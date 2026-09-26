import { buildWaferMap } from '../renderer/buildWaferMap.js';
import type { WaferMapInput, WaferMapResult } from '../renderer/buildWaferMap.js';
import { analyzeWaferMap, analyzeWaferLot } from '../stats/index.js';
import type { AnalyzeWaferMapOptions, StatsSummary, LotStatsSummary } from '../stats/index.js';
import { detachTables } from '../core/dieTable.js';
import type { DetachedTables } from '../core/dieTable.js';

export type WorkerRequest =
  | { type: 'run'; id: number; input: WaferMapInput }
  | { type: 'analyze'; id: number; results: WaferMapResult[]; options: AnalyzeWaferMapOptions; hasMultiWafer: boolean }
  | { type: 'runWithAnalysis'; id: number; inputs: WaferMapInput[]; options: AnalyzeWaferMapOptions; hasMultiWafer: boolean }
  | { type: 'ping' };

export type WorkerResponse =
  | { type: 'result'; id: number; result: WaferMapResult; tables: DetachedTables }
  | { type: 'analyzed'; id: number; waferSummaries: StatsSummary[]; lotSummary: LotStatsSummary | null }
  | { type: 'resultWithAnalysis'; id: number; results: WaferMapResult[]; waferSummaries: StatsSummary[]; lotSummary: LotStatsSummary | null; tables: DetachedTables }
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
      // The columns move to the page without a copy, and no die's values are
      // built to be cloned: the wrapper links the dies to them again.
      const { transfer, ...tables } = detachTables([result.dies]);
      (self as unknown as Worker).postMessage(
        { type: 'result', id: msg.id, result, tables } satisfies WorkerResponse, transfer,
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

  if (msg.type === 'runWithAnalysis') {
    try {
      const results = msg.inputs.map(input => buildWaferMap(input));
      const waferSummaries = results.map(r => analyzeWaferMap(r, msg.options));
      const lotSummary = msg.hasMultiWafer
        ? analyzeWaferLot(results, { ...msg.options, perWaferSummaries: waferSummaries })
        : null;
      const { transfer, ...tables } = detachTables(results.map(r => r.dies));
      (self as unknown as Worker).postMessage(
        { type: 'resultWithAnalysis', id: msg.id, results, waferSummaries, lotSummary, tables } satisfies WorkerResponse, transfer,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      (self as unknown as Worker).postMessage(
        { type: 'error', id: msg.id, message } satisfies WorkerResponse,
      );
    }
  }
};
