// Worth a look and an item about groups of wafers (yield by a field): such an item has no place on the map, so its card
// offers no Show on map, and its card is left out once Insights is grouped by one of the fields that give its groups, since
// the Overview's own yield card then shows the same bars. Lot: the edge-ring demo lot, whose probe card costs yield.
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

test('a card about groups of wafers offers no Show on map, though the host can show the map', () => {
  const { tab } = mount();
  assert.ok(groupItem && worthKeys(tab).includes('group:probe_card'), 'its card is drawn');
  assert.equal(groupCard(tab).querySelector('[data-wmap-worth-show-on-map]'), null);
  const others = [...tab.el.querySelectorAll('[data-wmap-worth-key]')].filter(c => c.dataset.wmapWorthKey !== 'group:probe_card');
  assert.ok(others.some(c => c.querySelector('[data-wmap-worth-show-on-map]')), 'the other cards still offer it');
});

test('grouped by the field, the card is left out; by a field that gives the same groups, too; by another field, it stays', () => {
  const groupBy = (tab, key) => { const b = tab.el.querySelector(`[data-wmap-commonality-group="${key}"]`); assert.ok(b, `a Group by button for ${key}, among ${[...tab.el.querySelectorAll('[data-wmap-commonality-group]')].map(x => x.dataset.wmapCommonalityGroup).join(', ')}`); click(window, b); };
  for (const [key, drawn] of [['probe_card', false], ['card_label', false], ['split', true]]) {
    const { tab } = mount();
    assert.ok(groupCard(tab), `drawn before grouping (${key})`);
    groupBy(tab, key);
    assert.equal(!!groupCard(tab), drawn, `grouped by ${key}`);
  }
});
