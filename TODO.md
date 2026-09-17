# TODO / Future Considerations

Items here are ideas or half-designed features that need more thought before implementation.

Convention (borrowed from `../tsmap/IDEAS.md`, which does this well): when an item
is done, check it off (`[x]`) and add a one-line implementation note or commit
reference rather than deleting the entry — the history of *why* something was
done the way it was is the useful part.

`[~]` marks an item **partly** done, where the heading must say which half shipped
and the body must say what is still open. It exists because the alternative was
worse in both directions: an unmarked heading over a body whose fix had already
landed reads as open work (that happened — "Gallery value-mode colour range" sat
unmarked for twelve days after being implemented, and was re-reported as an open
bug from this list), while `[x]` on a partial fix buries the remainder. An
**unmarked** heading therefore means nothing here has been done.

---

## [~] `downloadFilename` becomes a prefix in 0.31.0 — naming shipped in 0.30.1, the prefix change is due

0.30.1 names every saved file `[lot]_[wafer]_[content]` (`canvas-adapter/exportName.ts`, API
§5.4.5), but a host-set `downloadFilename` still names the map/gallery PNG verbatim, because
changing what an option means is breaking and can't go in a patch. 0.30.1's CHANGELOG
**Deprecated** section and a one-time console notice announce the change for 0.31.0.

**Enforced:** the test `a host downloadFilename still names the map PNG exactly…` in
`tests/dom-adapter.test.mjs` fails as soon as `package.json` or a CHANGELOG heading reaches 0.31.0.

Steps for 0.31.0:
1. `renderWaferMap` `downloadPng` and `renderWaferGallery` `downloadGalleryPng`: remove the
   `options.downloadFilename != null` verbatim branch, so the PNG always goes through
   `exportHooks`.
2. In both renderers' `withExportContext` getters, set `prefix: options.downloadFilename`. The
   prefix logic and its tests are already in `exportName.ts` / `tests/exportName.test.mjs`.
3. Pass `downloadFilename` on to gallery cards and detached windows (both `renderWaferMapCard`
   calls), so card files carry the host prefix too. Cards get the raw host hooks, so the prefix
   is applied exactly once.
4. Delete `noticeDownloadFilenameChange` and its test; `noticeOnce` in `renderer/deprecate.ts`
   stays.
5. Replace the verbatim test (and its release gate) with prefix tests, e.g.
   `LOT123_sort` → `LOT123_sort_W05_hard-bin.png`, CSVs prefixed, cards prefixed.
6. Update the option JSDoc (both files), API §5.4.5, the api.md option comments and the
   user guide's "Names of saved files", and add a CHANGELOG `### Breaking` entry.
7. Check the tsmap side: it passes its source-file stem, so its names become
   `<stem>_<wafer>_<content>`.

---

## [x] Summary-panel geometry warnings cannot be dismissed or collapsed

**Problem:** a geometry advisory (e.g. the inferred-die-pitch warning) renders
at the top of the Wafer Summary panel as a permanent block with no dismiss and
no collapse. On a wafer where the pitch was inferred it can run to ~10 lines,
pushing "Summary report" / "View die list" and the SUMMARY section below the
fold — so the panel's actual content starts off-screen on first open, every
time, for the whole session.

**Why it matters more than it looks:** the advisory is per-RESULT and
unchanging, so once read it carries no new information, but it costs the same
vertical space on every open of every wafer in a lot with inferred geometry —
which is the common case for the data this library exists to plot. It is also
the one panel element a user cannot act on: findings collapse, sections
collapse, the panel itself closes; this does not.

**Where it originates:** `packages/canvas-adapter/summaryPanel.ts` renders
`result.warnings` / `stats.warnings` as a plain block. There is already a
collapse mechanism in the same file (the findings and bin-breakdown sections
use `wireExpandToggle`), so this is reusing an existing pattern, not inventing
one.

**Suggested fix:** collapse to a single summary line by default — a warning
icon plus "Geometry inferred" with a chevron — expanding to the full text on
click, matching how findings already behave. Dismissal is a separate question:
per-session dismissal needs somewhere to remember it, and the panel is rebuilt
on every `setResult`, so "collapsed by default with the detail one click away"
is likely enough without any persistence at all.

**Related:** the `inferred-pitch` advisory was downgraded from error to warning
in 0.27.0 (it used to leave a permanent red banner in tsmap with nothing to
dismiss it). This is the same complaint one level down: the severity is now
right, the space it takes is not.

**Done (0.27.0):** collapsed by default in `warnings.ts`'s `buildWarningsBanner`
— a one-line summary (severity glyph + short label + chevron) that expands to
the full prose on click. The short labels are keyed on `code`, not derived from
the message, matching the rule hosts are given for branching on these; an
unknown code falls back to the message's first sentence so a new advisory still
collapses sensibly. The header is a real `<button>`, so keyboard operation and
the accessible name come from the element rather than hand-rolled key handling.
Measured on `examples/geometry.html`: 110px → 32px, 78px back on a 346px panel.

**Not** dismissable, deliberately: the condition is still true, and a dismissed
advisory about dies that may be mis-positioned is a wrong map with nothing on
screen saying so. Collapsing keeps it permanently visible and permanently one
click from its reasoning, which is the part that was actually missing.

## [~] Summary panel content clips silently in 'top'/'bottom' placement — clipping fixed, `placement` review still open

**Found while:** verifying `SummaryPanelOptions.placement` actually works for
all four values (right/left/top/bottom), prompted by a question about whether
today's toolbar/chrome-row work assumed 'right' only. It didn't — all four
positions are structurally correct (canvas and panel swap sides/stack
correctly, toolbar stays aligned, insets are right) — but 'top' and 'bottom'
have a separate, pre-existing problem: `createSummaryPanelEl` fixes the panel
to `height: 180px` with `overflowY: 'hidden'` for vertical placements (`right`/
`left` get `maxHeight: 100%` with `overflowY: 'auto'` instead). On any wafer
whose panel content exceeds 180px — which is most of them, since Summary alone
plus one collapsed section already approaches that — the excess is silently
clipped rather than scrolled. Visually the last visible row's text is cut off
mid-line with no indication more content exists below.

**Confirmed pre-existing**, not a regression from today's chrome-row work —
`git log -S` traces the 180px literal back to the commit that introduced
`testValues`/summary panel/toolbar tooltip fixes, well before this session.
Today's identity-strip font bump (`FONT.body` → `FONT.sub`) makes the content
taller and so pushes more panels over that ceiling, but the clipping mechanism
itself already existed.

**Suggested fix:** either give vertical placements `overflowY: 'auto'` too (an
internal scrollbar inside a 180px band, same pattern the horizontal placements
already use via `maxHeight: 100%`), or size the fixed height from actual
content up to some cap. The horizontal placements' approach — bound by the
container height, scroll internally — is probably the simpler fix to mirror.

**Before fixing: do a full review of `placement`, not just the clipping bug.**
Only `right` has had any real design attention — it's the only value used in
this library's own demos and docs, and (per Paul) tsmap's whole layout has been
built assuming it. `left`/`top`/`bottom` were verified structurally correct
(canvas/panel swap sides, toolbar stays aligned, insets are right) but that was
a quick live-render check, not a review of whether the content ITSELF reads
well in those positions — a 300px-wide panel squeezed to a 180px-tall band at
the top or bottom of a wide map may be the wrong shape for this content
regardless of the clipping bug, e.g. multi-column stat tiles, per-test tables,
and the findings list were all designed for a narrow-tall panel, not a
wide-short one.

**Clipping fixed 2026-09-09** (`summaryPanel.ts`): `overflowY` is now `'auto'` for every
placement, so a 'top'/'bottom' panel scrolls its 180px band instead of cutting the last row
mid-line. That is the silent-loss half only — the review below is untouched, and the three
options remain live.

**Live options once that review is done:**
1. Fix the clipping and keep all four values as designed.
2. Redesign `top`/`bottom`'s internal layout for a wide-short shape (more than
   an overflow fix — likely a different arrangement of sections).
3. **Remove `top`/`bottom` from `SummaryPanelOptions.placement` entirely**,
   narrowing it to `'right' | 'left'`, if a wide-short panel turns out not to
   be a shape worth supporting. This is a breaking change (removes accepted
   values) and would need a minor bump + CHANGELOG `### Breaking` entry per
   this repo's versioning policy — but doing it now, before any real host
   depends on `top`/`bottom`, is far cheaper than doing it after one does.
   Check `../tsmap` and any other known consumer for actual `placement: 'top'`
   / `'bottom'` usage before deciding — CLAUDE.md's own rule for "fixed
   everywhere" applies in reverse here: don't remove something a caller
   already relies on without a deprecation path.

---

## Extract the shared screenshot harness

**Idea:** `scripts/capture-screenshots.mjs` here (706 lines) and
`../tsmap/scripts/capture-screenshots.mjs` (827 lines) are the same harness —
static file server, headless Chromium, the setup-step vocabulary, `--only` /
`--list` filtering — pointed at different apps. Only the *definitions*
(`capture-definitions.mjs`) are legitimately per-project.

**Unmarked deliberately: none of the extraction has happened.** `../tsmap` has since
extracted its OWN half into `scripts/lib/` (server, browser, steps), shared between its
screenshot captures and its scenario runner — that is a tsmap-internal refactor and it
makes this entry easier, not done. The `FORKED —` headers below are a note, not a fix.

**Why it hasn't been done:** it needs a home. Neither repo should depend on the
other for a build script, so it would mean a third published (or vendored)
package for what is currently ~500 shared lines. Both files now carry a
`FORKED —` header noting the duplication so it isn't mistaken for accidental.

**Open questions:**

1. Vendor a copy into both (status quo, but with the header) vs. a real
   `@wafertools/capture-harness` package?
2. If a package: does it pull `playwright` into the dependency tree of a
   library that currently has no runtime deps at all?

---

## Gallery card removal (× button)

**Idea:** Add an × close button to each gallery card so users can remove individual wafers from the gallery without the host calling `setItems()`.

**What's straightforward:**
- Remove the card from the DOM and from `currentItems` / `originalItems` / `cardControllers` / `cardContainers`
- Rebuild the legend and grid layout (both already read from `currentItems`)
- Clear finding highlights (`clearLotFindingHighlight()`) since card indices shift
- Fire an `onRemoveItem(index, item)` callback so the host can mirror the removal in its own state
- Hide/disable the × in stacked modes (cards are synthetic aggregates, not individual wafers)

**Open questions:**

1. **Who re-runs `analyzeWaferLot`?**  
   `currentLotStats` is externally computed and passed in — the gallery has no way to recompute it after a wafer is removed. Options:
   - Host is responsible: `onRemoveItem` callback prompts the host to call `analyzeWaferLot()` and then `setLotStatsSummary()`.
   - Gallery is responsible: wire `analyzeWaferLot` from the stats package into the gallery so it can recompute internally. The dependency already exists for stacked modes (`analyzeWaferMap`), but lot-level stats is a bigger step.

2. **What happens to the summary panel in the interim?**  
   If the host is responsible for recomputing, lot-level stats are stale the moment a card is removed. Options:
   - Proactively hide/disable the summary panel on removal and restore it when `setLotStatsSummary()` is called with fresh data — never shows stale state.
   - Leave it open but mark it stale somehow.
   - Only show the summary panel if the host opted in to managing stats updates.

3. **Is this the right UX at all?**  
   An alternative is to leave removal as a pure host concern (host manages the items array and calls `setItems()`), and just make `setItems()` cheaper/smoother for the partial-removal case rather than adding internal removal logic.

## Non-uniform die pitch per reticle field (MPW / multi-site reticles)

**Motivation:** MPW (multi-project wafer) layouts commonly place several device
types or test vehicles inside one reticle field, at a finer pitch than the
spacing between reticle fields. A given test program may only test one of
those device types, so `results` only covers a subset of the physical die
positions — the rest are real, untested silicon, not absent positions. A user
raised this wanting the untested sites to render as recognisable "ghost"
dies (no-data grey) rather than simply being missing from the plot.

**Current workaround (already works, no code change):** dies present in
`results` with no `hbin`/`sbin`/`testValues` already render as no-data grey
(`NO_DATA_FILL`, `buildView.ts`). A caller can pre-build the **full** physical
die grid (including untested sites) and pass it via `WaferMapInputBase.dies`
(`buildWaferMap.ts:1246-1298`) — `results` are matched onto it by `x,y` key,
and unmatched grid positions stay no-data grey automatically. For a plain
uniform grid this is just `generateDies` + `clipDiesToWafer`.

**The actual gap:** `generateDies` (`core/dies.ts`) only produces a uniform
single-pitch grid. It cannot express "2-3 sites at a finer pitch within each
reticle field, with a coarser pitch between fields" — a caller would have to
hand-build that `Die[]` themselves today. Two areas of the library also
assume one global pitch and would misbehave even if a caller *did* hand-build
a non-uniform grid:

1. **Reticle field-boundary geometry** (`core/reticle.ts`,
   `generateReticleGrid`) takes a single scalar `diePitchX`/`diePitchY` for
   the whole wafer and computes field rectangles as `W*pitchX`/`H*pitchY`.
   The explicit-`dies` path in `buildWaferMap.ts:1272` currently hardcodes
   `diePitchX=1, diePitchY=1`, so reticle overlay boxes are already wrong
   for any physical (mm-scale) grid passed via `dies` — this is arguably a
   pre-existing bug independent of the non-uniform-pitch question.
   `getReticleCell`'s cell-label math (grid-index modulo) is pitch-independent
   and unaffected.
2. **Cluster-detection stats** (`stats/clusterDetection.ts:74-93`) derives its
   neighbour-search radius from a single sampled die's `width`/`height`
   (the first die in the array), assumed representative of the whole wafer.
   With intra-field vs. inter-field pitch differing, this would over- or
   under-merge spatial clusters depending on which pitch that first die
   happened to have.

Everything else (die-rect drawing, hit-testing, hover, `stats/regions.ts`
distance math) already reads per-die `physX`/`physY`/`width`/`height` and
would render/compute correctly with a non-uniform grid.

**Shape of a fix (not yet scoped in detail):**

- A `DieSpec`-like construct that describes a reticle field's internal site
  layout (site count/positions/pitch within the field) plus the field-to-field
  pitch across the wafer, and a generator (e.g. `generateDiesFromReticle`)
  that expands it into a full `Die[]` — sparing callers from hand-rolling grid
  math themselves, consistent with the library's "enforce validity
  internally, don't rely on the caller" principle.
- Each die presumably needs a way to identify which device type / test
  vehicle it is (an MPW reticle may contain several), so results for one
  device type match only the corresponding sites — likely a new optional
  `Die` field, and`results`-matching logic that can key on it in addition to
  `x,y`. Needs design: is this per-die `metadata`, a new typed field, or
  something reticle-config-driven?
- `generateReticleGrid`/`getReticleCell` need to accept non-uniform pitch
  (per-field site layout) instead of one `diePitchX`/`diePitchY` scalar, and
  the explicit-`dies` path's hardcoded `diePitchX=1, diePitchY=1` needs
  fixing regardless.
- `clusterDetection.ts`'s neighbour-radius estimation needs to stop assuming
  one representative die size — likely sample per local neighbourhood, or
  take an explicit pitch input rather than inferring from `dies[0]`.

**Open questions:**

1. Does the caller supply the reticle-internal site layout explicitly (site
   count + positions/pitch), or should the library attempt to infer it from a
   sparse `results` footprint the way `inferWaferFromXY` currently infers a
   uniform grid? Inference seems risky here — multi-device MPW footprints are
   inherently ambiguous without an explicit spec.
2. How does device-type identity flow through `results` matching, tooltips,
   and stats? Do stats need to be scoped per device type (e.g. yield is
   meaningless mixed across device types sharing a wafer)?
3. Does the reticle overlay need to show sub-field site boundaries as well as
   field boundaries, or just the field grid as today?
4. Interaction with `partial`/edge-clipping: `clipDiesToWafer` logic assumes
   dies are checked individually against the wafer circle — should still work
   per-site, but needs verification once site layout is non-uniform.

## Issues and idea since the port of charts from tsmap to wmap

### [~] Chart-panel mini-toolbars still use their own button chrome, not `makeBtn` — icons unified, the button primitive is not

Each Analysis-tab chart card (`cardShell()` in `charts/chartShell.ts`) has its own tiny save/expand button pair. Both now use the main toolbar's actual icons (`ICONS.expand`, `ICONS.download` — the save button previously used a raw `⤓` glyph, fixed), so the icon mismatch is resolved. What's still open: the buttons themselves are hand-built (22px, native `title` attribute) rather than going through `makeBtn` (28px, `ariaLabel`, the shared custom hover-tooltip system) — full primitive unification would need `cardShell()` to also thread through a `tooltip` element the way `createToolbarHelpers` does. Lower priority than a functional gap, purely a visual-consistency cleanup.

## Deferred from metadata-in-CSV-exports (0.24.0)

Two performance mitigations were scoped out of that change as bigger than a single release —
logged here rather than silently dropped. See `packages/canvas-adapter/dieList.ts` and
`packages/stats/metadataColumns.ts`.

### Row virtualisation for `buildDieListSection`

The die-list table has no virtualisation — every rendered row is real DOM. `maxRows` (0.24.0)
bounds this by capping the table at 50,000 rows by default, but that is a blunt instrument: a
host that genuinely wants to scroll through 200,000 rows currently cannot without raising the
cap back into multi-second, several-hundred-MB territory. A virtualised table (render only the
rows intersecting the scroll viewport, plus overscan) would remove the tradeoff entirely.

### Chunked/streaming CSV export

The CSV export builds one `lines: string[]` and `join`s it — at 266k dies × ~20 columns
(with metadata columns added) that's a ~40-90 MB string, doubled transiently at `join`. Fine
today; the failure mode as die counts and metadata-column counts both grow is a WebView OOM
during export, which would fail silently rather than gracefully. Worth moving to a
`Blob([...chunks])` construction (no single giant string) or a genuinely streamed download
before either dimension grows much further.

## [x] Gallery value-mode colour range is per-card when the active test has no limits

**Confirmed:** when the active test *has* limits, `colorbarRangeMode: 'spec'` gives every
card the same `[limitLow, limitHigh]` range (shared, comparable), and the "Colorbar range"
toggle lets the user opt into `'data'` instead — which the gallery already documents as
scaling each card to its own min/max (`perCardLegendBlockedReason` in
`packages/canvas-adapter/renderWaferGallery.ts`, "Each map has its own value range, so it
keeps its own colour bar").

But when the active test has **no** limits at all, `activeTestHasLimits()` is false, so the
"Colorbar range" toggle button is hidden entirely — there's no way to reach spec mode because
there's no spec. `buildView`'s `useSpecRange` check (`packages/renderer/buildView.ts` ~1379)
then falls through to the `else` branch, which computes `vMin`/`vMax` from `lo`/`hi` over only
the `dies` passed to *that* `buildView` call. Since `renderWaferGallery`'s `buildCard`
(`renderWaferGallery.ts` ~2198) calls `renderWaferMap` once per item with that item's own
`dies` and no explicit `valueRange` override, each card ends up auto-scaled to its own data
extent — silently, with no toggle and no "each map keeps its own range" messaging surfaced
to the user for this case (that message only fires when `colorbarRangeMode === 'data'`, which
isn't the state here even though the *effect* is identical).

**Net effect:** a value-mode gallery for a limit-less test cannot currently show wafers on a
common colour scale — exactly the comparison a lot gallery exists for.

**Decided (2026-08-28):** `'data'` mode should default to a lot-wide range — computed once in
`renderWaferGallery` over the *union* of all cards' dies for the active test (it already loops
`resolvedItems` for stacked-mode aggregation, see `allDies` ~1787) and passed down as an
explicit `valueRange: { test, range }` per card, overriding the per-card auto-scale. This
applies whenever the gallery is showing **the same test across multiple wafers** — i.e. plain
`value` mode, with or without limits. It does **not** apply to `stackedValues`: there, each
card is a *different test/parameter* (different units, different meaning), so per-card scaling
is correct and must stay — sharing a range across cards there would be as wrong as sharing an
axis between a temperature chart and a voltage chart. `stackedBins`/`stackedSoftBins` already
share a lot-wide range correctly (`stackedSharedOpts`, `valueRange: [0, lotSize]`) — no change
needed there.

This also fixes the no-limits case above for free: once `'data'` mode is lot-wide by
construction, there's no separate "no limits" branch to fall through — `'data'` is always
lot-wide for single-test value mode, `'spec'` remains the limits-based shared range, and both
are shared/comparable regardless of which one is active. The "Colorbar range" toggle itself
stays gated on `activeTestHasLimits()` as before — with no limits there is no second range to
toggle *to*, so there is nothing to offer a choice between; `'data'` mode is simply the only
(and now lot-wide) option in that case.

**Implemented (2026-08-28):** `packages/canvas-adapter/renderWaferGallery.ts` gained
`sharedDataValueRange()` (computes the lot-wide min/max for the active test, deferring to
`undefined` — i.e. per-card spec ranging — whenever a spec-anchored range applies) and
`syncSharedValueRange()` (writes the result into `sharedOpts.valueRange` as `{ test, range }`
and pushes it to every live card controller). `syncSharedValueRange()` is called: at the end of
`updateShared()` (covers active-test/colour-mode/pass-fail-display/mode-switch changes), at the
end of `buildCards()`'s sync-item pass (covers `setItems()` and initial mount), and after each
factory resolves in `resolveNext()` (so already-rendered cards widen their range as more lazy
items arrive, rather than staying anchored to whatever was visible first). Left untouched:
`stackedValues` (per-card auto-scale, each card is a different test), `stackedBins`/
`stackedSoftBins` (already shared via `stackedSharedOpts`'s `[0, lotSize]`), and log scale —
`buildView`'s `logScaleValid = wantsLogScale && vMin > 0 && vMax > 0` now naturally agrees
across every card once `vMin`/`vMax` are the same shared values, so no separate log-scale fix
was needed.

## Unify `identityHeader.ts` with `renderWaferGallery`'s `buildIdentityHeaderRow`

**Confirmed duplication, not yet unified.** `renderWaferGallery.ts` does not call
`identityHeader.ts`'s `createIdentityHeader` — grid cards, popup windows, and the floating-window
fallback each get their own expandable identity header via a separate `buildIdentityHeaderRow`
builder (`renderWaferGallery.ts` ~2064, called at ~2197 and ~2591), sharing only the low-level
`wireExpandToggle` interaction helper (`toolbar.ts`) with `identityHeader.ts`. `docs/architecture.md`
already documents this as "a known remaining duplication ... flagged for a future consolidation
pass" — this entry is the tracked pointer to that flag so it doesn't silently stay unaddressed.

**Why it hasn't been done:** it's a real refactor, not a small fix — `renderWaferGallery`'s
version also folds in a lot-wide distinct-values summary (`buildFacetTable`, `stats/facets.ts`)
into its bin-legend strip, which `identityHeader.ts` has no equivalent of. Unifying the two means
either extending `identityHeader.ts` to cover that case or keeping the gallery's summary logic
external and only sharing the label/expand-panel shell.

**Open questions:**

1. Does `identityHeader.ts` grow an option for the gallery's per-card facet summary, or does the
   gallery keep composing that separately around a shared shell?
2. Three call sites in `renderWaferGallery.ts` (grid card, popup, floating window) need
   migrating — do they all take the same options, or does one need something the others don't?

## [x] Gallery metadata-mode colours can mismatch the shared legend (same root cause, no limits involved)

**Confirmed, and NOT gated behind any edge case — can happen today.** `metadata` plot mode has
the identical per-card-vs-lot-wide split as the value-range bug above, just for colour index
instead of numeric range:

- Each card's own `buildView` call (`packages/renderer/buildView.ts` ~1496-1513) collects the
  *distinct metadata values on that card's own dies only*, natural-sorts them, and assigns
  colour by index into the ordered palette (`metadataValueColor(index)`).
- The gallery's shared legend strip (`renderWaferGallery.ts` ~1697-1712) instead collects
  distinct values across **every card's dies** (`metadataValueSet`, built by looping
  `resolvedItems`), natural-sorts *that*, and assigns colour by index the same way.

These two index assignments only agree when every card happens to contain the exact same set
of distinct values. If one wafer is missing a value the others have (e.g. a defect category
that wafer never exhibited), that card's local ordering shifts and its dies get painted with a
colour that doesn't match what the shared legend says it means. The code has a comment at
`renderWaferGallery.ts` ~1710 acknowledging the two must stay in sync ("must match buildView's
colour-assignment order, or this lot-level strip would list values in a different order to the
per-card legends") but nothing enforces it — it only holds by coincidence when the data is
uniform enough.

**Fixed 2026-09-09**, as suggested: `buildView` gained `ViewOptions.metadataValueOrder`
(`{ key, values }`, applied only when `key` matches `activeMetadataKey` — the exact guard
`valueRange`'s `{ test, range }` form uses), forwarded by `renderWaferMap` via
`WaferViewOptions`. `renderWaferGallery` computes the union across every item once
(`sharedMetadataValueOrder`) and pushes it to every live card (`syncSharedMetadataOrder`),
paired with `syncSharedValueRange` at the same three trigger points. Values a card has but the
list doesn't are appended rather than dropped, so a stale list can only cost the shared
ordering, never leave real dies uncoloured.

The ordering itself is now ONE implementation, `collectMetadataValues` (buildView.ts, internal
— not re-exported from `packages/renderer/index.ts`), used by the maps and by the gallery's
legend strip. The strip also stopped deriving values with `String(raw)` where the maps use
`metadataCategoricalValue`: a second divergence in the same place, which formatted numeric
metadata differently in the key than on the dies. 8 new tests (`tests/metadataMode.test.mjs`,
new `tests/galleryMetadataOrder.test.mjs`).

**Original suggested fix (kept for the record):** same shape as the value-range fix — compute the metadata colour map lot-wide
once in `renderWaferGallery` (it already builds `metadataValueSet` there) and pass it down to
each card's `buildView` instead of letting each card derive its own from a partial view of the
data. Note this is already bypassed correctly when a metadata field has explicit per-value
colours (`activeMetadataFieldDef.values[].color`) — only the auto-assigned ordinal-palette path
is affected.

---

## Untested-by-construction checkers — audit them, don't assume

**Audited 2026-09-09, by planting a defect against each.** The lesson recorded below —
"the focus rule could not fire at all on first writing… the acceptance test is not
optional" — was written in the same session that shipped three more checkers
(`check-api-claims`, `check-clones`, `check-overlay-conventions`) with no acceptance
run recorded for any of them. All three do fire: a wrong field count, a ~283-token
block copied between two stats files, and an `openModal(` without `anchor` plus a bare
`document.head.appendChild` were each caught with the right file, line and reason.
tsmap's newer `check-theme-contrast.mjs` was verified the same way.

So this is not an open defect — but the *evidence* was ad-hoc and lives only in a
transcript. **The real gap is that a checker's acceptance run is not repeatable.** Each
of these could be a test that plants its defect in a temp copy and asserts a non-zero
exit, the way `tests/` already covers library behaviour. Worth doing next time one of
them is touched, rather than as a sweep.

---

## [~] Enforce `UI_STANDARDS.md` with a lint suite, not prose — three rules shipped, two open, plus a decision

**Why this is here.** During the 2026-09-01 UI pass, most of the contract's new
rules were written down and then *asserted* to be met rather than checked. The
one check that did exist (`tsmap/scripts/check-button-styles.mjs`) was silently
broken — its regex `\.style\.cssText\s*=\s*[^;]+;` stopped at the first
semicolon, which is **inside the CSS string** (`margin-top:4px;…`), so it only
ever inspected the first declaration and reported everything clean. Meanwhile the
user kept finding buttons that looked like labels. A contract nothing enforces is
documentation; treating it as verification is how the drift kept recurring.

**Proposal.** One check per rule, in both repos, wired into `npm run verify`,
each failing with `file:line` and the rule it breaks.

| Rule | Mechanically checkable | Status |
| --- | --- | --- |
| Type tiers (11 / 12 / 13 / 15 / 20) | yes — flag off-tier `font-size` | **partly** — a floor is enforced (11px wmap / 12px tsmap), not the tiers |
| Radius roles, no literals | yes — flag `border-radius: Npx` | **done** — budget on literals (wmap 2, tsmap 1); `4px`→`RADIUS.control` and `50%`→`RADIUS.pill` were tokenised instead of admitted, both visually identical |
| Spacing scale | yes — flag off-scale padding/gap/margin | **done** — budget on distinct off-scale literals, ratcheted (wmap 4, tsmap 6) |
| Focus ring never suppressed | yes — flag `outline: none` without a documented reason nearby | **done** — requires a focus-specific reason in an adjacent comment |
| Every interactive element reacts to hover | yes — `cursor: pointer` with no hover/`wireControlHover`/class | **done as a ratchet** — wmap 18, tsmap 10 existing sites budgeted, not fixed; see below |
| One tooltip look | yes — flag a second tooltip style block | open |
| Buttons use a shared class | done — `check-button-styles.mjs` (rewritten with a quote-aware scanner) | done |
| No icon-role colour on text (`CLR.icon*`) | partly — flag `color: CLR.icon*` outside icon elements | open |

**Done so far (2026-09-02).** All of it inside the existing
`check-style-scales.mjs` rather than a script per rule — one checker per repo,
many rules, to avoid the sprawl this repo already has enough of. Added: a
quote-aware comment stripper (a comment in `chartShell.ts` *quotes*
`outline: none` while explaining its removal, and an unguarded scanner reads the
explanation as the offence); the spacing budget; the focus-ring rule.

Two lessons, both from the acceptance test rather than from reasoning:

1. The focus rule **could not fire at all** on first writing — its justification
   window included the offending line, which necessarily contains the word
   "outline", so every violation excused itself. It reported clean on a planted
   defect.
2. Before that, accepting a bare `UI_STANDARDS` mention as justification meant
   any nearby citation of the standard — for an unrelated reason — silently
   exempted a suppression.

Both are the exact failure this entry was written about, reproduced while
writing the fix for it. The acceptance test is not optional.

**The hover rule found 18 real sites in wmap and 10 in tsmap** — genuinely
clickable elements with no hover response at all, including the Summary panel's
collapsible section headers and the Insights tab buttons. Verified by hand, not
assumed: the section toggle has `cursor: pointer` and no `:hover`,
no `wireControlHover`, no `mouseenter` anywhere in its construction. These are
budgeted, not fixed — giving them hover states is a visible UI change and its
own decision. **That decision is still open**, and is the obvious next step on
this entry.

**Add a "one value, many places" enumeration.** The rules above check that a
value is *on scale*. They do not ask the different question that keeps finding
real bugs: **how many distinct values of this kind exist across both repos, and
should there be that many?** Every defect in the 2026-09-01 pass was this shape:

| Property | Distinct values found | Should be |
| --- | --- | --- |
| font-family | 3 in wmap + 1 in the host, none matching | 1 (inherited) |
| button appearance | 4 independent definitions of "secondary" | 1 |
| tooltip style | 2 (dark toolbar, light chart card) | 1 |
| card frame | 2 (`cardShell`, `plainCard`) | 1 |
| border radius | 8 in wmap, 5 in tsmap | 3 roles |
| hover state | wired on icon buttons, absent on text buttons | all controls |

Not yet enumerated, and worth adding for the same reason: `z-index`,
`box-shadow`, `transition`, `line-height`, `letter-spacing`.

**Why this needs its own check rather than review.** None of these are findable
by reading one file — each declaration is reasonable in isolation, and the defect
exists only in the comparison. They are also invisible to a *diff* review when
the offending lines are pre-existing and untouched, which is how the font-family
split survived two code reviews and a full design audit on the same day. A count
query finds them in one line; nothing else reliably does.

**The acceptance test for each check: it must find the defects already known.**
Run it against the pre-fix state (or a fixture reproducing it) and confirm it
fails. A check that passes on a known bug is worse than no check, because it
converts an unknown problem into a false assurance — which is exactly what
happened here.

**Not checkable, stays prose:** whether a given grey is a *label* or an *icon*,
whether a distinction is semantic or arbitrary, and anything needing a look at
the rendered result. Those need a human or a screenshot pass, and the contract
should say so rather than implying full coverage.

---

## [~] Decide whether the summary report is a screen or a print artefact — the 10px rules fixed, the decision itself is open

The exported HTML report (`packages/stats/reportHtml.ts`) carries `@media print`
and `@page { margin: 10mm 8mm 12mm }`, so it is *built* to print — but its type
is sized in screen px (20 title / 18 stat / 13 / 12 body / 11 label). Screen px
and print pt are not the same problem: 12px body is about 9pt on paper, under
the ~12pt floor for printed reading matter.

Two known-good answers, and which is right depends on how these are actually
used:

- **Read on screen, printed rarely** — leave it. The current scale is
  internally consistent and was ahead of the app (it had `tabular-nums` before
  the live UI did).
- **Printed and passed around** — add a `@media print` block that scales the
  document up rather than spot-fixing individual rules, so the on-screen and
  on-paper versions are each sized for their own medium.

Deliberately NOT done: forcing the app's tiers (11 / 12 / 13 / 15 / 20) onto it.
Those exist for dense chrome in a 300px panel; a document read at arm's length
is a different artefact and should keep its own scale.

Already fixed (2026-09-01): the two 10px rules — table column headers and the
status badge — went to 11px. At print, 10px is roughly 7.5pt, which is below any
sensible floor regardless of how this question is answered.

---

## [x] Solarized Light's accent is too light to be text — and it was four themes (five blocks), not one

`--accent: #268bd2` on Solarized Light's own light grounds measures about **3.0:1**
as text (and 2.54:1 on the selected tint) — under WCAG AA's 4.5:1 for normal-size
text. It is used as text on `.tb-btn:hover`, `.tb-btn--primary`, links and menu
selections, so this is a theme-level defect rather than any one component's.

Not caused by the 2026-09-01 UI work — that pass measured it and improved it
(2.54 → 3.00 by moving hover grounds to neutral), but cannot fix it: the value
itself is the problem.

**Fixed 2026-09-09, in tsmap** (`index.html` — these are tsmap's tokens; this entry lived here
because the measurement was taken during wmap's UI pass). Sweeping all sixteen theme variants
for `--accent` as text against every ground it is painted on found **five failing blocks** across four themes, not one:
Solarized Light 3.00:1, Solarized Dark 3.09:1 (under AA against every one of its own grounds —
the "check the other Solarized variant" note below was right), Light 4.24:1, Auto's light half
4.24:1 (a separate block inside a media query, which a `[data-theme]` sweep misses), and
Catppuccin Latte 4.42:1. Each was moved the smallest distance that clears 4.5:1 on all of its
own grounds: `#1d6ba2`, `#65addf`, `#1865b4`, `#1865b4`, `#8437e8`. tsmap's
`scripts/check-theme-contrast.mjs` (new, wired into `check:docs`) now fails the build on a
regression or a new theme that hasn't been measured.

**Original prescription (followed):** darken the accent for this theme only, the same way
`--wmap-icon-active` was set to `#1a65ca` rather than `#1a66cc` for exactly this
reason (smallest darkening that clears AA against the surface it sits on). Check
the other Solarized variant at the same time.

---

## [x] Histogram resolves `includeLimits` two different ways

`charts/histogram.ts` has two render paths and they disagree on what an *unset*
`axisPrefs.includeLimits` means:

- **Faceted (Group by active):** `axisIncludesLimits ? limitLow : undefined` —
  unset behaves as **off**.
- **Non-faceted:** `axisIncludesLimits ?? shouldIncludeLimitsByDefault(dataMin,
  dataMax, limitLow, limitHigh)` — unset derives a default **from the data**.

So the same test, with no explicit preference, can include spec limits in the
axis ungrouped and exclude them grouped — and the axis range changes under the
reader without the toggle moving.

**Fixed 2026-09-09:** the faceted branch now resolves an unset preference through
`shouldIncludeLimitsByDefault` too, over its own population (`collectTestValues` across every
group), and syncs the toggles to that same resolved value. Both branches therefore answer the
question the same way, so grouping no longer moves the axis under the reader. New
`tests/histogramAxisPrefs.test.mjs` mounts the panel both ways and asserts they agree (it fails
against the previous build).

Earlier, partial fix on 2026-09-01: the faceted branch no longer returns before
`syncAxisToggles`, so the toggles are at least visible and show the state that
branch is actually in. The underlying divergence is untouched — resolving it
means computing the faceted series' own data range and feeding it through
`shouldIncludeLimitsByDefault`, so both paths derive the same default.


---

## Two new modules from 0.27.0 have no test of their own

Found while auditing that release (2026-09-09). Neither is a defect — both are
covered indirectly — but both were extracted precisely because a *drift* between
two copies was the danger, and an indirect test cannot catch the extraction
regressing.

- **`packages/stats/connectedComponents.ts`** — 8-connected component labelling,
  extracted from inline copies in `clusterDetection.ts` and
  `patternClassification.ts`. Its own header says why it matters: the two callers
  answer the same question and reach the user as different things (a cluster
  finding on the map, a pattern classification for the lot), so a disagreement
  surfaces as a wafer that reports a cluster in one place and no pattern in the
  other. Exercised today only through both callers' tests, which pass a component
  set through several more layers of logic — so a labelling bug reaches those
  assertions diluted, or not at all. Wants direct cases: a diagonal-only chain
  (8-connected, so it IS one component), two groups touching at a corner,
  a single die, an empty set, and a large contiguous region (it is iterative
  specifically so that does not blow the stack — nothing checks that today).
- **`packages/canvas-adapter/charts/groupedBarPlot.ts`** — 254 lines, the shared
  body of the bin-cluster and test-pass-rate charts, which were "the same chart
  twice". No test names it; it is reached only when a grouped Insights view is
  rendered. Both charts' *data* builders are tested; the shared plot is not.

Neither blocks anything. Do them when next touching either file — the point of
writing them down is that "extracted, therefore safer" is only true while
something checks the extraction.

---

## Remove the exports deprecated in 0.30.0 — due in 0.31.0

Deprecated in 0.30.0 (unreleased as of 2026-09-15). `tests/deprecations.test.mjs` fails
once the changelog gains a `## [0.31.0]` heading, or `package.json` reaches 0.31.0, while any of
them is still exported — so 0.31.0 cannot be prepared with them by accident.

All 78 names registered through `deprecated()`/`deprecatedValue()` — `DEPRECATED_EXPORTS` in
`packages/renderer/deprecate.ts`, pinned to an exact list by `tests/deprecations.test.mjs` — across
the four index files: the value-gradient helpers, the chart-data builders, the low-level drawing
pipeline and the helpers exported by accident. The 0.30.0 CHANGELOG `### Deprecated` section names
them all.

To remove:
1. Delete `deprecated.ts` in core, renderer, stats and canvas-adapter, the re-export that ends each
   package's `index.ts`, and `deprecated.ts` from `scripts/check-clones.mjs`'s `SKIP`, and `packages/renderer/deprecate.ts`
   if nothing new has been deprecated through it.
2. Drop the type exports no remaining public signature references — the chart builders' types,
   `ViewOptions`, `ToCanvasOptions`, `View`'s draw-list types and the pipeline's own types.
3. `docs/api.md`: delete §7.6–7.8, §7.13, §7.15, §9, §10.3, §11 (keeping what §11 says stays), the
   builder rows in §7.16 and the deprecated rows in §10.1/§11.19; delete the guide's pipeline and
   report-builder passages;
   update `tests/export-surface.test.mjs`'s snapshot and rerun `check-api-claims --write`.
4. `CHANGELOG.md`: a `### Breaking` entry naming them all.
5. `tests/deprecations.test.mjs`: delete it, or reset it if something else is deprecated for a
   later release. Keep its "no library module imports through an index file" check.
6. The root bundle loses about 0.5 KB; lower `tests/bundle-size.test.mjs`'s threshold only
   with a dated log entry.
