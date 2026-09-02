# TODO / Future Considerations

Items here are ideas or half-designed features that need more thought before implementation.

Convention (borrowed from `../tsmap/IDEAS.md`, which does this well): when an item
is done, check it off (`[x]`) and add a one-line implementation note or commit
reference rather than deleting the entry — the history of *why* something was
done the way it was is the useful part.

---

## Extract the shared screenshot harness

**Idea:** `scripts/capture-screenshots.mjs` here (706 lines) and
`../tsmap/scripts/capture-screenshots.mjs` (827 lines) are the same harness —
static file server, headless Chromium, the setup-step vocabulary, `--only` /
`--list` filtering — pointed at different apps. Only the *definitions*
(`capture-definitions.mjs`) are legitimately per-project.

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

### Chart-panel mini-toolbars still use their own button chrome, not `makeBtn`

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

## Gallery value-mode colour range is per-card when the active test has no limits

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

## Gallery metadata-mode colours can mismatch the shared legend (same root cause, no limits involved)

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

**Possible fix:** same shape as the value-range fix — compute the metadata colour map lot-wide
once in `renderWaferGallery` (it already builds `metadataValueSet` there) and pass it down to
each card's `buildView` instead of letting each card derive its own from a partial view of the
data. Note this is already bypassed correctly when a metadata field has explicit per-value
colours (`activeMetadataFieldDef.values[].color`) — only the auto-assigned ordinal-palette path
is affected.

---

## Enforce `UI_STANDARDS.md` with a lint suite, not prose

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

| Rule | Mechanically checkable |
| --- | --- |
| Type tiers (11 / 12 / 13 / 15 / 20) | yes — flag off-tier `font-size` |
| Radius roles, no literals | yes — flag `border-radius: Npx` |
| Spacing scale | yes — flag off-scale padding/gap/margin |
| Focus ring never suppressed | yes — flag `outline: none` without a documented reason nearby |
| Every interactive element reacts to hover | yes — `cursor: pointer` with no hover/`wireControlHover`/class |
| One tooltip look | yes — flag a second tooltip style block |
| Buttons use a shared class | done — `check-button-styles.mjs` (rewritten with a quote-aware scanner) |
| No icon-role colour on text (`CLR.icon*`) | partly — flag `color: CLR.icon*` outside icon elements |

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

## Decide whether the summary report is a screen or a print artefact

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

## Solarized Light's accent is too light to be text

`--accent: #268bd2` on Solarized Light's own light grounds measures about **3.0:1**
as text (and 2.54:1 on the selected tint) — under WCAG AA's 4.5:1 for normal-size
text. It is used as text on `.tb-btn:hover`, `.tb-btn--primary`, links and menu
selections, so this is a theme-level defect rather than any one component's.

Not caused by the 2026-09-01 UI work — that pass measured it and improved it
(2.54 → 3.00 by moving hover grounds to neutral), but cannot fix it: the value
itself is the problem.

The fix is to darken the accent for this theme only, the same way
`--wmap-icon-active` was set to `#1a65ca` rather than `#1a66cc` for exactly this
reason (smallest darkening that clears AA against the surface it sits on). Check
the other Solarized variant at the same time.

---

## Histogram resolves `includeLimits` two different ways

`charts/histogram.ts` has two render paths and they disagree on what an *unset*
`axisPrefs.includeLimits` means:

- **Faceted (Group by active):** `axisIncludesLimits ? limitLow : undefined` —
  unset behaves as **off**.
- **Non-faceted:** `axisIncludesLimits ?? shouldIncludeLimitsByDefault(dataMin,
  dataMax, limitLow, limitHigh)` — unset derives a default **from the data**.

So the same test, with no explicit preference, can include spec limits in the
axis ungrouped and exclude them grouped — and the axis range changes under the
reader without the toggle moving.

Fixed on 2026-09-01: the faceted branch no longer returns before
`syncAxisToggles`, so the toggles are at least visible and show the state that
branch is actually in. The underlying divergence is untouched — resolving it
means computing the faceted series' own data range and feeding it through
`shouldIncludeLimitsByDefault`, so both paths derive the same default.

