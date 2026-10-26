import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/index.js';
import { analyzeWaferMap, renderWaferReportHtml } from '../dist/packages/stats/index.js';

test('the report scales up for paper, and only for paper', () => {
  const map = buildWaferMap({ results: Array.from({ length: 36 }, (_, k) => ({ x: k % 6, y: Math.floor(k / 6), hbin: k % 5 === 0 ? 2 : 1 })), waferConfig: { diameter: 80 }, dieConfig: { width: 10, height: 10 }, passBins: [1] });
  const html = renderWaferReportHtml(map, analyzeWaferMap(map));
  const print = html.slice(html.indexOf('@media print'));
  assert.match(print, /zoom:\s*1\.25/);
  assert.ok(!/zoom:/.test(html.slice(0, html.indexOf('@media print'))), 'the screen styles are not scaled');
});
