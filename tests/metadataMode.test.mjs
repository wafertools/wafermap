import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/packages/renderer/buildWaferMap.js';
import { buildView, buildMapTitle, buildHoverText, collectMetadataValues } from '../dist/packages/renderer/buildView.js';
import { metadataValueColor } from '../dist/packages/renderer/colorMap.js';

const waferConfig = { diameter: 40 };
const dieConfig   = { width: 10, height: 10 };

function rectFillAt(view, x, y) {
  const idx = view.dies.findIndex(d => d.x === x && d.y === y && !d.partial);
  const die = view.dies[idx];
  return view.rectangles.find(r => Math.abs(r.x - die.physX) < 1e-9 && Math.abs(r.y - die.physY) < 1e-9)?.fill;
}

const results = [
  { x: 0, y: 0, hbin: 1, metadata: { project: 'our-project' } },
  { x: 1, y: 0, hbin: 1, metadata: { project: 'vendor' } },
  { x: 0, y: 1, hbin: 2, metadata: { project: 'our-project' } },
  { x: 1, y: 1, hbin: 1 }, // no metadata at all — must render as no-data
];

test('metadata mode colours dies by the active metadata key, ordered alphabetically', () => {
  const { wafer, dies } = buildWaferMap({ results, waferConfig, dieConfig });
  const view = buildView(wafer, dies, { plotMode: 'metadata', activeMetadataKey: 'project' });

  // Sorted alphabetically: 'our-project' (index 0), 'vendor' (index 1).
  const ourProjectColor = metadataValueColor(0);
  const vendorColor     = metadataValueColor(1);

  assert.equal(rectFillAt(view, 0, 0), ourProjectColor);
  assert.equal(rectFillAt(view, 1, 0), vendorColor);
  assert.equal(rectFillAt(view, 0, 1), ourProjectColor);
});

test('metadata mode renders a die with no value for the active key as no-data grey', () => {
  const { wafer, dies } = buildWaferMap({ results, waferConfig, dieConfig });
  const view = buildView(wafer, dies, { plotMode: 'metadata', activeMetadataKey: 'project' });
  const noDataFill = rectFillAt(view, 1, 1);
  assert.notEqual(noDataFill, metadataValueColor(0));
  assert.notEqual(noDataFill, metadataValueColor(1));
});

test('metadata mode with no activeMetadataKey renders every die as no-data (nothing to plot)', () => {
  const { wafer, dies } = buildWaferMap({ results, waferConfig, dieConfig });
  const view = buildView(wafer, dies, { plotMode: 'metadata' });
  const fills = new Set(view.dies.filter(d => !d.partial).map((d, i) => rectFillAt(view, d.x, d.y)));
  assert.equal(fills.size, 1, 'every die should share the same (no-data) fill');
});

test('metadataCounts tallies distinct values, excluding partial/edge-excluded dies', () => {
  const { wafer, dies } = buildWaferMap({ results, waferConfig, dieConfig });
  const view = buildView(wafer, dies, { plotMode: 'metadata', activeMetadataKey: 'project' });
  assert.equal(view.metadataCounts.get('our-project'), 2);
  assert.equal(view.metadataCounts.get('vendor'), 1);
  // The die with no metadata contributes to neither bucket.
  assert.equal([...view.metadataCounts.values()].reduce((a, b) => a + b, 0), 3);
});

test('MetadataFieldDef.values overrides win over the auto-assigned label/colour', () => {
  const { wafer, dies } = buildWaferMap({ results, waferConfig, dieConfig, metadataFields: [
    { key: 'project', label: 'Project', values: [
      { value: 'our-project', label: 'Our Project', color: '#123456' },
    ] },
  ] });
  const view = buildView(wafer, dies, { plotMode: 'metadata', activeMetadataKey: 'project' },
    { metadataFields: [{ key: 'project', label: 'Project', values: [{ value: 'our-project', label: 'Our Project', color: '#123456' }] }] });
  assert.equal(rectFillAt(view, 0, 0), '#123456');
  // Vendor has no override — still auto-coloured, not grey/undefined.
  assert.match(rectFillAt(view, 1, 0), /^#[0-9a-f]{6}$/i);
});

test('buildMapTitle names the active metadata field for "metadata" plot mode', () => {
  const { wafer, dies } = buildWaferMap({ results, waferConfig, dieConfig, metadataFields: [
    { key: 'project', label: 'Project' },
  ] });
  const view = buildView(wafer, dies, { plotMode: 'metadata', activeMetadataKey: 'project' },
    { metadataFields: [{ key: 'project', label: 'Project' }] });
  const title = buildMapTitle(view);
  assert.equal(title.primary, 'Project');
  assert.equal(title.secondary, '');
});

test('buildMapTitle falls back to a Title-Cased key when no label is configured (matches the toolbar entry label)', () => {
  const { wafer, dies } = buildWaferMap({ results, waferConfig, dieConfig });
  const view = buildView(wafer, dies, { plotMode: 'metadata', activeMetadataKey: 'project' });
  assert.equal(buildMapTitle(view).primary, 'Project');
});

test('die.metadata still renders in the tooltip regardless of plot mode, with a Title-Cased label', () => {
  const { wafer, dies } = buildWaferMap({ results, waferConfig, dieConfig });
  const die = dies.find(d => d.x === 0 && d.y === 0);
  for (const plotMode of ['hardBin', 'value', 'metadata']) {
    const text = buildHoverText(die, plotMode);
    // Pretty-cased, matching the die-list/CSV column label and the toolbar
    // entry — a raw key here would be the one surface still speaking in
    // internal terms, and this is a deliberate label-alignment change.
    assert.match(text, /Project: our-project/);
  }
});

// ── highlightMetadataValue (click-to-highlight, metadata mode's analogue of highlightBin) ──

test('highlightMetadataValue dims every die whose value does not match, including no-data dies', () => {
  const { wafer, dies } = buildWaferMap({ results, waferConfig, dieConfig });
  const view = buildView(wafer, dies, {
    plotMode: 'metadata', activeMetadataKey: 'project', highlightMetadataValue: 'our-project',
  });
  const DIM_FILL = '#e8e9ea';
  // Matching dies (0,0) and (0,1) keep their real colour, not the dim fill.
  assert.notEqual(rectFillAt(view, 0, 0), DIM_FILL);
  assert.notEqual(rectFillAt(view, 0, 1), DIM_FILL);
  assert.equal(rectFillAt(view, 0, 0), rectFillAt(view, 0, 1), 'both our-project dies share the same colour');
  // Non-matching (1,0, vendor) and no-data (1,1) both dim.
  assert.equal(rectFillAt(view, 1, 0), DIM_FILL);
  assert.equal(rectFillAt(view, 1, 1), DIM_FILL);
});

test('highlightMetadataValue has no effect outside metadata mode', () => {
  const { wafer, dies } = buildWaferMap({ results, waferConfig, dieConfig });
  const withHighlight = buildView(wafer, dies, { plotMode: 'hardBin', highlightMetadataValue: 'our-project' });
  const withoutHighlight = buildView(wafer, dies, { plotMode: 'hardBin' });
  assert.equal(rectFillAt(withHighlight, 1, 0), rectFillAt(withoutHighlight, 1, 0));
});

test('metadata legend keys are the strings highlightMetadataValue matches', () => {
  const { wafer, dies } = buildWaferMap({ results, waferConfig, dieConfig });
  const view = buildView(wafer, dies, { plotMode: 'metadata', activeMetadataKey: 'project' });
  const keys = [...view.metadataCounts.keys()].sort();
  assert.deepEqual(keys, ['our-project', 'vendor']);
});

// ── metadataColorMap: must rank/colour from the same population as metadataCounts ──
// (regression test for a bug where a value seen only on edge-excluded/partial dies could
// shift the alphabetical rank — and therefore the colour — of every later value between
// the die-fill colour map and the legend, since the two were built from different scans.)

test('metadataColorMap excludes values seen only on edge-excluded dies from the colour ranking', () => {
  // diameter=60mm (radius=30), edgeExclusion=5 → keep-zone radius=25mm, pitch=10mm.
  // Grid [-3..+3]: dies at |physX or physY| = 30 fall outside the keep zone.
  const edgeOnlyResults = [];
  for (let x = -3; x <= 3; x++) {
    for (let y = -3; y <= 3; y++) {
      edgeOnlyResults.push({ x, y, hbin: 1 });
    }
  }
  // Give the edge-excluded corner die a value that sorts BEFORE the two real values —
  // if it leaked into the ranking scan, it would shift 'our-project' and 'vendor' up by one slot.
  const edgeDie = edgeOnlyResults.find(r => r.x === -3 && r.y === -3);
  edgeDie.metadata = { project: 'aaa-edge-only' };
  const keptA = edgeOnlyResults.find(r => r.x === 0 && r.y === 0);
  keptA.metadata = { project: 'our-project' };
  const keptB = edgeOnlyResults.find(r => r.x === 1 && r.y === 0);
  keptB.metadata = { project: 'vendor' };

  const built = buildWaferMap({
    results: edgeOnlyResults,
    waferConfig: { diameter: 60, edgeExclusion: 5, notch: { type: 'bottom' } },
    dieConfig: { width: 10, height: 10 },
  });
  assert.ok(built.dies.some(d => d.edgeExcluded), 'test setup must actually produce an edge-excluded die');

  const view = buildView(built.wafer, built.dies, { plotMode: 'metadata', activeMetadataKey: 'project' });

  // The edge-only value must never enter the ranking/colour map at all.
  assert.equal(view.metadataColorMap.has('aaa-edge-only'), false);
  // With the edge-only value excluded, 'our-project'/'vendor' rank 0/1 — exactly as they
  // would if the edge-excluded die didn't exist.
  assert.equal(view.metadataColorMap.get('our-project'), metadataValueColor(0));
  assert.equal(view.metadataColorMap.get('vendor'), metadataValueColor(1));

  // And the colour map must agree with what the die is actually filled with — the whole
  // point of exposing one shared map instead of letting each consumer recompute its own.
  const dieA = view.dies.find(d => d.x === 0 && d.y === 0);
  const rect = view.rectangles.find(r => Math.abs(r.x - dieA.physX) < 1e-9 && Math.abs(r.y - dieA.physY) < 1e-9);
  assert.equal(rect.fill, view.metadataColorMap.get('our-project'));
});

test('non-primitive metadata values (objects/arrays) are treated as no-data, not counted or coloured', () => {
  const withObjectValue = [
    { x: 0, y: 0, hbin: 1, metadata: { project: 'our-project' } },
    { x: 1, y: 0, hbin: 1, metadata: { project: { nested: true } } },
    { x: 0, y: 1, hbin: 1, metadata: { project: ['array', 'value'] } },
  ];
  const { wafer, dies } = buildWaferMap({ results: withObjectValue, waferConfig, dieConfig });
  const view = buildView(wafer, dies, { plotMode: 'metadata', activeMetadataKey: 'project' });

  assert.equal(view.metadataCounts.size, 1);
  assert.equal(view.metadataCounts.get('our-project'), 1);
  assert.equal(view.metadataColorMap.size, 1);

  const NO_DATA_FILL = '#d6d9dd';
  assert.equal(rectFillAt(view, 1, 0), NO_DATA_FILL);
  assert.equal(rectFillAt(view, 0, 1), NO_DATA_FILL);
});

// ── Natural (alphanumeric) ordering of metadata values ───────────────────────

test('metadata values sort naturally, so D2 precedes D10 rather than following it', () => {
  // Semiconductor labels are overwhelmingly <prefix><number>. A plain lexicographic
  // sort yields D0, D1, D10, D11, D2 — which reads as scrambled in a legend and
  // (because the same order drives palette assignment) also scrambles die colours.
  const labels = ['D10', 'D2', 'D0', 'D11', 'D1'];
  const results = labels.map((device, i) => ({ x: i, y: 0, hbin: 1, metadata: { device } }));
  const { wafer, dies } = buildWaferMap({
    results, waferConfig: { diameter: 200 }, dieConfig: { width: 10, height: 10 },
  });
  const view = buildView(wafer, dies, { plotMode: 'metadata', activeMetadataKey: 'device' });

  assert.deepEqual([...view.metadataColorMap.keys()], ['D0', 'D1', 'D2', 'D10', 'D11']);
  // Palette assignment follows that same order.
  assert.equal(view.metadataColorMap.get('D2'), metadataValueColor(2));
  assert.equal(view.metadataColorMap.get('D10'), metadataValueColor(3));
});

test('natural ordering is locale-independent, so colours are reproducible across machines', () => {
  // compareNatural pins locale 'en' deliberately: this ordering assigns colours, and
  // the same wafer must not come out differently coloured on a differently-configured host.
  const results = ['b2', 'B10', 'a1', 'A2'].map((device, i) => ({ x: i, y: 0, hbin: 1, metadata: { device } }));
  const { wafer, dies } = buildWaferMap({
    results, waferConfig: { diameter: 200 }, dieConfig: { width: 10, height: 10 },
  });
  const order = [...buildView(wafer, dies, { plotMode: 'metadata', activeMetadataKey: 'device' }).metadataColorMap.keys()];
  assert.equal(order.length, 4);
  assert.deepEqual(order.map(v => v.toLowerCase()), ['a1', 'a2', 'b2', 'b10'],
    'numbers must order by value within each alpha prefix');
});

// ── Lot-wide colour order ──────────────────────────────────────────────────────
//
// Each view used to assign colours by index into the values on ITS OWN dies, so
// a wafer that never exhibited one category shifted every later value up a
// colour and disagreed with the lot legend about what that colour meant.

const CATS = ['D0', 'D1', 'D2'];

function waferWithCategories(cats) {
  const res = cats.map((c, i) => ({ x: i % 2, y: Math.floor(i / 2), hbin: 1, metadata: { defect: c } }));
  return { wafer: buildWaferMap({ results: res, waferConfig, dieConfig }), cats };
}

function fillOfCategory(view, dies, cat) {
  const die = dies.find(d => d.metadata?.defect === cat && !d.partial);
  return view.rectangles.find(r => Math.abs(r.x - die.physX) < 1e-9 && Math.abs(r.y - die.physY) < 1e-9)?.fill;
}

test('metadataValueOrder colours a partial wafer from the lot-wide list', () => {
  const full = waferWithCategories(CATS);
  // This wafer never exhibited D1 — with per-view ordering its D2 takes index 1,
  // the colour the legend has already given to D1.
  const partial = waferWithCategories(['D0', 'D2']);

  const local = buildView(partial.wafer.wafer, partial.wafer.dies, { plotMode: 'metadata', activeMetadataKey: 'defect' });
  assert.equal(fillOfCategory(local, partial.wafer.dies, 'D2'), metadataValueColor(1),
    'the bug: D2 painted in D1\'s colour when derived from this wafer alone');

  const shared = buildView(partial.wafer.wafer, partial.wafer.dies, {
    plotMode: 'metadata', activeMetadataKey: 'defect',
    metadataValueOrder: { key: 'defect', values: CATS },
  });
  assert.equal(fillOfCategory(shared, partial.wafer.dies, 'D0'), metadataValueColor(0));
  assert.equal(fillOfCategory(shared, partial.wafer.dies, 'D2'), metadataValueColor(2),
    'with the lot-wide order, D2 keeps the colour the legend names');
  // And the wafer that does have every value is unaffected either way.
  const fullView = buildView(full.wafer.wafer, full.wafer.dies, {
    plotMode: 'metadata', activeMetadataKey: 'defect',
    metadataValueOrder: { key: 'defect', values: CATS },
  });
  assert.equal(fillOfCategory(fullView, full.wafer.dies, 'D2'), metadataValueColor(2));
});

test('metadataValueOrder is ignored for a different key, like valueRange for a different test', () => {
  const w = waferWithCategories(['D0', 'D2']);
  const view = buildView(w.wafer.wafer, w.wafer.dies, {
    plotMode: 'metadata', activeMetadataKey: 'defect',
    metadataValueOrder: { key: 'lot', values: ['whatever'] },
  });
  assert.equal(fillOfCategory(view, w.wafer.dies, 'D2'), metadataValueColor(1),
    'an order computed for another field must not colour this one');
});

test('a value missing from the supplied order is appended, never left uncoloured', () => {
  const w = waferWithCategories(['D0', 'D9']);
  const view = buildView(w.wafer.wafer, w.wafer.dies, {
    plotMode: 'metadata', activeMetadataKey: 'defect',
    metadataValueOrder: { key: 'defect', values: ['D0', 'D1'] },
  });
  // D9 is unknown to the list, so it lands after it — coloured, and never
  // stealing a colour the list has already spoken for.
  assert.equal(fillOfCategory(view, w.wafer.dies, 'D0'), metadataValueColor(0));
  assert.equal(fillOfCategory(view, w.wafer.dies, 'D9'), metadataValueColor(2));
});

test('collectMetadataValues natural-sorts and skips dies that never get a metadata fill', () => {
  const res = [
    { x: 0, y: 0, hbin: 1, metadata: { defect: 'D10' } },
    { x: 1, y: 0, hbin: 1, metadata: { defect: 'D2' } },
    { x: 0, y: 1, hbin: 1, metadata: { defect: 'D1' } },
  ];
  const built = buildWaferMap({ results: res, waferConfig, dieConfig });
  assert.deepEqual(collectMetadataValues(built.dies.filter(d => !d.partial), 'defect'), ['D1', 'D2', 'D10']);
  // Partial/edge-excluded dies render as their own fill and must not rank values.
  const withPartial = built.dies.map(d => ({ ...d, partial: d.metadata?.defect === 'D1' }));
  assert.deepEqual(collectMetadataValues(withPartial, 'defect'), ['D2', 'D10']);
});
