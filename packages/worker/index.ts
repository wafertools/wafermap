import type { WaferMapInput, WaferMapResult } from '../renderer/buildWaferMap.js';
import type { AnalyzeWaferMapOptions, LotStatsSummary, StatsSummary } from '../stats/index.js';
import type { WorkerRequest, WorkerResponse } from './wafermap.worker.js';

export interface WafermapWorker {
  /** Run buildWaferMap in the worker thread. Returns a promise that resolves with the result. */
  run(input: WaferMapInput): Promise<WaferMapResult>;
  /** Run analyzeWaferMap (and optionally analyzeWaferLot) in the worker thread. */
  runAnalysis(
    results: WaferMapResult[],
    options: AnalyzeWaferMapOptions,
    hasMultiWafer: boolean,
  ): Promise<{ waferSummaries: StatsSummary[]; lotSummary: LotStatsSummary | null }>;
  /**
   * Build and analyse in a single round-trip. The built `WaferMapResult`s stay
   * in the worker for analysis instead of being sent out and cloned back in, so
   * the large result objects cross the worker boundary only once (out), not three
   * times. Prefer this over `run` + `runAnalysis` when you need both.
   */
  runWithAnalysis(
    inputs: WaferMapInput[],
    options: AnalyzeWaferMapOptions,
    hasMultiWafer: boolean,
  ): Promise<{ results: WaferMapResult[]; waferSummaries: StatsSummary[]; lotSummary: LotStatsSummary | null }>;
  /** Terminate the underlying Worker. Call when the worker is no longer needed. */
  terminate(): void;
}

/**
 * Creates a wrapper around a `wafermap.worker.js` Web Worker.
 *
 * Pass the worker URL (or a pre-constructed Worker instance) — the worker
 * script must be the compiled `wafermap.worker.js` served from your build
 * output.
 *
 * @example
 * // With a bundler (Vite, webpack…)
 * import workerUrl from 'wafermap/worker?url';
 * const worker = createWafermapWorker(new Worker(workerUrl, { type: 'module' }));
 *
 * @example
 * // Plain script tag / CDN
 * const worker = createWafermapWorker(
 *   new Worker('/dist/wafermap.worker.js', { type: 'module' })
 * );
 */
export function createWafermapWorker(worker: Worker): WafermapWorker {
  let nextId = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pending = new Map<number, { resolve: (r: any) => void; reject: (e: Error) => void }>();

  worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
    const msg = ev.data;
    if (msg.type === 'pong') return;
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.type === 'error') {
      entry.reject(new Error(msg.message));
    } else if (msg.type === 'result') {
      entry.resolve(msg.result);
    } else if (msg.type === 'analyzed') {
      entry.resolve({ waferSummaries: msg.waferSummaries, lotSummary: msg.lotSummary });
    } else if (msg.type === 'resultWithAnalysis') {
      entry.resolve({ results: msg.results, waferSummaries: msg.waferSummaries, lotSummary: msg.lotSummary });
    }
  };

  worker.onerror = (ev) => {
    const err = new Error(ev.message ?? 'Worker error');
    for (const entry of pending.values()) entry.reject(err);
    pending.clear();
  };

  return {
    run(input: WaferMapInput): Promise<WaferMapResult> {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        worker.postMessage({ type: 'run', id, input } satisfies WorkerRequest);
      });
    },
    runAnalysis(
      results: WaferMapResult[],
      options: AnalyzeWaferMapOptions,
      hasMultiWafer: boolean,
    ): Promise<{ waferSummaries: StatsSummary[]; lotSummary: LotStatsSummary | null }> {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        worker.postMessage({ type: 'analyze', id, results, options, hasMultiWafer } satisfies WorkerRequest);
      });
    },
    runWithAnalysis(
      inputs: WaferMapInput[],
      options: AnalyzeWaferMapOptions,
      hasMultiWafer: boolean,
    ): Promise<{ results: WaferMapResult[]; waferSummaries: StatsSummary[]; lotSummary: LotStatsSummary | null }> {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        worker.postMessage({ type: 'runWithAnalysis', id, inputs, options, hasMultiWafer } satisfies WorkerRequest);
      });
    },
    terminate() {
      worker.terminate();
      const err = new Error('Worker terminated');
      for (const entry of pending.values()) entry.reject(err);
      pending.clear();
    },
  };
}
