// The report opened from a Summary panel is live: a click on a finding's row shows that finding on the map,
// and "What stands out" has a way into the full report. Opened on its own, the same report is a plain page.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildWaferMap, analyzeWaferMap } from '../dist/index.js';
import { renderWaferReportHtml, renderLotReportHtml } from '../dist/packages/stats/renderSummaryReport.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLDivElement = dom.window.HTMLDivElement;
globalThis.HTMLIFrameElement = dom.window.HTMLIFrameElement;
globalThis.Node = dom.window.Node;
globalThis.MessageEvent = dom.window.MessageEvent;
const { renderWaferSummaryContent: renderWaferSummaryContentRaw, buildSynthesisSection } = await import('../dist/packages/canvas-adapter/summaryPanel.js');
// These panels are built without a map, so each test states the pass bins it judges by.
const renderWaferSummaryContent = (panel, params) => renderWaferSummaryContentRaw(panel, { passBins: [1], ringCount: 4, ...params });
const { openReportModal } = await import('../dist/packages/canvas-adapter/guideWindow.js');

/** The report builders load on demand, so a report opens a tick after its link is clicked. */
const until = async (find, tries = 100) => {
  for (let i = 0; i < tries; i++) { const v = find(); if (v) return v; await new Promise(r => setTimeout(r, 5)); }
  return find();
};

const R = 9;
const wafer = (k) => {
  const results = [];
  for (let x = -R; x <= R; x++) for (let y = -R; y <= R; y++) {
    if (Math.hypot(x, y) > R) continue;
    results.push({ x, y, hbin: x > 0 && y > 0 && (x * 3 + y * 5 + k) % 10 < 5 ? 2 : 1 });
  }
  return buildWaferMap({ results, waferConfig: { diameter: 300, notch: { type: 'bottom' }, metadata: { lot: 'L1', waferId: `W${k}` } }, passBins: [1], ringCount: 4 });
};

test('a live report marks each finding row, and carries the one script that reports a click', () => {
  const m = wafer(1);
  const live = renderWaferReportHtml(m, analyzeWaferMap(m), { live: true });
  assert.match(live, /<tr class="tier-\w+ live" id="finding-[^"]+" data-finding="[^"]+"/);
  assert.match(live, /wmapFinding/);
  const plain = renderWaferReportHtml(m, analyzeWaferMap(m));
  assert.ok(!/data-finding|wmapFinding|class="[^"]* live"/.test(plain), 'opened on its own it is a plain page');
});

test('the lot report is live the same way', () => {
  const maps = [1, 2, 3, 4, 5].map(wafer);
  assert.match(renderLotReportHtml(maps, { live: true }), /data-finding="[^"]+"/);
  assert.ok(!/data-finding/.test(renderLotReportHtml(maps)));
});

test('the data-finding is the finding\'s own id, never the scoped anchor', () => {
  const m = wafer(1);
  const s = analyzeWaferMap(m);
  const html = renderWaferReportHtml(m, s, { live: true });
  const ids = [...html.matchAll(/data-finding="([^"]+)"/g)].map(x => x[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"'));
  const known = new Set(s.findings.map(f => f.id));
  assert.ok(ids.length > 0 && ids.every(id => known.has(id)));
});

test('a message from the report\'s own frame reaches the host with the finding\'s id; others do not', () => {
  const got = [];
  const handle = openReportModal('<p>x</p>', { onFinding: (id, h) => got.push([id, typeof h.close]) });
  const iframe = document.querySelector('iframe');
  assert.ok(iframe, 'the report is in a frame');
  window.dispatchEvent(new MessageEvent('message', { data: { wmapFinding: 'abc' }, source: iframe.contentWindow }));
  window.dispatchEvent(new MessageEvent('message', { data: { wmapFinding: 'evil' }, source: window }));
  window.dispatchEvent(new MessageEvent('message', { data: { other: 1 }, source: iframe.contentWindow }));
  assert.deepEqual(got, [['abc', 'function']]);
  handle.close();
  window.dispatchEvent(new MessageEvent('message', { data: { wmapFinding: 'late' }, source: iframe.contentWindow }));
  assert.equal(got.length, 1, 'closing the modal stops listening');
});

test('clicking a finding in the report closes it and selects that finding, as its row in the panel does', async () => {
  const m = wafer(1);
  const statsSummary = analyzeWaferMap(m);
  const panel = document.createElement('div');
  document.body.appendChild(panel);
  const clicked = [];
  renderWaferSummaryContent(panel, {
    wafer: m.wafer, dies: m.dies, statsSummary, yieldSummary: m.yield,
    dataCoverage: { filledDies: m.dies.length, totalDies: m.dies.length, edgeExcludedDies: 0, ratio: 1 },
    passBins: [1], ringCount: 4, binColors: undefined,
    onFindingClick: (f, row) => clicked.push([f.id, row.tagName]),
    findingsFilter: {}, onFindingsFilterChange: () => {},
  });
  const full = [...panel.querySelectorAll('button')].find(b => b.textContent === 'Full report ▸');
  assert.ok(full, 'What stands out has a way into the full report');
  full.dispatchEvent(new window.Event('click'));
  const iframe = await until(() => document.querySelector('iframe'));
  assert.ok(iframe && /data-finding/.test(iframe.srcdoc ?? ''), 'it opens the live report');
  const target = statsSummary.findings[0].id;
  window.dispatchEvent(new MessageEvent('message', { data: { wmapFinding: target }, source: iframe.contentWindow }));
  assert.deepEqual(clicked, [[target, 'BUTTON']]);
  assert.ok(!document.querySelector('iframe'), 'the modal closed to show the map');
  // an id the panel does not hold does nothing
  full.dispatchEvent(new window.Event('click'));
  const again = await until(() => document.querySelector('iframe'));
  window.dispatchEvent(new MessageEvent('message', { data: { wmapFinding: 'not-a-finding' }, source: again.contentWindow }));
  assert.equal(clicked.length, 1);
  assert.ok(document.querySelector('iframe'), 'and the modal stays open');
});

test('without a click handler there is no link into the report from the section', () => {
  const l = { level: 'wafer', hasNotableFindings: false, findings: [], stats: { totalDies: 10, analyzedDies: 10, yieldPercent: 90, testsConsidered: [], hardBinsConsidered: [] } };
  assert.ok(![...buildSynthesisSection(l, [1], {}).querySelectorAll('button')].some(b => /Full report/.test(b.textContent)));
  assert.ok([...buildSynthesisSection(l, [1], {}, undefined, () => {}).querySelectorAll('button')].some(b => /Full report/.test(b.textContent)));
});
