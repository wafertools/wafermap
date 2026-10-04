# Developer Guide — Recipes

**Part of the [Developer Guide](../guide.md).**

## Recipes

Short, task-focused examples for common integration questions.

### Render a static thumbnail (no toolbar)

Pass `showToolbar: false` for embedded widgets, report thumbnails, or any context
where the interactive toolbar would be intrusive:

```ts
renderWaferMap(container, result, { showToolbar: false });
```

The map still renders at full quality with tooltips disabled. To re-enable
tooltips while keeping the toolbar hidden, pair with `showTooltip: true`.

### Build a gallery from a CSV grouped by wafer ID

The typical first integration: parse a multi-wafer CSV, group rows by wafer, and
render them all as a gallery.

```ts
import { buildWaferMap } from '@wafertools/wafermap';
import { renderWaferGallery } from '@wafertools/wafermap/render';

// 1. Parse — cast all numeric fields; CSV parsers return strings
const rows = csvText.trim().split('\n').slice(1).map(line => {
  const [lot, wafer, x, y, hbin, sbin, testA, testB] = line.split(',');
  return { wafer, x: +x, y: +y, hbin: +hbin, sbin: +sbin,
           testValues: { 1010: +testA, 1020: +testB } };
});

// 2. Group by wafer ID — build results as items in one pass
const byWafer = Map.groupBy(rows, r => r.wafer);  // Node 21+ / modern browsers
// or: rows.reduce((m, r) => (m.set(r.wafer, [...(m.get(r.wafer) ?? []), r]), m), new Map())

const items = [...byWafer.entries()].map(([waferId, waferRows]) => ({
  ...buildWaferMap({ results: waferRows, passBins: [1] }),
  label: waferId,
}));

// 3. Render — one call, shared toolbar across all cards
renderWaferGallery(document.getElementById('gallery'), items);
```

### Re-use a single result for both rendering and analysis

`analyzeWaferMap` accepts a `WaferMapResult` directly — no need to call
`buildWaferMap` twice:

```ts
const result  = buildWaferMap({ results, passBins: [1] });
const summary = analyzeWaferMap(result);

// summary panel and findings button appear automatically
renderWaferMap(container, result, { statsSummary: summary });
```

### Fit multiple maps to the same value range

When showing several wafers side-by-side in value mode, lock them all to the same
colour scale so differences in the data are visible rather than hidden by
per-wafer auto-scaling:

```ts
const TEST = 1050;  // the test we lock the scale to

// Compute the shared range across all wafers first
let min = Infinity, max = -Infinity;
for (const r of waferResults) {
  for (const die of r.dies) {
    const v = die.testValues?.[TEST];
    if (v !== undefined) { min = Math.min(min, v); max = Math.max(max, v); }
  }
}

// Apply it as a per-card override so the shared gallery scale doesn't override it.
// Use the test-keyed `{ test, range }` form: the range is bound to the test it was
// computed from. If the active test is ever something other than TEST, the library
// ignores the range and auto-scales rather than colouring the wrong test's data
// against 1050's scale — you cannot accidentally produce a mis-scaled plot.
const items = waferResults.map((r, i) => ({
  ...r,
  label: waferIds[i],
  viewOptions: { valueRange: { test: TEST, range: [min, max] }, activeTest: TEST },
}));

renderWaferGallery(container, items, { viewOptions: { plotMode: 'value' } });
```

> The plain tuple form `valueRange: [min, max]` still works and applies to
> whichever test is active — but then keeping it consistent with `activeTest` is
> your responsibility. Prefer `{ test, range }` whenever the range was derived
> from a specific test.

### Changing the ring count

Set `ringCount` once, on `buildWaferMap` (default 4). The result carries it, and the ring
boundaries on the map, the Summary panel's ring yield, the report and the ring findings all
read it, so "Ring 2" always names the same dies:

```ts
const result  = buildWaferMap({ results, waferConfig, dieConfig, ringCount: 5 });
const summary = analyzeWaferMap(result);
renderWaferMap(container, result, { statsSummary: summary });
```

### Sync toolbar state to your own UI controls

`onViewOptionsChange` fires whenever the toolbar changes a display option. Use
it to reflect the map's current state in external controls — a mode dropdown, a
rotation indicator, or a URL query string:

```ts
const ctrl = renderWaferMap(container, result, {
  viewOptions: { plotMode: 'hardBin' },
  onViewOptionsChange: (opts, changed, category) => {
    modeDropdown.value = opts.plotMode;
    if (category !== 'state') {
      urlParams.set('mode', opts.plotMode);
      history.replaceState(null, '', '?' + urlParams);
    }
  },
});

// Drive the map from external controls in the other direction:
modeDropdown.addEventListener('change', () => {
  ctrl.setOptions({ plotMode: modeDropdown.value });
});
```

### Use gross die yield (edge dies in denominator)

By default, edge-excluded dies are removed from both the numerator and
denominator — they don't affect yield either way. Set
`edgeDieYieldMode: 'denominator-only'` to compute gross die yield instead —
edge dies count against yield but can never pass:

```ts
const result = buildWaferMap({
  results,
  waferConfig: { diameter: 300, edgeExclusion: 3 },
  dieConfig:   { width: 8, height: 12 },
  passBins:    [1],
  edgeDieYieldMode: 'denominator-only',
});

const { yieldPercent, yieldPercentGross } = result.yield;
// yieldPercent      — standard yield: edge dies excluded from both sides
// yieldPercentGross — gross die yield: edge dies in denominator only
```

### Filter findings by severity, kind, or spatial family

`filterFindings` slices the `findings` array from any `StatsSummary` or
`LotStatsSummary`. All criteria are ANDed; each accepts a single value or an
array:

```ts
import { filterFindings } from '@wafertools/wafermap/stats';

// Only ring or quadrant findings at unusual severity:
const critical = filterFindings(summary, {
  severity: 'unusual',
  family:   ['ring', 'quadrant'],
});

// All yield findings regardless of severity:
const yieldFindings = filterFindings(summary, { kind: 'yield' });
```

### Analyse a lot in Node.js without a browser

`buildWaferMap` and `analyzeWaferMap` have no DOM dependency — run them in a
plain Node.js script for CI checks, batch processing, or quick dataset
exploration:

```js
// analyse-lot.mjs  —  node analyse-lot.mjs
import { readFileSync } from 'node:fs';
import { buildWaferMap }   from '@wafertools/wafermap';
import { analyzeWaferMap } from '@wafertools/wafermap/stats';

const csv    = readFileSync('data/wafers.csv', 'utf8');
const lines  = csv.trim().split('\n');
const header = lines[0].split(',');
const col    = (row, name) => row[header.indexOf(name)];

const rows = lines.slice(1).map(line => {
  const r = line.split(',');
  return { wafer: col(r,'wafer'), x: +col(r,'x'), y: +col(r,'y'),
           hbin: +col(r,'hbin'), testValues: { 1010: +col(r,'testA') } };
});

const byWafer = Map.groupBy(rows, r => r.wafer);

for (const [waferId, waferRows] of byWafer) {
  const result  = buildWaferMap({ results: waferRows, passBins: [1] });
  const summary = analyzeWaferMap(result);
  const yld     = summary.stats.yieldPercent;
  const top     = summary.findings[0];
  console.log(
    `${waferId}  yield=${yld !== null ? yld.toFixed(1) + '%' : 'n/a'}` +
    `  findings=${summary.findings.length}` +
    (top ? `  top=[${top.severity}] ${top.summary}` : ''),
  );
}
```


### Keep a gallery responsive when building many maps

`buildWaferMap` and `analyzeWaferMap` are synchronous. Building a large gallery in
a single `.map()` loop blocks the main thread until all items are ready, leaving
the page blank for several seconds.

Pass factory functions instead of pre-built items and the gallery handles the rest
— the control bar and placeholder cards appear immediately, and each card is built
and inserted one per browser task as the factories run:

```ts
const items = fixtures.map(sample => () => {
  const result  = buildWaferMap({ results: sample.results, passBins: [1] });
  const summary = analyzeWaferMap(result);
  return { ...result, label: sample.label, statsSummary: summary };
});

renderWaferGallery(container, items);
```

The only visible difference is that each card's label is blank until its factory
runs — if the label depends on computed data (e.g. a findings count), it appears
when the card does rather than upfront. If the label is known in advance and you
want it visible immediately, pre-build items as usual for those cards.

**Showing progress while it runs.** A large lot can stage for 10–25 seconds, and a
host indicator that can only say "loading" for that long reads as a hang. The
gallery reports both its advance and its completion:

```ts
renderWaferGallery(container, items, {
  onItemResolved: (resolved, total) => {      // advance — one call per card
    bar.max = total;                          // `total` is right from the first call
    bar.value = resolved;
    label.textContent = `Rendering wafer ${resolved} of ${total}…`;
  },
  onItemsResolved: () => {                    // settled — hide the indicator here
    indicator.hidden = true;
  },
});
```

Two things to get right, both of which are why these are two separate signals:

- **Hold your indicator to `onItemsResolved`, not to `resolved === total`.** The
  lot-wide Summary panel is the last surface to settle and on a big lot it keeps
  filling in for seconds after the last card, with no card activity to report.
  Clearing the indicator when the cards land leaves the rest of the wait
  unexplained — the failure the progressive path exists to prevent, one layer up.
- **Neither callback needs you to know which form you passed.** A fully pre-built
  mount is one `onItemResolved` call with `resolved === total`, and
  `onItemsResolved` always fires, always asynchronously, after
  `renderWaferGallery` has returned. Both fire again on a rebuild — `setItems`, or
  switching into a stacked mode.

### Standalone stacked lot map with programmatic findings access

The gallery's stacked modes cover most use cases. Use `buildWaferMap({ lotStack })`
directly when you need one or more of:

- A **standalone stacked map** outside a gallery (e.g. a dedicated lot-average view)
- **Programmatic access to findings** before rendering (to filter, store, or feed your own UI)
- A **fixed aggregation method** set at build time rather than chosen interactively

```ts
import { buildWaferMap } from '@wafertools/wafermap';
import { renderWaferMap } from '@wafertools/wafermap/render';
import { analyzeWaferMap } from '@wafertools/wafermap/stats';

// Aggregate six wafers into a single mean map
const result = buildWaferMap({
  lotStack:    { results: waferResults, method: 'mean' },
  waferConfig, dieConfig,
  testDefs,    // include limitLow/limitHigh to enable cluster detection
});

// Run spatial analysis on the aggregated result
const summary = analyzeWaferMap(result, {
  testNumbers: [1060],   // optional: restrict to a specific test
});

// summary.stats.isLotStack        === true
// summary.stats.aggregationMethod === 'mean'

renderWaferMap(container, result, {
  viewOptions:  { plotMode: 'value', activeTest: 1060 },
  statsSummary: summary,
  summaryPanel: { defaultOpen: true },
});
```

Systematic lot patterns (e.g. an NE-quadrant drift present on every wafer) survive
averaging and emerge as clear findings on the lot-average map. The Summary panel
labels the view as "N wafers · mean" so it is unambiguous to the reader.

For cluster and edge-arc detection, dies that exceed a test's spec limits
(`limitLow` / `limitHigh` in `testDefs`) are used as the failure proxy. If no spec
limits are defined, cluster detection is skipped automatically.

**→ [Demo: Standalone stacked map with spatial analysis](../examples/statistics.html#lot-stack)**
