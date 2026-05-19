# Using wafermap in React

This guide is for developers integrating `wafermap` into a TypeScript + React application.

## Install

```bash
npm install @paulrobins/wafermap
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

- `renderWaferMap` and `renderWaferGallery` are **DOM-only** — call them inside `useEffect`, never in the render body or on the server
- Both renderers return a controller; always call `.destroy()` in the cleanup to prevent resource leaks
- Stabilise options objects with `useMemo` (or define them outside the component) so reference changes do not cause spurious re-mounts
- Run `buildWaferMap` outside the component where possible — it is pure and can run in a loader, `queryFn`, or top-level `useMemo`

## Minimal single-map component

```tsx
import { useEffect, useRef, useMemo } from 'react';
import { buildWaferMap, type DieResult } from '@paulrobins/wafermap';
import { renderWaferMap, type WaferSceneOptions } from '@paulrobins/wafermap/canvas-adapter';

interface WaferMapProps {
  rows: DieResult[];
  plotMode?: WaferSceneOptions['plotMode'];
}

export function WaferMap({ rows, plotMode = 'hardBin' }: WaferMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Pure — run outside the effect so the result is stable when data doesn't change.
  const { wafer, dies } = useMemo(
    () => buildWaferMap({ results: rows }),
    [rows],
  );

  // Stabilise so a new object on every render doesn't re-mount the canvas.
  const sceneOptions = useMemo<Partial<WaferSceneOptions>>(
    () => ({ plotMode }),
    [plotMode],
  );

  useEffect(() => {
    if (!canvasRef.current) return;
    const ctrl = renderWaferMap(canvasRef.current, wafer, dies, { sceneOptions });
    return () => ctrl.destroy();
  }, [wafer, dies, sceneOptions]);

  return <canvas ref={canvasRef} style={{ width: '100%', aspectRatio: '1' }} />;
}
```

## Updating options without remounting

Hold the controller in a ref and call `ctrl.render(newOptions)` to update cheaply without tearing down the canvas:

```tsx
export function WaferMap({ rows, plotMode = 'hardBin' }: WaferMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctrlRef  = useRef<ReturnType<typeof renderWaferMap> | null>(null);

  const { wafer, dies } = useMemo(
    () => buildWaferMap({ results: rows }),
    [rows],
  );

  // Mount once when the underlying data changes.
  useEffect(() => {
    if (!canvasRef.current) return;
    ctrlRef.current?.destroy();
    ctrlRef.current = renderWaferMap(canvasRef.current, wafer, dies);
    return () => { ctrlRef.current?.destroy(); ctrlRef.current = null; };
  }, [wafer, dies]);

  // Re-render cheaply when only display options change.
  useEffect(() => {
    ctrlRef.current?.render({ plotMode });
  }, [plotMode]);

  return <canvas ref={canvasRef} style={{ width: '100%', aspectRatio: '1' }} />;
}
```

## Gallery component

```tsx
import { useEffect, useRef, useMemo } from 'react';
import { buildWaferMap, type DieResult } from '@paulrobins/wafermap';
import { renderWaferGallery, type GalleryItem } from '@paulrobins/wafermap/canvas-adapter';

interface WaferGalleryProps {
  datasets: { label: string; rows: DieResult[] }[];
}

export function WaferGallery({ datasets }: WaferGalleryProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const items = useMemo<GalleryItem[]>(
    () => datasets.map(({ label, rows }) => {
      const { wafer, dies } = buildWaferMap({ results: rows });
      return { wafer, dies, label };
    }),
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

## Large galleries — GalleryItemFactory

For large lots, pass factory functions instead of pre-built items. The gallery inserts placeholder cards immediately and calls each factory in a deferred browser task, keeping the page responsive:

```tsx
import { renderWaferGallery, type GalleryItemFactory } from '@paulrobins/wafermap/canvas-adapter';

const items = datasets.map(({ label, rows }): GalleryItemFactory => () => {
  const { wafer, dies } = buildWaferMap({ results: rows });
  return { wafer, dies, label };
});

// In useEffect:
const ctrl = renderWaferGallery(containerRef.current, items);
```

## Running buildWaferMap in a loader

For React Router or TanStack Router, run `buildWaferMap` in the route loader so the result is ready before the component mounts:

```ts
// loader.ts
import { buildWaferMap } from '@paulrobins/wafermap';

export async function loader() {
  const rows = await fetchWaferData();
  return buildWaferMap({ results: rows }); // pure — no DOM, safe on the server
}
```

The component receives `wafer` and `dies` as loader data and passes them straight to `renderWaferMap` inside `useEffect`.

## Notes

- **SSR / Next.js / Remix**: `renderWaferMap` and `renderWaferGallery` require the DOM. Gate them with `useEffect` or a dynamic import with `{ ssr: false }`. `buildWaferMap` is pure and safe to call on the server.
- **Never** reconstruct options objects inline in JSX (`sceneOptions={{ plotMode }}`); use `useMemo` so the reference is stable and effects don't re-run every render.
- `buildWaferMap` has no DOM dependency — it is safe to call in a Web Worker, server loader, or React Query `queryFn`.

## Further reading

- [API reference](API.md)
- [Statistical findings](examples/10-findings.html)
- [Lot gallery](examples/12-gallery.html)
- [Web Worker](examples/15-worker.html)
