# Using wafermap in React

This guide is for developers integrating `wafermap` into a TypeScript + React application.

## Install

```bash
npm install @wafertools/wafermap
```

## What each side owns

Your React app owns: fetching data, UI state, component lifecycle, mount and cleanup.

`wafermap` owns: wafer geometry, die generation, data mapping, and canvas rendering.

## Recommended flow

1. Load your test data — rows with `x`, `y` (die grid positions), `hbin`, `sbin`, `testValues`
2. Call `buildWaferMap()` **outside** the render cycle — in a loader, `useMemo`, or data-fetching hook
3. Call `renderWaferMap()` inside a `useEffect` — it is DOM-only and must never run during SSR or in the render body
4. Always call `ctrl.destroy()` in the `useEffect` cleanup to release canvas resources

`x` and `y` in your data are **die grid positions** (prober step coordinates — integers such as −7, 0, 5), not millimetre values. Pass `dieConfig: { width, height }` in mm to supply physical die dimensions; omit it and the library estimates them from the grid layout.

## Key rules

- `renderWaferMap` is **DOM-only** — call it inside `useEffect`, never in the render body or on the server
- It returns a controller; always call `.destroy()` in the cleanup to prevent resource leaks
- Stabilise options objects with `useMemo` (or define them outside the component) so reference changes do not cause spurious re-mounts
- Run `buildWaferMap` outside the component where possible — it is pure and can run in a loader, `queryFn`, or top-level `useMemo`

## Minimal single-map component

`renderWaferMap` creates and manages its own `<canvas>` — pass a plain `<div>` sized to the desired display area:

```tsx
import { useEffect, useRef, useMemo } from 'react';
import { buildWaferMap, type DieResult } from '@wafertools/wafermap';
import { renderWaferMap, type WaferViewOptions } from '@wafertools/wafermap/render';

interface WaferMapProps {
  rows: DieResult[];
  plotMode?: WaferViewOptions['plotMode'];
}

export function WaferMap({ rows, plotMode = 'hardBin' }: WaferMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Pure — run outside the effect so the result is stable when data doesn't change.
  const result = useMemo(
    () => buildWaferMap({ results: rows }),
    [rows],
  );

  // Stabilise so a new object on every render doesn't re-mount the canvas.
  const viewOptions = useMemo<Partial<WaferViewOptions>>(
    () => ({ plotMode }),
    [plotMode],
  );

  useEffect(() => {
    if (!containerRef.current) return;
    const ctrl = renderWaferMap(containerRef.current, result, { viewOptions });
    return () => ctrl.destroy();
  }, [result, viewOptions]);

  return <div ref={containerRef} style={{ width: '100%', aspectRatio: '1' }} />;
}
```

## Updating options without remounting

Hold the controller in a ref and call `ctrl.setOptions()` to update display options cheaply without tearing down the canvas:

```tsx
export function WaferMap({ rows, plotMode = 'hardBin' }: WaferMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<ReturnType<typeof renderWaferMap> | null>(null);

  const result = useMemo(
    () => buildWaferMap({ results: rows }),
    [rows],
  );

  // Mount once when the underlying data changes.
  useEffect(() => {
    if (!containerRef.current) return;
    ctrlRef.current?.destroy();
    ctrlRef.current = renderWaferMap(containerRef.current, result);
    return () => { ctrlRef.current?.destroy(); ctrlRef.current = null; };
  }, [result]);

  // Re-render cheaply when only display options change.
  useEffect(() => {
    ctrlRef.current?.setOptions({ plotMode });
  }, [plotMode]);

  return <div ref={containerRef} style={{ width: '100%', aspectRatio: '1' }} />;
}
```

## Gallery component

Pass an array of `WaferMapDisplayItem` objects — each is a `WaferMapResult` with an optional `label` and per-card callbacks spread in:

```tsx
import { useEffect, useRef, useMemo } from 'react';
import { buildWaferMap, type DieResult } from '@wafertools/wafermap';
import { renderWaferGallery, type WaferMapDisplayItem } from '@wafertools/wafermap/render';

interface WaferGalleryProps {
  datasets: { label: string; rows: DieResult[] }[];
}

export function WaferGallery({ datasets }: WaferGalleryProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const items = useMemo<WaferMapDisplayItem[]>(
    () => datasets.map(({ label, rows }) => ({
      ...buildWaferMap({ results: rows }),
      label,
    })),
    [datasets],
  );

  useEffect(() => {
    if (!containerRef.current) return;
    const ctrl = renderWaferGallery(containerRef.current, items);
    return () => ctrl.destroy();
  }, [items]);

  return <div ref={containerRef} />;
}
```

## Large galleries — factory functions

For large lots, pass factory functions instead of pre-built items. The gallery inserts placeholder cards immediately and calls each factory in a deferred browser task, keeping the page responsive:

```tsx
import { renderWaferGallery, type WaferMapDisplayItemFactory } from '@wafertools/wafermap/render';

const items = datasets.map(({ label, rows }): WaferMapDisplayItemFactory => () => ({
  ...buildWaferMap({ results: rows }),
  label,
}));

// In useEffect:
const ctrl = renderWaferGallery(containerRef.current, items);
```

## Adding statistical findings

`analyzeWaferMap` is a pure function — run it alongside `buildWaferMap` and pass the result to `renderWaferMap`. A **Summary** button appears in the toolbar automatically; no extra HTML needed.

```tsx
import { buildWaferMap, type DieResult } from '@wafertools/wafermap';
import { analyzeWaferMap } from '@wafertools/wafermap/stats';
import { renderWaferMap } from '@wafertools/wafermap/render';

export function WaferMap({ rows }: { rows: DieResult[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  const result = useMemo(() => buildWaferMap({ results: rows }), [rows]);
  const summary = useMemo(() => analyzeWaferMap(result), [result]);

  useEffect(() => {
    if (!containerRef.current) return;
    const ctrl = renderWaferMap(containerRef.current, result, {
      statsSummary: summary,
    });
    return () => ctrl.destroy();
  }, [result, summary]);

  return <div ref={containerRef} style={{ width: '100%', aspectRatio: '1' }} />;
}
```

To show a persistent Summary panel instead of the toolbar button, add a `summaryPanel` option:

```tsx
renderWaferMap(containerRef.current, result, {
  statsSummary: summary,
  summaryPanel: { placement: 'right' },
});
```

## Running buildWaferMap in a loader

For React Router or TanStack Router, run `buildWaferMap` in the route loader so the result is ready before the component mounts:

```ts
// loader.ts
import { buildWaferMap } from '@wafertools/wafermap';

export async function loader() {
  const rows = await fetchWaferData();
  return buildWaferMap({ results: rows }); // pure — no DOM, safe on the server
}
```

The component receives the full `WaferMapResult` as loader data and passes it straight to `renderWaferMap` inside `useEffect`.

## Notes

- **SSR / Next.js / Remix**: `renderWaferMap` requires the DOM. Gate it with `useEffect` or a dynamic import with `{ ssr: false }`. `buildWaferMap` is pure and safe to call on the server.
- **Never** reconstruct options objects inline in JSX (`viewOptions={{ plotMode }}`); use `useMemo` so the reference is stable and effects don't re-run every render.
- `buildWaferMap` has no DOM dependency — it is safe to call in a Web Worker, server loader, or React Query `queryFn`.

## Further reading

- [API reference](api.md)
- [Statistical findings](examples/findings.html)
- [Lot gallery](examples/gallery.html)
- [Web Worker](examples/worker.html)
