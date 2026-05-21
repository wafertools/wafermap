import { buildWaferMap } from '../renderer/buildWaferMap.js';
import type { WaferMapInput, WaferMapResult } from '../renderer/buildWaferMap.js';
import { analyzeWaferMap, analyzeWaferLot } from '../stats/index.js';
import type { AnalyzeWaferMapOptions, StatsSummary, LotStatsSummary } from '../stats/index.js';

export type WorkerRequest =
  | { type: 'run'; id: number; input: WaferMapInput }
  | { type: 'analyze'; id: number; results: WaferMapResult[]; options: AnalyzeWaferMapOptions; hasMultiWafer: boolean }
  | { type: 'ping' };

export type WorkerResponse =
  | { type: 'result'; id: number; result: WaferMapResult }
  | { type: 'analyzed'; id: number; waferSummaries: StatsSummary[]; lotSummary: LotStatsSummary | null }
  | { type: 'error'; id: number; message: string }
  | { type: 'pong' };

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;

  if (msg.type === 'ping') {
    (self as unknown as Worker).postMessage({ type: 'pong' } satisfies WorkerResponse);
    return;
  }

  if (msg.type === 'run') {
    try {
      const result = buildWaferMap(msg.input);
      (self as unknown as Worker).postMessage(
        { type: 'result', id: msg.id, result } satisfies WorkerResponse,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      (self as unknown as Worker).postMessage(
        { type: 'error', id: msg.id, message } satisfies WorkerResponse,
      );
    }
  }

  if (msg.type === 'analyze') {
    try {
      const waferSummaries = msg.results.map(r => analyzeWaferMap(r, msg.options));
      const lotSummary = msg.hasMultiWafer
        ? analyzeWaferLot(msg.results, { ...msg.options, perWaferSummaries: waferSummaries })
        : null;
      (self as unknown as Worker).postMessage(
        { type: 'analyzed', id: msg.id, waferSummaries, lotSummary } satisfies WorkerResponse,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      (self as unknown as Worker).postMessage(
        { type: 'error', id: msg.id, message } satisfies WorkerResponse,
      );
    }
  }
};
