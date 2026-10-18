// Every card and every plot chart type has an "About this chart" line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ABOUT_LINES, plotAbout } from '../dist/packages/canvas-adapter/charts/cardAbout.js';
import { PLOT_CHARTS } from '../dist/packages/stats/plotSpec.js';

test('every plot chart type has an About line', () => {
  for (const chart of PLOT_CHARTS) assert.ok(ABOUT_LINES.charts[chart], chart);
});

test('every built-in plot card id the Insights tab and drilldown use has an About line of its own', () => {
  const src = ['insightsTab.ts', 'drilldown.ts'].map(f => readFileSync(new URL(`../packages/canvas-adapter/${f}`, import.meta.url), 'utf8')).join('\n');
  const ids = [...src.matchAll(/id: [`']((?:card|drill)-[a-z-]+)(\$\{[a-z]+\})?[`']/g)].map(m => (m[2] ? `${m[1]}x` : m[1]));
  assert.ok(ids.length >= 7, ids.join(','));
  for (const id of ids) assert.notEqual(plotAbout({ id, chart: 'bar' }).text, ABOUT_LINES.charts.bar, `${id} falls back to the chart type`);
});
