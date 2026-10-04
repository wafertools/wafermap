# API Reference — Web Worker

**Part of the [API Reference](../api.md).**

## 8 Web Worker

`buildWaferMap` and the analysis functions can be moved off the main thread so a
large build does not freeze the UI.  The `@wafertools/wafermap/worker` subpackage
provides a thin wrapper around a pre-built worker script.

**The worker is a responsiveness tool, not a speed tool.** It runs the *same* code as
the main thread, plus the cost of moving data across `postMessage`. The input is copied
into the worker. On the way back, the built maps' test values are *transferred* (moved,
not copied) and only the die objects are copied. So in total wall-clock time the worker
is **always slower** than calling `buildWaferMap` directly. What you buy is that the page
stays interactive while it works.

**Pass results as columns if you already have them** (`DieColumns`, §4.1.1). Copying typed
columns into the worker is fast, so the page does not freeze at all. Rows are copied one
object at a time, and that copy runs on the page: with rows the worker still freezes the
page for about half as long as doing the work there.

**When to use it:** only when a *single synchronous build would block the UI long
enough to notice*: roughly tens of thousands of dies, or many wafers built in one
batch. Indicative figures for build + analysis of one wafer, three tests, the worker
created once and reused (Chrome; they vary by machine and data):

| dies per wafer | input | on the main thread (page frozen) | worker, total | worker, longest page freeze |
|---|---|---|---|---|
| ~440 | rows or columns | ~15 ms | ~16–25 ms | none: don't use the worker |
| ~20,000 | rows | ~140 ms | ~300 ms | ~75 ms |
| ~20,000 | columns | ~80 ms | ~140 ms | under 50 ms |
| ~50,000 | rows | ~330 ms | ~740 ms | ~170 ms |
| ~50,000 | columns | ~190 ms | ~300 ms | under 50 ms |

Below a few thousand dies the build is fast enough that the worker only adds
latency. Don't reach for it by default. `renderWaferMap` always runs on the main
thread regardless.

**If you need both the result and its analysis, use `runWithAnalysis` (§8.4), not
`run` followed by `runAnalysis`.** `runAnalysis` copies the results you pass back into
the worker, test values included, so the combination moves each map three times
instead of once.

### 8.1 Setup

```ts
import { createWafermapWorker } from '@wafertools/wafermap/worker';

// Bundler (Vite, webpack…) — import the worker script URL
import workerUrl from '@wafertools/wafermap/worker-script?url';
const worker = createWafermapWorker(new Worker(workerUrl, { type: 'module' }));

// Plain HTML / CDN
const worker = createWafermapWorker(
  new Worker('https://cdn.jsdelivr.net/npm/@wafertools/wafermap/dist/packages/worker/wafermap.worker.js', { type: 'module' })
);
```

Create the worker once and reuse it for all calls.

### 8.2 `createWafermapWorker(worker)`

```ts
createWafermapWorker(worker: Worker): WafermapWorker
```

Returns a `WafermapWorker`:

```ts
// WafermapWorker
{
  run(input: WaferMapInput): Promise<WaferMapResult>
  runAnalysis(
    results: WaferMapResult[],
    options: AnalyzeWaferMapOptions,
    hasMultiWafer: boolean,
  ): Promise<{ waferSummaries: StatsSummary[]; lotSummary: LotStatsSummary | null }>
  runWithAnalysis(
    inputs: WaferMapInput[],
    options: AnalyzeWaferMapOptions,
    hasMultiWafer: boolean,
  ): Promise<{ results: WaferMapResult[]; waferSummaries: StatsSummary[]; lotSummary: LotStatsSummary | null }>
  terminate(): void
}
```

`WaferMapInput` → §4.1 · `WaferMapResult` → §4.2

### 8.3 `worker.run(input)`

```ts
worker.run(input: WaferMapInput): Promise<WaferMapResult>
```

`WaferMapInput` → §4.1 · `WaferMapResult` → §4.2

Identical input and output to `buildWaferMap` — just async.

```ts
// Replaces:
const result = buildWaferMap({ results, waferConfig, dieConfig });

// With:
const result = await worker.run({ results, waferConfig, dieConfig });

// Everything after is unchanged:
renderWaferMap(container, result);
```

Multiple concurrent calls are safe — each resolves independently.  Run wafers in parallel with `Promise.all`:

```ts
const waferResults = await Promise.all(
  waferIds.map(id => worker.run({ results: dataByWafer[id], dieConfig }))
);
```

### 8.4 `worker.runWithAnalysis(inputs, options, hasMultiWafer)`

```ts
worker.runWithAnalysis(
  inputs: WaferMapInput[],
  options: AnalyzeWaferMapOptions,
  hasMultiWafer: boolean,
): Promise<{ results: WaferMapResult[]; waferSummaries: StatsSummary[]; lotSummary: LotStatsSummary | null }>
```

Builds **and** analyses in a single round-trip. The built `WaferMapResult`s are
analysed inside the worker and never sent out just to be sent back, so the large
result objects cross the worker boundary only once. Prefer this whenever you need
both the maps and their statistics — it avoids two extra structured-clone copies
per wafer compared with `run` + `runAnalysis`.

```ts
const { results, waferSummaries, lotSummary } = await worker.runWithAnalysis(
  waferIds.map(id => ({ results: dataByWafer[id], dieConfig, passBins: [1] })),
  {},
  waferIds.length > 1,
);
results.forEach((result, i) =>
  renderWaferMap(containers[i], result, { statsSummary: waferSummaries[i] }));
```

`AnalyzeWaferMapOptions` → §7.3 · `StatsSummary` → §7.4 · `LotStatsSummary` → §7.5

### 8.5 `worker.terminate()`

```ts
worker.terminate(): void
```

Shuts down the underlying worker.  Any in-flight calls reject immediately.

---
