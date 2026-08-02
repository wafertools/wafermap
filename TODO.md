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
