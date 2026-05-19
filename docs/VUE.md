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

- `renderWaferMap` and `renderWaferGallery` are **DOM-only** — call them inside `onMounted`, never in the `<script setup>` top level, which runs during SSR in Nuxt
- Both renderers return a controller; always call `.destroy()` in `onUnmounted` to prevent resource leaks
- `buildWaferMap` is pure and safe to call anywhere — a Pinia store action, a composable, or a route loader

## Minimal single-map component

```vue
<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { buildWaferMap, type DieResult } from '@paulrobins/wafermap';
import { renderWaferMap, type WaferCanvasController } from '@paulrobins/wafermap/canvas-adapter';

const props = defineProps<{ rows: DieResult[] }>();

const canvasEl = ref<HTMLCanvasElement | null>(null);
let ctrl: WaferCanvasController | null = null;

function mount() {
  if (!canvasEl.value) return;
  ctrl?.destroy();
  const { wafer, dies } = buildWaferMap({ results: props.rows });
  ctrl = renderWaferMap(canvasEl.value, wafer, dies, {
    sceneOptions: { plotMode: 'hardBin' },
  });
}

onMounted(mount);
onUnmounted(() => ctrl?.destroy());

// Full remount when the data changes.
watch(() => props.rows, mount);
</script>

<template>
  <canvas ref="canvasEl" style="width: 100%; aspect-ratio: 1" />
</template>
```

## Reacting to options changes without remounting

When only display options change (plot mode, colour scheme, rotation), call `ctrl.setOptions()` instead of remounting:

```vue
<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { buildWaferMap, type DieResult } from '@paulrobins/wafermap';
import { renderWaferMap, type WaferCanvasController, type WaferSceneOptions } from '@paulrobins/wafermap/canvas-adapter';

const props = defineProps<{
  rows: DieResult[];
  plotMode?: WaferSceneOptions['plotMode'];
}>();

const canvasEl = ref<HTMLCanvasElement | null>(null);
let ctrl: WaferCanvasController | null = null;

onMounted(() => {
  if (!canvasEl.value) return;
  const { wafer, dies } = buildWaferMap({ results: props.rows });
  ctrl = renderWaferMap(canvasEl.value, wafer, dies, {
    sceneOptions: { plotMode: props.plotMode ?? 'hardBin' },
  });
});

onUnmounted(() => ctrl?.destroy());

// Data changed — full remount.
watch(() => props.rows, () => {
  if (!canvasEl.value) return;
  ctrl?.destroy();
  const { wafer, dies } = buildWaferMap({ results: props.rows });
  ctrl = renderWaferMap(canvasEl.value, wafer, dies, {
    sceneOptions: { plotMode: props.plotMode ?? 'hardBin' },
  });
});

// Options-only change — no remount needed.
watch(() => props.plotMode, (mode) => {
  ctrl?.setOptions({ plotMode: mode ?? 'hardBin' });
});
</script>

<template>
  <canvas ref="canvasEl" style="width: 100%; aspect-ratio: 1" />
</template>
```

## Gallery component

```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { buildWaferMap, type DieResult } from '@paulrobins/wafermap';
import { renderWaferGallery, type GalleryController, type GalleryItemFactory } from '@paulrobins/wafermap/canvas-adapter';

const props = defineProps<{
  wafers: Array<{ label: string; rows: DieResult[] }>;
}>();

const containerEl = ref<HTMLDivElement | null>(null);
let ctrl: GalleryController | null = null;

onMounted(() => {
  if (!containerEl.value) return;

  // Factory functions keep the page responsive — each card is built in a
  // deferred task so the gallery shell appears immediately.
  const factories: GalleryItemFactory[] = props.wafers.map((w) => () => {
    const { wafer, dies } = buildWaferMap({ results: w.rows });
    return { wafer, dies, label: w.label };
  });

  ctrl = renderWaferGallery(containerEl.value, factories);
});

onUnmounted(() => ctrl?.destroy());
</script>

<template>
  <div ref="containerEl" />
</template>
```

Call `ctrl.setItems(newFactories)` to replace the lot after mount, or `ctrl.setOptions({ plotMode: 'value' })` to change display options across all cards without rebuilding.

## Running buildWaferMap outside the component

`buildWaferMap` has no DOM dependency — extract it to a Pinia store action, a composable, or a route loader and pass `wafer` and `dies` in as props:

```ts
// stores/wafer.ts
import { defineStore } from 'pinia';
import { buildWaferMap } from '@paulrobins/wafermap';

export const useWaferStore = defineStore('wafer', {
  state: () => ({ wafer: null, dies: [] }),
  actions: {
    async load(rows) {
      const result = buildWaferMap({ results: rows });
      this.wafer = result.wafer;
      this.dies  = result.dies;
    },
  },
});
```

## Notes for Nuxt

- Wrap the component in `<ClientOnly>` or guard with `if (import.meta.client)` — `renderWaferMap` requires the DOM and will throw during server render
- `buildWaferMap` is safe to call in a Nuxt server route or `useFetch` — only the renderer calls need to be deferred to mount

## Further reading

- [API reference](API.md)
- [Statistical findings](examples/10-findings.html)
- [Lot gallery](examples/12-gallery.html)
- [Web Worker](examples/15-worker.html)
