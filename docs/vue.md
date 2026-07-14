# Using wafermap in Vue 3

This guide is for developers integrating `wafermap` into a TypeScript + Vue 3 application.

## Install

```bash
npm install @paulrobins/wafermap
```

## What each side owns

Your Vue app owns: fetching data, reactive state, component lifecycle, mount and cleanup.

`wafermap` owns: wafer geometry, die generation, data mapping, and canvas rendering.

## Recommended flow

1. Load your test data — rows with `x`, `y` (die grid positions), `hbin`, `sbin`, `testValues`
2. Call `buildWaferMap()` outside or in `onMounted` — it is pure and has no DOM dependency
3. Call `renderWaferMap()` inside `onMounted` — it is DOM-only and must never run during SSR
4. Always call `ctrl.destroy()` in `onUnmounted` to release canvas resources

`x` and `y` in your data are **die grid positions** (prober step coordinates — integers such as −7, 0, 5), not millimetre values. Pass `dieConfig: { width, height }` in mm to supply physical die dimensions; omit it and the library estimates them from the grid layout.

## Key rules

- `renderWaferMap` is **DOM-only** — call it inside `onMounted`, never in the `<script setup>` top level, which runs during SSR in Nuxt
- It returns a controller; always call `.destroy()` in `onUnmounted` to prevent resource leaks
- `buildWaferMap` is pure and safe to call anywhere — a Pinia store action, a composable, or a route loader

## Minimal single-map component

`renderWaferMap` creates and manages its own `<canvas>` — pass a plain `<div>` sized to the desired display area:

```vue
<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { buildWaferMap, type DieResult } from '@paulrobins/wafermap';
import { renderWaferMap, type WaferMapController } from '@paulrobins/wafermap/render';

const props = defineProps<{ rows: DieResult[] }>();

const containerEl = ref<HTMLDivElement | null>(null);
let ctrl: WaferMapController | null = null;

function mount() {
  if (!containerEl.value) return;
  ctrl?.destroy();
  const result = buildWaferMap({ results: props.rows });
  ctrl = renderWaferMap(containerEl.value, result, {
    viewOptions: { plotMode: 'hardBin' },
  });
}

onMounted(mount);
onUnmounted(() => ctrl?.destroy());

// Full remount when the data changes.
watch(() => props.rows, mount);
</script>

<template>
  <div ref="containerEl" style="width: 100%; aspect-ratio: 1" />
</template>
```

## Reacting to options changes without remounting

When only display options change (plot mode, colour scheme, rotation), call `ctrl.setOptions()` instead of remounting:

```vue
<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { buildWaferMap, type DieResult } from '@paulrobins/wafermap';
import { renderWaferMap, type WaferMapController, type WaferViewOptions } from '@paulrobins/wafermap/render';

const props = defineProps<{
  rows: DieResult[];
  plotMode?: WaferViewOptions['plotMode'];
}>();

const containerEl = ref<HTMLDivElement | null>(null);
let ctrl: WaferMapController | null = null;

onMounted(() => {
  if (!containerEl.value) return;
  const result = buildWaferMap({ results: props.rows });
  ctrl = renderWaferMap(containerEl.value, result, {
    viewOptions: { plotMode: props.plotMode ?? 'hardBin' },
  });
});

onUnmounted(() => ctrl?.destroy());

// Data changed — full remount.
watch(() => props.rows, () => {
  if (!containerEl.value) return;
  ctrl?.destroy();
  const result = buildWaferMap({ results: props.rows });
  ctrl = renderWaferMap(containerEl.value, result, {
    viewOptions: { plotMode: props.plotMode ?? 'hardBin' },
  });
});

// Options-only change — no remount needed.
watch(() => props.plotMode, (mode) => {
  ctrl?.setOptions({ plotMode: mode ?? 'hardBin' });
});
</script>

<template>
  <div ref="containerEl" style="width: 100%; aspect-ratio: 1" />
</template>
```

## Gallery component

Pass an array of `WaferMapDisplayItem` objects — each is a `WaferMapResult` with an optional `label` and per-card callbacks spread in. Factory functions keep the page responsive by building each card in a deferred task:

```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { buildWaferMap, type DieResult } from '@paulrobins/wafermap';
import { renderWaferGallery, type GalleryController, type WaferMapDisplayItemFactory } from '@paulrobins/wafermap/render';

const props = defineProps<{
  wafers: Array<{ label: string; rows: DieResult[] }>;
}>();

const containerEl = ref<HTMLDivElement | null>(null);
let ctrl: GalleryController | null = null;

onMounted(() => {
  if (!containerEl.value) return;

  // Factory functions keep the page responsive — each card is built in a
  // deferred task so the gallery shell appears immediately.
  const factories: WaferMapDisplayItemFactory[] = props.wafers.map((w) => () => ({
    ...buildWaferMap({ results: w.rows }),
    label: w.label,
  }));

  ctrl = renderWaferGallery(containerEl.value, factories);
});

onUnmounted(() => ctrl?.destroy());
</script>

<template>
  <div ref="containerEl" />
</template>
```

Call `ctrl.setItems(newFactories)` to replace the lot after mount, or `ctrl.setOptions({ plotMode: 'value' })` to change display options across all cards without rebuilding.

## Adding statistical findings

`analyzeWaferMap` is a pure function — run it alongside `buildWaferMap` and pass the result to `renderWaferMap`. A **Summary** button appears in the toolbar automatically.

```vue
<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { buildWaferMap, type DieResult } from '@paulrobins/wafermap';
import { analyzeWaferMap } from '@paulrobins/wafermap/stats';
import { renderWaferMap, type WaferMapController } from '@paulrobins/wafermap/render';

const props = defineProps<{ rows: DieResult[] }>();
const containerEl = ref<HTMLDivElement | null>(null);
let ctrl: WaferMapController | null = null;

onMounted(() => {
  if (!containerEl.value) return;
  const result  = buildWaferMap({ results: props.rows });
  const summary = analyzeWaferMap(result);
  ctrl = renderWaferMap(containerEl.value, result, { statsSummary: summary });
});

onUnmounted(() => ctrl?.destroy());
</script>

<template>
  <div ref="containerEl" style="width: 100%; aspect-ratio: 1" />
</template>
```

To show a persistent Summary panel instead of the toolbar button, add a `summaryPanel` option:

```ts
ctrl = renderWaferMap(containerEl.value, result, {
  statsSummary: summary,
  summaryPanel: { placement: 'right' },
});
```

## Running buildWaferMap outside the component

`buildWaferMap` has no DOM dependency — extract it to a Pinia store action, a composable, or a route loader and pass the result in as a prop:

```ts
// stores/wafer.ts
import { defineStore } from 'pinia';
import { buildWaferMap, type WaferMapResult } from '@paulrobins/wafermap';

export const useWaferStore = defineStore('wafer', {
  state: () => ({ result: null as WaferMapResult | null }),
  actions: {
    async load(rows) {
      this.result = buildWaferMap({ results: rows });
    },
  },
});
```

## Notes for Nuxt

- Wrap the component in `<ClientOnly>` or guard with `if (import.meta.client)` — `renderWaferMap` requires the DOM and will throw during server render
- `buildWaferMap` is safe to call in a Nuxt server route or `useFetch` — only the renderer calls need to be deferred to mount

## Further reading

- [API reference](api.md)
- [Statistical findings](examples/findings.html)
- [Lot gallery](examples/gallery.html)
- [Web Worker](examples/worker.html)
