// Worth a look: the items "What stands out" lists beside the map, drawn on the Insights Overview as the charts that show
// them. One list for both: the cards are the panel's top items in its order and words, each card goes to the map, and
// each of the panel's top rows goes to its card.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, click } from './fixtures/domHarness.mjs';

const dom = setupDom({ canvasSize: { width: 600, height: 400 } });
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 600; } });
window.HTMLElement.prototype.scrollIntoView = function () {};

const { analyzeWaferLot } = await import('../dist/index.js');
const { buildSynthesis, synthesisKey } = await import('../dist/packages/stats/synthesis.js');
const { createInsightsTab } = await import('../dist/packages/canvas-adapter/insightsTab.js');
const { buildSynthesisSection } = await import('../dist/packages/canvas-adapter/summaryPanel.js');
const { buildLot, passBinsOf } = await import('./fixtures/synthLots.mjs');

// An edge ring of failures with a test failing there, on four wafers: an item with a chart, and more besides.
const SPEC = { name: 'worth', wafers: 4, tests: 'both', signatures: [{ region: 'edge-ring', p: 0.35, bin: 5 }], testFailures: [{ test: 101, region: 'edge-ring', p: 0.3, binning: 6 }] };
const maps = buildLot(SPEC);
const lot = analyzeWaferLot(maps);
const passBins = passBinsOf(SPEC);
const items = maps.map((m, i) => ({ ...m, label: `W${i + 1}` }));
const synthesis = buildSynthesis(lot, { passBins });

function mount(extra = {}) {
  const root = document.getElementById('root');
  root.innerHTML = '';
  const shown = [];
  const tab = createInsightsTab({
    getRingCount: () => 4, getItems: () => items, getLotStats: () => lot,
    getBinColors: () => ({ hard: new Map(), soft: new Map(), shared: { hard: [], soft: [] }, pass: { hard: new Set(), soft: new Set() } }),
    showOnMap: target => shown.push(target), ...extra,
  });
  root.appendChild(tab.el);
  tab.el.style.display = 'flex';
  tab.render();
  return { tab, shown };
}
const worth = tab => tab.el.querySelector('[data-wmap-worth-a-look]');
const cards = tab => [...worth(tab).querySelectorAll('[data-wmap-worth-key]')];

test('the Overview draws the panel\'s top items as cards, in its order, each saying why', () => {
  assert.ok(synthesis.items.length >= 1, 'the lot has items');
  const { tab } = mount();
  assert.ok(worth(tab), 'a Worth a look section on Overview');
  assert.deepEqual(cards(tab).map(c => c.dataset.wmapWorthKey), synthesis.items.map(synthesisKey), 'the same items, in the same order');
  for (const [i, c] of cards(tab).entries()) {
    assert.ok(c.textContent.includes(`Shown because: ${synthesis.items[i].reason}`), 'the item in one short sentence');
    assert.ok(synthesis.items[i].text.startsWith(synthesis.items[i].reason.replace(/ — about [\d,]+ dies lost$/, '')), 'the start of the panel\'s sentence');
    assert.ok(c.querySelector('canvas'), 'a chart');
  }
});

test('Show on map hands the item\'s target to the host, as its row would', () => {
  const { tab, shown } = mount();
  click(window, cards(tab)[0].querySelector('[data-wmap-worth-show-on-map]'));
  assert.deepEqual(shown, [synthesis.items[0].target]);
});

test('without a host that shows the map, the cards offer no Show on map', () => {
  const { tab } = mount({ showOnMap: undefined });
  assert.equal(worth(tab).querySelector('[data-wmap-worth-show-on-map]'), null);
});

test('narrowed by the Insights filter, the section says it describes the whole lot and draws no cards', () => {
  const { tab } = mount({ filter: { conditions: [{ field: { builtin: 'wafer' }, values: ['W1'] }] } });
  assert.ok(worth(tab).querySelector('[data-wmap-worth-narrowed]'));
  assert.equal(cards(tab).length, 0);
});

test('showWorthCard opens the Overview at that card, and says when there is none', () => {
  const { tab } = mount();
  tab.el.querySelector('[data-wmap-insights-tab="data"]').click();
  const key = synthesisKey(synthesis.items[0]);
  assert.equal(tab.showWorthCard(key), true);
  assert.equal(tab.el.querySelector('[data-wmap-insights-tab="overview"]').getAttribute('aria-selected'), 'true');
  assert.equal(tab.showWorthCard('finding:no-such'), false);
});

test('the panel\'s top rows each have one Chart link to their card, and the "also" rows none', () => {
  const asked = [];
  const section = buildSynthesisSection(lot, passBins, { onFindingClick: () => {}, onTestClick: () => {}, onShowChart: key => asked.push(key) });
  const links = [...section.querySelectorAll('[data-wmap-synthesis-chart]')];
  assert.deepEqual(links.map(l => l.dataset.wmapSynthesisChart), synthesis.items.map(synthesisKey), 'one per top item, none for the also list');
  for (const l of links) assert.equal(l.closest('button[data-wmap-finding], button[data-wmap-test]'), null, 'never inside the row\'s own button');
  click(window, links[0]);
  assert.deepEqual(asked, [synthesisKey(synthesis.items[0])]);
  const none = buildSynthesisSection(lot, passBins, { onFindingClick: () => {}, onTestClick: () => {} });
  assert.equal(none.querySelector('[data-wmap-synthesis-chart]'), null, 'no Insights, no Chart links');
});
