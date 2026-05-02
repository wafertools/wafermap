import { analyzeWaferMap } from './analyzeWaferMap.js';
import type {
  AnalyzeWaferLotInput,
  AnalyzeWaferLotOptions,
  LotStatsSummary,
  StatsFinding,
  StatsSeverity,
} from './types.js';

const OUTLIER_THRESHOLD = 1.3;
const REPEATED_PATTERN_MIN_WAFERS = 2;

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function maxSeverity(left: StatsSeverity, right: StatsSeverity): StatsSeverity {
  const rank: Record<StatsSeverity, number> = { info: 0, notable: 1, unusual: 2 };
  return rank[left] >= rank[right] ? left : right;
}

function buildRepeatedPatternFindings(perWafer: LotStatsSummary['perWafer']): StatsFinding[] {
  const buckets = new Map<string, {
    finding: StatsFinding;
    waferIndices: number[];
    severity: StatsSeverity;
  }>();

  for (const entry of perWafer) {
    const seen = new Set<string>();
    for (const finding of entry.summary.findings) {
      const key = [
        finding.variable.kind,
        finding.variable.index ?? '',
        finding.variable.bin ?? '',
        finding.comparison.family,
        finding.comparison.left,
        finding.effect.direction,
      ].join('|');
      if (seen.has(key)) continue;
      seen.add(key);

      const bucket = buckets.get(key) ?? {
        finding,
        waferIndices: [],
        severity: finding.severity,
      };
      bucket.waferIndices.push(entry.waferIndex);
      bucket.severity = maxSeverity(bucket.severity, finding.severity);
      buckets.set(key, bucket);
    }
  }

  const findings: StatsFinding[] = [];

  for (const [key, bucket] of buckets) {
    if (bucket.waferIndices.length < REPEATED_PATTERN_MIN_WAFERS) continue;
    const coverage = bucket.waferIndices.length / Math.max(1, perWafer.length);
    const severity: StatsSeverity = coverage >= 0.6 || bucket.severity === 'unusual' ? 'unusual' : 'notable';
    const finding = bucket.finding;

    findings.push({
      id: `lot-repeat:${key}`,
      level: 'lot',
      severity,
      variable: { ...finding.variable },
      comparison: { ...finding.comparison },
      effect: {
        direction: finding.effect.direction,
        absoluteDelta: finding.effect.absoluteDelta,
        relativeDelta: coverage,
        effectSize: finding.effect.effectSize,
      },
      stats: {
        method: 'wafer-finding-frequency',
        sampleSizeLeft: bucket.waferIndices.length,
        sampleSizeRight: perWafer.length - bucket.waferIndices.length,
      },
      summary: `${finding.summary} across ${bucket.waferIndices.length}/${perWafer.length} wafers`,
      highlight: {
        kind: 'wafer',
        waferIndices: bucket.waferIndices,
      },
    });
  }

  return findings;
}

function buildYieldOutlierFindings(perWafer: LotStatsSummary['perWafer']): StatsFinding[] {
  const comparable = perWafer
    .map((entry) => ({
      waferIndex: entry.waferIndex,
      yieldPercent: entry.summary.metadata.yieldPercent,
    }))
    .filter((entry): entry is { waferIndex: number; yieldPercent: number } => entry.yieldPercent !== null);

  if (comparable.length < 3) return [];

  const values = comparable.map((entry) => entry.yieldPercent);
  const center = median(values);
  const mad = median(values.map((value) => Math.abs(value - center)));
  if (!Number.isFinite(mad) || mad === 0) return [];

  const findings: StatsFinding[] = [];

  for (const entry of comparable) {
    const zScore = 0.6745 * (entry.yieldPercent - center) / mad;
    if (Math.abs(zScore) < OUTLIER_THRESHOLD) continue;
    const delta = entry.yieldPercent - center;
    findings.push({
      id: `inter-wafer:yield:${entry.waferIndex}`,
      level: 'inter-wafer',
      severity: Math.abs(zScore) >= 2 ? 'unusual' : 'notable',
      variable: {
        kind: 'yield',
        label: 'Yield',
      },
      comparison: {
        family: 'wafer',
        left: `Wafer ${entry.waferIndex + 1}`,
        right: 'Lot median',
      },
      effect: {
        direction: delta > 0 ? 'higher' : 'lower',
        absoluteDelta: delta,
        relativeDelta: center === 0 ? undefined : delta / center,
        effectSize: zScore,
      },
      stats: {
        method: 'mad-z-score',
        sampleSizeLeft: 1,
        sampleSizeRight: comparable.length - 1,
      },
      summary: `Wafer ${entry.waferIndex + 1} yield is ${delta > 0 ? 'higher' : 'lower'} than the lot median`,
      highlight: {
        kind: 'wafer',
        waferIndices: [entry.waferIndex],
      },
    });
  }

  return findings;
}

export function analyzeWaferLot(
  items: AnalyzeWaferLotInput,
  options: AnalyzeWaferLotOptions = {},
): LotStatsSummary {
  const perWafer = items.map((item, waferIndex) => ({
    waferIndex,
    summary: analyzeWaferMap(item, options),
  }));
  const comparableWaferCount = perWafer.filter((entry) => entry.summary.metadata.yieldPercent !== null).length;
  const findings = [
    ...buildRepeatedPatternFindings(perWafer),
    ...buildYieldOutlierFindings(perWafer),
  ].sort((left, right) => {
    const leftRank = left.severity === 'unusual' ? 2 : left.severity === 'notable' ? 1 : 0;
    const rightRank = right.severity === 'unusual' ? 2 : right.severity === 'notable' ? 1 : 0;
    if (leftRank !== rightRank) return rightRank - leftRank;
    return left.summary.localeCompare(right.summary);
  });

  return {
    level: 'lot',
    hasNotableFindings: findings.some((finding) => finding.severity !== 'info')
      || perWafer.some((entry) => entry.summary.hasNotableFindings),
    findings,
    perWafer,
    metadata: {
      waferCount: items.length,
      comparableWaferCount,
    },
  };
}
