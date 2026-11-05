// Commonality (stats/commonality.ts): every wafer field ranked by how clearly its groups differ in yield and in the main
// fail bins, each wafer one value; fields that cannot be tested, and fields that cannot be told apart, said to be.

import test from 'node:test';
import assert from 'node:assert/strict';
import { cardMenuLabels } from './fixtures/cardMenu.mjs';
import { buildWaferMap } from '../dist/index.js';
import { rankCommonality, measureLabel, COMMONALITY_BINS } from '../dist/packages/stats/commonality.js';

/** A wafer of 100 dies: `fail2` of them in bin 2 and `fail3` in bin 3, the rest passing in bin 1. */
function wafer(meta, fail2, fail3 = 3) {
  const r = buildWaferMap({
    results: Array.from({ length: 100 }, (_, k) => ({ x: k % 10, y: Math.floor(k / 10), hbin: k < fail2 ? 2 : k < fail2 + fail3 ? 3 : 1 })),
    waferConfig: { diameter: 30, metadata: meta }, dieConfig: { width: 2, height: 2 }, passBins: [1],
  });
  return { metadata: r.metadata, dies: r.dies, passBins: [1] };
}

// Probe card B loses about 15 points of yield to bin 2; split is noise (neither value is consistently higher within a card,
// which is how a field is read once the card is allowed for); slot gives every wafer its own value; lot and date move together.
const lotOf = () => [
  wafer({ probeCard: 'A', split: 'X', slot: '1', lot: 'L1', date: 'D1' }, 4),
  wafer({ probeCard: 'A', split: 'Y', slot: '2', lot: 'L1', date: 'D1' }, 5),
  wafer({ probeCard: 'A', split: 'X', slot: '3', lot: 'L1', date: 'D1' }, 5),
  wafer({ probeCard: 'A', split: 'Y', slot: '4', lot: 'L2', date: 'D2' }, 4),
  wafer({ probeCard: 'B', split: 'X', slot: '5', lot: 'L2', date: 'D2' }, 19),
  wafer({ probeCard: 'B', split: 'Y', slot: '6', lot: 'L2', date: 'D2' }, 18),
  wafer({ probeCard: 'B', split: 'X', slot: '7', lot: 'L1', date: 'D1' }, 21),
  wafer({ probeCard: 'B', split: 'Y', slot: '8', lot: 'L2', date: 'D2' }, 20),
];
const fields = [
  { key: 'probeCard', label: 'Probe card' }, { key: 'split', label: 'Split' }, { key: 'slot', label: 'Slot' },
  { key: 'lot', label: 'Lot' }, { key: 'date', label: 'Date' },
];

test('the field that divides yield ranks first, with its worst group and the spread in points', () => {
  const r = rankCommonality(lotOf(), fields);
  const top = r.rows[0];
  assert.equal(top.field.key, 'probeCard');
  assert.ok(['yield', 'bin'].includes(top.measure.kind));
  assert.ok(top.pAdjusted < 0.01, `q ${top.pAdjusted}`);
  const yieldRow = r.rows.find(x => x.field.key === 'probeCard' && x.measure.kind === 'yield');
  assert.equal(yieldRow.worst.key, 'B');
  assert.ok(Math.abs(yieldRow.spread - 15) < 0.01, `spread ${yieldRow.spread}`);
  const binRow = r.rows.find(x => x.field.key === 'probeCard' && x.measure.kind === 'bin' && x.measure.bin === 2);
  assert.equal(binRow.worst.key, 'B', 'for a bin, the worst group has the most of it');
  const split = r.rows.find(x => x.field.key === 'split' && x.measure.kind === 'yield');
  assert.ok(split.pAdjusted > 0.3, 'noise does not rank');
});

test('the bins compared are the most common fail bins, at most five', () => {
  const r = rankCommonality(lotOf(), fields);
  assert.deepEqual(r.bins, [2, 3]);
  assert.ok(r.bins.length <= COMMONALITY_BINS);
  assert.equal(measureLabel({ kind: 'bin', bin: 2 }), 'Hard bin 2');
});

test('a field that gives every wafer its own value is not compared, and is named', () => {
  const r = rankCommonality(lotOf(), fields);
  assert.deepEqual(r.untestable.map(f => f.key), ['slot']);
  assert.ok(!r.rows.some(x => x.field.key === 'slot'));
});

test('fields that group the wafers identically are named as not separable', () => {
  const r = rankCommonality(lotOf(), fields);
  assert.deepEqual(r.tied.map(set => set.map(f => f.key)), [['lot', 'date']]);
});

test('n is wafers: the comparison is over wafer values, not dies', () => {
  const r = rankCommonality(lotOf(), fields);
  const row = r.rows.find(x => x.field.key === 'probeCard' && x.measure.kind === 'yield');
  assert.deepEqual(row.comparison.groups.map(g => [g.key, g.n]), [['A', 4], ['B', 4]]);
});

test('the card ranks the rows, offers Group by, and says which field Insights is grouped by', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><body></body>');
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement; globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  const { renderCommonalityPanel } = await import('../dist/packages/canvas-adapter/charts/commonality.js');
  const picked = [];
  const p = renderCommonalityPanel({ wafers: lotOf(), fields, groupedBy: 'split', onGroupBy: k => picked.push(k), ownerDocument: dom.window.document });
  const rows = [...p.card.querySelectorAll('tbody tr')];
  assert.match(rows[0].textContent, /^Probe card/);
  assert.match(p.card.textContent, /Lot and Date/);
  assert.match(p.card.textContent, /Not compared.*Slot/);
  p.card.querySelector('[data-wmap-commonality-group="probeCard"]').dispatchEvent(new dom.window.MouseEvent('click'));
  assert.deepEqual(picked, ['probeCard']);
  // Every row, then the grouped field's rows say so in place of the button.
  [...p.card.querySelectorAll('button')].find(b => /^Show all/.test(b.textContent)).dispatchEvent(new dom.window.MouseEvent('click'));
  const all = [...p.card.querySelectorAll('tbody tr')];
  assert.ok(all.length > rows.length);
  const splitRows = all.filter(r => /^Split/.test(r.textContent));
  assert.ok(splitRows.length > 0 && splitRows.every(r => /Grouped by this/.test(r.textContent)));
  const labels = cardMenuLabels(p.card);
  assert.ok(!labels.includes('Save as PNG'), 'a table: no image to save');
  assert.ok(labels.includes('About this table') && !labels.includes('About this chart'), 'a table is not called a chart');
  assert.equal(p.card.style.flex, '0 0 auto', 'as tall as its table, in a column of cards');
});

test('a yield row tints its worst group when it falls short of the wafers\' mean yield; a fail bin\'s row is not tinted', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><body></body>');
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement; globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  const { renderCommonalityPanel } = await import('../dist/packages/canvas-adapter/charts/commonality.js');
  const p = renderCommonalityPanel({ wafers: lotOf(), fields, groupedBy: undefined, onGroupBy: () => {}, ownerDocument: dom.window.document });
  [...p.card.querySelectorAll('button')].find(b => /^Show all/.test(b.textContent)).dispatchEvent(new dom.window.MouseEvent('click'));
  const rows = [...p.card.querySelectorAll('tbody tr')];
  const probe = rows.find(r => /^Probe card/.test(r.textContent) && /Yield/.test(r.cells[1].textContent));
  assert.match(probe.cells[2].style.background, /^rgba\(190, 60, 60/, 'probe card B: well short of the mean yield');
  assert.equal(probe.cells[3].style.background, '', 'the best group is not tinted');
  const bin = rows.find(r => /^Probe card/.test(r.textContent) && !/Yield/.test(r.cells[1].textContent));
  assert.equal(bin.cells[2].style.background, '', 'a bin share is not a yield');
});

test('three fields that group the wafers identically are one tied set, not three pairs', () => {
  const lot = [4, 5, 6, 5, 19, 20, 21, 20].map((fails, i) => wafer({ a: i < 4 ? 'x' : 'y', b: i < 4 ? 'p' : 'q', c: i < 4 ? '1' : '2' }, fails));
  const r = rankCommonality(lot, [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }]);
  assert.deepEqual(r.tied.map(set => set.map(f => f.key)), [['a', 'b', 'c']]);
});

test('a field another hides is found once the other is allowed for, and the row says so', () => {
  // Card B loses 15 points and split Y loses 6, on wafers where each card holds both splits twice: one-way, each field's
  // effect is buried in the other's spread; the card stands out on its own, and the split once the card is allowed for.
  const lot = [
    wafer({ probeCard: 'A', split: 'X' }, 4), wafer({ probeCard: 'A', split: 'X' }, 5),
    wafer({ probeCard: 'A', split: 'Y' }, 10), wafer({ probeCard: 'A', split: 'Y' }, 11),
    wafer({ probeCard: 'B', split: 'X' }, 19), wafer({ probeCard: 'B', split: 'X' }, 20),
    wafer({ probeCard: 'B', split: 'Y' }, 25), wafer({ probeCard: 'B', split: 'Y' }, 26),
  ];
  const r = rankCommonality(lot, [{ key: 'probeCard', label: 'Probe card' }, { key: 'split', label: 'Split' }]);
  const yieldRow = (key) => r.rows.find(x => x.field.key === key && x.measure.kind === 'yield');
  const split = yieldRow('split'), card = yieldRow('probeCard');
  assert.deepEqual(split.allowedFor.map(f => f.key), ['probeCard']);
  assert.equal(card.allowedFor, undefined, 'the card stands out on its own, so nothing is allowed for');
  assert.ok(split.pAdjusted < 0.05 && card.pAdjusted < 0.05, `q ${split.pAdjusted}, ${card.pAdjusted}`);
  // The row still reads in the measure's own means.
  assert.ok(Math.abs(split.spread - 6) < 0.01, `spread ${split.spread}`);
});

test('fields that group the wafers identically are not allowed for one another', () => {
  const lot = [4, 5, 6, 5, 19, 20, 21, 20].map((fails, i) => wafer({ tester: i < 4 ? 'T1' : 'T2', handler: i < 4 ? 'H1' : 'H2' }, fails));
  const r = rankCommonality(lot, [{ key: 'tester', label: 'Tester' }, { key: 'handler', label: 'Handler' }]);
  assert.ok(r.rows.every(x => !x.allowedFor), 'neither hides the other');
  assert.equal(r.tied.length, 1);
});
