# Troubleshooting

**For:** developers integrating the library. Common mistakes and how to fix them.

---

## Bins or test values from a CSV are strings

**Cause:** a CSV parser gives every field as a string. String **coordinates** make `buildWaferMap` throw (`x and y must be numbers, received strings`). String **bins and test values** are not converted: a bin of `"1"` is not the pass bin `1`, so those dies read as fails and yield is wrong, and a test value of `"0.5"` is not a number to colour or analyse. Since 0.30.1 the map reports this as an `input-values-not-numbers` warning — a red ⛔ in the toolbar and an entry in `result.warnings` — counting each kind.

**Fix:** cast every numeric field with `+` or `Number()` before passing it to `buildWaferMap`:

```ts
buildWaferMap({
  results: rows.map(r => ({
    x:    +r.x,
    y:    +r.y,
    hbin: +r.hbin,
    testValues: { 1010: +r.testA },
  })),
});
```

**How to confirm:** look for `input-values-not-numbers` in `result.warnings`, or check `typeof result.dies[0].hbin` — it should be `'number'`.

---

## Map is blank, invisible, or the wrong height

**Cause:** `renderWaferMap` *fills its container* — the canvas is sized `width: 100%; height: 100%`. Width comes from normal document flow for free, but **height does not**: a container with no resolved height gives the canvas no height to fill. A plain block `<div>` in document flow is fine (it grows to the map), but a flex or grid child whose ancestors never resolve a height collapses to zero, and the map is invisible. When this happens the library logs:

> `[wafermap] The map container has zero height, so the map cannot render…`

**Fix — give the container a resolved height, any one of:**

```ts
// 1. Let the library size it (simplest — no container CSS needed):
renderWaferMap(container, result, { height: 600 }); // px, or '70vh', etc.
```

```css
/* 2. Explicit CSS height on the container: */
#map { height: 600px; }

/* 3. A height-resolved flex/grid parent: */
.parent { display: flex; height: 100vh; }
.parent > #map { flex: 1; min-height: 0; }

/* 4. Absolute fill of a positioned ancestor: */
#map { position: absolute; inset: 0; }
```

The same applies to `renderWaferGallery`, except the gallery is a scrolling card grid: each card has its own height, so it flows downward and scrolls rather than collapsing — but its scroll area still needs a height-resolved parent to be bounded.

**How to confirm:** in DevTools, inspect the container element — if its computed height is `0`, that is the problem, not the data.

---

## Yield shows 0 % or 100 % when it should not

**Cause:** `passBins` defaults to `[1]`, but your test program uses a different bin for pass (e.g. bin `0`, or multiple bins).

**Fix:** pass the correct `passBins` to `buildWaferMap` — the only place they are set. The result carries
them, and `analyzeWaferMap`, `renderWaferMap` and `renderWaferGallery` read them from it:

```ts
const PASS = [1, 2]; // your actual passing bins

const result  = buildWaferMap({ results, passBins: PASS });
const summary = analyzeWaferMap(result);

renderWaferMap(container, result, { statsSummary: summary });
```

**How to confirm:** `result.yield.passDies` and `result.yield.failDies` reflect whatever `passBins` was passed to `buildWaferMap`. If the numbers look wrong, check that value first.

---

## Stacked plot modes missing from the toolbar

**Cause:** `stackedValues`, `stackedBins`, and `stackedSoftBins` only appear in the toolbar when `result.isLotStack` is `true`. This flag is only set when `lotStack` was passed to `buildWaferMap` — it is not set when you call `aggregateValues` manually and feed the result to a single-wafer `buildWaferMap`.

**Fix:** use the `lotStack` input:

```ts
// Correct — toolbar shows stacked modes
const result = buildWaferMap({
  lotStack: {
    results: [wafer1Rows, wafer2Rows, wafer3Rows],
    method:  'mean',
  },
  waferConfig: { diameter: 300 },
  dieConfig:   { width: 10, height: 10 },
});
```

---

## No statistical findings appear, and nothing errors

**Cause:** `analyzeWaferMap` skips test-value analysis entirely when the die data
contains more than 250 distinct tests. It returns **no test findings at all** rather
than a trimmed set, and nothing throws — so an empty findings list looks identical to
"this wafer is unremarkable". This bites when a data source hands you a full
parametric test program and only a handful of tests are ever displayed.

**Diagnosis:** check the warning, don't infer it from the silence.

```ts
const summary = analyzeWaferMap(result, { enableTestValueAnalysis: true });
const capped = summary.stats.warnings?.find(w => w.code === 'test-count-capped');
if (capped) console.warn(capped.message);
```

From 0.22.0 the renderers show this themselves — a ⚠ appears in the toolbar and names
the reason, so you do not have to have thought to check.

**Fix:** scope the analysis to the tests you actually display.

```ts
const summary = analyzeWaferMap(result, {
  enableTestValueAnalysis: true,
  testNumbers: [1050, 1060, 1070],   // only these are analysed
});
```

Better still, filter `testDefs` before `buildWaferMap` — the cost of the whole
pipeline scales with test count, and test correlation scales quadratically. See
[Performance](performance.md#only-pass-the-tests-youll-actually-use).

---

## The map looks right but the dies are in the wrong place

**Cause:** geometry was inferred, and inference cannot tell a small full wafer from a
slice of a large one. With partial coverage the diameter and centre are both guesses,
so every die can be misplaced relative to the true wafer boundary.

**Diagnosis:** `result.warnings` carries a structured advisory, and from 0.22.0 the
toolbar shows a red ⚠ for it — geometry advisories are severity `'error'` precisely
because they mean the picture may be wrong, not merely incomplete.

```ts
for (const w of result.warnings) console.warn(w.code, w.message);
// 'partial-coverage' | 'geometry-conflict' | 'non-standard-diameter'
```

**Fix:** supply what is being guessed — `dieConfig.width`/`height` always, plus
`waferConfig.diameter` and `waferConfig.center` for partial data. See
[Guide: Adding die size and wafer geometry](guide.md#adding-die-size-and-wafer-geometry).

---

## `renderWaferMap is not exported by @wafertools/wafermap`

**Cause:** the renderers are not on the root entry point. `renderWaferMap` and
`renderWaferGallery` are exported **only** from the `/render` subpath.
Depending on your bundler this surfaces as a build-time "no export named
`renderWaferMap`" error or a runtime `undefined is not a function`.

**Fix:** import them from `@wafertools/wafermap/render`.

```ts
import { buildWaferMap } from '@wafertools/wafermap';         // geometry + data
import { renderWaferMap } from '@wafertools/wafermap/render';  // the renderer
```

This split is deliberate: the root entry re-exports only the DOM-free layers (`core`,
`renderer`, `stats`) so it stays usable in Node and tree-shakeable. See §10 of the
[API reference](api.md) for the full subpath list.

---

## `window is not defined` or `document is not defined` on the server

**Cause:** `renderWaferMap` and `renderWaferGallery` require a browser DOM. They will throw if called during SSR in Next.js, Nuxt, SvelteKit, or Remix.

**Fix:** gate the renderer inside the browser lifecycle. `buildWaferMap` and `analyzeWaferMap` are pure functions with no DOM dependency — only the renderer call needs to be deferred.

=== React ===
```tsx
useEffect(() => {
  const ctrl = renderWaferMap(ref.current, result);
  return () => ctrl.destroy();
}, [result]);
```

=== Vue ===
```ts
onMounted(() => {
  ctrl = renderWaferMap(el.value, result);
});
```

=== SvelteKit ===
```ts
onMount(() => {
  ctrl = renderWaferMap(host, result);
});
```

=== Next.js ===

Use a dynamic import with `ssr: false`, or guard with `typeof window !== 'undefined'` inside a `useEffect`.

---

## Tooltips, menus, or the expand modal render behind my own modal/overlay

**Cause:** depends on how your modal is built.

- **A plain `fixed`/`absolute` overlay div** (most modal libraries, including Flowbite's default): wmap's overlays stack at a high default z-index (`6000`) specifically so this doesn't normally happen. If your modal's own z-index is higher than that, wmap's overlays lose.
- **A native `<dialog>` element shown via `.showModal()`:** the dialog is promoted into the browser's **top layer**, which paints above the *entire* normal stacking order unconditionally — no z-index, however high, lets a `document.body`-level element paint above it. This is a different mechanism from ordinary z-index stacking.

**Fix:**

- For the plain-div case, pass `zIndex` so wmap's overlays stack above your modal:

  ```ts
  // Host modal at z-index 5000; put wmap's overlays above it:
  renderWaferMap(container, result, { zIndex: 5100 });
  ```

- For the native `<dialog>` case, **no configuration is needed** — wmap detects a modally-shown `<dialog>` ancestor automatically and roots its overlays (tooltip, menus, the expand modal, the user-guide window's in-page fallback) inside it instead of `document.body`, so they land in the same top-layer subtree. If you're still seeing this on a current wmap version, confirm the element is genuinely a `<dialog>` shown via `.showModal()` (not `.show()` — a non-modal dialog never enters the top layer and doesn't need this) by checking `dialogEl.matches(':modal')` in DevTools.

**How to confirm:** in DevTools, find the tooltip/menu/modal element (search for `wmap-overlay-box` or the tooltip's inline `position: fixed` style) and check where it sits in the DOM — if it's a child of `document.body` while your own modal is a native `<dialog>` elsewhere in the tree, you're on a wmap version predating this fix.

See also: [API Reference §5.4, "Overlay z-index"](api.md#54-renderoptions) for the full stacking model.

---

## A bin or test name shows HTML tags

**Cause:** since 0.30.1, names from your data — test and bin names, units, wafer labels, metadata values — are shown as text in every tooltip, never interpreted as HTML. A file with a malicious test name could otherwise run script when someone hovered a die. A name containing markup, such as `<b>Leakage</b>`, now shows the tags literally.

**Fix:** put plain text in names. Styling belongs to the map, not the data.

---

## Further reading

- [API Reference](api.md)
- [Developer Guide](guide.md)
- [Quick Start](quickstart.md)
