// The chart catalogue (stats/chartCatalogue.ts) holds what wmap draws, once: every plot chart type, every built-in card, every
// map mode. The app's "About this chart" lines are read from it, and its ids are the chart reference's heading anchors.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHART_CATALOGUE, catalogueEntry } from '../dist/packages/stats/chartCatalogue.js';
import { GUIDE_SECTIONS } from '../dist/packages/stats/guideSections.js';
import { PLOT_CHARTS } from '../dist/packages/stats/plotSpec.js';
import { cardAbout, plotAbout } from '../dist/packages/canvas-adapter/charts/cardAbout.js';

const src = f => readFileSync(new URL(`../packages/${f}`, import.meta.url), 'utf8');

test('ids are unique, lower-case words joined by hyphens, and each entry says something', () => {
  const ids = CHART_CATALOGUE.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length, 'a repeated id');
  for (const e of CHART_CATALOGUE) {
    assert.match(e.id, /^[a-z]+(-[a-z]+)*$/, e.id);
    assert.ok(e.title.length > 0 && e.about.length > 20, e.id);
    assert.ok(e.about.endsWith('.'), `${e.id}: one sentence, ending in a full stop`);
    assert.ok(['map', 'chart', 'table'].includes(e.kind), e.id);
  }
});

test('every plot chart type has an entry', () => {
  for (const chart of PLOT_CHARTS) {
    assert.equal(CHART_CATALOGUE.filter(e => e.chart === chart).length, 1, `${chart} has exactly one entry`);
  }
});

test('every built-in card that is not a plot has an entry', () => {
  const kinds = [...src('stats/chartCatalogue.ts').match(/export type CardKind =([^;]+);/)[1].matchAll(/'([a-z-]+)'/g)].map(m => m[1]);
  assert.ok(kinds.length >= 9, kinds.join(','));
  for (const k of kinds) assert.equal(CHART_CATALOGUE.filter(e => e.card === k).length, 1, `card ${k}`);
});

test('every built-in plot card id the Insights tab and drilldown draw has an entry', () => {
  const code = ['insightsTab.ts', 'drilldown.ts'].map(f => src(`canvas-adapter/${f}`)).join('\n');
  const ids = [...code.matchAll(/id: [`']((?:card|drill)-[a-z-]+)(\$\{[a-z]+\})?[`']/g)].map(m => (m[2] ? m[1].replace(/-$/, '') : m[1])); // card-pass-rate-<kind> is the pass-rate card
  assert.ok(ids.length >= 7, ids.join(','));
  const have = new Set(CHART_CATALOGUE.flatMap(e => e.cards ?? []));
  for (const id of ids) assert.ok(have.has(id), `${id} has no catalogue entry`);
});

test('every plot mode is a map entry', () => {
  const modes = [...src('renderer/buildView.ts').match(/export type PlotMode =([^;]+);/)[1].matchAll(/'([A-Za-z]+)'/g)].map(m => m[1]);
  assert.equal(modes.length, 7);
  const have = new Set(CHART_CATALOGUE.filter(e => e.kind === 'map').flatMap(e => e.mode ?? []));
  for (const m of modes) assert.ok(have.has(m), `plot mode ${m}`);
});

test('every see and guide names something that exists', () => {
  const sections = new Set(Object.values(GUIDE_SECTIONS));
  for (const e of CHART_CATALOGUE) {
    for (const s of e.see ?? []) { assert.ok(catalogueEntry(s), `${e.id} sees ${s}`); assert.notEqual(s, e.id, `${e.id} sees itself`); }
    for (const g of e.guide ?? []) assert.ok(sections.has(g), `${e.id} cites a guide section that is not in GUIDE_SECTIONS`);
  }
});

test('the app\'s About lines are the catalogue\'s, and a table says "table"', () => {
  assert.equal(plotAbout({ id: 'card-yield', chart: 'bar' }).text, catalogueEntry('yield-by-wafer').about);
  assert.equal(plotAbout({ id: 'mine', chart: 'control' }).text, catalogueEntry('control-chart').about);
  assert.equal(cardAbout('capability').text, catalogueEntry('process-capability').about);
  assert.equal(cardAbout('commonality').noun, 'table');
  assert.equal(cardAbout('pat').noun, 'table');
  assert.equal(cardAbout('ring-yield').noun, 'chart');
});

test('the Chart gallery page lists the catalogue as it is: nothing to regenerate', async () => {
  const { renderIndex } = await import('../scripts/build-chart-index.mjs');
  const html = readFileSync(new URL('../docs/examples/insights.html', import.meta.url), 'utf8');
  const a = html.indexOf('<!-- chart-index:start');
  const b = html.indexOf('<!-- chart-index:end -->');
  assert.ok(a > 0 && b > a, 'the chart-index markers are on the page');
  const block = html.slice(html.lastIndexOf('\n', a) + 1, b + '<!-- chart-index:end -->'.length);
  assert.equal(block, await renderIndex(), 'the chart index is out of date: run node scripts/build-chart-index.mjs');
});

test('every plot the Chart gallery supplies is a catalogue chart, and each catalogue chart a plot can be is supplied once', () => {
  const html = readFileSync(new URL('../docs/examples/insights.html', import.meta.url), 'utf8');
  const ids = [...html.matchAll(/id: 'gallery-([a-z]+)'/g)].map(m => m[1]);
  const plotEntries = CHART_CATALOGUE.filter(e => e.tab === 'plots' && e.id !== 'sweep');
  // The gallery's plot ids follow the entries' ids in catalogue order, apart from a few spelt shorter.
  assert.equal(ids.length, plotEntries.length, 'one plot per catalogue chart (a sweep has its own page)');
});

test('every chart and table on the Chart gallery has a thumbnail (node scripts/capture-screenshots.mjs --only chart-gallery)', async () => {
  const { existsSync } = await import('node:fs');
  const shown = CHART_CATALOGUE.filter(e => e.tab && e.tab !== 'drilldown' && e.id !== 'sweep');
  assert.equal(shown.length, 35);
  for (const e of shown) assert.ok(existsSync(new URL(`../docs/examples/thumbs/${e.id}.webp`, import.meta.url)), `thumbs/${e.id}.webp`);
});

// Zensical takes a heading's anchor from its text alone (an `{ #id }` is ignored), so an entry's id is the slug of its title.
const slug = t => t.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().toLowerCase().replace(/[-\s]+/g, '-');

test('every catalogue id is the slug of its title: the heading anchor on the chart reference', () => {
  for (const e of CHART_CATALOGUE) assert.equal(e.id, slug(e.title), `${e.id}: the id is the slug of "${e.title}"`);
});

test('the chart reference: each entry on the page is a catalogue entry under its own title, opening with the catalogue\'s line', () => {
  const md = readFileSync(new URL('../docs/charts.md', import.meta.url), 'utf8');
  const sections = [...md.matchAll(/^### (.+)\n([\s\S]*?)(?=^#{2,3} |\n---\n|(?![\s\S]))/gm)];
  assert.equal(sections.length, CHART_CATALOGUE.length, 'every catalogue entry has its entry on the page');
  for (const [, title, body] of sections) {
    const entry = catalogueEntry(slug(title));
    assert.ok(entry, `"${title}" is not a catalogue entry`);
    assert.equal(title, entry.title, `${entry.id}: the heading is the catalogue's title`);
    assert.ok(body.includes(`*${entry.about}*`), `${entry.id}: opens with the catalogue's line`);
    for (const part of ['**Why it is useful.**', '**How to read it', '**Notes', '**Where to find it', '**See also.**']) {
      assert.ok(body.includes(part), `${entry.id}: has ${part}`);
    }
    // The see-also links are the catalogue's, in its order: the page cannot send a reader somewhere the catalogue does not.
    const line = body.split('\n').find(l => l.startsWith('**See also.**')) ?? '';
    const linked = [...line.matchAll(/\]\(#([a-z0-9-]+)\)/g)].map(m => m[1]);
    assert.deepEqual(linked, entry.see ?? [], `${entry.id}: See also is the catalogue's`);
  }
});
