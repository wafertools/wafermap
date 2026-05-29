# Using wafermap in SvelteKit

This guide is for a developer who wants to try `wafermap` inside a TypeScript + SvelteKit application.

## Install

```bash
npm install @paulrobins/wafermap
```

For local testing from a checkout:

```bash
npm install ../path/to/wafermap
```

## What each side owns

Your SvelteKit app owns: fetching or loading wafer data, UI state, Svelte component lifecycle, mounting and cleanup of the canvas renderer.

`wafermap` owns: wafer geometry, die generation, data-to-die mapping, and interactive canvas rendering.

## Recommended flow

1. Load your test data — rows with `x`, `y` (die grid positions), `hbin`, `sbin`, `testValues`
2. Call `buildWaferMap({ results, waferConfig?, dieConfig? })` — handles geometry automatically
3. Render with `renderWaferMap(...)` inside `onMount`
4. Use `renderWaferGallery(...)` inside `onMount` when you need a multi-wafer gallery

`x` and `y` in your data are **die grid positions** (prober step coordinates — integers like −7, 0, 5), not millimetre values. Pass `dieConfig: { width, height }` in mm to supply physical die dimensions; omit it and the library estimates them from the grid layout.

## Minimal single-map component

`renderWaferMap` creates and manages its own `<canvas>` — pass a plain `<div>` sized to the desired display area:

```svelte
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { buildWaferMap, type DieResult } from '@paulrobins/wafermap';
  import { renderWaferMap, type WaferMapController } from '@paulrobins/wafermap/render';

  export let rows: DieResult[] = [];

  let host: HTMLDivElement | null = null;
  let ctrl: WaferMapController | null = null;

  onMount(() => {
    if (!host) return;
    const result = buildWaferMap({ results: rows });
    ctrl = renderWaferMap(host, result, {
      viewOptions: { plotMode: 'hardBin' },
    });
  });

  onDestroy(() => ctrl?.destroy());
</script>

<div bind:this={host} style="width: 100%; aspect-ratio: 1" />
```

## Updating options without remounting

Hold the controller and call `ctrl.setOptions()` to update display options without tearing down the canvas:

```svelte
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { buildWaferMap, type DieResult } from '@paulrobins/wafermap';
  import { renderWaferMap, type WaferMapController, type WaferViewOptions } from '@paulrobins/wafermap/render';

  export let rows: DieResult[] = [];
  export let plotMode: WaferViewOptions['plotMode'] = 'hardBin';

  let host: HTMLDivElement | null = null;
  let ctrl: WaferMapController | null = null;

  onMount(() => {
    if (!host) return;
    const result = buildWaferMap({ results: rows });
    ctrl = renderWaferMap(host, result, { viewOptions: { plotMode } });
  });

  onDestroy(() => ctrl?.destroy());

  // React to prop changes without remounting
  $: ctrl?.setOptions({ plotMode });
</script>

<div bind:this={host} style="width: 100%; aspect-ratio: 1" />
```

## Gallery component

Pass an array of results (or factory functions for large lots) to render a card grid with shared controls:

```svelte
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { buildWaferMap, type DieResult } from '@paulrobins/wafermap';
  import { renderWaferGallery, type GalleryController, type WaferMapDisplayItemFactory } from '@paulrobins/wafermap/render';

  export let wafers: Array<{ label: string; rows: DieResult[] }> = [];

  let host: HTMLDivElement | null = null;
  let ctrl: GalleryController | null = null;

  onMount(() => {
    if (!host) return;
    // Factory functions keep the page responsive — each card is built in a
    // deferred task so the gallery shell appears immediately.
    const factories: WaferMapDisplayItemFactory[] = wafers.map((w) => () => ({
      ...buildWaferMap({ results: w.rows }),
      label: w.label,
    }));
    ctrl = renderWaferGallery(host, factories);
  });

  onDestroy(() => ctrl?.destroy());
</script>

<div bind:this={host} />
```

## Adding statistical findings

`analyzeWaferMap` is a pure function — run it alongside `buildWaferMap` and pass the result to `renderWaferMap`. A **Findings** button appears in the toolbar automatically.

```svelte
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { buildWaferMap, type DieResult } from '@paulrobins/wafermap';
  import { analyzeWaferMap } from '@paulrobins/wafermap/stats';
  import { renderWaferMap, type WaferMapController } from '@paulrobins/wafermap/render';

  export let rows: DieResult[] = [];

  let host: HTMLDivElement | null = null;
  let ctrl: WaferMapController | null = null;

  onMount(() => {
    if (!host) return;
    const result  = buildWaferMap({ results: rows });
    const summary = analyzeWaferMap(result);
    ctrl = renderWaferMap(host, result, { statsSummary: summary });
  });

  onDestroy(() => ctrl?.destroy());
</script>

<div bind:this={host} style="width: 100%; aspect-ratio: 1" />
```

To show a persistent summary panel instead of the toolbar button, add a `summaryPanel` option:

```ts
ctrl = renderWaferMap(host, result, {
  statsSummary: summary,
  summaryPanel: { placement: 'right' },
});
```

## Notes for SvelteKit

- `renderWaferMap` requires the DOM — always call it inside `onMount`, never at the top level of `<script>`, which runs during SSR
- `buildWaferMap` and `analyzeWaferMap` are pure functions with no DOM dependency — safe to call in a `+page.server.ts` load function or a Svelte store
- Call `ctrl.destroy()` in `onDestroy` so the canvas resources are released when the component unmounts

## Reference files

- [API reference](api.md)
- [Your first wafer map](examples/01-first-map.html)
- [CSV loading demo](examples/03-csv-data.html)
- [Statistical findings](examples/10-findings.html)
- [Lot gallery](examples/12-gallery.html)
- [Web Worker](examples/15-worker.html)
- [Troubleshooting](troubleshooting.md)
