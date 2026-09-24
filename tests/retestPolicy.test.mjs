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

// ── Part IDs and the tester's supersede flag ─────────────────────────────────

const noPos = (partId, hbin, extra = {}) => ({ partId, hbin, ...extra });
const many = (n) => Array.from({ length: n }, (_, i) => noPos(`P${i}`, 1));

test('unpositioned dies sharing a part ID are one retested die, and it is reported', () => {
  const r = buildWaferMap({ results: [
    result(0, 0, 1), noPos('A7', 3), ...many(8), noPos('A7', 1),
  ], waferConfig, dieConfig });
  const a7 = r.dies.filter(d => d.partId === 'A7');
  assert.equal(a7.length, 1);
  assert.equal(a7[0].hbin, 1, "'last' wins");
  assert.equal(a7[0].retestCount, 2);
  const w = r.warnings.find(w => w.code === 'retests-by-part-id');
  assert.equal(w?.severity, 'info');
});

test('blank part IDs never match', () => {
  const r = buildWaferMap({ results: [noPos('', 1), noPos('  ', 2), noPos(undefined, 3)], waferConfig, dieConfig });
  assert.equal(r.dies.filter(d => d.x === undefined).length, 3);
  assert.ok(!r.warnings.some(w => w.code === 'retests-by-part-id'));
});

test('a part ID on more than 20% of the unpositioned records is a default, not an ID', () => {
  // "0" on 3 of 10 records (30%): part IDs are not used at all on this wafer.
  const r = buildWaferMap({ results: [
    noPos('0', 1), noPos('0', 2), noPos('0', 3), noPos('B', 1), noPos('B', 2), ...many(5),
  ], waferConfig, dieConfig });
  assert.equal(r.dies.length, 10, 'nothing merged');
  assert.ok(!r.warnings.some(w => w.code === 'retests-by-part-id'));
});

test("a superseding record wins whatever retestPolicy says", () => {
  const { dies } = buildWaferMap({
    results: [result(0, 0, 1), { ...result(0, 0, 5), supersedes: 'position' }],
    retestPolicy: 'best', passBins: [1],
    waferConfig, dieConfig,
  });
  const d = dies.find(d => d.x === 0 && d.y === 0);
  assert.equal(d.hbin, 5);
  assert.equal(d.retestCount, 2);
});

test("a 'partId' supersede removes the earlier record with that part ID at another position", () => {
  const { dies } = buildWaferMap({
    results: [
      { ...result(0, 0, 3), partId: 'Q1' }, result(1, 0, 1),
      { ...result(2, 0, 1), partId: 'Q1', supersedes: 'partId' },
    ],
    waferConfig, dieConfig,
  });
  assert.equal(dies.find(d => d.x === 0 && d.y === 0)?.hbin, undefined, 'the superseded record is gone');
  assert.equal(dies.find(d => d.x === 2 && d.y === 0)?.hbin, 1);
});
