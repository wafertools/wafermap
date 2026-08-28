import { analyzeWaferMap } from './analyzeWaferMap.js';
import { median } from '../core/utils.js';
import type {
  AnalyzeWaferLotInput,
  AnalyzeWaferMapOptions,
  LotStatsSummary,
  StatsFinding,
  StatsSeverity,
  StatsSummary,
} from './types.js';

const OUTLIER_THRESHOLD = 1.3;
const REPEATED_PATTERN_MIN_WAFERS = 2;

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
    // Skip findings that another finding in the SAME wafer already absorbs as an
    // exact restatement (a soft-bin twin over identical dies; the single pass
    // bin against the yield row). `summary.findings` is deliberately the full
    // uncollapsed list, so without this the duplication removed at wafer level
    // reappears here — one lot row per twin, each annotated "seen on N/M wafers",
    // which is where it is most misleading because it looks like corroboration.
    // The absorbing finding still buckets normally and carries the merged label.
    const absorbed = new Set(entry.summary.findings.flatMap(f => f.absorbedIds ?? []));
    for (const finding of entry.summary.findings) {
      if (absorbed.has(finding.id)) continue;
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
        relativeDelta: finding.effect.relativeDelta,
        effectSize: finding.effect.effectSize,
      },
      stats: {
        method: 'wafer-finding-frequency',
        sampleSizeLeft: bucket.waferIndices.length,
        sampleSizeRight: perWafer.length - bucket.waferIndices.length,
      },
      summary: `${finding.summary} — seen on ${bucket.waferIndices.length}/${perWafer.length} wafers (${Math.round(coverage * 100)}%)`,
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
      yieldPercent: entry.summary.stats.yieldPercent,
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
      summary: `Wafer ${entry.waferIndex + 1} yield is ${Math.abs(delta).toFixed(1)} percentage points ${delta > 0 ? 'higher' : 'lower'} than the lot median`,
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
  options: AnalyzeWaferMapOptions & { perWaferSummaries?: StatsSummary[] } = {},
): LotStatsSummary {
  const perWafer = items.map((item, waferIndex) => ({
    waferIndex,
    summary: options.perWaferSummaries?.[waferIndex] ?? analyzeWaferMap(item, options),
  }));
  const findings = [
    ...buildRepeatedPatternFindings(perWafer),
    ...buildYieldOutlierFindings(perWafer),
  ].sort((left, right) => {
    const leftRank = left.severity === 'unusual' ? 2 : left.severity === 'notable' ? 1 : 0;
    const rightRank = right.severity === 'unusual' ? 2 : right.severity === 'notable' ? 1 : 0;
    if (leftRank !== rightRank) return rightRank - leftRank;
    return left.summary.localeCompare(right.summary, 'en');
  });

  // Lot-level identity: only keys every wafer that has identity data agrees on —
  // excluding wafer-specific keys so only lot/product/date etc. remain. A key
  // where wafers disagree (e.g. items pooled from more than one lot/program) is
  // omitted rather than silently taking the first wafer's value, and reported in
  // mixedIdentityFields so a caller can detect and warn/split instead of a report
  // silently mislabelling a pooled batch as a single lot.
  const identityWafers = perWafer.map(w => w.summary.wafer).filter((w): w is NonNullable<typeof w> => !!w);
  const lotIdentity: Record<string, unknown> = {};
  const mixedIdentityFields: string[] = [];
  if (identityWafers.length > 0) {
    const keys = new Set<string>();
    for (const w of identityWafers) for (const k of Object.keys(w)) keys.add(k);
    keys.delete('wafer');
    keys.delete('waferId');
    for (const key of keys) {
      const values = identityWafers.filter(w => key in w).map(w => w[key]);
      const allAgree = values.every(v => v === values[0]);
      if (allAgree) {
        lotIdentity[key] = values[0];
      } else {
        mixedIdentityFields.push(key);
      }
    }
  }

  const lotYieldSeries = perWafer.map(({ waferIndex, summary }) => ({
    waferIndex,
    yieldPercent: summary.stats.yieldPercent,
  }));

  const perWaferTestStatsRaw = perWafer
    .map(({ waferIndex, summary }) =>
      summary.stats.perTestStats?.length
        ? { waferIndex, tests: summary.stats.perTestStats }
        : null
    )
    .filter((e): e is NonNullable<typeof e> => e !== null);

  return {
    level: 'lot',
    hasNotableFindings: findings.some((finding) => finding.severity !== 'info')
      || perWafer.some((entry) => entry.summary.hasNotableFindings),
    findings,
    lot: Object.keys(lotIdentity).length > 0 ? lotIdentity : undefined,
    ...(mixedIdentityFields.length > 0 ? { mixedIdentityFields } : {}),
    stats: { waferCount: items.length },
    lotYieldSeries,
    perWafer,
    ...(perWaferTestStatsRaw.length > 0 ? { perWaferTestStats: perWaferTestStatsRaw } : {}),
  };
}
