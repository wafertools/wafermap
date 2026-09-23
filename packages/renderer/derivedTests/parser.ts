/**
 * Expression parser for derived tests.
 *
 * Deliberately hand-written and dependency-free. A general-purpose expression
 * library (mathjs, expr-eval) would be the only security boundary between a
 * shared `.json` template and the host application, and would have to be trusted
 * to contain no path back to `Function`/`eval`. This grammar is closed: the only
 * identifiers that resolve are the caller's own declared constants, the only data
 * reachable is the die being evaluated, and there is no member access, no
 * assignment, no indexing by anything but an integer literal, and no way to name
 * a host object. Nothing in the AST can express a call to something not in
 * `FUNCTIONS` below.
 *
 * Grammar (recursive descent, standard precedence):
 *
 * ```
 *   expr     := or
 *   or       := and ('or' and)*
 *   and      := not ('and' not)*
 *   not      := 'not' not | compare
 *   compare  := add (('<' | '<=' | '>' | '>=' | '==' | '!=') add)?
 *   add      := mul (('+' | '-') mul)*
 *   mul      := pow (('*' | '/' | '%') pow)*
 *   pow      := unary ('^' pow)?                      // right-associative
 *   unary    := '-' unary | primary
 *   primary  := NUMBER | IDENT | call | accessor | '(' expr ')'
 *   accessor := ('t' | 'testPass' | 'specPass') '[' INT ('..' INT)? ']'
 *   call     := IDENT '(' (expr (',' expr)*)? ')'
 * ```
 *
 * The one non-scalar path: a range accessor (`t[1010..1015]`) produces a VECTOR,
 * and a vector may ONLY be consumed by a reducer. There is no vector arithmetic,
 * no elementwise operator and no vector-valued constant — which is what stops
 * this grammar drifting into an array language.
 */

import type { TestDef } from '../buildWaferMap.js';
import { isParametricTest } from '../buildWaferMap.js';
import { hasSpecLimits } from '../spec.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Static type of an expression node. Checked at parse time, so a type error is
 *  a build warning with a position rather than a runtime surprise on one die. */
export type ExprType = 'number' | 'boolean' | 'numberVec' | 'boolVec';

/** Which per-die quantity an accessor reads. Mirrors `passFailDisplay`'s
 *  vocabulary exactly: `'test'` is the tester's recorded verdict, `'spec'` is the
 *  spec-limit judgement. `t` is the measured value itself. */
export type AccessorKind = 't' | 'testPass' | 'specPass';

export type ExprNode =
  | { k: 'num';     value: number }
  | { k: 'acc';     kind: AccessorKind; test: number }
  | { k: 'vec';     kind: AccessorKind; tests: number[] }
  | { k: 'diePass' }
  | { k: 'unary';   op: '-' | 'not'; arg: ExprNode }
  | { k: 'binary';  op: BinaryOp; left: ExprNode; right: ExprNode }
  | { k: 'call';    name: string; args: ExprNode[] };

export type BinaryOp =
  | '+' | '-' | '*' | '/' | '%' | '^'
  | '<' | '<=' | '>' | '>=' | '==' | '!='
  | 'and' | 'or';

export interface ParseOk {
  ok: true;
  ast: ExprNode;
  type: ExprType;
  /** Every test number the expression reads, for dependency and validity checks. */
  reads: { kind: AccessorKind; test: number }[];
  /** True when the expression consults the die's bin-based pass verdict. */
  usesDiePass: boolean;
}

export interface ParseErr {
  ok: false;
  /** Human-readable, already naming the position. */
  message: string;
  /** 0-based character offset in the source expression. */
  position: number;
}

export type ParseResult = ParseOk | ParseErr;

export interface ParseContext {
  /** Tests the expression may reference — the *source* defs only. A derived test
   *  referencing another derived test is rejected: chaining needs a dependency
   *  sort and a cycle check, which is a later feature, not a first one. */
  testDefs: Map<number, TestDef>;
  /** Caller-declared named constants. These are the ONLY resolvable identifiers
   *  besides function names, and they are substituted at parse time. */
  constants: Record<string, number>;
}

// ── Function table ────────────────────────────────────────────────────────────

/** Argument spec for a whitelisted function. `vec` accepts either vector type
 *  unless narrowed by `vecOf`. */
interface FnSpec {
  /** Fixed scalar arity, when the function takes numbers. */
  arity?: number;
  /** Variadic scalar form, e.g. `min(a, b, c)`. */
  variadic?: boolean;
  /** Reducer form: takes exactly one vector of this type. */
  vecOf?: 'numberVec' | 'boolVec' | 'any';
  /** Result type. */
  returns: ExprType;
}

/**
 * The complete set of callable names. Scalar maths plus the vector reducers.
 *
 * `min`/`max` are the only overloaded names: `min(a, b)` over scalars and
 * `min(t[1010..1015])` over a vector. Both mean the same thing, so one name is
 * right; the parser picks the form from the argument types.
 */
export const FUNCTIONS: Record<string, FnSpec[]> = {
  // Scalar maths
  abs:   [{ arity: 1, returns: 'number' }],
  sqrt:  [{ arity: 1, returns: 'number' }],
  ln:    [{ arity: 1, returns: 'number' }],
  log10: [{ arity: 1, returns: 'number' }],
  exp:   [{ arity: 1, returns: 'number' }],
  floor: [{ arity: 1, returns: 'number' }],
  ceil:  [{ arity: 1, returns: 'number' }],
  round: [{ arity: 1, returns: 'number' }],
  sign:  [{ arity: 1, returns: 'number' }],
  pow:   [{ arity: 2, returns: 'number' }],
  min:   [{ vecOf: 'numberVec', returns: 'number' }, { variadic: true, returns: 'number' }],
  max:   [{ vecOf: 'numberVec', returns: 'number' }, { variadic: true, returns: 'number' }],
  // Conditional — the bridge between the two type domains
  if:    [{ arity: 3, returns: 'number' }],
  // Boolean-vector reducers
  all:        [{ vecOf: 'boolVec', returns: 'boolean' }],
  any:        [{ vecOf: 'boolVec', returns: 'boolean' }],
  none:       [{ vecOf: 'boolVec', returns: 'boolean' }],
  countTrue:  [{ vecOf: 'boolVec', returns: 'number' }],
  countFalse: [{ vecOf: 'boolVec', returns: 'number' }],
  // Number-vector reducers
  mean: [{ vecOf: 'numberVec', returns: 'number' }],
  sum:  [{ vecOf: 'numberVec', returns: 'number' }],
  // Works on either vector — the honest denominator for any of the above
  countKnown: [{ vecOf: 'any', returns: 'number' }],
};

const ACCESSORS: AccessorKind[] = ['t', 'testPass', 'specPass'];

// ── Tokenizer ─────────────────────────────────────────────────────────────────

type TokKind = 'num' | 'ident' | 'op' | 'punc' | 'eof';
interface Tok { kind: TokKind; text: string; pos: number; value?: number }

const OPERATORS = ['<=', '>=', '==', '!=', '..', '+', '-', '*', '/', '%', '^', '<', '>'];
const PUNCT = ['(', ')', '[', ']', ','];

class ParseError extends Error {
  constructor(message: string, readonly position: number) { super(message); }
}

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }

    // Number. Note `..` must not be eaten as a decimal point: `1010..1015`
    // tokenizes as INT, RANGE, INT, so a digit run stops at a second dot.
    if (c >= '0' && c <= '9') {
      const start = i;
      while (i < src.length && src[i]! >= '0' && src[i]! <= '9') i++;
      if (src[i] === '.' && src[i + 1] !== '.') {
        i++;
        while (i < src.length && src[i]! >= '0' && src[i]! <= '9') i++;
      }
      if (src[i] === 'e' || src[i] === 'E') {
        const save = i;
        i++;
        if (src[i] === '+' || src[i] === '-') i++;
        if (src[i]! >= '0' && src[i]! <= '9') {
          while (i < src.length && src[i]! >= '0' && src[i]! <= '9') i++;
        } else i = save;
      }
      const text = src.slice(start, i);
      toks.push({ kind: 'num', text, pos: start, value: Number(text) });
      continue;
    }

    if (/[A-Za-z_]/.test(c)) {
      const start = i;
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i]!)) i++;
      toks.push({ kind: 'ident', text: src.slice(start, i), pos: start });
      continue;
    }

    const op = OPERATORS.find(o => src.startsWith(o, i));
    if (op) { toks.push({ kind: 'op', text: op, pos: i }); i += op.length; continue; }

    if (PUNCT.includes(c)) { toks.push({ kind: 'punc', text: c, pos: i }); i++; continue; }

    throw new ParseError(`Unexpected character ${JSON.stringify(c)} at position ${i}`, i);
  }
  toks.push({ kind: 'eof', text: '', pos: src.length });
  return toks;
}

// ── Parser ────────────────────────────────────────────────────────────────────

interface Typed { node: ExprNode; type: ExprType }

class Parser {
  private p = 0;
  readonly reads: { kind: AccessorKind; test: number }[] = [];
  usesDiePass = false;

  constructor(private readonly toks: Tok[], private readonly ctx: ParseContext) {}

  private peek(): Tok { return this.toks[this.p]!; }
  private next(): Tok { return this.toks[this.p++]!; }
  private at(text: string): boolean {
    const t = this.peek();
    return (t.kind === 'op' || t.kind === 'punc' || t.kind === 'ident') && t.text === text;
  }
  private eat(text: string): boolean { if (this.at(text)) { this.p++; return true; } return false; }
  private expect(text: string): Tok {
    if (!this.at(text)) {
      const t = this.peek();
      throw new ParseError(
        `Expected ${JSON.stringify(text)} but found ${t.kind === 'eof' ? 'end of expression' : JSON.stringify(t.text)} at position ${t.pos}`,
        t.pos);
    }
    return this.next();
  }

  parse(): Typed {
    const out = this.parseOr();
    const t = this.peek();
    if (t.kind !== 'eof') {
      throw new ParseError(`Unexpected ${JSON.stringify(t.text)} at position ${t.pos}`, t.pos);
    }
    return out;
  }

  private requireScalar(v: Typed, what: string, pos: number): ExprType {
    if (v.type === 'numberVec' || v.type === 'boolVec') {
      throw new ParseError(
        `${what} cannot be applied to a test range at position ${pos} — a range must be reduced first, e.g. mean(t[1010..1015]) or all(testPass[1010..1015])`,
        pos);
    }
    return v.type;
  }

  private parseOr(): Typed {
    let left = this.parseAnd();
    while (this.at('or')) {
      const pos = this.next().pos;
      const right = this.parseAnd();
      this.requireBool(left, 'or', pos); this.requireBool(right, 'or', pos);
      left = { node: { k: 'binary', op: 'or', left: left.node, right: right.node }, type: 'boolean' };
    }
    return left;
  }

  private parseAnd(): Typed {
    let left = this.parseNot();
    while (this.at('and')) {
      const pos = this.next().pos;
      const right = this.parseNot();
      this.requireBool(left, 'and', pos); this.requireBool(right, 'and', pos);
      left = { node: { k: 'binary', op: 'and', left: left.node, right: right.node }, type: 'boolean' };
    }
    return left;
  }

  private requireBool(v: Typed, op: string, pos: number): void {
    this.requireScalar(v, `Operator ${JSON.stringify(op)}`, pos);
    if (v.type !== 'boolean') {
      throw new ParseError(
        `Operator ${JSON.stringify(op)} needs a true/false operand at position ${pos}, but got a number — compare it first, e.g. t[1020] > 5`,
        pos);
    }
  }

  private parseNot(): Typed {
    if (this.at('not')) {
      const pos = this.next().pos;
      const arg = this.parseNot();
      this.requireBool(arg, 'not', pos);
      return { node: { k: 'unary', op: 'not', arg: arg.node }, type: 'boolean' };
    }
    return this.parseCompare();
  }

  private parseCompare(): Typed {
    const left = this.parseAdd();
    const t = this.peek();
    if (t.kind === 'op' && ['<', '<=', '>', '>=', '==', '!='].includes(t.text)) {
      this.next();
      const right = this.parseAdd();
      const lt = this.requireScalar(left, `Operator ${JSON.stringify(t.text)}`, t.pos);
      const rt = this.requireScalar(right, `Operator ${JSON.stringify(t.text)}`, t.pos);
      if (lt !== rt) {
        throw new ParseError(
          `Cannot compare a ${lt} with a ${rt} at position ${t.pos}`, t.pos);
      }
      if (lt === 'boolean' && t.text !== '==' && t.text !== '!=') {
        throw new ParseError(
          `Operator ${JSON.stringify(t.text)} cannot order true/false values at position ${t.pos}`, t.pos);
      }
      return {
        node: { k: 'binary', op: t.text as BinaryOp, left: left.node, right: right.node },
        type: 'boolean',
      };
    }
    return left;
  }

  private parseAdd(): Typed {
    let left = this.parseMul();
    for (;;) {
      const t = this.peek();
      if (t.kind !== 'op' || (t.text !== '+' && t.text !== '-')) return left;
      this.next();
      const right = this.parseMul();
      this.requireNum(left, t.text, t.pos); this.requireNum(right, t.text, t.pos);
      left = { node: { k: 'binary', op: t.text, left: left.node, right: right.node }, type: 'number' };
    }
  }

  private parseMul(): Typed {
    let left = this.parsePow();
    for (;;) {
      const t = this.peek();
      if (t.kind !== 'op' || !['*', '/', '%'].includes(t.text)) return left;
      this.next();
      const right = this.parsePow();
      this.requireNum(left, t.text, t.pos); this.requireNum(right, t.text, t.pos);
      left = { node: { k: 'binary', op: t.text as BinaryOp, left: left.node, right: right.node }, type: 'number' };
    }
  }

  private parsePow(): Typed {
    const left = this.parseUnary();
    const t = this.peek();
    if (t.kind === 'op' && t.text === '^') {
      this.next();
      const right = this.parsePow(); // right-associative
      this.requireNum(left, '^', t.pos); this.requireNum(right, '^', t.pos);
      return { node: { k: 'binary', op: '^', left: left.node, right: right.node }, type: 'number' };
    }
    return left;
  }

  private requireNum(v: Typed, op: string, pos: number): void {
    this.requireScalar(v, `Operator ${JSON.stringify(op)}`, pos);
    if (v.type !== 'number') {
      throw new ParseError(
        `Operator ${JSON.stringify(op)} needs a numeric operand at position ${pos}, but got a true/false value`,
        pos);
    }
  }

  private parseUnary(): Typed {
    const t = this.peek();
    if (t.kind === 'op' && t.text === '-') {
      this.next();
      const arg = this.parseUnary();
      this.requireNum(arg, '-', t.pos);
      return { node: { k: 'unary', op: '-', arg: arg.node }, type: 'number' };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Typed {
    const t = this.next();

    if (t.kind === 'num') return { node: { k: 'num', value: t.value! }, type: 'number' };

    if (t.kind === 'punc' && t.text === '(') {
      const inner = this.parseOr();
      this.expect(')');
      return inner;
    }

    if (t.kind === 'ident') {
      if ((ACCESSORS as string[]).includes(t.text)) return this.parseAccessor(t.text as AccessorKind, t.pos);
      if (t.text === 'diePass') {
        // Call syntax is required so it can never be mistaken for a constant.
        this.expect('('); this.expect(')');
        this.usesDiePass = true;
        return { node: { k: 'diePass' }, type: 'boolean' };
      }
      if (this.at('(')) return this.parseCall(t.text, t.pos);
      if (Object.prototype.hasOwnProperty.call(this.ctx.constants, t.text)) {
        const v = this.ctx.constants[t.text]!;
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          throw new ParseError(`Constant ${JSON.stringify(t.text)} at position ${t.pos} is not a finite number`, t.pos);
        }
        return { node: { k: 'num', value: v }, type: 'number' };
      }
      throw new ParseError(
        `Unknown name ${JSON.stringify(t.text)} at position ${t.pos}. Test values are read as t[1020], verdicts as testPass[1020] or specPass[1020]; other names must be declared in \`constants\`.`,
        t.pos);
    }

    throw new ParseError(
      `Unexpected ${t.kind === 'eof' ? 'end of expression' : JSON.stringify(t.text)} at position ${t.pos}`, t.pos);
  }

  /** `t[1020]`, `testPass[1020]`, `specPass[1010..1015]`. */
  private parseAccessor(kind: AccessorKind, pos: number): Typed {
    this.expect('[');
    const from = this.expectInt();
    let tests: number[] | undefined;
    if (this.eat('..')) {
      const to = this.expectInt();
      if (to < from) {
        throw new ParseError(`Test range ${from}..${to} at position ${pos} runs backwards`, pos);
      }
      // A range is a convenience for naming a contiguous block of test numbers;
      // it is not an assertion that every number in it exists. Only the numbers
      // that ARE declared tests are read, so a sweep with gaps still works. An
      // entirely empty range is a mistake worth reporting, though.
      tests = [];
      for (let n = from; n <= to; n++) if (this.ctx.testDefs.has(n)) tests.push(n);
      if (tests.length === 0) {
        throw new ParseError(
          `Test range ${from}..${to} at position ${pos} matches no declared test`, pos);
      }
    }
    this.expect(']');

    const numbers = tests ?? [from];
    for (const n of numbers) this.checkAccessible(kind, n, pos);
    for (const n of numbers) this.reads.push({ kind, test: n });

    const elemType: ExprType = kind === 't' ? 'number' : 'boolean';
    if (tests === undefined) {
      return { node: { k: 'acc', kind, test: from }, type: elemType };
    }
    return {
      node: { k: 'vec', kind, tests },
      type: elemType === 'number' ? 'numberVec' : 'boolVec',
    };
  }

  /**
   * Static validity of one accessor against the declared tests. Every one of
   * these is knowable at build time, so it is a build warning with a position
   * rather than a silent no-data die.
   */
  private checkAccessible(kind: AccessorKind, test: number, pos: number): void {
    const def = this.ctx.testDefs.get(test);
    if (def === undefined) {
      throw new ParseError(
        `Test ${test} at position ${pos} is not declared in \`testDefs\``, pos);
    }
    if (kind === 't' && !isParametricTest(def)) {
      throw new ParseError(
        `t[${test}] at position ${pos} reads a measured value, but test ${test} is functional (testType 'F') and has no measured value — use testPass[${test}] for its verdict`,
        pos);
    }
    if (kind === 'specPass') {
      if (!isParametricTest(def)) {
        throw new ParseError(
          `specPass[${test}] at position ${pos} needs spec limits, but test ${test} is functional (testType 'F') — use testPass[${test}] for its recorded verdict`,
          pos);
      }
      if (!hasSpecLimits(def)) {
        throw new ParseError(
          `specPass[${test}] at position ${pos} needs \`limitLow\` or \`limitHigh\` on test ${test}, which declares neither`,
          pos);
      }
    }
  }

  private expectInt(): number {
    const t = this.peek();
    if (t.kind !== 'num' || !Number.isInteger(t.value)) {
      throw new ParseError(
        `Expected a test number at position ${t.pos}`, t.pos);
    }
    this.next();
    return t.value!;
  }

  private parseCall(name: string, pos: number): Typed {
    const specs = FUNCTIONS[name];
    if (specs === undefined) {
      throw new ParseError(
        `Unknown function ${JSON.stringify(name)} at position ${pos}. Available: ${Object.keys(FUNCTIONS).sort().join(', ')}`,
        pos);
    }
    this.expect('(');
    const args: Typed[] = [];
    if (!this.at(')')) {
      do { args.push(this.parseOr()); } while (this.eat(','));
    }
    this.expect(')');

    const argTypes = args.map(a => a.type);
    const node: ExprNode = { k: 'call', name, args: args.map(a => a.node) };

    for (const spec of specs) {
      if (spec.vecOf !== undefined) {
        if (argTypes.length !== 1) continue;
        const a = argTypes[0]!;
        const isVec = a === 'numberVec' || a === 'boolVec';
        if (!isVec) continue;
        if (spec.vecOf !== 'any' && spec.vecOf !== a) continue;
        return { node, type: spec.returns };
      }
      if (spec.variadic) {
        if (argTypes.length < 2 || !argTypes.every(a => a === 'number')) continue;
        return { node, type: spec.returns };
      }
      if (spec.arity !== undefined) {
        if (argTypes.length !== spec.arity) continue;
        if (name === 'if') {
          if (argTypes[0] !== 'boolean' || argTypes[1] !== 'number' || argTypes[2] !== 'number') continue;
          return { node, type: 'number' };
        }
        if (!argTypes.every(a => a === 'number')) continue;
        return { node, type: spec.returns };
      }
    }

    throw new ParseError(
      `${name}(${argTypes.join(', ')}) at position ${pos} is not a valid call — ${describeSignatures(name, specs)}`,
      pos);
  }
}

function describeSignatures(name: string, specs: FnSpec[]): string {
  const forms = specs.map(s => {
    if (s.vecOf === 'boolVec')  return `${name}(<true/false test range>)`;
    if (s.vecOf === 'numberVec') return `${name}(<value test range>)`;
    if (s.vecOf === 'any')       return `${name}(<test range>)`;
    if (s.variadic)              return `${name}(number, number, …)`;
    if (name === 'if')           return 'if(<true/false>, number, number)';
    return `${name}(${Array.from({ length: s.arity ?? 0 }, () => 'number').join(', ')})`;
  });
  return `expected ${forms.join(' or ')}`;
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Parse and statically type-check one derived-test expression.
 *
 * Never throws: a malformed expression comes back as `{ ok: false }` with a
 * message and a character position, which `buildWaferMap` turns into a
 * `derived-test-invalid` warning. The derived test is then dropped rather than
 * evaluated — a half-working expression would silently plot wrong numbers.
 */
export function parseExpression(source: string, ctx: ParseContext): ParseResult {
  try {
    if (source.length > MAX_EXPRESSION_LENGTH) {
      return {
        ok: false,
        message: `Expression is ${source.length} characters, over the ${MAX_EXPRESSION_LENGTH} limit`,
        position: MAX_EXPRESSION_LENGTH,
      };
    }
    const parser = new Parser(tokenize(source), ctx);
    const { node, type } = parser.parse();
    if (type === 'numberVec' || type === 'boolVec') {
      return {
        ok: false,
        message: 'Expression results in a test range, not a single value — reduce it, e.g. mean(t[1010..1015]) or all(testPass[1010..1015])',
        position: 0,
      };
    }
    return { ok: true, ast: node, type, reads: parser.reads, usesDiePass: parser.usesDiePass };
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, message: e.message, position: e.position };
    throw e;
  }
}

/** Bound on source length. A shared template is untrusted input; an expression
 *  longer than this is a mistake or an attack, not a measurement. */
export const MAX_EXPRESSION_LENGTH = 2000;
