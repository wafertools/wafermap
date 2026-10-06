/**
 * Build-time application of derived tests.
 *
 * Runs over raw `DieResult` records **before** `collapseLotStack` and before
 * retest resolution, and that ordering is load-bearing:
 *
 * - **Before stacking.** `abs(t[1020] - t[1010])` computed from the two raw
 *   values on one probe record is a real measurement of one die. The same
 *   expression computed from two independently aggregated stacks is a difference
 *   of two averages over possibly different die populations — a number with no
 *   physical meaning that would nonetheless plot happily.
 * - **Before retest collapse.** Every accessor then reads the same probe record,
 *   so a derived value can never mix a value from one touchdown with a verdict
 *   from another. `retestPolicy` afterwards selects among records that already
 *   carry their own derived value.
 *
 * A derived test is an ordinary test from here on: it lands in `testValues` (or
 * `testPass`, if its expression is boolean) and its def joins `testDefs`, so
 * every downstream surface — value plot modes, the colorbar, tooltips,
 * `analyzeWaferMap`, Insights, the report, gallery reconciliation — picks it up
 * with no further change.
 */

import { isStdfTestNumber, STDF_TEST_NUM_MAX } from '../../core/stdf.js';
import { diePassStatus } from '../../core/dies.js';
import type { DieResult, TestDef, WaferWarning } from '../buildWaferMap.js';
import { getTestPassStatus, isParametricTest } from '../buildWaferMap.js';
import { classifySpec } from '../spec.js';
import { parseExpression, type ExprNode, type ParseContext } from './parser.js';
import { evaluate, type EvalContext } from './evaluate.js';
import type { DieTable } from '../../core/dieTable.js';
import {
  extendTable, rowView, testValue, HAS_VALUES, HAS_VERDICTS, VERDICT_FAIL, VERDICT_NONE, VERDICT_PASS,
} from '../../core/dieTable.js';

/**
 * A test whose values are computed from other tests on the same die, rather than
 * measured by the tester.
 *
 * It is a `TestDef` with an expression, not a parallel concept: `unit`,
 * `limitLow`/`limitHigh` and `logScale` already mean exactly the right thing for
 * a derived quantity, and `result.testDefs` stays one homogeneous array.
 *
 * ```ts
 * { testNumber: 900001, name: 'Leakage Shift', unit: 'uA',
 *   expression: 'abs(t[1020] - t[1010])', limitHigh: 5 }
 *
 * { testNumber: 900002, name: 'Sweep All Pass', testType: 'F',
 *   expression: 'all(testPass[1010..1025])' }
 * ```
 */
export interface DerivedTestDef extends TestDef {
  /**
   * Expression over other tests on the same die.
   *
   * Reads: `t[n]` (measured value, parametric tests only), `testPass[n]` (the
   * tester's recorded verdict), `specPass[n]` (spec-limit judgement, needs
   * limits), `diePass()` (the die's bin verdict). A range — `t[1010..1015]` —
   * produces a set that must be reduced: `mean`, `sum`, `min`, `max`, `all`,
   * `any`, `none`, `countTrue`, `countFalse`, `countKnown`.
   *
   * Operators `+ - * / % ^`, comparisons, `and`/`or`/`not`, and
   * `if(cond, a, b)`. Functions `abs sqrt ln log10 exp floor ceil round sign
   * pow min max`.
   *
   * Evaluated with no JavaScript engine of any kind: it is parsed to a typed
   * tree at build time and walked per die. There is no `eval`, no `Function`,
   * no member access and no way to name a host object.
   */
  expression: string;
  /** Named constants usable in `expression`. The only resolvable identifiers
   *  besides function names. */
  constants?: Record<string, number>;
  /**
   * Marks this def as derived. Set by `buildWaferMap`, never by the caller.
   *
   * It is a display flag: every surface that names the test reads it, through
   * `renderer/testLabel.ts`, to show that the value was not measured. It does
   * NOT exclude derived tests from anything — a derived test is an ordinary test
   * from the build onwards, and appears in `functionalYield`, the per-test
   * statistics, capability, findings and Insights exactly like a measured one.
   */
  readonly derived?: true;
}

/** One compiled, validated derived test, ready to evaluate per die. */
interface Compiled {
  def: TestDef & { derived: true };
  ast: ExprNode;
  /** Boolean expressions are verdicts and must land in `testPass`, never as a
   *  1/0 in `testValues` — which would put them in the correlation matrix and
   *  the Cpk table and resurrect the legacy 0/1 ambiguity. */
  boolean: boolean;
}

export interface ApplyResult {
  /** The wafer's table with the derived columns added (the input table when nothing was derived). */
  table: DieTable;
  testDefs: TestDef[] | undefined;
  warnings: WaferWarning[];
}

function warn(message: string): WaferWarning {
  return { code: 'derived-test-invalid', message, severity: 'warning' };
}

/**
 * Unit agreement across `+` and `-`. The library knows the units, so staying
 * silent about a volts-minus-amps subtraction would be exactly the kind of
 * unlabelled nonsense the design principles forbid. It is a warning rather than
 * a rejection: unit strings are free text and a site may legitimately use
 * `"uA"` and `"µA"` for the same thing, so refusing to build would be worse than
 * saying so.
 */
function unitMismatch(node: ExprNode, defs: Map<number, TestDef>): string[] {
  const problems: string[] = [];
  const unitsOf = (n: ExprNode): Set<string> | undefined => {
    switch (n.k) {
      case 'acc': {
        if (n.kind !== 't') return undefined;
        const u = defs.get(n.test)?.unit;
        return u ? new Set([u]) : undefined;
      }
      case 'unary': return n.op === '-' ? unitsOf(n.arg) : undefined;
      case 'binary': {
        const l = unitsOf(n.left); const r = unitsOf(n.right);
        if (n.op === '+' || n.op === '-') {
          if (l && r) {
            const merged = new Set([...l, ...r]);
            if (merged.size > 1) {
              problems.push(`${[...merged].join(' and ')} are combined by "${n.op}"`);
            }
            return merged;
          }
          return l ?? r;
        }
        return undefined;
      }
      case 'call': {
        if (n.name === 'min' || n.name === 'max' || n.name === 'mean' || n.name === 'sum') {
          const first = n.args[0];
          if (first?.k === 'vec' && first.kind === 't') {
            const us = new Set(first.tests.map(t => defs.get(t)?.unit).filter((u): u is string => !!u));
            if (us.size > 1) problems.push(`${[...us].join(' and ')} are combined by "${n.name}"`);
            return us;
          }
        }
        return undefined;
      }
      default: return undefined;
    }
  };
  unitsOf(node);
  return problems;
}

/**
 * Compile `derivedTests` against the declared `testDefs`.
 *
 * Two passes, because derived tests may reference each other:
 *
 * 1. **Admit and parse.** Every entry that clears the identity checks is parsed
 *    against a namespace containing the source tests AND all declared derived
 *    tests, so `t[900001]` resolves. Parsing is what reveals the dependencies.
 * 2. **Order and prune.** The parsed entries are topologically sorted so a test
 *    is always evaluated after the ones it reads. A cycle, or a dependency on an
 *    entry that was itself rejected, drops the dependent with a warning naming
 *    the cause — an expression whose input never materialises would otherwise
 *    evaluate to no-data on every die and look like missing data.
 *
 * Rejected tests are dropped entirely rather than partially applied: a
 * half-working expression silently plots wrong numbers, which is worse than a
 * missing plot mode.
 */
function compile(
  derivedTests: DerivedTestDef[],
  testDefs: TestDef[] | undefined,
  measuredNumbers: Set<number>,
): { compiled: Compiled[]; warnings: WaferWarning[] } {
  const warnings: WaferWarning[] = [];
  const sourceDefs = new Map((testDefs ?? []).map(d => [d.testNumber, d]));

  const labelOf = (d: DerivedTestDef): string =>
    `${JSON.stringify(d.name ?? '')} (test ${d.testNumber})`;

  // ── Pass 1a: identity. Done before any parsing so the namespace the
  // expressions are checked against contains only entries that can really exist.
  const admitted: DerivedTestDef[] = [];
  const taken = new Set<number>();
  for (const raw of derivedTests) {
    const label = labelOf(raw);
    if (!isStdfTestNumber(raw.testNumber)) {
      warnings.push(warn(`Derived test ${label} was dropped: \`testNumber\` must be a whole number from 0 to ${STDF_TEST_NUM_MAX}, as STDF stores it.`));
      continue;
    }
    // Measured data is ground truth and is never overwritten by a computed
    // value. The caller picks the number, so a collision is the caller's to fix.
    if (measuredNumbers.has(raw.testNumber) || sourceDefs.has(raw.testNumber)) {
      warnings.push(warn(
        `Derived test ${label} was dropped: test number ${raw.testNumber} already exists in the data. Measured values are never replaced by a derived test — give it an unused number.`));
      continue;
    }
    if (taken.has(raw.testNumber)) {
      warnings.push(warn(`Derived test ${label} was dropped: test number ${raw.testNumber} is used by an earlier derived test.`));
      continue;
    }
    if (typeof raw.expression !== 'string' || raw.expression.trim() === '') {
      warnings.push(warn(`Derived test ${label} was dropped: \`expression\` is empty.`));
      continue;
    }
    taken.add(raw.testNumber);
    admitted.push(raw);
  }

  // The namespace expressions are checked against: real tests plus every
  // admitted derived test, described by its DECLARED `testType` and limits. A
  // declaration that turns out to disagree with its own expression is caught
  // below and drops the test, which then cascades to anything reading it.
  const namespace = new Map(sourceDefs);
  for (const d of admitted) {
    const { expression: _e, constants: _c, ...def } = d;
    namespace.set(d.testNumber, { ...def, testType: d.testType ?? 'P' });
  }

  // ── Pass 1b: parse and type-check.
  interface Parsed { raw: DerivedTestDef; compiled: Compiled; deps: number[] }
  const parsedByNumber = new Map<number, Parsed>();
  const dropped = new Set<number>();

  for (const raw of admitted) {
    const label = labelOf(raw);
    const ctx: ParseContext = { testDefs: namespace, constants: raw.constants ?? {} };
    const parsed = parseExpression(raw.expression, ctx);
    if (!parsed.ok) {
      warnings.push(warn(`Derived test ${label} was dropped: ${parsed.message}`));
      dropped.add(raw.testNumber);
      continue;
    }

    // The declared kind must match what the expression actually produces. Both
    // are known here, so a mismatch is reported with the reason rather than
    // silently coercing a verdict into a measurement or vice versa.
    const producesBoolean = parsed.type === 'boolean';
    const declaredFunctional = !isParametricTest(raw);
    if (producesBoolean !== declaredFunctional) {
      warnings.push(warn(producesBoolean
        ? `Derived test ${label} was dropped: its expression produces a true/false verdict, so it must declare \`testType: 'F'\`.`
        : `Derived test ${label} was dropped: it declares \`testType: 'F'\` but its expression produces a number. Functional tests carry a verdict, not a measurement.`));
      dropped.add(raw.testNumber);
      continue;
    }
    if (producesBoolean && (raw.limitLow !== undefined || raw.limitHigh !== undefined)) {
      warnings.push(warn(`Derived test ${label}: test limits are ignored on a true/false derived test.`));
    }

    if (raw.testNumber === undefined) continue;
    const self = raw.testNumber;
    const deps = [...new Set(parsed.reads.map(r => r.test))].filter(t => t !== self && taken.has(t));
    if (parsed.reads.some(r => r.test === self)) {
      warnings.push(warn(`Derived test ${label} was dropped: its expression reads itself.`));
      dropped.add(self);
      continue;
    }

    for (const problem of unitMismatch(parsed.ast, namespace)) {
      warnings.push(warn(
        `Derived test ${label} combines different units — ${problem}. The result is computed as written; set \`unit\` on the derived test to say what it is.`));
    }

    // `expression` and `constants` travel WITH the def rather than being
    // stripped here. They are what a tooltip or panel needs to say where a
    // computed number came from, and the alternative — asking the host to hold
    // its `derivedTests` input alongside the result and join the two by test
    // number — is a second source of truth that can disagree with the def that
    // was actually admitted (this one carries the resolved `testType`).
    parsedByNumber.set(self, {
      raw,
      compiled: {
        def: { ...raw, testType: producesBoolean ? 'F' : 'P', derived: true },
        ast: parsed.ast,
        boolean: producesBoolean,
      },
      deps,
    });
  }

  // ── Pass 2: order by dependency, pruning cycles and orphans.
  //
  // Depth-first with a colour mark. Evaluation order is the whole point: a
  // nested derived test must read a value that has already been computed for
  // this die, so declaration order is not good enough.
  const compiled: Compiled[] = [];
  const state = new Map<number, 'visiting' | 'done'>();

  const visit = (n: number, stack: number[]): boolean => {
    if (state.get(n) === 'done')     return !dropped.has(n);
    if (state.get(n) === 'visiting') {
      const cycle = [...stack.slice(stack.indexOf(n)), n].join(' → ');
      for (const m of stack.slice(stack.indexOf(n))) {
        if (dropped.has(m)) continue;
        dropped.add(m);
        warnings.push(warn(
          `Derived test ${labelOf(parsedByNumber.get(m)!.raw)} was dropped: its expression depends on itself through ${cycle}.`));
      }
      return false;
    }

    const entry = parsedByNumber.get(n);
    if (entry === undefined) return false;   // rejected in pass 1

    state.set(n, 'visiting');
    let ok = true;
    for (const dep of entry.deps) {
      if (!visit(dep, [...stack, n])) {
        if (!dropped.has(n)) {
          dropped.add(n);
          const depLabel = parsedByNumber.get(dep)?.raw.name ?? `test ${dep}`;
          warnings.push(warn(
            `Derived test ${labelOf(entry.raw)} was dropped: it reads ${JSON.stringify(depLabel)} (test ${dep}), which was itself dropped.`));
        }
        ok = false;
        break;
      }
    }
    state.set(n, 'done');
    if (!ok || dropped.has(n)) return false;
    compiled.push(entry.compiled);
    return true;
  };

  // Declaration order drives the walk, so an independent set keeps the order the
  // caller wrote and the output is stable.
  for (const raw of admitted) visit(raw.testNumber, []);

  return { compiled, warnings };
}

/**
 * Apply `derivedTests` to a wafer's records: `records[i]` is row `i` of
 * `table` (its bins give `diePass()`). Returns a copy of the table with a
 * column per derived test, and `testDefs` extended with the derived defs.
 * Neither the records nor the table passed in are changed.
 */
export function applyDerivedTests(
  records: readonly DieResult[],
  table: DieTable,
  testDefs: TestDef[] | undefined,
  derivedTests: DerivedTestDef[] | undefined,
  passBins: ReadonlySet<number>,
): ApplyResult {
  if (derivedTests === undefined || derivedTests.length === 0) {
    return { table, testDefs, warnings: [] };
  }

  const measured = new Set<number>();
  for (const [tn, col] of table.values) if (col.some(v => !Number.isNaN(v))) measured.add(tn);
  for (const [tn, col] of table.verdicts) if (col.some(v => v !== VERDICT_NONE)) measured.add(tn);

  const { compiled, warnings } = compile(derivedTests, testDefs, measured);
  if (compiled.length === 0) return { table, testDefs, warnings };

  // Includes the derived defs, in dependency order, so a nested derived test's
  // `specPass[n]` is judged against the limits declared on the test it reads.
  const defsByNumber = new Map<number, TestDef>((testDefs ?? []).map(d => [d.testNumber, d]));
  for (const c of compiled) defsByNumber.set(c.def.testNumber, c.def);

  // A column per derived test, written row by row. `compiled` is in dependency
  // order, so a nested derived test reads the value computed for this row a
  // moment ago, which is what makes nesting work.
  const n = table.rows;
  const newValues = new Map<number, Float64Array>();
  const newVerdicts = new Map<number, Int8Array>();
  for (const c of compiled) {
    if (c.boolean) newVerdicts.set(c.def.testNumber, new Int8Array(n).fill(VERDICT_NONE));
    else newValues.set(c.def.testNumber, new Float64Array(n).fill(NaN));
  }
  const out = extendTable(table, newValues, newVerdicts);
  const at = rowView(out);

  for (let i = 0; i < n; i++) {
    const row = at(i);
    const readValue = (t: number): number | undefined => testValue(row, t);
    const ctx: EvalContext = {
      value:    readValue,
      testPass: t => getTestPassStatus(row, t, defsByNumber.get(t)),
      specPass: t => {
        const cat = classifySpec(readValue(t), defsByNumber.get(t));
        return cat === null ? undefined : cat === 'pass';
      },
      // THE per-die pass rule, not a copy of it: `diePass()` in an expression
      // must agree with yield and the failing-die hatch on every die.
      diePass: () => diePassStatus(records[i], passBins),
      // A die's own recorded field. An absent one is absent, not zero: die (0, 0) and "no position" must stay different.
      field: name => {
        const rec = records[i];
        const v = name === 'x' ? rec.x : name === 'y' ? rec.y : name === 'hbin' ? rec.hbin : name === 'sbin' ? rec.sbin : rec.siteNum;
        return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
      },
    };

    for (const c of compiled) {
      const v = evaluate(c.ast, ctx);
      // An unknown result is an ABSENT entry, not a zero and not a false. The
      // die then reads as no-data everywhere, and is excluded from the stat
      // populations rather than dragging them. A dependent derived test reading
      // it gets `undefined` and goes absent too, by the same rule.
      if (v === undefined) continue;
      if (c.boolean) {
        newVerdicts.get(c.def.testNumber)![i] = v ? VERDICT_PASS : VERDICT_FAIL;
        out.fields[i] |= HAS_VERDICTS;
      } else {
        newValues.get(c.def.testNumber)![i] = v as number;
        out.fields[i] |= HAS_VALUES;
      }
    }
  }

  return {
    table: out,
    testDefs: [...(testDefs ?? []), ...compiled.map(c => c.def)],
    warnings,
  };
}
