# Troubleshooting

Common mistakes and how to fix them.

---

## Map renders as an empty grey circle

**Cause:** Die coordinates from a CSV parser are strings, not numbers. The library matches data to the die grid by integer position — string `"5"` does not match integer `5`, so no dies get filled.

**Fix:** Cast every numeric field with `+` or `Number()` before passing to `buildWaferMap`:

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

**How to confirm:** check `result.dataCoverage.filledDies`. If it is `0` with non-empty input, coordinates are not matching.

---

## Yield shows 0 % or 100 % when it should not

**Cause:** `passBins` defaults to `[1]`, but your test program uses a different bin for pass (e.g. bin `0`, or multiple bins).

**Fix:** pass the correct `passBins` everywhere it matters — `buildWaferMap`, `analyzeWaferMap`, and `renderWaferMap`:

```ts
const PASS = [1, 2]; // your actual passing bins

const result  = buildWaferMap({ results, passBins: PASS });
const summary = analyzeWaferMap(result, { passBins: PASS });

renderWaferMap(container, result, {
  passBins: PASS,        // summary panel yield label
  statsSummary: summary,
});
```

**How to confirm:** `result.yield.passDies` and `result.yield.failDies` reflect whatever `passBins` was passed to `buildWaferMap`. If the numbers look wrong, check that value first.

---

## Stacked plot modes missing from the toolbar

**Cause:** `stackedValues`, `stackedBins`, and `stackedSoftBins` only appear in the toolbar when `view.isLotStack` is `true`. This flag is only set when `lotStack` was passed to `buildWaferMap` — it is not set when you call `aggregateValues` manually and feed the result to a single-wafer `buildWaferMap`.

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

## `window is not defined` or `document is not defined` on the server

**Cause:** `renderWaferMap` (and `toCanvas`) require a browser DOM. They will throw if called during SSR in Next.js, Nuxt, SvelteKit, or Remix.

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

## Further reading

- [API Reference](API.md)
- [Developer Guide](GUIDE.md)
- [Quick Start](QUICKSTART.md)
