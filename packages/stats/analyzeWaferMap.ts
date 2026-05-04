import type { Die } from '../core/dies.js';
import { buildWaferMap, type WaferMapResult } from '../renderer/buildWaferMap.js';
import type { BinDef, TestDef } from '../renderer/buildWaferMap.js';
import type {
  AnalyzeWaferMapInput,
  AnalyzeWaferMapOptions,
  StatsFinding,
  StatsSeverity,
  StatsSummary,
} from './types.js';
import { buildQuadrantRegions, buildReticlePositionRegions, buildRingRegions, type StatsRegion } from './regions.js';

interface EligibleDie extends Die {
  hbin: number;
}

interface RawFinding extends StatsFinding {
  comparison: StatsFinding['comparison'];
  stats: StatsFinding['stats'];
  effect: StatsFinding['effect'];
}

const DEFAULT_OPTIONS: Required<AnalyzeWaferMapOptions> = {
  ringCount: 4,
  passBins: [1],
  significanceLevel: 0.05,
  minimumEffectSize: 0.15,
  minimumSampleSize: 5,
  includePartial: false,
  includeEdgeExcluded: false,
  enableYieldAnalysis: true,
  enableHardBinAnalysis: true,
  enableSoftBinAnalysis: true,
  enableTestValueAnalysis: true,
  enableReticlePositionAnalysis: true,
};

function normalizeInput(input: AnalyzeWaferMapInput): WaferMapResult {
  return 'wafer' in input && 'dies' in input && 'scene' in input ? input : buildWaferMap(input);
}

function isEligibleDie(die: Die, options: Required<AnalyzeWaferMapOptions>): die is EligibleDie {
  if (!options.includePartial && die.partial) return false;
  if (!options.includeEdgeExcluded && die.edgeExcluded) return false;
  return die.hbin !== undefined;
}

function collectMetadata(dies: Die[], analyzedDies: number, yieldPercent: number | null): StatsSummary['metadata'] {
  const testSet = new Set<number>();
  const hardBinSet = new Set<number>();
  const softBinSet = new Set<number>();

  for (const die of dies) {
    die.values?.forEach((value, index) => {
      if (value !== undefined) testSet.add(index);
    });
    if (die.hbin !== undefined) hardBinSet.add(die.hbin);
    if (die.sbin !== undefined) softBinSet.add(die.sbin);
  }

  return {
    totalDies: dies.length,
    analyzedDies,
    excludedDies: dies.length - analyzedDies,
    yieldPercent,
    testsConsidered: [...testSet].sort((left, right) => left - right),
    hardBinsConsidered: [...hardBinSet].sort((left, right) => left - right),
    softBinsConsidered: [...softBinSet].sort((left, right) => left - right),
  };
}

function errorFunction(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function normalCdf(value: number): number {
  return 0.5 * (1 + errorFunction(value / Math.sqrt(2)));
}

function twoProportionPValue(
  leftPass: number,
  leftTotal: number,
  rightPass: number,
  rightTotal: number,
): number {
  const pooled = (leftPass + rightPass) / (leftTotal + rightTotal);
  const variance = pooled * (1 - pooled) * ((1 / leftTotal) + (1 / rightTotal));
  if (!Number.isFinite(variance) || variance <= 0) return 1;
  const z = ((leftPass / leftTotal) - (rightPass / rightTotal)) / Math.sqrt(variance);
  return Math.max(0, Math.min(1, 2 * (1 - normalCdf(Math.abs(z)))));
}

function adjustPValues(findings: RawFinding[]): RawFinding[] {
  const families = new Map<string, RawFinding[]>();
  for (const finding of findings) {
    const key = `${finding.variable.kind}:${finding.comparison.family}`;
    const entries = families.get(key) ?? [];
    entries.push(finding);
    families.set(key, entries);
  }

  for (const entries of families.values()) {
    const sorted = [...entries]
      .filter((entry) => entry.stats.pValue !== undefined)
      .sort((left, right) => (left.stats.pValue ?? 1) - (right.stats.pValue ?? 1));
    const total = sorted.length;
    let runningMin = 1;

    for (let index = total - 1; index >= 0; index--) {
      const entry = sorted[index];
      const raw = entry.stats.pValue ?? 1;
      const adjusted = Math.min(1, Math.min(runningMin, (raw * total) / (index + 1)));
      entry.stats.adjustedPValue = adjusted;
      runningMin = adjusted;
    }
  }

  return findings;
}

function severityForFinding(pValue: number, delta: number): StatsSeverity {
  if (pValue <= 0.01 && Math.abs(delta) >= 0.25) return 'unusual';
  if (pValue <= 0.05 && Math.abs(delta) >= 0.15) return 'notable';
  return 'info';
}

function severityForScore(pValue: number, score: number): StatsSeverity {
  if (pValue <= 0.01 && Math.abs(score) >= 0.5) return 'unusual';
  if (pValue <= 0.05 && Math.abs(score) >= 0.15) return 'notable';
  return 'info';
}

function summarizeYieldFinding(label: string, delta: number): string {
  return `${label} yield is ${delta > 0 ? 'higher' : 'lower'} than the rest of the wafer`;
}

function summarizeRegionLabel(label: string, family: 'ring' | 'quadrant' | 'reticle-position'): string {
  if (family === 'quadrant') return `quadrant ${label}`;
  return label;
}

function summarizeBinFinding(
  label: string,
  binLabel: string,
  delta: number,
  family: 'ring' | 'quadrant' | 'reticle-position',
): string {
  const familyLabel = summarizeRegionLabel(label, family);
  return `${familyLabel} has ${delta > 0 ? 'higher' : 'lower'} ${binLabel} occurrence than the rest of the wafer`;
}

function summarizeTestFinding(
  label: string,
  testLabel: string,
  delta: number,
  family: 'ring' | 'quadrant' | 'reticle-position',
): string {
  const familyLabel = summarizeRegionLabel(label, family);
  return `${familyLabel} has ${delta > 0 ? 'higher' : 'lower'} ${testLabel} than the rest of the wafer`;
}

function labelForBin(bin: number, defs: BinDef[] | undefined, prefix: 'HBin' | 'SBin'): string {
  const def = defs?.find((entry) => entry.bin === bin);
  return def?.name ? `${prefix} ${bin} (${def.name})` : `${prefix} ${bin}`;
}

function labelForTest(index: number, defs: TestDef[] | undefined): { label: string; unit?: string } {
  const def = defs?.find((entry) => entry.index === index);
  return { label: def?.name ?? `Test ${index}`, unit: def?.unit };
}

function buildYieldFindings(
  eligibleDies: EligibleDie[],
  regionFamily: StatsRegion[],
  passBins: number[],
  options: Required<AnalyzeWaferMapOptions>,
): RawFinding[] {
  const passSet = new Set(passBins);
  const dieMap = new Map(eligibleDies.map((die) => [`${die.i},${die.j}`, die]));
  const findings: RawFinding[] = [];

  for (const region of regionFamily) {
    const left = region.dieKeys
      .map((key) => dieMap.get(key))
      .filter((die): die is EligibleDie => die !== undefined);
    const leftKeySet = new Set(region.dieKeys);
    const right = eligibleDies.filter((die) => !leftKeySet.has(`${die.i},${die.j}`));

    if (left.length < options.minimumSampleSize || right.length < options.minimumSampleSize) continue;

    const leftPass = left.filter((die) => passSet.has(die.hbin)).length;
    const rightPass = right.filter((die) => passSet.has(die.hbin)).length;
    const leftRate = leftPass / left.length;
    const rightRate = rightPass / right.length;
    const delta = leftRate - rightRate;
    const pValue = twoProportionPValue(leftPass, left.length, rightPass, right.length);

    findings.push({
      id: `yield:${region.key}`,
      level: 'wafer',
      severity: 'info',
      variable: {
        kind: 'yield',
        label: 'Yield',
      },
      comparison: {
        family: region.family,
        left: region.label,
        right: 'Rest of wafer',
      },
      effect: {
        direction: delta === 0 ? 'different' : delta > 0 ? 'higher' : 'lower',
        absoluteDelta: delta,
        relativeDelta: rightRate === 0 ? undefined : delta / rightRate,
        effectSize: delta,
      },
      stats: {
        method: 'two-proportion-z',
        pValue,
        sampleSizeLeft: left.length,
        sampleSizeRight: right.length,
      },
      summary: summarizeYieldFinding(region.label, delta),
      highlight: {
        kind: 'region',
        regionFamily: region.family,
        keys: [region.key],
        dieKeys: [...region.dieKeys],
      },
    });
  }

  adjustPValues(findings);

  return findings
    .filter((finding) => {
      const adjusted = finding.stats.adjustedPValue ?? finding.stats.pValue ?? 1;
      const delta = Math.abs(finding.effect.absoluteDelta ?? 0);
      return adjusted <= options.significanceLevel && delta >= options.minimumEffectSize;
    })
    .map((finding) => ({
      ...finding,
      severity: severityForFinding(
        finding.stats.adjustedPValue ?? finding.stats.pValue ?? 1,
        finding.effect.absoluteDelta ?? 0,
      ),
    }));
}

function buildBinFindings(
  eligibleDies: EligibleDie[],
  regionFamily: StatsRegion[],
  binSpace: 'hard' | 'soft',
  defs: BinDef[] | undefined,
  variableKind: 'hardbin' | 'softbin',
  options: Required<AnalyzeWaferMapOptions>,
): RawFinding[] {
  const getBin = (d: EligibleDie) => binSpace === 'soft' ? d.sbin : d.hbin;
  const dieMap = new Map(eligibleDies.map((die) => [`${die.i},${die.j}`, die]));
  const bins = [...new Set(
    eligibleDies
      .map(getBin)
      .filter((bin): bin is number => bin !== undefined),
  )].sort((left, right) => left - right);
  const findings: RawFinding[] = [];
  const prefix = variableKind === 'hardbin' ? 'HBin' : 'SBin';

  for (const region of regionFamily) {
    const left = region.dieKeys
      .map((key) => dieMap.get(key))
      .filter((die): die is EligibleDie => die !== undefined);
    const leftKeySet = new Set(region.dieKeys);
    const right = eligibleDies.filter((die) => !leftKeySet.has(`${die.i},${die.j}`));

    if (left.length < options.minimumSampleSize || right.length < options.minimumSampleSize) continue;

    for (const bin of bins) {
      const leftHits = left.filter((die) => getBin(die) === bin).length;
      const rightHits = right.filter((die) => getBin(die) === bin).length;
      const leftRate = leftHits / left.length;
      const rightRate = rightHits / right.length;
      const delta = leftRate - rightRate;
      const pValue = twoProportionPValue(leftHits, left.length, rightHits, right.length);
      const binLabel = labelForBin(bin, defs, prefix);

      findings.push({
        id: `${variableKind}:${bin}:${region.key}`,
        level: 'wafer',
        severity: 'info',
        variable: {
          kind: variableKind,
          bin,
          label: binLabel,
        },
        comparison: {
          family: region.family,
          left: region.label,
          right: 'Rest of wafer',
        },
        effect: {
          direction: delta === 0 ? 'different' : delta > 0 ? 'higher' : 'lower',
          absoluteDelta: delta,
          relativeDelta: rightRate === 0 ? undefined : delta / rightRate,
          effectSize: delta,
        },
        stats: {
          method: 'two-proportion-z',
          pValue,
          sampleSizeLeft: left.length,
          sampleSizeRight: right.length,
        },
        summary: summarizeBinFinding(region.label, binLabel, delta, region.family),
        highlight: {
          kind: 'bin',
          bin,
          regionKeys: [region.key],
          dieKeys: [...region.dieKeys],
        },
      });
    }
  }

  adjustPValues(findings);

  return findings
    .filter((finding) => {
      const adjusted = finding.stats.adjustedPValue ?? finding.stats.pValue ?? 1;
      const delta = Math.abs(finding.effect.absoluteDelta ?? 0);
      return adjusted <= options.significanceLevel && delta >= options.minimumEffectSize;
    })
    .map((finding) => ({
      ...finding,
      severity: severityForFinding(
        finding.stats.adjustedPValue ?? finding.stats.pValue ?? 1,
        finding.effect.absoluteDelta ?? 0,
      ),
    }));
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleVariance(values: number[], avg: number): number {
  if (values.length < 2) return 0;
  return values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
}

function welchPValue(leftValues: number[], rightValues: number[]): { pValue: number; effectSize: number; delta: number } {
  const leftMean = mean(leftValues);
  const rightMean = mean(rightValues);
  const leftVar = sampleVariance(leftValues, leftMean);
  const rightVar = sampleVariance(rightValues, rightMean);
  const standardError = Math.sqrt((leftVar / leftValues.length) + (rightVar / rightValues.length));
  const delta = leftMean - rightMean;

  if (!Number.isFinite(standardError) || standardError === 0) {
    return { pValue: delta === 0 ? 1 : 0, effectSize: delta === 0 ? 0 : Math.sign(delta) * Infinity, delta };
  }

  const z = delta / standardError;
  const pooledSd = Math.sqrt(Math.max(0, ((leftVar + rightVar) / 2)));
  const effectSize = pooledSd === 0 ? delta : delta / pooledSd;
  return {
    pValue: Math.max(0, Math.min(1, 2 * (1 - normalCdf(Math.abs(z))))),
    effectSize,
    delta,
  };
}

function buildTestValueFindings(
  dies: Die[],
  regionFamily: StatsRegion[],
  defs: TestDef[] | undefined,
  options: Required<AnalyzeWaferMapOptions>,
): RawFinding[] {
  const dieMap = new Map(dies.map((die) => [`${die.i},${die.j}`, die]));
  const testIndices = [...new Set(
    dies.flatMap((die) =>
      (die.values ?? [])
        .map((value, index) => ({ value, index }))
        .filter((entry) => entry.value !== undefined)
        .map((entry) => entry.index),
    ),
  )].sort((left, right) => left - right);
  const findings: RawFinding[] = [];

  for (const region of regionFamily) {
    const leftDies = region.dieKeys
      .map((key) => dieMap.get(key))
      .filter((die): die is Die => die !== undefined);
    const leftKeySet = new Set(region.dieKeys);
    const rightDies = dies.filter((die) => !leftKeySet.has(`${die.i},${die.j}`));

    for (const testIndex of testIndices) {
      const leftValues = leftDies.map((die) => die.values?.[testIndex]).filter((value): value is number => value !== undefined);
      const rightValues = rightDies.map((die) => die.values?.[testIndex]).filter((value): value is number => value !== undefined);

      if (leftValues.length < options.minimumSampleSize || rightValues.length < options.minimumSampleSize) continue;

      const { pValue, effectSize, delta } = welchPValue(leftValues, rightValues);
      const { label, unit } = labelForTest(testIndex, defs);

      findings.push({
        id: `test:${testIndex}:${region.key}`,
        level: 'wafer',
        severity: 'info',
        variable: {
          kind: 'test',
          index: testIndex,
          label,
          unit,
        },
        comparison: {
          family: region.family,
          left: region.label,
          right: 'Rest of wafer',
        },
        effect: {
          direction: delta === 0 ? 'different' : delta > 0 ? 'higher' : 'lower',
          absoluteDelta: delta,
          effectSize,
        },
        stats: {
          method: 'welch-z-approx',
          pValue,
          sampleSizeLeft: leftValues.length,
          sampleSizeRight: rightValues.length,
        },
        summary: summarizeTestFinding(region.label, label, delta, region.family),
        highlight: {
          kind: 'region',
          regionFamily: region.family,
          keys: [region.key],
          dieKeys: [...region.dieKeys],
        },
      });
    }
  }

  adjustPValues(findings);

  return findings
    .filter((finding) => {
      const adjusted = finding.stats.adjustedPValue ?? finding.stats.pValue ?? 1;
      const effectSize = Math.abs(finding.effect.effectSize ?? 0);
      return adjusted <= options.significanceLevel && effectSize >= options.minimumEffectSize;
    })
    .map((finding) => ({
      ...finding,
      severity: severityForScore(
        finding.stats.adjustedPValue ?? finding.stats.pValue ?? 1,
        finding.effect.effectSize ?? 0,
      ),
    }));
}

export function analyzeWaferMap(
  input: AnalyzeWaferMapInput,
  options: AnalyzeWaferMapOptions = {},
): StatsSummary {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const result = normalizeInput(input);
  const eligibleDies = result.dies.filter((die): die is EligibleDie => isEligibleDie(die, resolved));
  const includedDies = result.dies.filter((die) => {
    if (!resolved.includePartial && die.partial) return false;
    if (!resolved.includeEdgeExcluded && die.edgeExcluded) return false;
    return true;
  });
  const ringRegions = buildRingRegions(includedDies, result.wafer, resolved.ringCount);
  const quadrantRegions = buildQuadrantRegions(includedDies, result.wafer, resolved.ringCount);
  const reticlePositionRegions = resolved.enableReticlePositionAnalysis
    ? buildReticlePositionRegions(includedDies, result.reticleConfig)
    : [];

  const findings: RawFinding[] = [];
  if (resolved.enableYieldAnalysis) {
    findings.push(
      ...buildYieldFindings(
        eligibleDies,
        ringRegions,
        resolved.passBins,
        resolved,
      ),
      ...buildYieldFindings(
        eligibleDies,
        quadrantRegions,
        resolved.passBins,
        resolved,
      ),
      ...buildYieldFindings(
        eligibleDies,
        reticlePositionRegions,
        resolved.passBins,
        resolved,
      ),
    );
  }
  if (resolved.enableHardBinAnalysis) {
    findings.push(
      ...buildBinFindings(eligibleDies, ringRegions, 'hard', result.scene.hbinDefs, 'hardbin', resolved),
      ...buildBinFindings(eligibleDies, quadrantRegions, 'hard', result.scene.hbinDefs, 'hardbin', resolved),
      ...buildBinFindings(eligibleDies, reticlePositionRegions, 'hard', result.scene.hbinDefs, 'hardbin', resolved),
    );
  }
  if (resolved.enableSoftBinAnalysis) {
    const softEligibleDies = eligibleDies.filter((die): die is EligibleDie => die.sbin !== undefined);
    findings.push(
      ...buildBinFindings(softEligibleDies, ringRegions, 'soft', result.scene.sbinDefs, 'softbin', resolved),
      ...buildBinFindings(softEligibleDies, quadrantRegions, 'soft', result.scene.sbinDefs, 'softbin', resolved),
      ...buildBinFindings(softEligibleDies, reticlePositionRegions, 'soft', result.scene.sbinDefs, 'softbin', resolved),
    );
  }
  if (resolved.enableTestValueAnalysis) {
    findings.push(
      ...buildTestValueFindings(eligibleDies, ringRegions, result.scene.testDefs, resolved),
      ...buildTestValueFindings(eligibleDies, quadrantRegions, result.scene.testDefs, resolved),
      ...buildTestValueFindings(eligibleDies, reticlePositionRegions, result.scene.testDefs, resolved),
    );
  }

  findings.sort((left, right) => {
    const leftScore = left.stats.adjustedPValue ?? left.stats.pValue ?? 1;
    const rightScore = right.stats.adjustedPValue ?? right.stats.pValue ?? 1;
    if (leftScore !== rightScore) return leftScore - rightScore;
    return Math.abs((right.effect.absoluteDelta ?? 0)) - Math.abs((left.effect.absoluteDelta ?? 0));
  });

  return {
    level: 'wafer',
    hasNotableFindings: findings.some((finding) => finding.severity === 'notable' || finding.severity === 'unusual'),
    findings,
    metadata: collectMetadata(result.dies, eligibleDies.length, result.yield.yieldPercent),
  };
}
