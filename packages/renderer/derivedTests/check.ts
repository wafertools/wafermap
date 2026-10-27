// Check one derived test's expression without building a map: the answer a host's editor shows while its
// user types. It runs the same parser, namespace and kind check `buildWaferMap` applies, so the two can never
// disagree about what is acceptable; what it cannot see is a cycle between derived tests, which the build
// reports as a `derived-test-invalid` warning.

import type { TestDef } from '../buildWaferMap.js';
import { isStdfTestNumber, STDF_TEST_NUM_MAX } from '../../core/stdf.js';
import { parseExpression, type AccessorKind } from './parser.js';
import { unitMismatch, type DerivedTestDef } from './apply.js';

export interface DerivedCheckInput {
  expression: string;
  /** The number the derived test will have; a derived test may not read itself. */
  testNumber: number;
  /** The declared kind. Omitted: not checked against what the expression produces. */
  testType?: 'P' | 'F';
  constants?: Record<string, number>;
}

export type DerivedCheck =
  | {
      ok: true;
      /** What the expression produces: a measurement, or a true/false verdict (which needs `testType: 'F'`). */
      produces: 'number' | 'verdict';
      /** Every test the expression reads, and how, in order of appearance. */
      reads: { kind: AccessorKind; test: number }[];
      /** Advice that does not stop the test being built, such as units combined by `+`. */
      warnings: string[];
    }
  | {
      ok: false;
      message: string;
      /** 0-based character offset into `expression`, when the problem has one. */
      position?: number;
    };

/**
 * `testDefs` are the measured tests the expression may read; `otherDerived` are the host's *other* derived
 * tests, which it may read too. The identity rules are the build's: a test number is a whole number from 0 to
 * the STDF maximum, and neither a measured test nor another derived test may already have it.
 */
export function checkDerivedExpression(
  input: DerivedCheckInput,
  testDefs: readonly TestDef[],
  otherDerived: readonly DerivedTestDef[] = [],
): DerivedCheck {
  if (typeof input.expression !== 'string' || input.expression.trim() === '') {
    return { ok: false, message: 'The expression is empty.' };
  }
  if (!isStdfTestNumber(input.testNumber)) {
    return { ok: false, message: `The test number must be a whole number from 0 to ${STDF_TEST_NUM_MAX}, as STDF stores it.` };
  }
  const namespace = new Map<number, TestDef>(testDefs.map(d => [d.testNumber, d]));
  if (namespace.has(input.testNumber)) {
    return { ok: false, message: `Test number ${input.testNumber} already exists in the data; give the derived test an unused number.` };
  }
  for (const d of otherDerived) {
    if (d.testNumber === input.testNumber) {
      return { ok: false, message: `Test number ${input.testNumber} is used by another derived test.` };
    }
    const { expression: _e, constants: _c, ...def } = d;
    namespace.set(d.testNumber, { ...def, testType: d.testType ?? 'P' });
  }
  const parsed = parseExpression(input.expression, { testDefs: namespace, constants: input.constants ?? {} });
  if (!parsed.ok) return { ok: false, message: parsed.message, position: parsed.position };

  const verdict = parsed.type === 'boolean';
  if (input.testType !== undefined && verdict !== (input.testType === 'F')) {
    return {
      ok: false,
      message: verdict
        ? 'The expression produces a true/false verdict, so the test must be functional.'
        : 'The test is functional but its expression produces a number; a functional test carries a verdict.',
    };
  }
  if (parsed.reads.some(r => r.test === input.testNumber)) {
    return { ok: false, message: 'The expression reads the test it defines.' };
  }
  const warnings = unitMismatch(parsed.ast, namespace).map(p => `Different units are combined: ${p}.`);
  return { ok: true, produces: verdict ? 'verdict' : 'number', reads: parsed.reads, warnings };
}
