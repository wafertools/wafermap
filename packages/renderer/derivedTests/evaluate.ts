/**
 * Evaluator for a parsed derived-test expression.
 *
 * Two rules govern every operation here, and they are deliberately different
 * from each other:
 *
 * 1. **Scalars propagate "unknown" strictly.** If any operand is `undefined` —
 *    a test not run on this die, a verdict never recorded, a value outside its
 *    limits' knowability — the whole expression is `undefined`, which becomes an
 *    absent entry and renders as no-data grey. Never `?? 0`, never `?? false`.
 *    A missing measurement is not a zero and a missing verdict is not a fail.
 *
 * 2. **Reducers skip unknowns and count only what is known.** This is the one
 *    intentional break from (1), and it is why `countKnown` exists: a die binned
 *    out early legitimately has no verdict for the tests that never ran, and
 *    under strict propagation `all(testPass[1010..1025])` would grey out most of
 *    a bad wafer instead of saying what it was asked. A reducer over an entirely
 *    unknown vector still returns `undefined` — there is nothing to reduce.
 *
 * A non-finite arithmetic result (`0/0`, `ln(-1)`, overflow) is `undefined` too,
 * for the same reason: `NaN` must reach the map as no-data, not as a value that
 * drags a mean toward zero or classifies as in-spec.
 */

import type { ExprNode } from './parser.js';
// minOf/maxOf iterate. `Math.min(...arr)` passes one argument per element and
// throws RangeError past ~131k of them — reachable from a wide test range.
import { minOf, maxOf } from '../../core/utils.js';

/** Per-die data the evaluator is allowed to reach. Deliberately a closed set of
 *  functions rather than the die object, so the AST has no path to anything
 *  else on the die or in the host. */
export interface EvalContext {
  /** Measured value of a parametric test, or `undefined` if not recorded. */
  value(test: number): number | undefined;
  /** Tester's recorded verdict, via `getTestPassStatus`. */
  testPass(test: number): boolean | undefined;
  /** Spec-limit judgement, via `classifySpec`. */
  specPass(test: number): boolean | undefined;
  /** The die's bin-based pass verdict, via `diePassStatus`. */
  diePass(): boolean | undefined;
}

type Scalar = number | boolean | undefined;
type Vector = Scalar[];

/** Coerce a numeric result to the library's no-data convention. */
function finite(n: number): number | undefined {
  return Number.isFinite(n) ? n : undefined;
}

function evalVector(node: Extract<ExprNode, { k: 'vec' }>, ctx: EvalContext): Vector {
  const read = (t: number): Scalar => node.kind === 't' ? ctx.value(t)
    : node.kind === 'testPass' ? ctx.testPass(t)
      : ctx.specPass(t);
  return node.tests.map(read);
}

function reduce(name: string, vec: Vector): Scalar {
  const known = vec.filter(v => v !== undefined);

  // `countKnown` is defined on an all-unknown vector — that is the number it
  // exists to report. Every other reducer has nothing to work with.
  if (name === 'countKnown') return known.length;
  if (known.length === 0) return undefined;

  switch (name) {
    case 'all':        return (known as boolean[]).every(Boolean);
    case 'any':        return (known as boolean[]).some(Boolean);
    case 'none':       return !(known as boolean[]).some(Boolean);
    case 'countTrue':  return (known as boolean[]).filter(Boolean).length;
    case 'countFalse': return (known as boolean[]).filter(v => !v).length;
    case 'min':        return minOf(known as number[]);
    case 'max':        return maxOf(known as number[]);
    case 'sum':        return finite((known as number[]).reduce((a, b) => a + b, 0));
    case 'mean':       return finite((known as number[]).reduce((a, b) => a + b, 0) / known.length);
    default:           return undefined;
  }
}

const SCALAR_FNS: Record<string, (args: number[]) => number> = {
  abs:   a => Math.abs(a[0]!),
  sqrt:  a => Math.sqrt(a[0]!),
  ln:    a => Math.log(a[0]!),
  log10: a => Math.log10(a[0]!),
  exp:   a => Math.exp(a[0]!),
  floor: a => Math.floor(a[0]!),
  ceil:  a => Math.ceil(a[0]!),
  round: a => Math.round(a[0]!),
  sign:  a => Math.sign(a[0]!),
  pow:   a => Math.pow(a[0]!, a[1]!),
  min:   a => minOf(a),
  max:   a => maxOf(a),
};

/**
 * Evaluate `node` for one die. Returns `undefined` when no answer is knowable.
 *
 * The AST is a plain data tree built by `parseExpression` and already statically
 * type-checked, so this walk performs no validation and cannot reach any host
 * value not exposed through `ctx`.
 */
export function evaluate(node: ExprNode, ctx: EvalContext): Scalar {
  switch (node.k) {
    case 'num': return node.value;

    case 'acc':
      return node.kind === 't' ? ctx.value(node.test)
        : node.kind === 'testPass' ? ctx.testPass(node.test)
          : ctx.specPass(node.test);

    case 'diePass': return ctx.diePass();

    case 'vec':
      // Unreachable: the parser rejects a vector-typed expression at the root
      // and every consumer is a reducer, handled in the 'call' branch.
      return undefined;

    case 'unary': {
      const v = evaluate(node.arg, ctx);
      if (v === undefined) return undefined;
      return node.op === '-' ? finite(-(v as number)) : !(v as boolean);
    }

    case 'binary': {
      // `and`/`or` still propagate unknown strictly rather than short-circuiting
      // on a known operand. `false and unknown` could arguably be `false`, but
      // three-valued shortcuts mean a die's result depends on which operand the
      // author happened to write first, which is not a property a wafer map
      // should have.
      const l = evaluate(node.left, ctx);
      if (l === undefined) return undefined;
      const r = evaluate(node.right, ctx);
      if (r === undefined) return undefined;

      switch (node.op) {
        case '+':  return finite((l as number) + (r as number));
        case '-':  return finite((l as number) - (r as number));
        case '*':  return finite((l as number) * (r as number));
        case '/':  return finite((l as number) / (r as number));
        case '%':  return finite((l as number) % (r as number));
        case '^':  return finite(Math.pow(l as number, r as number));
        case '<':  return (l as number) <  (r as number);
        case '<=': return (l as number) <= (r as number);
        case '>':  return (l as number) >  (r as number);
        case '>=': return (l as number) >= (r as number);
        case '==': return l === r;
        case '!=': return l !== r;
        case 'and': return (l as boolean) && (r as boolean);
        case 'or':  return (l as boolean) || (r as boolean);
      }
      return undefined;
    }

    case 'call': {
      // `if` is lazy in its branches: only the taken branch is evaluated, so an
      // unknown in the untaken branch does not poison a knowable answer. The
      // condition itself is strict.
      if (node.name === 'if') {
        const cond = evaluate(node.args[0]!, ctx);
        if (cond === undefined) return undefined;
        return evaluate(node.args[cond ? 1 : 2]!, ctx);
      }

      const first = node.args[0];
      if (node.args.length === 1 && first !== undefined && first.k === 'vec') {
        return reduce(node.name, evalVector(first, ctx));
      }

      const fn = SCALAR_FNS[node.name];
      if (fn === undefined) return undefined;
      const args: number[] = [];
      for (const a of node.args) {
        const v = evaluate(a, ctx);
        if (v === undefined) return undefined;
        args.push(v as number);
      }
      return finite(fn(args));
    }
  }
}
