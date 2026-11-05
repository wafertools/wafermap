// The demo lots' wafer fields (docs/examples/data/generate-demos.js): each lot's groups are meant to do something, or
// deliberately nothing, so a feature that finds a group effect has a known answer to find. The data is synthetic and
// seeded, so the effects are pinned here. Equipment fields are fixed within a probe session (two wafers; three for the
// parametric lot) and the tester and its handler are the same partition.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'examples', 'data');

function load(name) {
  const [head, ...lines] = readFileSync(join(DATA, `${name}.csv`), 'utf8').trim().split('\n');
  const cols = head.split(',');
  return lines.map(l => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
}
const mean = v => v.reduce((a, b) => a + b, 0) / v.length;
/** Per group of `field`: the share of dies in hard bin 1 (percent) and the mean of `test`. */
function byGroup(rows, field, test) {
  const g = new Map();
  for (const r of rows) (g.get(r[field]) ?? g.set(r[field], []).get(r[field])).push(r);
  return Object.fromEntries([...g].map(([k, v]) => [k, {
    wafers: new Set(v.map(r => r.wafer)).size,
    yield: 100 * v.filter(r => r.hbin === '1').length / v.length,
    mean: test ? mean(v.map(r => +r[test])) : NaN,
  }]));
}

test('every lot has at least eight wafers, with each field value on at least two', () => {
  for (const name of ['edge-ring', 'parametric', 'cluster', 'high-yield']) {
    const rows = load(name);
    assert.ok(new Set(rows.map(r => r.wafer)).size >= 8, `${name}: wafers`);
    for (const f of ['tester', 'probe_card', 'operator', 'split'].filter(k => k in rows[0])) {
      for (const [k, g] of Object.entries(byGroup(rows, f))) assert.ok(g.wafers >= 2, `${name}: ${f} ${k} has ${g.wafers} wafers`);
    }
  }
});

test('a tester and its handler are the same partition; the card and operator are not', () => {
  const rows = load('edge-ring');
  const pairs = f => new Set(rows.map(r => `${r.tester}|${r[f]}`)).size;
  assert.equal(pairs('handler'), 2, 'tester and handler coincide');
  assert.equal(pairs('probe_card'), 4, 'the card is crossed with the tester');
  assert.equal(pairs('operator'), 4, 'the operator is crossed with the tester');
});

test('equipment is fixed within a session, and the fab split is dealt across each session', () => {
  const rows = load('edge-ring');
  const sessions = new Map();
  for (const r of rows) sessions.set(r.test_date, new Set([...(sessions.get(r.test_date) ?? []), `${r.tester}|${r.probe_card}|${r.operator}`]));
  assert.equal(sessions.size, 4);
  for (const [, equipment] of sessions) assert.equal(equipment.size, 1);
  const splitsIn = d => new Set(rows.filter(r => r.test_date === d).map(r => r.split));
  for (const d of sessions.keys()) assert.equal(splitsIn(d).size, 2, `${d} holds both splits`);
});

test('edge-ring: the ring is heavier on Recipe-2, and the weak card costs yield without moving a test', () => {
  const rows = load('edge-ring');
  const split = byGroup(rows, 'split', 'iddq'), card = byGroup(rows, 'probe_card', 'iddq');
  assert.ok(split['Recipe-2'].yield < split.Baseline.yield - 1.5, 'Recipe-2 loses yield');
  assert.ok(split['Recipe-2'].mean > split.Baseline.mean * 1.05, 'and runs leakier');
  assert.ok(card['PC-B'].yield < card['PC-A'].yield - 3, 'PC-B loses yield');
  assert.ok(Math.abs(card['PC-B'].mean / card['PC-A'].mean - 1) < 0.02, 'with no Iddq shift');
  const op = byGroup(rows, 'operator');
  assert.ok(Math.abs(op.alice.yield - op.bob.yield) < 2, 'the operator does nothing');
});

test('cluster: the clusters are heavier on Tester-2, and Recipe-2 shifts Vref', () => {
  const rows = load('cluster');
  const tester = byGroup(rows, 'tester', 'iddq'), split = byGroup(rows, 'split', 'vref');
  assert.ok(tester['Tester-2'].yield < tester['Tester-1'].yield - 0.8, 'Tester-2 loses yield');
  assert.ok(split['Recipe-2'].mean > split.Baseline.mean + 0.008, 'Recipe-2 sits higher on Vref');
  const card = byGroup(rows, 'probe_card');
  assert.ok(Math.abs(card['PC-A'].yield - card['PC-B'].yield) < 1.5, 'the card does nothing');
});

test('parametric: the corner grades Iddq and Fmax, and the weak card is not the corner', () => {
  const rows = load('parametric');
  const corner = byGroup(rows, 'split', 'fmax'), iddq = byGroup(rows, 'split', 'iddq');
  assert.ok(corner.SS.mean < corner.TT.mean - 30 && corner.TT.mean < corner.FF.mean - 30, 'Fmax grades SS < TT < FF');
  assert.ok(iddq.SS.mean < iddq.TT.mean && iddq.TT.mean < iddq.FF.mean, 'Iddq grades SS < TT < FF');
  assert.deepEqual(Object.values(corner).map(g => g.wafers), [4, 4, 4], 'four wafers of each corner, one of each in every session');
});

test('high-yield: the fields vary and none of them does anything', () => {
  const rows = load('high-yield');
  for (const f of ['tester', 'probe_card', 'operator']) {
    const g = Object.values(byGroup(rows, f, 'iddq'));
    assert.ok(g.length >= 2);
    assert.ok(Math.max(...g.map(x => x.yield)) - Math.min(...g.map(x => x.yield)) < 0.6, `${f}: yield`);
    assert.ok(Math.max(...g.map(x => x.mean)) / Math.min(...g.map(x => x.mean)) < 1.05, `${f}: Iddq`);
  }
});
