import { buildWaferMap, type WaferMapResult } from '../renderer/buildWaferMap.js';
import type { AnalyzeWaferMapInput } from './types.js';

/**
 * Build an analysis input if it is not already a built map. A module of its own
 * so it stays internal: stats/index.ts re-exports analyzeWaferMap.ts wholesale.
 * analyzeWaferLot builds each wafer once here and passes the built result down,
 * so its lot figures and each wafer's analysis read the same dies.
 */
export function normalizeInput(input: AnalyzeWaferMapInput): WaferMapResult {
  return 'wafer' in input && 'dies' in input && 'view' in input ? input : buildWaferMap(input);
}
