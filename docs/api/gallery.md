# API Reference — `renderWaferGallery` — gallery

**Part of the [API Reference](../api.md).**

## 6 `renderWaferGallery(container, items, options?)` — gallery

A multi-map gallery with a shared control bar, per-card view-only toolbars, and
click-to-detach into separate windows. All cards stay in sync — changing mode,
colour, rotate, or flip in the gallery bar applies to every card instantly.

```ts
renderWaferGallery(container: HTMLElement, items: Array<WaferMapDisplayItem | WaferMapDisplayItemFactory>, options?: GalleryOptions): GalleryController
```

> **As with `renderWaferMap`, `options` is optional.** `GalleryOptions` has 19
> top-level fields; tsmap passes the same six it passes to `renderWaferMap`. The
> two option types deliberately overlap, so what you learned there mostly carries
> over — this section documents the gallery-only additions (`columns`,
> `lotStatsSummary`, per-card legends) and the shared fields' gallery behaviour.

The container needs a **width** but not a fixed height — the grid grows to fit its
cards. `width: 100%` is the typical choice; do not set `overflow: hidden` on it or
card content will be clipped.

```html
<div id="gallery" style="width: 100%;"></div>
```

The gallery's toolbar and legend are `position: sticky`, so they stay visible while
the grid scrolls. Stickiness needs a scrolling ancestor with a bounded height and
`overflow-y: auto` (or `scroll`) — the container itself, or any parent. Without one,
the toolbar and legend just scroll away with the grid as before; nothing breaks,
they're simply not sticky.

```ts
import { renderWaferGallery } from '@wafertools/wafermap/render';

renderWaferGallery(document.getElementById('gallery'), items, galleryOptions);
```

### 6.1 `WaferMapDisplayItem`

A gallery item. `WaferMapResult` satisfies this interface structurally, so `buildWaferMap` results can be passed directly with no conversion. Only `wafer` and `dies` are required — everything else is optional, which allows synthesized items (e.g. stacked-mode aggregates) to be constructed without the full result shape.

```ts
interface WaferMapDisplayItem {
  wafer:         Wafer                                // required — wafer geometry
  dies:          Die[]                                // required — die data

  hbinDefs?:     BinDef[]                             // hard bin names/colors
  sbinDefs?:     BinDef[]                             // soft bin names/colors
  testDefs?:     TestDef[]                            // named test definitions
  metadataFields?: MetadataFieldDef[]                 // opts die.metadata keys into 'metadata' plot mode — §4.1.12
  reticles?:     Reticle[]                            // reticle field geometry

  label?:        string                               // names this wafer on its card header, in findings/yield lists, reports,
                                                      // the die list's Wafer column and a detached window — default: the
                                                      // wafer's metadata.waferId, else "Wafer N (no ID)"
  viewOptions?:  Partial<WaferViewOptions>            // per-card overrides merged on top of shared options
  statsSummary?:  StatsSummary                        // shown in the card's own summary panel when detached into its own window, and in the gallery Wafers panel; when lotStatsSummary is provided, per-wafer findings are available automatically — only set this explicitly when analysing without analyzeWaferLot
  onClick?:       (die: Die, event: MouseEvent) => void
  onSelect?:      (dies: Die[]) => void
}
```

Items are typically `buildWaferMap` results with display overrides spread in:

```ts
// Simplest form — result is a valid item as-is:
items = results.map(r => r);

// With display overrides:
items = results.map((r, i) => ({ ...r, label: ids[i] }));

// With per-card stats:
items = results.map((r, i) => ({ ...r, label: ids[i], statsSummary: summaries[i] }));
```

Reticle overlays are wired automatically from `result.reticles` — no extra configuration needed.

### 6.1.1 `WaferMapDisplayItemFactory`

```ts
type WaferMapDisplayItemFactory = () => WaferMapDisplayItem
```

A factory function accepted anywhere a `WaferMapDisplayItem` is expected (in the `items` array passed to
`renderWaferMap` or `setItems`). When the gallery encounters a factory it inserts a placeholder
card immediately and calls the factory in a deferred browser task (`setTimeout(0)`), swapping in
the real card when it returns.

Use factories instead of pre-built items when `buildWaferMap` / `analyzeWaferMap` is expensive —
the gallery shell and control bar appear instantly and cards fill in one by one rather than the
page being blank while all maps are built:

```ts
const items = fixtures.map(sample => () => {
  const result  = buildWaferMap({ results: sample.results, passBins: [1] });
  const summary = analyzeWaferMap(result);
  return { ...result, label: sample.label, statsSummary: summary };
});

renderWaferGallery(container, items);
```

The placeholder card shows no label — if the label depends on computed data (e.g. a findings
count) it appears when the card does. Pre-built items and factories can be mixed freely in the
same array. Stacked modes (`stackedValues`, `stackedBins`, `stackedSoftBins`) require all items
to be pre-built.

### 6.2 `GalleryOptions`

```ts
{
  viewOptions?:           WaferViewOptions  // initial shared state
  onViewOptionsChange?:   (opts: WaferViewOptions, changed: (keyof WaferViewOptions)[], category: 'preference' | 'state' | 'mixed') => void
                          // mirrors control bar changes; same category semantics as renderWaferMap
  onItemsResolved?:        () => void        // fires once the gallery is settled: every factory resolved and the
                                            // lot-wide legend, colours and Summary panel up to date. Always async,
                                            // and always fires whether you passed factories or pre-built items, so a
                                            // host holding a progress indicator over a large lot needs no polling and
                                            // no knowledge of which path the gallery took. Fires again on a rebuild
                                            // (setItems, or switching into a stacked mode).
                                            // It waits for the Summary panel's own render, which on a big lot finishes
                                            // seconds after the last card: 50 wafers x 8,000 dies x 50 tests in Chrome
                                            // are carded at 3.6 s and settled at 8.2 s. Hold your indicator to here —
                                            // clearing it when the cards land leaves the rest of the wait unexplained
  onItemResolved?:         (resolved: number, total: number) => void
                                            // fires as each card is built, with how many of the expected items exist
                                            // now and how many there will be. `total` is the count you passed, so it
                                            // is right from the first call and a bar can be sized before anything
                                            // arrives. This is the ADVANCE signal; onItemsResolved is the SETTLED one.
                                            // Fires on the pre-built path too — a fully synchronous mount is one call
                                            // with resolved === total — so you never branch on which form you passed;
                                            // a mixed set reports its pre-built items in one call, then one per factory.
                                            // It covers the cards only: after resolved === total the Summary panel is
                                            // still filling in with no card activity, and onItemsResolved marks the end
                                            // of that. Not called for an empty item list
  downloadFilename?:       string             // prefix for every file the gallery, its cards and detached windows
                                            // save; the lots, wafer count and content follow it (§5.4.5)
  onSaveImage?:            (blob: Blob, suggestedName: string) => void | Promise<void>
                                            // host hook for persisting the composite gallery PNG (and each card's own
                                            // save). Mirrors renderWaferMap's onSaveImage — see §5.4 for full semantics.
  onSaveText?:             (text: string | Blob, suggestedName: string, mimeType: string) => void | Promise<void>
                                            // host hook for every CSV export in the gallery, its cards and its panels.
                                            // Mirrors onSaveImage — see §5.4 for full semantics.
  showHelpButton?:         boolean           // show a help button in the gallery bar that opens the built-in end-user
                                            // guide (default false). Opens as a real, separate window when `window.open`
                                            // is available, falling back to an in-page non-modal floating window when
                                            // it's blocked (some embedded WebViews)
  userGuideExtension?:     UserGuideExtension  // insert a host app's own documentation into the guide window
                                            // (see "User guide extension" below) — only relevant when showHelpButton is true
  lotStatsSummary?:        LotStatsSummary   // lot-level stats from analyzeWaferLot — adds a Summary button to the toolbar; per-wafer findings are drawn from the lot analysis automatically and badged onto the Wafer Yield rows
  summaryPanel?:           SummaryPanelOptions  // Summary panel placement and open/closed initial state (§5.4.2)
  findingsNotice?:         FindingsNotice  // a row at the top of the Findings section stating that a category of finding is not present, and
                                            // optionally offering to compute it — see §5.4.2. Replace it with setFindingsNotice(notice | undefined).
  dieList?:                DieListDisplayOptions // "Data tables" button inside the Summary panel — Statistics, every die
                                            // across the whole lot (pooled, with a Wafer column) and one row per wafer. Not a toolbar
                                            // button; requires summaryPanel to be reachable. Default ENABLED
                                            // (shows automatically whenever the Summary panel is); set
                                            // { enabled: false } to hide it. §5.4.4
  insights?:               InsightsOptions   // adds a Maps | Insights switch that swaps the grid for a lot-wide chart
                                            // suite (Overview, Distributions, Correlation, with a "Group by" control)
                                            // — default disabled. See §6.10.
  attributes?:             Record<string, WaferAttributeDef>  // your names for wafer attributes: label, facet?, date?: what Group by offers and the strip, Wafers table and reports call each
  warnings?:               WarningsOptions   // built-in surfacing of the library's own advisories — ON by default.
                                            // Collected across every card and de-duplicated, so a problem affecting
                                            // the whole lot is stated once, not per wafer.
  columns?:                number            // fix the number of grid columns; omit to let the gallery auto-size based on die pitch
  zIndex?:                 number            // base z-index for wmap's transient overlays (menus, tooltip, modals); omit for a
                                            // safe high default, or set it to embed the gallery inside your own modal/overlay
                                            // (same semantics as renderWaferMap — see "Overlay z-index" in §5.4)
}
```

### 6.3 `GalleryController`

```ts
{
  setItems(items: Array<WaferMapDisplayItem | WaferMapDisplayItemFactory>): void  // rebuild all cards; factories resolved progressively
  setOptions(opts: Partial<WaferViewOptions>): void // sync shared options to all cards
  getOptions(): WaferViewOptions
  setLotStatsSummary(summary: LotStatsSummary | undefined): void  // update the lot summary panel at runtime
  setColumns(columns: number | undefined): void  // fix the column count, as the toolbar's Columns control does; undefined = auto layout
  getBinColors(): BinColors  // the bin colours every card draws, resolved over the whole gallery (§10.6)
  openUserGuide(): void   // opens the end-user guide window directly — the same action the help toolbar button
                                  // performs, but callable regardless of showHelpButton, so a host that hides
                                  // wmap's own help button (e.g. folding it into its own combined help menu) can
                                  // still trigger the guide without a DOM query
  destroy(): void
}
```

### 6.4 Gallery control bar

| Button | Action |
| --- | --- |
| Mode | Dropdown: plot mode for all cards |
| Palette | Menu: bin colour scheme (bin modes) or value gradient (other modes) for all cards — same menu as §5.6. Bin colours are resolved **once across the whole gallery** and handed to every card, so a bin is the same colour on every wafer and in the lot legend. Hidden in `'metadata'` mode — that mode always uses its own dedicated ordered palette (§4.1.12), so the control would have no visible effect. |
| Log scale | Toggle log₁₀ scale for all cards. Shown only in `value` / `stackedValues` modes, and hidden whenever a solid pass/fail display is active or the active test is functional, since log scale has no effect on pass/fail colouring. |
| Rings | Toggle ring boundaries on all cards |
| Quadrants | Toggle quadrant boundaries on all cards |
| Labels | Toggle die labels on all cards |
| Reticle | Toggle reticle overlay on all cards — only shown when at least one item has reticle geometry |
| XY indicator | Toggle axis-orientation arrows on all cards |
| Legend style | Dropdown: **Legend on each map** (`perCardLegend`, off by default; forced on in value modes, where no lot-level colorbar exists), then **Position on each map** — **Default (right)**, **Compact (right)**, **Left**, **Top**, **Bottom**, **Floating** (`legendPosition`). Positions are greyed while per-card legends are off, and hidden outside hardBin/softBin/metadata modes. The lot-level legend strip is not affected by either. |
| Orientation | Dropdown: Rotate 90° CW, Flip horizontal, Flip vertical — applies to all cards |
| Columns | Dropdown: fix the column count to 1–5, or restore **Auto** (default). Auto sizes columns so dies are at least 4 px wide; its cards are capped by die density and pack from the left rather than stretching to fill the width. A fixed count divides the full width between that many columns, with no cap. |
| Select on every wafer | Toggle, off by default. On, a selection (box, click or clear) made on any card is applied at the same die positions on every card, and the drilldown menu (§5.12) — right-click or the Menu key on a card or its header, or the Chart button — opens on those dies across all the wafers: the charts, and the **Dies**, **Test statistics** and **Wafers** tables, stated as "selected at the same die positions on N wafers". Files are named by the gallery's own lot context. A badge counts the selected die positions; a click with a selection showing clears it (and stays on), and turning the mode off clears every card. No option: a toolbar toggle only. |
| (picked wafers) | **Ctrl/Cmd+click a card's header** picks that wafer (outlined; the toolbar shows "N wafers picked ✕", which clears them). Right-click a picked card for the drilldown menu (§5.12) on every die of every picked wafer, with a **Wafers** table; dies selected on a map take precedence. Picks are dropped when the items change. |
| Download gallery | Composite PNG of all cards at full HiDPI resolution |
| Summary | Toggle the Summary panel — shown when `lotStatsSummary` is provided or any item carries `statsSummary` |
| Insights | Toggle the Insights tab — swaps the grid for a lot-wide chart suite. Shown unless `insights.enabled` is `false`. See §6.10. |
| User guide | Open the built-in end-user guide — a real, separate window when available, falling back to an in-page non-modal floating window when `window.open` is blocked (some embedded WebViews). Only shown when `showHelpButton: true`; callable directly via `openUserGuide()` regardless. |

Per-card toolbars show only the map tools: download, zoom region, zoom +/−, reset, pan, box-select and **Chart** (§5.12, when there is something to chart).

**Right-click on a card** anywhere outside its map — the header, the space around the map — opens the drilldown menu (§5.12) for that card's whole wafer; on the map itself it behaves as on a single map. Insights' per-wafer marks (a *Yield by wafer* bar, a boxplot row, a trend point) offer the same menu for their wafer.

**While the Insights tab is open**, the grid/mode/palette/overlay/orientation/columns/download controls above, and Summary, are all hidden as a group — none of them apply to the chart suite, and Summary specifically toggles the gallery's Summary panel, which lives inside the grid body already hidden underneath. Summary, Insights, and User guide stay visible.

### 6.5 Summary panel

When `lotStatsSummary` is provided or any item carries `statsSummary`, a **Summary panel** toggle button appears in the control bar. Clicking it opens one panel (no tabs — see §5.5) alongside the grid. With `lotStatsSummary` it shows yield, bin breakdown and ring/quadrant yield across all the wafers, test value statistics, cross-wafer findings (repeated patterns, yield outliers), and a **Wafer Yield** list with each wafer badged by its own findings count; a "Summary report" button opens the full lot report (`renderLotReportHtml`, §7.6). Without `lotStatsSummary`, the panel lists the wafers that have findings of their own.

The header names the population: `Summary — Lot LOT123 · 13 wafers` when every wafer records the same lot ID, otherwise `Summary — 26 wafers from 2 lots` (or just `13 wafers` when none records a lot). Statistics taken across the set follow the same rule — "lot median" only for one lot, "median of all wafers" otherwise — so a gallery pooling several lots never reads as one.

`analyzeWaferLot` runs per-wafer analysis internally, so passing `lotStatsSummary` alone populates the panel — no separate `analyzeWaferMap` per item is needed.

Clicking a finding highlights the affected area:

- **Repeated-pattern findings** (e.g. ring or quadrant patterns seen across multiple wafers) — outlines the affected cards and highlights the matching die zone on each
- **Inter-wafer yield outliers** — outlines the outlier card(s)

Clicking the active finding again clears the highlight. Detaching a card while a finding is active passes through the card's `statsSummary` so the window's own per-wafer summary panel is also available.

### 6.6 Detaching a card into its own window

Each card header contains an expand button (↗). Clicking it detaches that card
into its own **real, separate window** (`window.open`) — not an in-page overlay —
so it can be moved anywhere on screen, including outside the bounds of the host
browser/app window, same as any other OS-managed window. The gallery grid stays
fully interactive the whole time (there was never a backdrop or overlay to block
it), and any number of cards may be detached at once, so several wafers can be
inspected side by side. The detached window mounts a fresh `renderWaferMap` at
full resolution with the complete toolbar; shared view options are passed
through so it opens in the same display state as the gallery.

The card left behind in the grid becomes a small placeholder — its own
controller is torn down while detached (the popup is the only live view of that
wafer) — and its header button toggles to a "reattach" affordance (same button,
no new UI). Clicking it, or closing the popup window itself, tears the popup
down and rebuilds a fresh card in the grid slot with the gallery's current
shared view options.

If the gallery's card set changes shape while a card is detached — most notably
a stacked-mode switch, which can collapse many per-wafer cards into fewer
aggregate ones — the popup has no equivalent grid slot to return to. Rather than
closing or breaking, it becomes **unlinked**: its window title and an in-content
banner both switch to an "— unlinked from gallery" notice, its own canvas/toolbar
keep working exactly as before, and it can only be closed manually from then on
(there is no longer a slot to reattach to).

**Embedded hosts where `window.open` is blocked (e.g. Tauri, Electron, WebView2).**
As with reports (§7.7), a plain `window.open` call is blocked/returns
`null` silently in these environments. Rather than leaving the detach button
inert there, wmap automatically **falls back to the same in-page non-modal
floating window the user guide uses** whenever `window.open` is unavailable and
no custom opener is registered — detach keeps working everywhere, it just can't
be dragged outside the host window's own bounds in that fallback case.

**Non-modal floating windows can be collapsed.** Both the detach fallback
window above and the user guide's own window (§6.5) show a Collapse button in
their header, alongside maximize/close. Collapsing shrinks the window to a
220px-wide title strip — the map/content is hidden, not destroyed, and
Show contents restores it to its previous size (including any size the user
resized it to). The title truncates with an ellipsis and a native hover
tooltip while collapsed. The button is hidden while the window is maximized, so a
maximized window shows restore and close only. It is drawn as chevrons rather than
an OS-style `_`, because in a desktop host a maximized window's header sits directly
under the OS title bar. Modal overlays (the single-map expand modal opened
via the toolbar's expand button or `E`) do not get this button, since a
modal's backdrop already blocks the rest of the page — collapsing one would
achieve nothing.

If your host has its own multi-window API and you want a real separate OS
window instead of the in-page fallback, register a custom opener at startup:

```ts
import { setDetachWindowOpener } from '@wafertools/wafermap/render';

setDetachWindowOpener((label) => {
  // Return a Window-like handle (must expose a usable `.document`, `.closed`,
  // and `.close()`) backed by your host's own window API. Return null to
  // decline — falls back to the in-page floating window, same as if no
  // opener were registered at all.
  return myApp.openDetachWindow(label);
});
```

**Not usable for Tauri as designed.** A Tauri `WebviewWindow` is fully
isolated — a separate script context with its own `window`/`document` and no
shared JS state with the window that created it — so it cannot produce the
synchronous `Window`-with-live-`.document` handle this contract expects. Tauri
hosts get the in-page fallback automatically with no configuration; a real
Tauri-backed detach window would need a different mechanism entirely (a
dedicated bootstrap page + IPC to pass the wafer data across, since there's no
way to share a DOM reference between Tauri windows) — tracked as an open,
unscoped item in tsmap's own issue log if you're building a Tauri host and want
to pick this up.

### 6.7 Shared bin legend & lot metadata strip

A shared strip is rendered between the control bar and the card grid, combining
two independent pieces of content:

- **Bin swatches** — for `hardBin` and `softBin` modes only, one coloured
  swatch and label per unique bin across all items. Hidden for `value`,
  `stackedValues`, `stackedBins`, and `stackedSoftBins` (those modes use a
  per-card colorbar instead), unchanged from before.
- **Lot-level metadata** (lot, product, test program, temperature, etc.) — shown
  in **every** mode, not just bin modes, so basic wafer/lot identity is never
  hidden behind a mode switch. Built on `buildFacetTable` (`@wafertools/wafermap/stats`):
  a field with a single value across every currently-shown item shows it
  plainly (`Lot: LOT123`); a field that varies shows every distinct value it
  takes (`Lot: LOT123, LOT456`) — never `analyzeWaferLot`'s first-wafer-wins
  `lotIdentity`, and never silently dropped just because a gallery spans
  multiple lots. The strip fills the width it has, on one line: fields are
  taken in priority order (lot, product, program, split, then the rest), each
  listing as many of its distinct values (by wafer coverage) as fit, up to 12,
  with the count in the label and a trailing ellipsis when it is cut
  (`Lot (5): LOT-A, LOT-B, …`). Only when a field cannot fit even one value do it
  and the fields after it move behind one button (`N more fields`), which opens
  them all. It re-fits as the width changes.
  `waferId` stays excluded from this strip by default (unique per wafer,
  never a useful summary value — the same curation `buildFacetTable` already
  applies for the Insights "Group by" control). In a stacked mode, also leads
  with `"N wafers stacked · <method>"`.

The strip is hidden only when there is nothing to show at all — no metadata and
no bin swatches for the current mode.

The richer per-wafer fields this strip's distinct-value list doesn't fully spell
out are also available per card: each card's header is expandable — click it
(or the chevron next to the label) to reveal that wafer's own full metadata as
an overlay under the header, not a layout push, so it never resizes the card's
map. Only rendered when the wafer actually has metadata to show. A card
detached into its own window — a real popup, or the in-page floating-window
fallback used when `window.open` is unavailable — carries the exact same
expandable header, so identity and metadata read identically wherever a
wafer from this gallery is being viewed.

The bin swatches use bin definitions from the gallery items — `hbinDefs` for
hardBin mode, `sbinDefs` for softBin mode. Because hard and soft bin number
spaces are independent (STDF V4: both 0–32767), the two arrays are kept separate
and never merged.

Clicking a bin entry sets `highlightBin` to that bin, which dims all non-matching
bins on every card simultaneously; Ctrl/Cmd+click (or Ctrl/Cmd+Enter/Space) adds or
removes a bin, and clicking the only active entry clears the highlight. A clicked lot
finding about a bin sets it to that bin; a legend click releases the finding. The active entry is indicated with a bold label and a blue swatch
border. The strip rebuilds automatically whenever the mode, colour scheme,
highlight, or item set changes.

### 6.8 Stacked modes

The toolbar includes three lot-aggregation modes: **Stacked Hard Bins**,
**Stacked Soft Bins**, and **Stacked Test Values**.  The gallery handles
aggregation internally. 

Bin and test definitions are read from the gallery items automatically — no need to pass them in `viewOptions`. The gallery discovers unique values from the input dies to generate the cards and legend.

- **`stackedBins` / `stackedSoftBins`** — one card per bin; each die shows the
  count of wafers on which that bin appeared at that position.
- **`stackedValues`** — one card per test parameter; each die shows the lot
  aggregate (mean by default) of that parameter.  The aggregation method is
  `sharedOpts.aggregationMethod` (default `'mean'`); change it with
  `ctrl.setOptions({ aggregationMethod: 'median' })`.

Switching to a stacked mode rebuilds the cards; switching back restores the
original per-wafer cards.  `ctrl.setItems(newItems)` always accepts per-wafer
items — the gallery re-aggregates automatically if a stacked mode is active.

### 6.9 Gallery example

```ts
import { buildWaferMap } from '@wafertools/wafermap';
import { renderWaferMap } from '@wafertools/wafermap/render';

const results = waferIds.map(id => buildWaferMap({ results: dataByWafer[id], dieConfig }));
const items = results.map((r, i) => ({
  ...r,
  label:    waferIds[i],
  onClick:  (die) => showDieDetail(die, waferIds[i]),
  onSelect: (selected) => showSelectionPanel(waferIds[i], selected),
}));

const ctrl = renderWaferGallery(document.getElementById('gallery'), items, {
  viewOptions: { plotMode: 'hardBin' },
  onViewOptionsChange: (opts, changed, category) => syncSidebarControls(opts, changed, category),
  downloadFilename: 'lot-overview',
});

// Rebuild after wafer selection changes:
ctrl.setItems(newItems);

// Sync from external control:
ctrl.setOptions({ plotMode: 'value' });

// Clean up:
ctrl.destroy();
```

### 6.10 Insights tab

Insights is on by default (pass `insights: { enabled: false }` to remove it). It adds a **Maps | Insights** switch at the far right of the chrome row, after the toolbar, in the same place in both views. Choosing **Insights** swaps the grid for a lot-wide chart suite, computed from every gallery item's `dies` — mutually exclusive with the grid view, since the chart suite wants the full body's room, not a side panel. The gallery grid's own state (mode, columns, etc.) is preserved underneath and restored when you switch back. Independent of the Summary panel (§6.5, opened separately) — the two toggle independently and neither hides the other's controls, since the Summary panel's click-to-highlight has nothing to act on while Insights has replaced the grid.

Insights has the same sub-tabs as the single-wafer version (§5.9) — **Overview**, **Distributions**, **Correlation**, and **Data**, whose **Statistics** view follows the Group by below with one set of tables per group, and whose **Wafers** view is the lot as one row per wafer — plus:

- **Group by.** When any gallery item's `wafer.metadata` has more than one distinct value for a groupable field (`lot`, `product`, `testProgram`, `temperature`, `split`, or any custom key), a "Group by" dropdown appears above the panels. `waferId` is deliberately never offered — every panel already shows one row/box per wafer when ungrouped, so "grouping" by wafer identity would just recreate that with an extra click. Each panel consumes the active grouping differently, matching what makes sense for that chart type:
  - **Yield / bin pareto** — one pooled bar per group, click-to-drill into that group's per-wafer bars with a Back button. Grouped bin pareto swaps to a clustered view (one bar per group, side by side, per bin) instead of drilling.
  - **Boxplot** — one pooled row per group by default, click-to-drill into that group's per-wafer rows with a Back button.
  - **Histogram** — an overlaid multi-series view, one coloured series per group, with a click-to-emphasize legend.
  - **Capability / correlation matrix** — a "Group: `<value>` ▾" dropdown that restricts to exactly one group's dies at a time (pooling across groups would be misleading for both — Simpson's paradox for correlation, mixed-population statistics for capability).
  - **Scatter** — never restricts; every group's points are always plotted together, coloured by group instead of hard bin, with a click-to-filter legend.
- **Wafer picker.** Histogram, correlation, and scatter each pool every wafer by default when ungrouped (they draw one shared canvas, not one per wafer) — a "Wafer: `All wafers ▾`" selector lets you narrow to a single wafer instead. Narrowing also clears the "Mixed `<fields>` — Simpson's paradox" warning that correlation/scatter show when the pooled wafers vary on a groupable field, since a single wafer can't be mixed with anything.
- **Click to open a wafer.** Leaf rows in the yield bar and the boxplot (a real per-wafer row — ungrouped, or drilled into a group) open that wafer in a modal, reusing the same detach-window rendering the gallery's card-expand feature uses. A boxplot leaf click opens the wafer already in **test-value mode on the boxplot's currently selected test**, not the default plot mode. Bin pareto/cluster bars and capability/correlation/scatter are not clickable-to-open.
- **Precomputed lot yield.** When `lotStatsSummary` is also provided, the yield panel reads each wafer's yield directly from `lotStatsSummary.lotYieldSeries` instead of recomputing it from dies — guaranteeing the Insights tab's yield numbers agree exactly with the gallery's own Summary panel (§6.5) and any report generated from the same `lotStatsSummary`. Falls back to computing from dies (same `passBins`/exclusion rule as `buildWaferMap`) when `lotStatsSummary` is absent.

```ts
const items = results.map((r, i) => ({ ...r, label: waferIds[i] }));
const lotSummary = analyzeWaferLot(items.map(it => ({ dies: it.dies, wafer: it.wafer })));

renderWaferGallery(document.getElementById('gallery'), items, {
  insights: { enabled: true },
  lotStatsSummary: lotSummary,
});
```

`analyzeWaferLot` → §7.2 · `LotStatsSummary` → §7.5

---
