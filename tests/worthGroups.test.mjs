// Worth a look and an item about the yield of groups of wafers (yield by a field): What divides yield, just below, shows it,
// from the same fields read the same way, so it has no card of its own. Lot: the edge-ring demo lot, whose probe card costs yield.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setupDom, click } from './fixtures/domHarness.mjs';

setupDom({ canvasSize: { width: 600, height: 400 } });
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 600; } });
window.HTMLElement.prototype.scrollIntoView = function () {};

const { analyzeWaferLot, buildWaferMap } = await import('../dist/index.js');
const { buildSynthesis } = await import('../dist/packages/stats/synthesis.js');
const { createInsightsTab } = await import('../dist/packages/canvas-adapter/insightsTab.js');
const { rankCommonality, commonalityConfidence } = await import('../dist/packages/stats/commonality.js');

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'examples', 'data');
const FIELDS = ['tester', 'handler', 'probe_card', 'operator', 'test_date', 'split'];
const attributes = { tester: { label: 'Tester' }, handler: { label: 'Handler' }, probe_card: { label: 'Probe card' }, card_label: { label: 'Card label' },
  operator: { label: 'Operator' }, test_date: { label: 'Test date' }, split: { label: 'Split' } };

function loadLot(name) {
  const meta = JSON.parse(readFileSync(join(DATA, `${name}.meta.json`), 'utf8'));
  const [head, ...lines] = readFileSync(join(DATA, `${name}.csv`), 'utf8').trim().split('\n');
  const cols = head.split(',');
  const at = (c) => cols.indexOf(c);
  const byWafer = new Map();
  for (const line of lines) {
    const v = line.split(',');
    if (!byWafer.has(v[1])) {
      const md = { lot: v[0], waferId: v[1], ...Object.fromEntries(FIELDS.map(f => [f, v[at(f)]])) };
      md.card_label = `card ${md.probe_card}`;     // gives the same groups as the probe card, whatever it is called
      byWafer.set(v[1], { md, results: [] });
    }
    byWafer.get(v[1]).results.push({ x: +v[2], y: +v[3], hbin: +v[4], sbin: +v[5], testValues: { 1001: +v[at('iddq')], 1002: +v[at('vref')], 1003: +v[at('fmax')] } });
  }
  return [...byWafer.values()].map((w, i) => ({ ...buildWaferMap({ ...meta, results: w.results, passBins: [1], waferConfig: { ...meta.waferConfig, metadata: w.md } }), label: `W${i + 1}` }));
}
const maps = loadLot('edge-ring');
const lot = analyzeWaferLot(maps);
const synthesis = buildSynthesis(lot, { passBins: [1], attributes });
const groupItem = synthesis.items.concat(synthesis.also?.items ?? []).find(it => it.target.kind === 'group' && it.target.field === 'probe_card');

function mount(extra = {}) {
  const root = document.getElementById('root');
  root.innerHTML = '';
  const shown = [];
  const tab = createInsightsTab({
    getRingCount: () => 4, getItems: () => maps, getLotStats: () => lot, attributes,
    getBinColors: () => ({ hard: new Map(), soft: new Map(), shared: { hard: [], soft: [] }, pass: { hard: new Set(), soft: new Set() } }),
    showOnMap: target => shown.push(target), ...extra,
  });
  root.appendChild(tab.el);
  tab.el.style.display = 'flex';
  tab.render();
  return { tab, shown };
}
const worthKeys = tab => [...tab.el.querySelectorAll('[data-wmap-worth-key]')].map(c => c.dataset.wmapWorthKey);
const groupCard = tab => tab.el.querySelector('[data-wmap-worth-key="group:probe_card"]');

test('the lot has an item about its probe card, with every field that gives the same groups', () => {
  assert.ok(groupItem, 'the weak probe card is an item');
  assert.deepEqual(groupItem.target.fields, ['probe_card', 'card_label']);
});

test('an item about the yield of groups of wafers is drawn in What divides yield, not as a card', () => {
  const { tab } = mount();
  assert.equal(groupCard(tab), null);
  assert.ok(tab.el.querySelector('[data-wmap-commonality-group="probe_card"]'), 'What divides yield has a row for the probe card');
  assert.ok(tab.el.querySelector('[data-wmap-worth-key]')?.querySelector('[data-wmap-worth-show-on-map]'), 'the other cards still offer Show on map');
});

test('the Summary panel\'s Chart link for it lands on What divides yield', () => {
  const { tab } = mount();
  assert.equal(tab.showWorthCard('group:probe_card'), true);
  assert.equal(tab.showWorthCard('group:no_such_field'), false);
});

test('What stands out and What divides yield read the probe card the same way', () => {
  const wafers = maps.map(m => ({ metadata: m.metadata, dies: m.dies, passBins: m.passBins }));
  const fields = Object.entries(attributes).map(([key, { label }]) => ({ key, label }));
  const result = rankCommonality(wafers, fields, attributes);
  const row = result.rows.find(r => r.field.key === 'probe_card' && r.measure.kind === 'yield');
  assert.ok(row, 'a yield row for the probe card');
  assert.notEqual(commonalityConfidence(row.pAdjusted), 'none', `confirmed in What stands out, so not "Not clear" here (q ${row.pAdjusted})`);
  // Both read it after allowing for the same field, or for none.
  const allowed = row.allowedFor?.map(f => f.label) ?? [];
  assert.equal(/allowing for/.test(groupItem.reason), allowed.length > 0, `allowing for: ${allowed.join(', ') || 'none'}; item: ${groupItem.reason}`);
  for (const label of allowed) assert.ok(groupItem.reason.includes(label), `the item names ${label}`);
});

test('every item has a key of its own, so a Chart link and a Show on map find the one item meant', async () => {
  const { synthesisKey } = await import('../dist/packages/stats/synthesis.js');
  const all = [...synthesis.items, ...(synthesis.also?.items ?? [])];
  const keys = all.map(synthesisKey);
  assert.equal(new Set(keys).size, keys.length, keys.join(', '));
  // A test's own item and one about groups that leads with the same test differ.
  const shift = { target: { kind: 'test', testNumber: 7 }, chart: { chart: 'box', fields: { x: { meta: 'split' }, y: { test: 7 } } } };
  const own = { target: { kind: 'test', testNumber: 7 }, chart: { chart: 'histogram', fields: { x: { test: 7 } } } };
  assert.notEqual(synthesisKey(shift), synthesisKey(own));
});
