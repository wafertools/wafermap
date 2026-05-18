import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/packages/renderer/buildWaferMap.js';

const waferConfig = { diameter: 300 };
const dieConfig   = { width: 10, height: 10 };

function result(x, y, hbin) {
  return { x, y, hbin };
}

test("retestPolicy 'last' keeps last result (default)", () => {
  const { dies } = buildWaferMap({
    results: [result(0, 0, 3), result(0, 0, 1)],
    waferConfig, dieConfig,
  });
  assert.equal(dies.find(d => d.x === 0 && d.y === 0)?.hbin, 1);
});

test("retestPolicy 'first' keeps first result", () => {
  const { dies } = buildWaferMap({
    results: [result(0, 0, 3), result(0, 0, 1)],
    retestPolicy: 'first',
    waferConfig, dieConfig,
  });
  assert.equal(dies.find(d => d.x === 0 && d.y === 0)?.hbin, 3);
});

// ── 'best': pass beats fail; tiebreak by lower hbin ──────────────────────────

test("retestPolicy 'best' — pass beats fail (all-fail then pass)", () => {
  // bin 1 = pass; bins 3,5 = fail — best should pick the pass
  const { dies } = buildWaferMap({
    results: [result(0, 0, 5), result(0, 0, 3), result(0, 0, 1)],
    retestPolicy: 'best',
    passBins: [1],
    waferConfig, dieConfig,
  });
  assert.equal(dies.find(d => d.x === 0 && d.y === 0)?.hbin, 1);
});

test("retestPolicy 'best' — pass beats fail even when pass bin is higher number", () => {
  // passBins: [3] — bin 3 is pass, bin 1 is fail despite being numerically lower
  const { dies } = buildWaferMap({
    results: [result(0, 0, 1), result(0, 0, 3)],
    retestPolicy: 'best',
    passBins: [3],
    waferConfig, dieConfig,
  });
  assert.equal(dies.find(d => d.x === 0 && d.y === 0)?.hbin, 3);
});

test("retestPolicy 'best' — all fail: tiebreak picks lowest hbin", () => {
  const { dies } = buildWaferMap({
    results: [result(0, 0, 5), result(0, 0, 2), result(0, 0, 7)],
    retestPolicy: 'best',
    passBins: [1],
    waferConfig, dieConfig,
  });
  assert.equal(dies.find(d => d.x === 0 && d.y === 0)?.hbin, 2);
});

test("retestPolicy 'best' — multiple passes: tiebreak picks lowest hbin", () => {
  // passBins: [1, 2] — both pass, lower number should win
  const { dies } = buildWaferMap({
    results: [result(0, 0, 2), result(0, 0, 1)],
    retestPolicy: 'best',
    passBins: [1, 2],
    waferConfig, dieConfig,
  });
  assert.equal(dies.find(d => d.x === 0 && d.y === 0)?.hbin, 1);
});

// ── 'worst': fail beats pass; tiebreak by higher hbin ────────────────────────

test("retestPolicy 'worst' — fail beats pass", () => {
  // bin 1 = pass; bins 3,5 = fail — worst should pick a fail
  const { dies } = buildWaferMap({
    results: [result(0, 0, 1), result(0, 0, 3), result(0, 0, 5)],
    retestPolicy: 'worst',
    passBins: [1],
    waferConfig, dieConfig,
  });
  assert.equal(dies.find(d => d.x === 0 && d.y === 0)?.hbin, 5);
});

test("retestPolicy 'worst' — all fail: tiebreak picks highest hbin", () => {
  const { dies } = buildWaferMap({
    results: [result(0, 0, 5), result(0, 0, 2), result(0, 0, 7)],
    retestPolicy: 'worst',
    passBins: [1],
    waferConfig, dieConfig,
  });
  assert.equal(dies.find(d => d.x === 0 && d.y === 0)?.hbin, 7);
});

test("retestPolicy 'worst' — fail beats pass even when fail bin is lower number", () => {
  // passBins: [3] — bin 3 is pass, bin 1 is fail despite being numerically lower
  const { dies } = buildWaferMap({
    results: [result(0, 0, 3), result(0, 0, 1)],
    retestPolicy: 'worst',
    passBins: [3],
    waferConfig, dieConfig,
  });
  assert.equal(dies.find(d => d.x === 0 && d.y === 0)?.hbin, 1);
});

// ── edge cases ────────────────────────────────────────────────────────────────

test("retestPolicy 'best' falls back to 'last' when no hbin on any candidate", () => {
  const { dies } = buildWaferMap({
    results: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
    retestPolicy: 'best',
    waferConfig, dieConfig,
  });
  assert.equal(dies.find(d => d.x === 0 && d.y === 0)?.hbin, undefined);
});

test('retestPolicy — retestCount is always set regardless of policy', () => {
  for (const policy of ['last', 'first', 'best', 'worst']) {
    const { dies } = buildWaferMap({
      results: [result(0, 0, 3), result(0, 0, 1)],
      retestPolicy: policy,
      waferConfig, dieConfig,
    });
    const die = dies.find(d => d.x === 0 && d.y === 0);
    assert.equal(die?.retestCount, 2, `retestCount should be 2 for policy '${policy}'`);
  }
});
