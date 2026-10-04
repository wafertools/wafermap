# API Reference — `renderWaferMap` — single map

**Part of the [API Reference](../api.md).**

## 5 `renderWaferMap(container, result, options?)`

A fully self-contained interactive wafermap. Accepts a `WaferMapResult` directly,
owns view building internally, and provides a **built-in toolbar** that appears on
hover — wafermap-specific controls always in the same place.

```ts
renderWaferMap(container: HTMLElement, result: RenderableWaferMap, options?: RenderOptions): WaferMapController
```

> **`options` is optional, and mostly stays that way.** `RenderOptions` has 22
> top-level fields and this section documents all of them, but the call above
> works with none: you get the toolbar, plot modes, colour schemes, zoom and pan,
> tooltips, die selection and PNG export by default.
>
> For calibration, **tsmap** — a full desktop application on this library — passes
> **6**: `viewOptions` (initial plot mode and colour scheme), `summaryPanel`,
> `insights`, `downloadFilename`, `userGuideExtension` and `showHelpButton`. Those
> six, plus `onSaveImage`/`onSaveText` if you want exports routed through your own
> save dialog, cover the overwhelming majority of integrations.
>
> Everything else in this section exists for a specific need — a host that draws
> its own chrome, an embedded map that must follow a host theme, a wafer with no
> position data. Search for the problem you have; don't read forward.

`RenderableWaferMap` is `{ wafer, dies }` plus every other `WaferMapResult` field
as optional. A `WaferMapResult` satisfies it, so the usual `buildWaferMap` →
`renderWaferMap` path is unchanged; the wider type exists because
`renderWaferGallery` renders each card through this same function, and a card is
a `WaferMapDisplayItem` that carries no `dataCoverage`, `viewport`, `legendBox`,
`binLegendRows` or `reticleConfig`. Supply what you have — anything absent is
derived or skipped rather than assumed.

`renderWaferMap` accepts any block `HTMLElement` as `container` — the function
creates and manages its own `<canvas>` inside it, sized to fill the container
(`width: 100%; height: 100%`). Width comes from document flow, but the canvas can
only fill a **resolved height**. A plain block `<div>` in normal flow works (it
grows to the map), but a flex or grid child whose ancestors never resolve a height
collapses to zero — the map is then invisible and the library logs a warning. Give
the container a height with any of:

```html
<!-- Fixed size: -->
<div id="map" style="width: 600px; height: 600px;"></div>

<!-- Responsive square (height follows width): -->
<div id="map" style="width: 100%; aspect-ratio: 1;"></div>
```

```ts
// Or let the library size it — no container CSS needed:
renderWaferMap(container, result, { height: 600 }); // px, or '70vh', etc.
```

See [Troubleshooting → Map is blank, invisible, or the wrong height](../troubleshooting.md)
for all four valid sizing patterns.
The toolbar gives users direct access to every display option without any app-level
chrome: plot mode, colour scheme, ring and quadrant overlays, die labels, rotate,
flip, zoom, box-select, and PNG download. An **expand** button (⛶) in the toolbar
opens the map in an enlarged modal overlay using canvas reparenting — no second
controller is created. A maximise button inside the modal grows it to fill the window.

```ts
import { buildWaferMap } from '@wafertools/wafermap';
import { renderWaferMap } from '@wafertools/wafermap/render';

const result = buildWaferMap({ results, passBins });
const ctrl = renderWaferMap(document.getElementById('map'), result, { showToolbar: true });
```

### 5.1 `WaferViewOptions`

`viewOptions` controls the initial display state of the map — which plot mode to show, the
colour scheme, overlays, orientation, and so on. Every field is optional; the toolbar lets
users change all of them at runtime. Pass `viewOptions` inside `RenderOptions`:

```ts
renderWaferMap(container, result, {
  viewOptions: {
    plotMode:      'value',
    activeTest:    1060,       // testNumber to show (must match a testDef.testNumber)
    valueColorScheme: 'mako',
    showDieLabels: true,
  },
});
```

To read or update options programmatically after mount, use the controller:

```ts
const ctrl = renderWaferMap(container, result, options);

ctrl.getOptions();                         // → current WaferViewOptions snapshot
ctrl.setOptions({ plotMode: 'softBin' });  // merge — only listed keys change
```

#### Field reference

| Field | Type | Default | Notes |
|---|---|---|---|
| `plotMode` | `PlotMode` | `'hardBin'` | `'hardBin'` \| `'softBin'` \| `'value'` \| `'stackedValues'` \| `'stackedBins'` \| `'stackedSoftBins'` \| `'metadata'` |
| `binColorScheme` | `string` | `'default'` | Bin palette for `hardBin`/`softBin`. Built-in: `'default'`, `'accessible'` (colour-blind safe). Custom palettes via `registerBinColorScheme()` (§10.6). Pass bins take the palette's pass (green) colours and fail bins its fail colours, each chosen by bin number so a bin is the same colour in every lot — see §10.6. |
| `valueColorScheme` | `string` | `'default'` | Value gradient for `value` and the stacked modes (a stacked-bin map is a value map: each position's occurrence rate). Built-in: `'default'` (Viridis), `'cividis'` (colour-blind safe), `'greyscale'`, `'plasma'`, `'inferno'`, `'mako'`, `'traffic'`, `'jet'`. Every one but `'traffic'` and `'jet'` reads low = dark, high = light. Custom gradients via `registerValueColorScheme()`. Separate from `binColorScheme`, so switching plot mode never resets either. Neither applies in `'metadata'` mode (always the dedicated ordered palette + `MetadataFieldDef.values[].color` overrides — §4.1.12). |
| `reverseValueScheme` | `boolean` | `false` | Flip the value gradient so high values take its low-end colour. The Colour scheme menu offers it as **Reverse gradient**. Use it for a parameter whose *low* end is the notable one, or for monochrome print where more ink should mean more. Applies to the dies, the colorbar and the mapless summary together — resolve any gradient of your own through `resolveValueColorFn(name, reversed)` so it cannot disagree with them. |
| `useDefinedBinColors` | `boolean` | `true` | Honour `BinDef.color` where a bin definition supplies one. The Palette menu offers it as **Use colours from bin definitions**, only when some definition carries a colour. |
| `activeTest` | `number` | `0` | testNumber to display in `value` mode — must match a `testDef.testNumber`, not a positional index |
| `activeMetadataKey` | `string` | — | `die.metadata` key to display in `'metadata'` mode — must match a `metadataFields[].key` (§4.1.12) |
| `passFailDisplay` | `'off' \| 'spec' \| 'test'` | `'off'` | Requested pass/fail display for `value` mode. `'spec'` colours dies by spec-limit judgement (green / blue fail-low / red fail-high; degrades to `'off'` when the active test has no limits). `'test'` colours dies by the tester's own verdict from `die.testPass` (green pass / red fail, undirected; degrades to `'off'` when no die has a verdict for the active test). The library resolves the effective display — a functional active test (`testType: 'F'`) always renders as `'test'` regardless of this option. Both solid displays replace the colorbar with a Pass/Fail legend carrying per-category die counts, and the map title's secondary line names which is shown (`Limit pass/fail` vs `Tester pass/fail` vs `Functional pass/fail`). Toggled via the Overlays toolbar menu, whose two entries appear only when valid for the active test. |
| `highlightBin` | `number \| number[]` | — | Dim all bins except this one, or these. Clicking a bin/soft-bin legend swatch shows only it (or clears it when it is the only one shown); Ctrl/Cmd+click adds or removes it. A clicked finding about a bin sets it to that bin. |
| `highlightMetadataValue` | `string \| string[]` | — | `'metadata'` mode's analogue of `highlightBin` — dim every die except this metadata value, or these. Legend clicks work as for `highlightBin`. |
| `valueRange` | `[number, number] \| { test, range }` | auto | Explicit range for value colour normalization; overrides `colorbarRangeMode`. Tuple applies to the active test (caller owns the coupling). Object `{ test, range }` applies only when `test` matches the active test, else it is ignored and the view auto-scales — use this to safely fix a range computed for a specific test. |
| `colorbarRangeMode` | `'spec' \| 'data'` | `'spec'` | Controls **only** the colorbar's numeric range when the active test has spec limits: `'spec'` spans `[limitLow, limitHigh]`; `'data'` spans the actual data min/max. In both ranges all dies are coloured by the gradient and out-of-spec dies are flagged with a triangle marker (▽ below `limitLow`, △ above `limitHigh`) over their gradient fill — so the distribution stays readable while out-of-spec dies remain visibly flagged. The marker is drawn black or white per die for contrast against its own gradient fill, so it stays visible under any colour scheme. Ignored under `passFailDisplay: 'spec'` (pass/fail mode always uses spec limits and fills dies solid green/blue/red). |
| `logScale` | `boolean` | from `TestDef` | Override log₁₀ scale for the active test; falls back to linear when vMin ≤ 0 |
| `aggregationMethod` | `string` | `'mean'` | Aggregation method in `stackedValues` mode: `'mean'` \| `'median'` \| `'stddev'` \| `'min'` \| `'max'` \| `'count'` |
| `rotation` | `0 \| 90 \| 180 \| 270` | `0` | Clockwise rotation in degrees |
| `flipX` | `boolean` | `false` | |
| `flipY` | `boolean` | `false` | |
| `showDieLabels` | `boolean` | `false` | Die index labels |
| `showRingBoundaries` | `boolean` | `false` | |
| `showQuadrantBoundaries` | `boolean` | `false` | |
| `showReticle` | `boolean` | `false` | Reticle field boundary overlay (requires `reticles` on the result) |
| `showXYIndicator` | `boolean` | `false` | Axis-orientation arrows showing +X/+Y directions. The toolbar switches it on with the first rotate or flip; it stays on until switched off |
| `showAxes` | `boolean` | zoom | Draw the die-coordinate axis labels along the bottom and left edges. Unset, they appear while the map is zoomed; `true` shows them always, `false` never. The Overlays menu's **Axis labels** row sets it. Showing them reserves room for the labels, so the map is a little smaller. |
| `compact` | `boolean` | `false` | Draw the dies on a compact grid with the empty rows and columns removed and each group of dies outlined, instead of at their physical positions. For multi-project wafers, where each reticle holds only a few of your dies. The toolbar offers it when the occupied columns and rows repeat at a regular pitch (or at the `reticleConfig` width and height, or a multiple of it); setting it here applies it regardless. Only the layout changes: every die is still drawn and counted, and hover text and axis labels give original die coordinates. The wafer outline, rings, quadrants and reticle grid are not drawn in this layout; the XY indicator is. A gallery builds one layout from all its wafers. |
| `legendPosition` | `'default' \| 'compact' \| 'left' \| 'top' \| 'bottom' \| 'floating'` | `'default'` | Bin legend position. `'default'` auto-adapts: compact below 280 px, floating below 180 px |

#### Persisting user preferences

`WaferViewOptions` is the intersection of two named sub-types:
- **`WaferPreferences`** — stable settings worth saving (bin and value colour schemes, the bin-definition colour toggle, rotation, overlays, legend position, log scale, colorbar range mode)
- **`WaferDisplayState`** — transient session state (plot mode, active test, active metadata key, value range, highlight bin)

The `onViewOptionsChange` callback receives a `category` hint (`'preference' | 'state' | 'mixed'`) so you can decide what to persist without filtering keys manually:

```ts
renderWaferMap(container, result, {
  onViewOptionsChange: (opts, changed, category) => {
    if (category === 'preference') saveToLocalStorage(opts);
  },
});
```

Use `=== 'preference'` (not `!== 'state'`) so that `'mixed'` events — which may include transient fields like `plotMode` or `activeTest` — do not get written to storage.


### 5.2 Hover tooltip content by mode

| Mode | Tooltip content |
| --- | --- |
| `value`, `hardBin`, `softBin` | Die (x, y) · one line per test value (`"Idsat: 1.23 mA"` with testDefs, `"Test 1050: 1.23 mA"` without) · bins with hard/soft labels |
| `stackedValues` | Die (x, y) · test label + method + aggregated value (e.g. `"Idsat (mean): 1.23 mA"` with testDefs, `"Test 1050 (mean): 1.23 mA"` without) |
| `stackedBins` | Die (x, y) · bin number · bin name · count · percentage (e.g. "1 · Pass: 3 (75%)") |
| `stackedSoftBins` | Same as `stackedBins` but uses `sbinDefs` for name lookup |

The method label and the percentage denominator come from the map: `renderWaferMap` and `renderWaferGallery` set both, and a map built with `lotStack` carries its own lot size.

### 5.3 Axis labels

When `showAxes: true`, tick labels show die grid indices (integer i/j values). `renderWaferMap` derives `diePitchMm` from the view geometry, so axes always show grid indices.

### 5.4 `RenderOptions`

Drawing options, forwarded to the canvas (the `ToCanvasOptions` type):

```ts
{
  padding?:        number                      // CSS-px padding inside the canvas edge (default 16)
  background?:     string                      // canvas background colour (default '#f5f5f5')
  showColorbar?:   boolean                     // colorbar (value modes) or bin legend (bin modes) (default true)
  colorbarWidth?:  number                      // CSS-px width of the colorbar strip (default 16)
  showAxes?:       boolean                     // axis tick marks and labels (default false)
  showTitle?:      boolean                     // the map title by the colorbar/legend (default true)
  legendOffset?:   { x: number; y: number }    // floating legend offset in CSS px
  diePitchMm?:     { x: number; y: number }    // derived from the map when omitted
  metadataFields?: MetadataFieldDef[]          // labels and colours for the metadata legend
}
```

Plus:

```ts
{
  height?:                 number | string    // intrinsic map height. renderWaferMap fills its container, which must
                                            // therefore have a resolved height; set this and the library sizes its own
                                            // wrapper, so the map renders with no container CSS. Number = px, or any CSS
                                            // length ('600px', '70vh'). Omit when the container already has a height.
  showAxes?:               boolean            // draw axis tick marks and die grid index labels (default false)
  viewOptions?:           WaferViewOptions  // initial display state; plotMode, testDefs, and reticles are pre-seeded from the result automatically
  onHover?:                (die: Die | null, event: MouseEvent) => void
  onClick?:                (die: Die, event: MouseEvent) => void
  onSelect?:               (dies: Die[]) => void     // fires after box-select drag or click-select
  onViewOptionsChange?:   (opts: WaferViewOptions, changed: (keyof WaferViewOptions)[], category: 'preference' | 'state' | 'mixed') => void
                          // mirrors toolbar changes; changed lists the keys that were modified;
                          // category is 'preference' when all changed keys are WaferPreferences,
                          // 'state' when all are WaferDisplayState, 'mixed' when both
  showTooltip?:            boolean   // default true
  showToolbar?:            boolean   // default true
  showIdentity?:      boolean   // default true — the wafer's identity (lot, wafer ID, product, test
                                            // program, temperature, etc.) in the chrome row above the canvas, beside
                                            // the toolbar. Independent of showToolbar/Insights, and a CONTENT switch
                                            // only: the chrome row exists whenever there is a toolbar, so turning this
                                            // off costs the identity text and nothing else. Short metadata renders
                                            // inline when it fits; otherwise it collapses to one identifying line that
                                            // expands over the canvas on click/Enter/Space. Renders nothing when the
                                            // result has no metadata/lot-stack context.
  dieList?:                DieListDisplayOptions  // display preferences for the built-in die-list table (the
                                            // coordinate-less map replacement, and the "+N dies without position" footer)
                                            // — column selection, maxRows. See §5.4.1.
  showExpandButton?:       boolean   // show the expand button in the toolbar and enable the E-key shortcut
                                            // (default true). Independent of showIdentity — expand is a view control,
                                            // not part of the wafer's identity. Set false when the host already renders
                                            // the map inside its own expanded/modal context, where wmap's built-in
                                            // expand modal would be redundant
  statsSummary?:           StatsSummary  // precomputed wafer-level stats — adds a Summary toggle button to the toolbar
  summaryPanel?:           SummaryPanelOptions  // Summary panel placement and open/closed initial state
  insights?:               InsightsOptions  // adds an Insights toolbar button that swaps the map for this wafer's own
                                            // chart suite (Overview, Distributions, Correlation) — default disabled. See §5.9.
  warnings?:               WarningsOptions  // built-in surfacing of the library's own advisories — ON by default.
                                            // { display?: boolean; onWarning?: (w: WaferWarning[]) => void }
                                            // See §4.2.2 and the note below.
  showHelpButton?:         boolean   // show a help button in the toolbar that opens the built-in end-user guide
                                            // (default false); enable in applications that want to surface the guide
                                            // without linking externally. Opens as a real, separate window when
                                            // `window.open` is available, falling back to an in-page non-modal
                                            // floating window when it's blocked (some embedded WebViews — Tauri,
                                            // Electron, WebView2 — silently return null)
  userGuideExtension?:     UserGuideExtension  // insert a host app's own documentation into the guide window
                                            // (see "User guide extension" below) — only relevant when showHelpButton is true
  downloadFilename?:       string    // prefix for every file the map saves, PNGs and CSVs; the lot, wafer and
                                            // content follow it (§5.4.5)
  onSaveImage?:            (blob: Blob, suggestedName: string) => void | Promise<void>
                                            // host hook for persisting the rendered PNG. When provided, the toolbar's save
                                            // button calls it instead of triggering a browser <a download>, letting
                                            // embedded hosts (Tauri, Electron, WebView2) route the image through a native
                                            // dialog. When omitted, the default download behaviour is unchanged.
                                            // suggestedName is the generated name, with extension (§5.4.5)
  onSaveText?:             (text: string | Blob, suggestedName: string, mimeType: string) => void | Promise<void>
                                            // host hook for every built-in "Export CSV" button — the Data tables (Statistics, Dies,
                                            // Wafers; from the Summary panel's Data tables button, drilldown and Insights' Data tab)
                                            // and the correlation matrix (§5.4.1). The docked Summary panel has no CSV buttons of its own. Mirrors
                                            // onSaveImage — when provided, called instead of a browser <a download> (a
                                            // silent no-op in Tauri/Electron/WebView2). When omitted, the default
                                            // download behaviour is unchanged. `text` is a string, or a Blob for a
                                            // table of a million cells or more (a lot's die list): write it with
                                            // blob.stream() or read it with await blob.text() — a host handles both.
  zIndex?:                 number    // base z-index for wmap's transient overlays (menus, tooltip, expand/help modals).
                                            // Omit for a safe high default (above typical app modal layers); set it to
                                            // embed the map inside your own modal/overlay. See "Overlay z-index" below.
}
```


> **Sizing.** `renderWaferMap` fills its container, so the container must have a resolved height (width comes from document flow). A plain block `<div>` grows to fit the map; a flex/grid child needs a height-resolved parent or it collapses to zero — the library logs a warning when it detects this. Pass `height` to have the library size the container for you. See [Troubleshooting → Map is blank, invisible, or the wrong height](../troubleshooting.md).

The box-select toolbar button is always shown. Providing `onSelect` lets your app react to selection changes; without it the selection is purely visual.

When `statsSummary` is provided, a summary panel toggle button (notebook icon) appears in the toolbar. The panel opens hidden by default; clicking the button shows or hides it. Clicking a finding in the panel highlights the affected die zone on the map.

**Overlay z-index (`zIndex` / `--wmap-z`).** Every transient overlay wmap creates in the host page — toolbar menus and dropdowns, the die hover tooltip, the expand modal, and the (non-modal) user-guide window — uses `position: fixed`. By default they stack at a **high** base value (`6000`), so they appear above typical app modal layers with no configuration. wmap layers its own overlays from the base upward: the modal backdrop and a component's own persistent chrome (e.g. a gallery card's toolbar) at the base, the tooltip and the modal box (over its own backdrop) at base + 1, every menu/dropdown/cascade-submenu at base + 2, and content that must clear a maximized modal box at base + 3. The user-guide window uses its own incrementing band above that, so it's never hidden behind a still-open modal. A gallery card detached into its own window (§6.6) is a separate OS window, not an in-page overlay, so none of this stacking applies to it — it's positioned and raised by the OS window manager instead.

Menus specifically render into one dedicated layer per overlay root (see "Menus opened from inside..." below) rather than at the same tier as ordinary persistent chrome — a persistent, host-page-pinned element (your own sticky header, a docked panel) can sit anywhere in *your* stacking order without ever being able to outrank a wmap menu, because menus don't compete on the general base/tooltip/modal scale at all.

To embed a wmap render **inside your own modal or overlay**, pass `zIndex` so wmap's menus and tooltips land above it:

```ts
// Host modal at z-index 5000; put wmap's overlays above it:
renderWaferMap(container, result, { zIndex: 5100 });
```

`zIndex` is applied for the lifetime of the render and restored on `controller.destroy()`. Internally it writes the `--wmap-z` CSS custom property on `document.documentElement` (overlays that append to `document.body` inherit it from there, and every tier above — including the menu layer — is itself `calc(var(--wmap-z, 6000) + N)`, so raising `zIndex` shifts the whole stack together); you can set `--wmap-z` yourself instead of passing `zIndex` if you prefer to control stacking via CSS. Menus opened from inside the expand modal or the user-guide window are appended to that box's own menu layer rather than `document.body`'s, so they always appear above its content regardless of the host page's stacking context.

**Native `<dialog>` host modals need no configuration at all.** If your own modal is built on the native `<dialog>` element and shown via `.showModal()`, it's promoted into the browser's **top layer** — a rendering layer that sits above the entire normal stacking order unconditionally, regardless of any `z-index` (no `zIndex` value, however high, can make a `document.body`-level element paint above it). wmap detects this automatically: every overlay it creates (tooltip, menus, the expand modal, the user-guide window's in-page fallback) checks whether its trigger lives inside a `<dialog>` currently shown modally (`element.matches(':modal')`) and, if so, roots itself inside that dialog instead of `document.body` — so it lands correctly in the same top-layer subtree with no `zIndex` or other configuration needed. This is unrelated to the `zIndex` mechanism above, which only matters for ordinary (non-`<dialog>`) modal implementations — a plain `fixed`/`absolute` overlay div, whatever library built it.

#### 5.4.1 Theming (`--wmap-*` custom properties)

wmap's **chrome** — the toolbar, summary panel, menus, the die tooltip, and the wafer **canvas** itself (background, axis labels, grid) — is themed entirely through CSS custom properties. Set them on any ancestor of the render container and everything wmap draws follows. Every token has a **light default baked in**, so if you set nothing you get the default light appearance; override only what you want.

This is the same mechanism `--wmap-z` uses for stacking. It is theme-agnostic: wmap defines the tokens and their defaults, the host supplies the values. (The **data** palette — the bin/value colours of the dies — is separate and controlled by `colorScheme`, not these tokens; it does not follow the chrome accent.)

##### Type size (`--wmap-font-size`)

wmap's chrome is sized from **one** token. Set `--wmap-font-size` and every tier
moves with it, so an embedded map follows the host's own type scale instead of
pinning wmap's:

```css
:root { --wmap-font-size: 14px; }   /* default 12px */
```

The tiers are derived, not individually settable — deliberately, so a host
cannot produce an incoherent scale (headings smaller than body, meta larger than
headings):

| Tier | Size | Used for |
| --- | --- | --- |
| meta | base − 1px | uppercase micro-labels, badges, disclosure arrows |
| body | base | prose, table cells, hints, and every interactive control |
| sub-heading | base + 1px | group headers inside a scrolling list |
| heading | base + 3px | card and panel titles |
| stat | base + 8px | the large summary figures |

**Canvas text follows too**, but resolves the token at paint time from the
**document root** — canvas cannot read a CSS variable. Set `--wmap-font-size` on
`:root` (as with the colour tokens) rather than scoping it to a container, or
chart and axis labels will keep the default while the DOM chrome moves.

##### Density (`--wmap-density`)

The companion lever to `--wmap-font-size`. It scales every step of the spacing
scale, so an embedded map can tighten into a narrow column or breathe in a roomy
host:

```css
:root { --wmap-density: 0.85; }   /* default 1 */
```

Type is deliberately **not** affected. Density is the space between things;
shrinking type to fit a column is what produced a segmented toggle that rendered
smaller than the buttons beside it. Corner radius is likewise unaffected — it is
three fixed roles (control 4px, container 6px, pill full).

##### Typeface (`--wmap-font-family`)

The third sizing lever. It defaults to `inherit`, so an embedded map picks up the
host's own typeface without being told; set it only when the map should differ
from its container:

```css
:root { --wmap-font-family: "IBM Plex Sans", system-ui, sans-serif; }  /* default: inherit */
```

Like `--wmap-font-size`, canvas text cannot read the variable, so it reaches DOM
chrome only — set a stack the canvas defaults sit comfortably beside rather than
a display face.

**Token reference** (default in parentheses):

| Token | Themes | Default |
| --- | --- | --- |
| `--wmap-font-family` | DOM-chrome typeface (canvas text is unaffected) | `inherit` |
| `--wmap-canvas-bg` | Wafer canvas background | `#f5f5f5` (falls back to `--wmap-surface`) |
| `--wmap-surface` | Menus, panels, toolbar surfaces, gallery cards | `#fff` |
| `--wmap-panel-bg` | Summary-panel base | `#fafbfc` |
| `--wmap-border` | Borders, dividers, axis tick lines | `rgba(0,0,0,0.12)` |
| `--wmap-control-border` | Button, toggle and input edges — deliberately stronger than `--wmap-border`, which is a hairline divider | `--wmap-border` if set, else `rgba(0,0,0,0.30)` |
| `--wmap-text` | Primary text (chrome + canvas axis/legend) | `#333` |
| `--wmap-text-muted` | Secondary/muted text | `#66788a` |
| `--wmap-text-strong` | Emphasis text — Summary-panel headings, big stat numbers, metadata badge values | `#1f2f43` |
| `--wmap-icon` | Toolbar icon default | `#506784` |
| `--wmap-icon-hover` | Toolbar icon hover | `#2a3f5f` |
| `--wmap-icon-active` | Active icon / on-canvas accent | `#1a66cc` |
| `--wmap-bg-hover` / `--wmap-bg-active` | Hover / active row backgrounds | `#edf0f8` / `#dce8f8` |
| `--wmap-menu-hover` / `--wmap-menu-active` | Menu-item hover / active | `#f0f4fc` / `#dce8f8` |
| `--wmap-separator` | Faint separators | `rgba(0,0,0,0.12)` |
| `--wmap-warn-bg` / `--wmap-warn-border` / `--wmap-warn-text` | Warning banner | `#fffbe6` / `#f0c040` / `#7a5800` |
| `--wmap-err-bg` / `--wmap-err-border` / `--wmap-err-text` | Error banner (geometry advisories — dies may be mis-positioned) | `#fef2f2` / `#dc8a8a` / `#7a1c1c` |
| `--wmap-info-bg` / `--wmap-info-text` | Info callout | `#dce8f8` / `#334155` |
| `--wmap-selected` | Finding-drilldown card outline (gallery) | `#e07a20` |
| `--wmap-finding-indicator` | Summary button text colour when the wafer/lot has notable findings | `#b7551a` |
| `--wmap-bar-fill` | Summary-panel progress bars (wafer yield, region yield, bin breakdown) — fill | `#2a6fc0` |

`--wmap-err-*` and `--wmap-warn-*` are visually distinct on purpose — a warning says something is missing or degraded, an error says the map may be positionally **wrong** (geometry advisories), and flattening the two into one colour hides the difference that matters. **Every token that pairs a background with text on it — `warn-*`, `err-*`, `text-strong` against `panel-bg`/`surface` — needs its own AA-contrasting pair when you theme it.** Overriding only the surfaces and leaving these unset does not make them invisible; it makes them fall back to the *light-theme* defaults above, which is how a dark theme silently ends up with near-black text on a near-black panel. §5.4.1's dark/Nord examples below set all of them for exactly this reason.

Canvas colours are resolved from these variables at draw time and re-resolved on a theme change or OS light/dark flip, so the wafer repaints to match.

**Following the OS light/dark preference** — put the light values on `:root` and override in a media query:

```css
:root {
  --wmap-surface: #fff;
  --wmap-text: #333;
  /* …other light values… */
}
@media (prefers-color-scheme: dark) {
  :root {
    --wmap-canvas-bg: #242426;
    --wmap-surface:   #2a2a2d;
    --wmap-panel-bg:  #202022;
    --wmap-border:    #3a3a3a;
    --wmap-text:      #ccc;
    --wmap-text-muted:#888;
    --wmap-icon:      #aaa;
    --wmap-icon-hover:#6af;
    --wmap-icon-active:#6af;
    /* …etc… */
  }
}
```

**Example — a dark theme** (drop-in; overrides only what differs from the light defaults):

```css
.wmap-dark {
  --wmap-canvas-bg:   #242426;
  --wmap-surface:     #2a2a2d;
  --wmap-panel-bg:    #202022;
  --wmap-border:      #3a3a3a;
  --wmap-text:        #ccc;
  --wmap-text-muted:  #888;
  --wmap-text-strong: #f2f2f2;
  --wmap-icon:        #aaa;
  --wmap-icon-hover:  #6af;
  --wmap-icon-active: #6af;
  --wmap-bg-hover:    #343438;
  --wmap-bg-active:   #2b3a4f;
  --wmap-menu-hover:  #343438;
  --wmap-menu-active: #2b3a4f;
  --wmap-separator:   #2a2a2a;
  --wmap-warn-bg:     #3a2f0f;
  --wmap-warn-border: #7a6222;
  --wmap-warn-text:   #f0c04d;
  --wmap-err-bg:      #3a1414;
  --wmap-err-border:  #7a3030;
  --wmap-err-text:    #ff8a8a;
  --wmap-info-bg:     #1a2b3d;
  --wmap-info-text:   #8ecbff;
  --wmap-selected:    #6af;
  --wmap-finding-indicator: #ffa057;
}
```

Every one of these matters: the six tokens that used to be left unset here — `--wmap-text-strong` plus the `warn-*`/`err-*`/`info-*`/`finding-indicator` group — do not go unstyled when omitted. They fall back to wmap's *light*-theme defaults, and `--wmap-text-strong` (the Summary panel's heading/big-number colour) defaults to `#1f2f43`, near-black. Near-black text on the `#202022` panel above is under 1.1:1 contrast — invisible, not merely dim. Omitting any of this block's tokens reproduces that bug for whichever surface reads the one you left out.

**Example — Nord** (a branded palette; shows the same structure with a different accent):

```css
.wmap-nord {
  --wmap-canvas-bg:   #2e3440;
  --wmap-surface:     #323846;
  --wmap-panel-bg:    #2b303b;
  --wmap-border:      #434c5e;
  --wmap-text:        #e5e9f0;
  --wmap-text-muted:  #a6adbb;
  --wmap-text-strong: #eceff4;
  --wmap-icon:        #d8dee9;
  --wmap-icon-hover:  #88c0d0;
  --wmap-icon-active: #88c0d0;
  --wmap-bg-hover:    #3b4252;
  --wmap-bg-active:   #3b4a58;
  --wmap-menu-hover:  #3b4252;
  --wmap-menu-active: #3b4a58;
  --wmap-separator:   #3b4252;
  --wmap-warn-bg:     #3b3220;
  --wmap-warn-border: #7a6a3a;
  --wmap-warn-text:   #ebcb8b;
  --wmap-err-bg:      #3b2020;
  --wmap-err-border:  #7a4040;
  --wmap-err-text:    #f39a9a;
  --wmap-info-bg:     #20303a;
  --wmap-info-text:   #88c0d0;
  --wmap-selected:    #88c0d0;
  --wmap-finding-indicator: #dc9a80;
}
```

> The reference host [tsmap](https://github.com/wafertools/tsmap) implements a full theme picker (light, dark, Nord, Solarized, a brand green, high-contrast) this way — its `index.html` `:root` blocks are a worked example of the complete token set across multiple themes.

#### 5.4.2 `SummaryPanelOptions`

```ts
{
  placement?:   'right' | 'left' | 'top' | 'bottom'  // panel side; default 'right'
  defaultOpen?: boolean                               // open on mount; default false
}
```

The Summary panel is a docked panel — metadata, yield, detected anomalies (`StatsSummary.findings`, with severity chips wired to `filterFindings`, §7.11; the Kind/Region dropdowns appear once there are at least 8 findings), bin breakdown, region yield, test values, and functional tests — plus one combined "Summary report" button that opens the full HTML report (`renderWaferReportHtml`/`renderLotReportHtml`, §7.6, which already include findings) in an in-app modal (`openReportModal`, §9.2) — no host wiring required. Always co-visible with the map so a clicked finding can highlight the affected dies right there — see §5.9 for why this is a separate surface from Insights. Its bin/region/test-value numbers and Insights' Overview sub-tab read the same underlying computation (`StatsSummary.stats.*`, including `regionYield` and `capability`), so the two surfaces can show overlapping numbers without ever disagreeing.

Findings render directly beneath the headline stats, above the bin/region/test detail. Every section collapses from its header, and the collapsed set is remembered per panel element across re-renders.

The gallery's panel has **no tabs**. It previously opened on a Lot/Findings pair in which both tabs carried findings — lot-level ones under "Lot", and none at all under "Findings", which actually listed wafers — and in which two identical-looking per-wafer lists did different things on click. There is now one list: the **Wafer Yield** section, with each row badged by its own findings count and opening that wafer when clicked. Every wafer appears in it, including those with no findings, which the old subset list structurally could not show. A `Findings report` button beside the other report buttons covers every wafer's findings in one document.

On the single-wafer panel the metadata section is suppressed when the caller already renders that metadata — `renderWaferMap` does so whenever its identity header is mounted (`showIdentity`, default `true`), since the header's expandable panel is built from the same helpers. Set `showIdentity: false` and the panel's own "Wafer Info" section returns.

Three sections carry a header selector, and each derives its default rather than starting neutral:

| Section | Selector | Default |
| --- | --- | --- |
| Bin breakdown | Hard / Soft | The map's **plot mode** (`hardBin`/`stackedBins` → hard, `softBin`/`stackedSoftBins` → soft), falling back to whichever bin type has data. Shown only when both types have data. |
| Region yield | Ring / Quadrant | Ring. Quadrant yield averages over half the wafer and is near-flat on most lots; a real asymmetry is reported as a finding with a significance test behind it. |
| Wafer yield (lot) | Slot / Yield | Slot order, which is what makes a slot-correlated pattern visible. |

Bin bars are ordered pass-bins-first, then failing bins by descending count — the order every bin list in the library uses, including the Insights bin chart — and are labelled "% of dies (N=…)" to distinguish them from the lot card's "Mean wafer yield", which is an *unweighted* mean of per-wafer yields. The two are different statistics over different denominators and agree only when die counts are even across the lot.

The on-screen test table carries Test / Mean / **Ppk** / Limit yield only; the full descriptive statistics (min, quartiles, median, max, σ, both limits) stay in the CSV export and the summary report. Ppk rather than Cpk because Cp/Cpk use the pooled *within-wafer* stddev — on a single-wafer panel there is exactly one subgroup, so `cpk === ppk` identically and the "Cpk" label would name an index the data does not contain; across a lot, Cpk excludes the wafer-to-wafer shift that Ppk includes. The Cpk/Ppk pair is a drift diagnostic and lives in the summary report, which prints all four indices. A test's `N` is hoisted into the section title when every test shares it.

#### 5.4.3 `InsightsOptions`

```ts
{
  enabled?:     boolean                                          // show the Insights toolbar button and the Maps | Insights switch; default true with a toolbar (single map: `showToolbar`), always true for a gallery; `false` opts out
  defaultView?: 'overview' | 'distributions' | 'correlation' | 'sweeps' | 'data' | 'plot'  // sub-tab shown first; default 'overview'.
                                                                      // 'sweeps' with no sweeps defined falls back to 'overview'
  defaultOpen?: boolean                                          // open Insights on mount instead of the map; default false
  sweeps?:      SweepSpec[]                                      // parametric sweeps, one card each on a Sweeps tab (below)
  onRemoveSweeps?: (ids: string[]) => void                       // adds a Remove button to the Sweeps tab's notice about
                                                                      // sweeps that name no test in the data; the host drops
                                                                      // those ids and re-renders
  plots?:       PlotSpec[]                                       // the reader's saved plots, the Plot tab's list (below)
  onPlotsChange?: (plots: PlotSpec[]) => void                    // the whole list after every add, edit, delete or import
  onPickPlotsFile?: () => Promise<string | null>                 // choose a plots file to import (a native dialog); without
                                                                      // it the Plot tab uses the browser's file input
}
```

`defaultOpen` is for an analysis-first surface, where the charts are the point and
the map is the secondary view — symmetric with `summaryPanel.defaultOpen`. Note
that the chart suite is a lazily-imported chunk, so opening it on mount also pulls
that chunk on load rather than on first click; leave it off for a map-first page.
See the [Insights example](../examples/insights.html), which uses it because the
charts are its whole subject.

##### The Plot tab: saved plots

The **Plot** sub-tab is a chart builder: the reader picks a chart type (scatter, histogram, box, bar or line), the field for X, Y
and colour (any test, die position, wafer yield, or lot field), and axis titles and limits, and each edit is drawn
at once. A plot is a recipe, `PlotSpec`, that carries no population: the wafers drawn are whatever Insights is
scoped to, or whatever a drilldown selection holds, so the same list works on any lot. The library stores nothing.
Hand the list in as `plots`, keep it current from `onPlotsChange`, and pass it back next time:

```ts
import { readPlotsFile, writePlotsFile } from '@wafertools/wafermap/stats';

const saved = readPlotsFile(localStorage.getItem('plots') ?? '{"format":"wafermap-plots","plots":[]}');
renderWaferGallery(el, items, {
  insights: {
    plots: saved.plots,
    onPlotsChange: plots => localStorage.setItem('plots', writePlotsFile(plots)),
  },
});
```

`onPlotsChange` is called once for a burst of edits (typing a title is one call), with the whole list in the
reader's order, and again when the view is destroyed if a change is waiting. A host that has no storage can ignore
both options: the tab then keeps plots for the life of the page, and **Export plots…** / **Import plots…** carry
them as a file (`onSaveText` receives the export; `onPickPlotsFile` supplies the import).

```ts
{
  id: 'plot-lq1x-0f3a-0',                   // generated once, never reused; survives rename and reorder
  title?: 'Vth vs Idsat',                    // only when the reader typed one; absent = an automatic title
  mark: 'scatter' | 'histogram' | 'box' | 'bar' | 'line',
  encoding: {
    x?: Field, y?: Field,                    // a histogram reads y (or x) as its values; a box or bar's x is its categories (default wafer)
    color?: Field | { follow: 'groupBy' } | { none: true },   // absent = follow the tab's Group by; a measured value or wafer figure
                                             // colours a scatter on a gradient, anything else is a category
  },
  level?: 'die' | 'wafer',                   // the unit one mark stands for; absent = the finest the fields allow
  aggregate?: 'mean' | 'median' | 'min' | 'max' | 'sum' | 'count' | 'yield',
  axes?: { x?: Axis, y?: Axis },             // Axis = { label?, scale?: 'linear' | 'log', min?, max?, reverse? }
  bins?: 16,
}
// Field = { test: 1050, name?: 'Vth' } | { builtin: 'wafer' | 'x' | 'y' | 'ring' | 'quadrant' | 'hbin' | 'sbin' | 'site' | 'yield' | 'dieCount' | 'waferOrder' } | { meta: 'split' }
```

Things that hold for every plot:

- **A test is found by its number and checked by its name.** A plot saved against another test program is
  reported ("Test 1050 is "Leakage" in this plot and "Vth" here") instead of being drawn against the wrong
  measurement.
- **The plot states its population and what it left out**: the wafers and dies, how values were combined, and the
  count of dies missing a value.
- **One unit per mark.** With `level: 'wafer'`, die-level values are combined per wafer with `aggregate`, and a
  per-wafer field (yield) cannot be split by a per-die one (hard bin): that is reported, not drawn.
- **Grouping has three places.** The categories on an axis are the plot's X; the series within them are its colour;
  which wafers are in view is the tab's **Show**, and is not part of the plot.
- **A plot this lot cannot draw is kept.** It is listed, dimmed, with the reason, and draws again on a lot that has
  the test.

**The file.** `writePlotsFile(plots)` returns `{ "format": "wafermap-plots", "version": 1, "plots": [...] }`.
`readPlotsFile(text)` is lenient: it keeps every plot it can read, names each setting it dropped in `warnings`, and
sets `error` only when nothing is usable. Settings a newer version wrote are kept when the file is written back, and
a plot using a mark this version does not know is kept and shown as needing a newer version, so a round trip through
an older build loses nothing. Importing adds plots and never replaces: a plot whose id is already in the list is
added as a copy.

**Plots in drilldown.** Each saved plot is a row in the right-click menu (a **Plots** section between the charts and
the tables), drawn over the selected dies; **New plot…** opens a draft on the selection that is kept only if the
reader adds it. The Plot tab, its editor and the chart are loaded the first time they are opened.

#### 5.4.4 Die list & CSV export

The die list is the general "show me the raw dies" table — one row per die, with an Export CSV
button. It backs three built-in surfaces — the coordinate-less map replacement, the "+N dies
without position" footer, and the Summary panel's "Data tables" button, below — all configured
by the one `dieList` option (`DieListDisplayOptions`).

**"Data tables"** is a button inside the always-available Summary panel (§5.4.2/§6.5), not a
new toolbar button — deliberately, since the toolbar already carries a dozen buttons and this
reuses an existing entry point the same way "Summary report" opens the HTML report without one
either. It opens the Insights Data tab's tables in a modal — **Statistics** and **Dies**, each with Export CSV and Copy — and works with `insights: { enabled: false }`; the Dies table is virtual, so `maxRows` does not apply to it. **On by default** whenever a Summary panel is reachable at all — set `enabled: false`
to hide it:

```ts
renderWaferMap(container, result, {
  summaryPanel: {},   // the panel this button lives inside — "Data tables" appears automatically
});

renderWaferMap(container, result, {
  summaryPanel: {},
  dieList: { enabled: false },   // …unless you don't want it
});
```

On `renderWaferMap` it opens **this wafer's own dies** (and its statistics). On `renderWaferGallery` (§6.5) the
equivalent `GalleryOptions.dieList` opens **every wafer in the lot, pooled** (plus a **Wafers** table, one row per wafer), with a leading
`Wafer` column (one per die, resolved from each card's own `label`) and wafer-metadata columns
computed via `commonMetadata` — a field common to every wafer appears once; a field that
varies across the lot (a mixed-lot pool) does not appear at all, rather than printing one
wafer's value as if it applied to the whole export. Both open the same resizable modal wmap's
toolbar already uses elsewhere (chart drilldown, wafer expand), with the same metadata
columns, the same `maxRows` and the same CSV export as every other die-list surface.

Columns, in order: `[extraColumn?]` → X, Y `[→ Ring, Quadrant]` `[→ Edge excluded]` → Site,
Hard bin, Soft bin → one column per test → die metadata → wafer metadata.

**X/Y are separate numeric columns**, not a single `"(x, y)"` cell — a bracketed pair reads
fine on screen but forces an extra parsing step (or breaks outright) when the CSV is opened in
Excel, pandas, or any other tool expecting one number per cell. Blank for an unpositioned die.

**Ring/Quadrant** appear for positioned dies, and are omitted entirely for a wafer with none,
not shown empty. They use the map's own `ringCount`, the same rule as the ring and quadrant
findings and `stats.regionYield` (§7.4.1), so "Ring 2" here always names the same region a
Ring finding does.

**Edge excluded** appears only when at least one die in the export has `edgeExcluded: true` —
`buildWaferMap`'s edge exclusion (`waferConfig.edgeExclusion`) is opt-in and only ever stamps
`true` on the dies it excludes, never `false` on the ones it doesn't, so "no die is excluded"
and "the feature was never configured" are indistinguishable from `Die[]` alone; omitting the
column in that case is the closest available approximation. When shown, `Yes`/`No` is
unambiguous for every row, since at least one exclusion is known to have happened somewhere in
the export.

**Metadata columns are on by default** (`metadataColumns: 'auto'`) — every key found on any
die's `DieMetadata`, deterministically ordered (`metadataFields` declaration order first,
then the rest naturally sorted). Unlike the `'metadata'` plot mode, where `metadataFields`
gates *which* keys are offered (a legend has a cardinality limit), a table column has none —
an export silently dropping host data would be worse than a wide one. Pass an explicit
`string[]` to pin the set and order, or `'none'` to omit die metadata entirely.

**Wafer metadata (`lot`, `waferId`, `product`, …) is CSV-only by default**
(`waferMetadataColumns: 'csv'`) — constant down every row, so it is noise on screen next to
the always-visible metadata badge (§5.4), but it is exactly what makes a detached CSV
self-describing enough to concatenate several exports and still know which wafer each row
came from. Set `'both'` to also show it in the table, or `'none'` to omit it.

A key present on **both** the wafer and a die produces exactly one column, scope `die`,
carrying the die's value — the same shadowing rule the hover tooltip (§11.4) applies.

**Column labels** resolve `metadataFields[].label` → `prettyKey(key)` → the raw key, matching
every other column's human-readable header. A metadata key that collides with a built-in
column name (e.g. a key literally called `Site`) is never dropped — it becomes
`"Site (metadata)"`, or falls back further to `"Site (site)"` and then a numbered suffix in
the (rare) case that also collides.

**`maxRows`** (default `50_000`) caps how many rows are built as real DOM — this table has no
virtualisation, so an uncapped multi-hundred-thousand-die lot is a genuinely slow, heavy
build. The CSV export is **never** capped; it always contains every die, and a footer states
the truncation explicitly (`"Showing the first 50,000 of 266,412 dies. The CSV export
contains all 266,412."`) whenever it applies. Set `maxRows: 0` to skip the table and offer
only the CSV export.

```ts
export interface DieListDisplayOptions {
  enabled?:              boolean;                        // the "View die list" link (default true)
  metadataColumns?:      'auto' | 'none' | string[];   // default 'auto'
  waferMetadataColumns?: 'csv' | 'both' | 'none';        // default 'csv'
  maxRows?:               number;                        // default 50_000; CSV is never capped
  maxHeight?:             string;
}
```

The wafer metadata and metadata-field labels always come from the current build result, never
from a host option, so an export cannot carry the wrong wafer's identity.

#### 5.4.5 Saved file names

Every file the library saves — map, gallery and chart PNGs, and every CSV export — is named for
the data it came from, so exports from different wafers never collide or need renaming:

```text
[prefix]_[lot]_[wafer]_[content].[ext]
```

| Part | Where it comes from |
|---|---|
| prefix | `downloadFilename`, when the host sets it (below). |
| lot | `wafer.metadata.lot`. A gallery covering several lots writes the count, e.g. `3-lots`. |
| wafer | The item's `label`, else `wafer.metadata.waferId`. A gallery writes the wafer count (`25-wafers`); a lot-stacked map writes `stacked-25-wafers`. |
| content | What was saved: the map's title as drawn beside its legend (`hard-bin`, `vth-mv`), `gallery-…`, a chart's title, `test-values`, `functional-tests`, `die-list`, `test-correlation`. |

Examples: `LOT123_W05_hard-bin.png`, `LOT123_W05_die-list.csv`, `LOT123_25-wafers_yield-by-wafer.png`.

- **Parts the data doesn't have are left out.** The library never makes up an identity: a wafer
  with no `label` or `waferId` gets no wafer part, not a position such as `Wafer 3`.
- **A lot or wafer made only of digits is labelled** (`lot-123`, `wafer-5`), so it can't be
  mistaken for a count.
- **Names are safe on every common filesystem.** Path and reserved characters become `-`, names
  are length-limited, and Windows device names are avoided. Letters in any script are kept.
- **The name is worked out when the file is saved**, so it follows `setResult`, `setItems` and
  plot-mode changes. A gallery card or detached window names files for its own wafer.

`onSaveImage` and `onSaveText` receive this name as `suggestedName`.

**`downloadFilename`** is a prefix for every file a map or gallery saves, PNGs and CSVs alike —
on a gallery, its cards and detached windows too. Parts the prefix already names are not
repeated, so `downloadFilename: 'LOT123_sort'` gives `LOT123_sort_W05_hard-bin.png`, not
`LOT123_sort_LOT123_W05_hard-bin.png`.

### 5.5 `WaferMapController`

Choose the right update method:
- `setResult` — new wafer loaded (different geometry, dies, and/or test data). Re-seeds bin defs, testDefs, and reticles from the new result automatically.
- `setOptions` — display-only change: plot mode, colour scheme, zoom, etc. No data reload.

```ts
{
  setResult(result: WaferMapResult): void            // replace wafer geometry and die data
  setOptions(opts: Partial<WaferViewOptions>): void // merge options, rebuild view
  getOptions(): WaferViewOptions                    // current options snapshot
  setSelection(dies: Die[]): void                    // programmatically highlight dies
  clearSelection(): void
  resetZoom(): void                                  // return to fitted view
  setStatsSummary(summary: StatsSummary | undefined): void  // update the Summary panel at runtime
  closeSummaryPanel(): void  // close the Summary panel if open (e.g. on loading a new file); the user reopens it from the toolbar
  getBinColors(): BinColors  // the bin colours this map draws, with the palette currently chosen — for a host surface (§10.6)

  setInsightsOpen(open: boolean): void  // programmatically open/close the Insights tab; no-op if `insights.enabled` was not set

  openUserGuide(): void   // opens the end-user guide window directly — the same action the help toolbar button
                                  // performs, but callable regardless of showHelpButton, so a host
                                  // that hides wmap's own help button (e.g. folding it into its own combined help menu)
                                  // can still trigger the guide without a DOM query

  destroy(): void                                    // remove all listeners and DOM elements
}
```


### 5.6 Toolbar buttons (full mode)

| Button | Action |
| --- | --- |
| Camera | Export current view as PNG |
| Zoom region | Drag to draw a zoom rectangle |
| Pan | Drag to pan the map |
| Box select | Draw selection rectangle — fires `onSelect` callback if provided. The mode a map opens in. |
| Chart | Drilldown menu (§5.12) for the selected dies, or for the whole wafer when nothing is selected — the same menu right-click opens. Shown only when there is something to chart: a parametric test in the data, or a sweep in `insights.sweeps`. |
| Zoom + | Zoom in centred on canvas |
| Zoom − | Zoom out centred on canvas |
| Reset | Return to fitted view (also: double-click canvas) |
| Mode | Grouped dropdown: **Test Value** section (one entry per test — labelled by `testDef.name` when provided, otherwise `Test {N}` using the testNumber; cascade submenu when > 6 tests) · **Bins** section (Hard Bin, Soft Bin) · **Lot Aggregation** section (Stacked Test Values, Stacked Hard Bins, Stacked Soft Bins). Only modes for which data is actually present are shown. |
| Palette | Menu: in Hard/Soft Bin mode, the registered bin colour schemes (plus **Use colours from bin definitions** when a `BinDef` carries a colour); in every other mode, the registered value gradients. Hidden in `'metadata'` mode. |
| Log scale | Toggle log₁₀ scale for the colorbar and value normalization. Shown only in `value` / `stackedValues` modes, and hidden (not just dimmed) whenever a solid pass/fail display is active or the active test is functional, since log scale has no effect on pass/fail colouring. Overrides the per-test `TestDef.logScale` default. Silently falls back to linear when vMin ≤ 0. |
| Colorbar range | Toggle colorbar range between **spec** (`[limitLow, limitHigh]`) and **data** (actual min/max). Only shown in `value` mode when the active testDef has at least one limit defined. Active (highlighted) = spec range; inactive = data range. In both states all dies keep the gradient fill and out-of-spec dies are flagged with a triangle marker (▽ below `limitLow`, △ above `limitHigh`) over that fill. |
| Rings | Toggle ring boundary overlay |
| Quadrants | Toggle quadrant boundary overlay |
| Labels | Toggle die index text labels |
| Reticle | Toggle reticle field overlay — only shown when `reticles` are present |
| XY indicator | Toggle axis-orientation arrows showing +X/+Y directions |
| Legend style | Dropdown: bin legend position — **Default (right)**, **Compact (right)**, **Left**, **Top**, **Bottom**, **Floating** (draggable). Disabled outside hardBin/softBin/metadata modes. |
| Rotate | Rotate 90° clockwise (cycles 0→90→180→270) |
| Flip H | Mirror horizontally |
| Flip V | Mirror vertically |
| Summary | Toggle the Summary panel — only shown when `statsSummary` is provided |
| Insights | Toggle the Insights tab — swaps the map for this wafer's chart suite. Shown unless `insights.enabled` is `false`. See §5.9. |
| User guide | Open the built-in end-user guide — a real, separate window when available, falling back to an in-page non-modal floating window when `window.open` is blocked (some embedded WebViews). Only shown when `showHelpButton: true`; callable directly via `openUserGuide()` regardless. |

**Expand** opens the map in an enlarged modal overlay; the map box is reparented — no view rebuild. A maximise button in the modal grows it to fill the window (`F`). Close with Esc, the × button, or the backdrop. Keyboard shortcut: `E`. It works in the **Insights** view too, where it expands the whole chart suite into a wide modal — those charts interact, and reading them side by side is the case the modal exists for; individual chart panels keep their own expand button for enlarging just one. Hidden inside gallery cards (which have their own non-modal expand, see §6) and inside an already-open modal or window.

**While the Insights tab is open**, every control above except Insights and User guide is hidden — Camera/Zoom/Pan/Box select, Mode/Palette/Log scale/Colorbar range/Rings/Quadrants/Labels/Reticle/XY indicator/Legend style/Rotate/Flip, and Summary all apply only to the map view, which the chart suite has replaced; Summary's panel specifically would have nothing to highlight against with the map hidden behind Insights. Expand is likewise hidden while Insights is open, for the same reason. They reappear as soon as Insights is closed.

### 5.7 Interactions

| Gesture | Mode | Action |
| --- | --- | --- |
| Scroll wheel | Zoom mode | Zoom in/out centred on cursor |
| Drag | Select mode (default) | Box-select dies |
| Drag | Pan mode | Pan the map |
| Drag | Zoom mode | Draw zoom rectangle |
| Space+drag | Any | Pan without leaving the current mode |
| Click on die | Any | `onClick` callback; selects just that die. Clicking the only selected die again clears the selection |
| Ctrl/Cmd+click | Any | Toggle die in/out of selection |
| Ctrl/Cmd+drag | Select mode | Additive box-select |
| Hover over die | Any | Tooltip + `onHover` callback |
| Click bin legend entry | Any | Show only that bin (`highlightBin`), or clear it when it is the only one shown — dims all non-matching bins. Releases an active finding |
| Ctrl/Cmd+click bin legend entry | Any | Add or remove that bin from `highlightBin` |
| Double-click | Any | Reset to fitted view |
| Right-click | Any | Drilldown menu (§5.12): on an unselected die, selects it first; on a selected die or empty space, keeps the selection; with nothing selected, charts the whole wafer. Left to the browser (or host) when there is nothing to chart |
| Menu key / Shift+F10 | Any (focus on canvas) | The same menu, from the keyboard |

The selection is drawn with every unselected die faded towards the map background and an outline round the selected dies, which keep their full colour. A finding highlighted from the Summary panel, and `setSelection`, draw the same way. Changing the selection on the map (click, box select, right-click, Esc) releases a finding the Summary panel shows as active, along with its bin highlight.
| Esc | Any | Clear selection; also closes the expand modal |
| `E` key | Any (focus on canvas) | Open / close the expand modal |

> **Note:** zoom/rotate/flip are visual-only transforms — they never mutate the
> underlying `Die` data.  Selection stability is guaranteed: `die.x` and `die.y`
> remain unchanged regardless of display orientation.

### 5.8 Example usage

```ts
import { buildWaferMap } from '@wafertools/wafermap';
import { renderWaferMap } from '@wafertools/wafermap/render';

const result = buildWaferMap({ results, waferConfig, dieConfig });

const ctrl = renderWaferMap(document.getElementById('map'), result, {
  viewOptions: { plotMode: 'hardBin', binColorScheme: 'accessible' },
  onClick:  (die)  => console.log(die.x, die.y, die.hbin, die.sbin),
  onSelect: (dies) => console.log(`Selected ${dies.length} dies`),
  onViewOptionsChange: (opts, changed, category) => {
    if (category === 'preference') savePreferences(opts);
    syncExternalUI(opts, changed);
  },
});

// Replace wafer geometry and die data after a full data reload:
ctrl.setResult(newResult);

// Programmatically change display mode:
ctrl.setOptions({ plotMode: 'value', valueColorScheme: 'plasma' });

// Clean up:
ctrl.destroy();
```

### 5.9 Insights tab

Insights is on by default wherever the toolbar is shown (pass `insights: { enabled: false }` to remove it; a map with `showToolbar: false` stays a plain map unless `enabled: true`). It adds an **Insights** toolbar button and a **Map | Insights** switch at the start of the chrome row. Clicking either swaps the map for a chart suite computed from this wafer's own dies — the same panels a gallery's Insights tab shows (§6.10), scoped to one wafer. Clicking the button again (or the toolbar's Insights button) returns to the map view; the toolbar itself stays visible and usable the whole time so the Insights button is always reachable to close the tab.

**Separate from the Summary panel (§5.4.2) on purpose.** A finding's entire value is click-to-highlight-on-map, which can't work inside a full takeover of the map — so the Summary panel (which includes findings) stays docked, always co-visible with the map, while Insights takes over the full view for chart-heavy content that doesn't reference specific dies. The two toggle independently; opening one never hides the other's toolbar button. Insights' Overview numbers and the Summary panel's compact bin/ring/quadrant/test-value rows read the same underlying computation, so they never disagree even though both can be on screen in principle.

Insights has three chart sub-tabs, **Sweeps** when `insights.sweeps` defines any, and a last **Data** sub-tab (below):

- **Overview** — a **per-test pass rate** chart (worst test first, clustered by group when "Group by" is active), headline tiles naming the population (wafer count, dies analysed and excluded, and for a lot the mean wafer yield, labelled *unweighted, per wafer* to distinguish it from the die-weighted figure), a yield bar (labelled with the actual `passBins` in use, e.g. "Yield by wafer (pass: bin 1)", with a dashed median reference line), a hard/soft bin pareto, and a details card with ring/quadrant regional yield. The pass-rate chart has three modes — the same three pass rates `analyzeWaferMap` returns as `stats.testSpecYield`, `stats.testFlagYield` and `stats.functionalYield` (§7.4.1) — because a parametric test carries **two independent** pass/fail notions and a functional test only one:

| Mode | Judged by |
| --- | --- |
| `spec` | The value against `limitLow`/`limitHigh`. |
| `testFlag` | The tester's own recorded verdict in `die.testPass` — STDF's PTR `TEST_FLG` pass/fail bits, which exist whether or not `LO_LIMIT`/`HI_LIMIT` do. |
| `functional` | The recorded verdict for a `testType: 'F'` test, which has no measured value and therefore only ever has this one. |

The two parametric modes can legitimately disagree — guard bands, dynamic or per-site limits, criteria the exported limits do not describe, or a limits/data mismatch. They are therefore kept as separate views rather than collapsed into one "parametric pass rate", and the chart counts the dies the two sources judge differently — the same figure as `stats.specVerdictDisagreementDies`. The chart surfaces that count rather than resolving it, since only the reader can tell an expected guard band from a real mismatch.

Only the modes the data supports are offered, judged from the dies for `'testFlag'`, since every parametric test *could* carry a verdict and a definition-only check would offer a mode that renders empty. Bars are *rates* on a fixed 0–100% axis rather than counts, so splits with different wafer counts compare fairly. A parametric test with neither limits nor a recorded verdict is genuinely unjudgeable and is omitted rather than reported as 100%.
- **Distributions** — process capability (Cp/Cpk/Pp/Ppk per test, the same figures as `stats.capability` in §7.4.1; normalised to the spec limits where both are given and the test limits otherwise; a test without both limits is drawn on its own observed range, with no indices), a test-value boxplot, a value histogram, and a **wafer-to-wafer trend** (per-wafer mean with ±1σ whiskers, the die-weighted lot mean as a dashed centre line, and the limits). The trend is always in slot order and has no sort control: a drift or a bad cassette position is only visible in the physical sequence, so sorting it would remove the only signal it carries.
- **Limits on the charts** — the boxplot, histogram, trend and scatter draw test limits (`limitLow`/`limitHigh`, labelled *Lo limit*/*Hi limit*, short dashes) and spec limits (`specLow`/`specHigh`, labelled *LSL*/*USL*, long dashes). When the test has both kinds, a **Limits** choice — *Test + spec* (default), *Test limits*, *Spec limits*, *None* — is shared by all four charts. A test without the chosen kind shows the kind it has; a limit outside the plotted range is marked at the chart edge. The wafer map's pass/fail colouring and out-of-limit markers always use the test limits.
- **Correlation** — a Pearson-r correlation matrix (stating the median pairwise `n`, with the exact per-pair `n` in each cell's tooltip) and a die-level X/Y scatter that reports `r` and `n` for the pair it is showing, recomputed when the legend filters the points. Hovering a point names its wafer and die; clicking it opens that wafer on the X test (a single-wafer host shows the test on its map instead); dragging a rectangle selects the dies inside it, across wafers, and opens the drilldown menu (§5.12) for them, with a **Wafers** table when they span more than one. Clicking a capability box drives the boxplot, histogram and trend onto that same test in place; clicking a correlation matrix cell drives the scatter panel's X/Y in place.
- **Data** — the same scope as tables, one at a time (`InsightsView` `'data'`; it is the last tab, after **Sweeps**). **Statistics** is the per-test statistics table and the functional-tests table (they were Overview cards), one set per group when "Group by" is active. **Dies** is one row per die — wafer, X, Y, ring, quadrant, site, bins, a column per test, and metadata — drawn as a virtual table, so only the rows in view exist in the DOM, with sortable columns. **Wafers** is one row per wafer: metadata, die counts, the yield every other panel reports, and the mean of each of the first 50 parametric tests. **Export CSV** writes the table as shown, in the order shown, with full-precision plain numbers (§5.4.1's `onSaveText`; a table of a million cells or more reaches the host as a `Blob`); the Dies table can be exported **Wide** (a column per test) or **Long** (a row per die per test, skipping tests the die has no result for). **Copy** puts a table of up to 200,000 cells on the clipboard as tab-separated text. `InsightsOptions.defaultView` accepts `'data'`.

For a single wafer there is no "Group by" control (grouping needs more than one wafer to be meaningful — see §6.10) and no click-to-open-wafer action (the map you're looking at already *is* the only wafer there is to open). Everything else — the wafer picker on histogram/correlation/scatter, the capability↔boxplot/histogram cross-link, the correlation↔scatter cross-link — behaves the same as the gallery version.

`insights.enabled` only changes what the toolbar exposes; it needs no other options.

**`insights.sweeps`** — parametric sweeps, one card each in their own **Sweeps** sub-tab, which appears only when at least one is defined. Sweeps get a tab rather than joining Distributions because that view is driven by one selected test (capability → boxplot → histogram → trend), while a sweep draws many tests as one curve and ignores the selection; and the tab exists exactly when there is something in it, rather than behind an option or a count threshold, so a sweep never moves tabs because another was added. `defaultView: 'sweeps'` opens on it. **→ [Example: Parametric sweeps](../examples/sweeps.html)**

A sweep reads an ordered run of tests as a response curve rather than as independent tests, and measures the **pair**: where the first two series cross, and how far apart they are at given levels. The case it exists for is one quantity measured at a series of drive levels and recorded as a block of consecutive test numbers — swept up in one block, down in another.

```ts
insights: {
  enabled: true,
  sweeps: [{
    id: 'power',
    title: 'Power Sweep — rise vs fall',
    series: [
      { label: 'Rising',  tests: [1200, 1201, 1202], xValues: [0, 3, 6] },
      { label: 'Falling', tests: [1210, 1211, 1212], xValues: [0, 3, 6] },
    ],
    separationAt: [0.45, 0.60],
    xLabel: 'Drive level (dBm)',
  }],
}
```

| Field | | |
|---|---|---|
| `id` | `string` | Stable identity, so a host can persist which sweep was selected |
| `title` | `string` | Card title |
| `series[].tests` | `(number \| string)[]` | Test numbers **in sweep order** — never sorted. An entry may be a range string, `"1200..1230"` (see below) |
| `series[].xValues` | `number[]` | The real swept quantity per test, one per test **after** ranges are expanded. Without it the x axis is the ordinal position, because test numbers are identifiers and nothing guarantees they are evenly spaced — interpolating a crossing along them would assume a scale the data never claimed. Supply it and the crossing is reported in dBm rather than "between the 3rd and 4th test". |
| `series[].xFromName` | `string` | Read each test's x value from its **name** instead of `xValues` — for programs that record the swept quantity only in the test text. A placeholder pattern, not a regex: `{x}` reads a number, `*` matches anything, the rest is literal. Found anywhere in the name; literal text matches regardless of case. `{x}` reads an SI prefix (`12K` → 12,000, `1M` → 1,000,000; case-sensitive, so `m` is milli, with `K` accepted as kilo). A letter counts as a prefix only when it stands alone or leads a unit symbol — `12K`, `12kΩ`, `5us` — so `12Kangaroos` reads 12. In a name written all in capitals a prefix before a unit is read in any case (`5NS` → 5 ns), except `M`, which could be milli or mega and is reported rather than guessed (`2MV`): spell it in the pattern (`"V_{x}MV"`). Put the prefix in the pattern (`"LRS_STATS_{x}K"`) to keep the number as written. Each x stays attached to its own test, so a missing test loses one point rather than shifting the rest. A name the pattern does not fit is reported and nothing is measured. Not a regex because a shared file must not be able to freeze the app: this matcher's cost is bounded whatever the pattern. |
| `series[].color` | `string` | Optional override. Omit it and the series take CVD-safe palette colours that theme correctly in dark mode; a hardcoded hex does neither. |
| `crossing` | `boolean` | Default `true` when there are two or more series |
| `separationAt` | `number[]` | Y levels at which to report the **width** between the first two series — the horizontal distance between the points where each crosses that level. When one curve falls and the other rises, the pair traces a V and this is the width of the V at that level, which widens as the level rises above the crossing. Each series must be monotonic for the width to be unambiguous; a level that meets a curve twice reports the first crossing. |
| `xLabel` / `yLabel` | `string` | Axis titles |
| `xUnit` | `string` | Bare unit of the x values (`"Ω"`, `"V"`). Ticks, crossing and widths then print SI-prefixed — `47.3 kΩ` |
| `xScale` | `'linear' \| 'log'` | `'log'` for steps that grow by multiples (1k, 2k, 5k … 1M). The crossing is interpolated along log x and a width is reported as a ratio, `×2.49 (15.9 kΩ → 39.7 kΩ)`. Needs every x positive; otherwise the axis stays linear and the card says so. Default `'linear'` |

Each line is the population **median with a p10–p90 band**, not one trace per die — a lot is thousands of dies. The per-die view of the same data is a derived test (§4.1.9) plotted on the map, where position is visible.

A sweep deliberately carries **no population scope of its own**: it names which tests form the curve, so the same definition is valid for any population and stays portable between lots and hosts. The dies it aggregates are whatever the Insights view is currently scoped to.

**Drilldown.** Every sweep is also offered on a population the user picks — selected dies, one wafer — alongside a value histogram and process capability. See §5.12.

**Swept values in test names, on a log axis.** A resistance CDF — one test per threshold, the threshold written only in the test text (`Normalized_LRS= LRS_STATS_12K / …`), thresholds growing by multiples:

```ts
sweeps: [{
  id: 'lrs-cdf',
  title: 'LRS CDF — before vs after bake',
  xLabel: 'LRS threshold', xUnit: 'Ω', xScale: 'log',
  yLabel: 'Fraction of cells below',
  separationAt: [0.5],        // the median resistance shift, reported as a ratio
  crossing: false,            // two CDFs of one population are not expected to meet
  series: [
    { label: 'Before bake', tests: ['31200..31230'], xFromName: 'LRS_STATS_{x}' },  // 12K → 12,000 Ω
    { label: 'After bake',  tests: ['31300..31330'], xFromName: 'LRS_STATS_{x}' },
  ],
}]
```

**Ranges in `tests`.** An entry of `tests` may be a range string — the exact syntax of a derived-test expression's `t[1200..1230]` (§4.1.9), parsed by the same code, so the same text always names the same tests:

```ts
series: [
  { label: 'Rising',  tests: ['1200..1230'],       xValues: RISE_DBM },
  { label: 'Falling', tests: ['1240..1270', 1290], xValues: FALL_DBM },
]
```

- A range expands to the tests **declared** in `testDefs` inside it, ascending. A program numbered in steps of 2 needs no step syntax: `"1200..1230"` is 16 tests there.
- Entries expand in the order written, so a number or a second range can follow a block.
- A range that runs backwards, or matches no declared test, is reported in the card footer and contributes no tests. A series recorded from the top level down keeps ascending test numbers and says so in `xValues`.
- **`xValues` is checked against the expanded list.** A test missing from a range — not in this lot's program, or not loaded by the host — leaves the range one short, and the footer lists exactly which tests it matched. The card is then drawn in test order and the crossing and widths are **not measured**, because pairing the remaining x values with the remaining tests would slide every later x onto the wrong test and report a plausible, wrong crossing. The same applies when some series have `xValues` and others do not.

A plain number that is not declared still keeps its place in the curve with no data, and is reported — naming a test explicitly asserts that it should be there.

A crossing is measured only where both series share an x value, and a multiple crossing is reported as such rather than presenting the first as if it were the only one. A width level that either curve never reaches reads "not measurable", naming which series — never `0`. Tests missing from `testDefs`, functional tests inside a sweep, and series measuring different units are reported in the card footer.

**Sweeps that name no test in the data.** A sweep whose tests are all absent — typically one a host kept from another test program — draws an empty card saying so, and the Sweeps tab shows a notice listing such sweeps. With `insights.onRemoveSweeps`, the notice carries a **Remove** button that hands the host those sweeps' ids.


**The chart suite is loaded on demand.** It is a separate chunk (size in [Performance → Download size](../performance.md#download-size)), fetched
the first time Insights is opened and never downloaded by a page that only renders maps —
the same treatment the in-app user guide gets. Two consequences worth knowing:

- `WaferMapController.setInsightsOpen(true)` returns before the tab's DOM exists. The
  toolbar responds immediately, but code that asserts on the chart DOM straight after the
  call must wait for it to appear — polling for `button[data-wmap-insights-tab]` is the cheapest
  reliable signal. Closing is synchronous, and toggling back to the map while the chunk is
  still in flight is honoured rather than overridden.
- A host that bundles wmap itself needs a bundler that supports dynamic `import()`
  code-splitting (Vite, Rollup, webpack, esbuild with `splitting: true` — all of them by
  default). One that inlines dynamic imports still works; it simply loses the saving. `insights.defaultView` picks which sub-tab shows first (default `'overview'`). Panels that read parametric test data (capability, boxplot, histogram, trend, correlation, scatter, and the pass-rate chart's `spec`/`testFlag` modes) need `testDefs` passed to `buildWaferMap` to have anything to plot — yield and bin pareto only need `die.hbin`/`die.sbin`.

```ts
const result = buildWaferMap({ results, waferConfig, dieConfig, testDefs, passBins: [1] });
renderWaferMap(document.getElementById('map'), result, { insights: { enabled: true } });
```

### 5.10 Warnings

`renderWaferMap` and `renderWaferGallery` surface the library's own advisories
themselves. A ⚠ indicator appears in the toolbar **only when there is something to
say**; clicking it lists each advisory with its code and explanation. The same set
feeds the Summary panel's banner.

This is on by default and needs no wiring. The reasoning: the library raises
advisories that mean the map may be *positionally wrong* (`partial-coverage` and
friends — §4.2.2), and it is the only party that knows. Leaving it to the caller to
notice and display them means, in practice, that nobody is told.

It is deliberately **not** a toast. These are persistent conditions about whether the
map can be trusted, and a message that dismisses itself leaves the map still wrong
with no way back to the explanation.

```ts
interface WarningsOptions {
  display?:   boolean                              // default true
  onWarning?: (warnings: WaferWarning[]) => void   // collected, de-duplicated, severity-ordered
}
```

**Hosts with their own notification system** should pass both:

```ts
renderWaferMap(el, result, {
  warnings: {
    display: false,                    // suppress the built-in indicator
    onWarning: (warnings) => myToastSystem.show(warnings),
  },
});
```

The library still does the collecting, de-duplicating and severity ordering; the host
owns only presentation. `onWarning` fires once on mount — with an empty array when
there is nothing to report, so you can clear your own display — and again whenever the
set changes (for example when a `statsSummary` arrives later and raises the
test-count cap).

Turning `display` off *without* wiring `onWarning` means nobody is told, which is the
situation this feature exists to end.

**Collecting without a map.** `collectWarnings` and `severityOf` are exported from
`@wafertools/wafermap/render`, so a host can reproduce exactly the set the built-in UI
would show rather than re-deriving it from two separate sources:

```ts
import { collectWarnings } from '@wafertools/wafermap/render';

const warnings = collectWarnings({ result, statsSummary });   // most severe first
```

Warnings are de-duplicated on `code` + `message`. A lot legitimately raises the same
geometry advisory on every wafer; repeating it twenty times would bury the one that
differs.

### 5.11 User guide extension

`showHelpButton: true` (§5.4, §6.2) opens wmap's own built-in end-user guide — but a host application often has its own documentation too, and forcing the user to find two separate help buttons/documents is poor UX. `userGuideExtension` inserts the host's own content **before** wmap's guide content in the same window, so there's one help button and one combined document instead of two.

A host's own help entry point often needs to work before anything is rendered too (an empty-state "Help" menu, say) — `renderWaferMap`/`renderWaferGallery`'s `userGuideExtension` option only takes effect once one of them has actually been called. For that gap, `openWaferMapGuide` (§9.3) opens the identical combined window directly, no live render required.

```ts
import type { UserGuideExtension } from '@wafertools/wafermap/render';

interface UserGuideExtension {
  html:   string   // host-provided HTML, inserted before wmap's own guide content.
                    // Static content only — must not contain <script> tags (see below).
  title?: string    // overrides the floating window's title bar text
                    // (default 'Wafer Map — User Guide')
}
```

```ts
renderWaferMap(container, result, {
  showHelpButton: true,
  userGuideExtension: {
    title: 'My App — Help',
    html: '<h1>My App</h1><p>App-specific documentation goes here…</p>',
  },
});
```

wmap's own guide content keeps its own `<h1>Wafer Map — User Guide</h1>` further down the page — the result reads as one combined document with the host's section first, not a title rewrite of wmap's own content. `title`, when given, only affects the window chrome (title bar), matching the same convention `renderWaferGallery`'s window uses.

**No `<script>` tags in `html`.** wmap re-executes exactly one inline script after inserting the combined content — its own live-demo bootstrap, always the last element in wmap's guide HTML — by finding the content container's *first* `<script>` in document order. A `<script>` tag in the host's own HTML would be found first instead, silently breaking wmap's live demos. Keep `html` to static markup (headings, prose, images, links).

**Printing.** When the guide opens as an in-page overlay (any host where `window.open` is blocked or unavailable, e.g. Tauri/Electron/WebView2), its header includes a Print/Save-as-PDF button that calls the host page's own `window.print()` — no host wiring needed. A real separate popup (plain browser hosts, where `window.open` succeeds) needs no such button: it's an actual OS window with nothing else on the page to exclude, so the browser's native Ctrl+P/Cmd+P already prints just the guide.

**Combined "Contents" navigation.** A sticky bar at the top of the guide window lists every `<h2 id="...">` found in the combined document — the host's `extension.html` and wmap's own guide content alike — behind a "Contents" disclosure toggle, plus a "Top" shortcut. This is what makes the combined window read as one guide rather than two stacked documents: without it there is no shared navigation between a host's own sections and wmap's, and no way back to an earlier section once a reader has scrolled past it. Every heading in the combined document also gets a `scroll-margin-top` so a jump target never lands hidden underneath the sticky bar — this applies to a host's own internal cross-references too (any anchor link inside `extension.html`), not just this nav's own links. Give every section-level heading in `html` a real, unique `id` (the pattern in the example above, using `<h2 id="...">` for section headings, is what the nav looks for) and it is picked up automatically — there is nothing else to opt into. Appears once there are at least two `<h2 id>` elements total; wmap's own guide alone already clears that, so every host gets this nav, whether or not it supplies an extension.

The list is deliberately **one flat list, not grouped or split by source** — a host's help button opens what reads as one guide, and a reader has no reason to know or care that it's actually two source documents stitched together. Each side's `<h2>`s are typically numbered from their own source markdown independently (`1.`, `2.`, `3.` …), which would collide head-on partway through this one list, so the nav strips any leading `N.` a heading's own text supplies and lets position in the list carry the order instead. Entries flow in a CSS multi-column box (top-to-bottom within a column, then across), not a row-major grid — the usual reading order for a printed or on-screen table of contents.

**Search.** The same sticky bar also gets a find-in-page text box — but **only** in the in-page overlay case (the same condition Printing above uses), sitting between the Contents toggle and the Top shortcut. A real popup window needs none: it's an actual OS window, so the browser's native Ctrl+F/Cmd+F already searches it — a custom box there would just be redundant chrome. The in-page fallback has no such native search reachable from inside the embedded WebView, which is the gap this fills. Matches are wrapped in plain `<mark>` elements — every browser already renders those as a highlighted span with no CSS needed, so there's no invented highlight colour to keep in sync with a host's theme; the current match additionally gets an outline so it stands out from the rest. Enter/Shift+Enter step through matches, Escape clears the query (or blurs if already empty), and the match count announces via `aria-live` for screen readers.

**Matching wmap's reading measure.** wmap's own guide content is capped at `max-width: var(--wmap-guide-reading-width, 720px)`, widening to `1000px` when the guide window is maximised (the property is set on the shared content wrapper, so it cascades to anything using it). Give the host content's own top-level block the same `max-width: var(--wmap-guide-reading-width, <yourDefault>)` — and matching padding, e.g. `padding: 24px 32px` — to keep the two sections' margins and line lengths visually identical as the window resizes, rather than introducing a visible seam between "the host's part" and "wmap's part."

---

### 5.12 Drilldown — charting a selection or a wafer

Right-click a population and pick a chart drawn from **just those dies**, opened in the same modal an expanded Insights card uses. It needs no host wiring and has no option: it is there whenever there is something to chart. **→ User guide §4.4** describes it from the user's side.

**Populations** — what the user right-clicks decides the dies:

| Where | Population |
| --- | --- |
| A selected die, or empty map space with a selection | The selected dies |
| An unselected die | That die — it is selected first, file-manager style (`onSelect` fires) |
| Empty map space with nothing selected | The whole wafer |
| A gallery card outside its map (header, the space around the map) | That card's whole wafer |
| One wafer's bar in *Yield by wafer*, box in *Test value distribution*, or point in *Wafer-to-wafer trend* (Insights) | That wafer — the tooltip says "right-click to chart this wafer". A pooled group row is not a wafer and does not offer it |

The map's **Chart** toolbar button (§5.6), the Menu key and Shift+F10 open the same menu without a mouse. A population is a **snapshot**: the chart keeps its dies if the selection changes afterwards.

**Charts** offered for it:

| Chart | Available when | Notes |
| --- | --- | --- |
| Value histogram | Some parametric test has a value in the population | Opens on the test the map is showing (`plotMode: 'value'`) |
| Process capability | Some parametric test has at least two values | Below 30 dies the card adds that each Ppk is a rough estimate |
| Each `insights.sweeps` entry | The population has values for the sweep's tests | A single map offers them even when `insights.enabled` is off; the gallery passes its sweeps to every card |

A chart that cannot be drawn stays in the menu, **disabled, with the reason** as its hint — no values for its tests, too few dies, or a lot-stack map, whose dies are per-position aggregates rather than measured dies (every chart is disabled there). Charts that compare wafers (the boxplot, the trend) are not offered: every population here is one wafer.

**What the chart says.** The modal title and a line on the card state how many dies are plotted and from which wafer — "12 dies selected on W03", "2,644 dies on W03". Partial and edge-excluded dies are left out, as in every chart, and then counted: "10 of 12 dies selected on W03 (partial and edge-excluded dies left out)". The wafer is named by the item's `label`, else `metadata.waferId`; with neither it reads "this wafer" — never a positional "Wafer 3 (no ID)", which would read as an ID.

**Right-click on the map opens the drilldown menu whatever the data holds** — there are always dies to list, so a bins-only map offers **Dies** (the charts and **Test statistics** are listed greyed, with the reason). A host's own context menu on the map therefore no longer appears; the canvas owns right-click on itself. The map canvas owns right-click on itself: a right-click it declines (the bin legend, a mapless map) never reaches a gallery card or a host handler around it.

The menu and its charts are a separate chunk, loaded on the first right-click — a page that never uses it never downloads it.
