import type { WaferMapInput, WaferMapResult } from '../renderer/buildWaferMap.js';

export type StatsSeverity = 'info' | 'notable' | 'unusual';
export type StatsLevel = 'wafer' | 'lot' | 'inter-wafer';
export type StatsVariableKind = 'yield' | 'hardbin' | 'softbin' | 'test';
export type StatsComparisonFamily =
  | 'ring'
  | 'quadrant'
  | 'reticle-position'
  | 'wafer';

export interface HighlightRegionTarget {
  kind: 'region';
  regionFamily: Exclude<StatsComparisonFamily, 'wafer'>;
  keys: string[];
  dieKeys?: string[];
}

export interface HighlightBinTarget {
  kind: 'bin';
  bin: number;
  regionKeys?: string[];
  dieKeys?: string[];
}

export interface HighlightWaferTarget {
  kind: 'wafer';
  waferIndices: number[];
}

export interface HighlightDieTarget {
  kind: 'dies';
  dieKeys: string[];
}

export type HighlightTarget =
  | HighlightRegionTarget
  | HighlightBinTarget
  | HighlightWaferTarget
  | HighlightDieTarget;

export interface StatsFinding {
  id: string;
  level: StatsLevel;
  severity: StatsSeverity;
  variable: {
    kind: StatsVariableKind;
    index?: number;
    bin?: number;
    label: string;
    unit?: string;
  };
  comparison: {
    family: StatsComparisonFamily;
    left: string;
    right: string;
  };
  effect: {
    direction: 'higher' | 'lower' | 'different';
    absoluteDelta?: number;
    relativeDelta?: number;
    effectSize?: number;
  };
  stats: {
    method: string;
    pValue?: number;
    adjustedPValue?: number;
    sampleSizeLeft: number;
    sampleSizeRight: number;
  };
  summary: string;
  highlight: HighlightTarget;
}

export interface StatsSummary {
  level: 'wafer';
  hasNotableFindings: boolean;
  findings: StatsFinding[];
  metadata: {
    totalDies: number;
    analyzedDies: number;
    excludedDies: number;
    yieldPercent: number | null;
    testsConsidered: number[];
    hardBinsConsidered: number[];
    softBinsConsidered: number[];
  };
}

export interface LotStatsSummary {
  level: 'lot';
  hasNotableFindings: boolean;
  findings: StatsFinding[];
  perWafer: Array<{
    waferIndex: number;
    summary: StatsSummary;
  }>;
  metadata: {
    waferCount: number;
    comparableWaferCount: number;
  };
}

export interface AnalyzeWaferMapOptions {
  /**
   * Should mirror the ring count used by the renderer for consistent semantics.
   * Defaults to 4, which matches the current render default.
   */
  ringCount?: number;
  passBins?: number[];
  significanceLevel?: number;
  minimumEffectSize?: number;
  minimumSampleSize?: number;
  includePartial?: boolean;
  includeEdgeExcluded?: boolean;
  enableYieldAnalysis?: boolean;
  enableHardBinAnalysis?: boolean;
  enableSoftBinAnalysis?: boolean;
  enableTestValueAnalysis?: boolean;
  enableReticlePositionAnalysis?: boolean;
}

export interface AnalyzeWaferLotOptions extends AnalyzeWaferMapOptions {}

export type AnalyzeWaferMapInput = WaferMapInput | WaferMapResult;
export type AnalyzeWaferLotInput = Array<WaferMapInput | WaferMapResult>;
