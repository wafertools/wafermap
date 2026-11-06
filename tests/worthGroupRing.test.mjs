// A Worth a look item about a group's ring pass rate draws its chart over that ring's dies: its filter names the ring the
// way a plot's Ring field does ("Ring 4"), not the way a finding does ("Ring 4 (edge)"), or the card is empty.

import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWaferLot, buildWaferMap } from '../dist/index.js';
import { buildSynthesis } from '../dist/packages/stats/synthesis.js';
import { resolvePlot } from '../dist/packages/stats/plotData.js';

// 12 wafers of two splits: the edge ring of split X fails far more often than split Y's; the core is alike.
function wafer(split, k) {
  const R = 11;
  const results = [];
  for (let x = -R; x <= R; x++) for (let y = -R; y <= R; y++) {
    const r = Math.hypot(x, y);
    if (r > R) continue;
    const edge = r > R - 3;
    const noise = (x * 7 + y * 13 + k * 5) % 17 === 0;
    results.push({ x, y, hbin: (edge && split === 'X' && (x + y + k) % 3 !== 0) || noise ? 2 : 1 });
  }
  return { ...buildWaferMap({ results, passBins: [1], waferConfig: { diameter: 40, metadata: { lot: 'L', waferId: `${split}${k}`, split } }, dieConfig: { width: 1.5, height: 1.5 } }), label: `${split}${k}` };
}
const maps = [...Array(6)].flatMap((_, k) => [wafer('X', k), wafer('Y', k)]);
const lot = analyzeWaferLot(maps);
const synthesis = buildSynthesis(lot, { passBins: [1], attributes: { split: { label: 'Split' } } });
const ringItem = synthesis.items.concat(synthesis.also?.items ?? []).find(it => it.target.kind === 'group' && it.chart?.where?.conditions?.some(c => c.field.builtin === 'ring'));

test('a group item about a ring names the ring as the Ring field does, and its chart has dies left', () => {
  assert.ok(ringItem, 'the weak edge ring of one split is an item');
  const condition = ringItem.chart.where.conditions[0];
  assert.deepEqual(condition.values, [`Ring ${lot.stats.regionYield.ring.length}`]);
  const items = maps.map(m => ({ ...m, ringCount: m.ringCount }));
  const r = resolvePlot({ ...ringItem.chart }, items.map(m => ({ wafer: m.wafer, dies: m.dies, passBins: m.passBins, ringCount: m.ringCount, label: m.label, metadata: m.metadata })), {});
  assert.ok(!(r.issues ?? []).some(i => /Nothing is left/.test(i)), `issues: ${(r.issues ?? []).join('; ')}`);
});
