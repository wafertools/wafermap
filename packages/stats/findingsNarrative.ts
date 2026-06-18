import type { StatsFinding, StatsComparisonFamily, StatsSeverity } from './types.js';

const FAMILY_PRIORITY: StatsComparisonFamily[] = [
  'spatial-pattern', 'ring', 'sector', 'quadrant', 'cluster', 'edge-arc', 'reticle-position',
];

const SEVERITY_RANK: Record<StatsSeverity, number> = { unusual: 0, notable: 1, info: 2 };

// Compass bearing → angle in degrees (CCW from East), for gradient-direction maths.
// Covers the 16-point sector names and the 4 quadrant diagonals (NE/NW/SW/SE).
const BEARING_DEG: Record<string, number> = {
  E: 0, ENE: 22.5, NE: 45, NNE: 67.5, N: 90, NNW: 112.5, NW: 135, WNW: 157.5,
  W: 180, WSW: 202.5, SW: 225, SSW: 247.5, S: 270, SSE: 292.5, SE: 315, ESE: 337.5,
};

function adjustedP(f: StatsFinding): number {
  return f.stats.adjustedPValue ?? f.stats.pValue ?? 1;
}

// Strongest finding: worst severity, then smallest adjusted p-value.
function pickStrongest(findings: StatsFinding[]): StatsFinding {
  return [...findings].sort((a, b) => {
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sev !== 0) return sev;
    return adjustedP(a) - adjustedP(b);
  })[0];
}

// When yield is present, pass/fail hard/soft bin findings merely restate it
// (yield ⇔ pass-bin rate; fail-bin moves opposite). Drop them from the prose —
// the findings list still shows them in full.
function dropRedundantBinMetrics(findings: StatsFinding[]): StatsFinding[] {
  const hasYield = findings.some(f => f.variable.kind === 'yield');
  if (!hasYield) return findings;
  return findings.filter(f => f.variable.kind !== 'hardBin' && f.variable.kind !== 'softBin');
}

// Split a region label into its constituent compass/region tokens, so a merged
// label ("Quadrants NW, SW & SE") can be compared against a bare one ("SW").
function regionTokens(label: string): string[] {
  return label
    .replace(/^(Rings?|Quadrants?|Sectors?)\s+/i, '')
    .split(/[,&]|–|\band\b/)
    .map(t => t.trim())
    .filter(Boolean);
}

// True when two region labels name any region in common.
function labelsOverlap(a: string, b: string): boolean {
  const ta = new Set(regionTokens(a));
  return regionTokens(b).some(t => ta.has(t));
}

function metricLabel(f: StatsFinding): string {
  if (f.variable.kind === 'yield') return 'yield';
  if (f.variable.kind === 'hardBin') return `HBin ${f.variable.bin ?? f.variable.index ?? '?'}`;
  if (f.variable.kind === 'softBin') return `SBin ${f.variable.bin ?? f.variable.index ?? '?'}`;
  return f.variable.label;
}

function dominantDirection(findings: StatsFinding[]): 'higher' | 'lower' | 'mixed' {
  let high = 0, low = 0;
  for (const f of findings) {
    if (f.effect.direction === 'higher') high++;
    else if (f.effect.direction === 'lower') low++;
  }
  if (high > low) return 'higher';
  if (low > high) return 'lower';
  return 'mixed';
}

function dirWord(dir: 'higher' | 'lower' | 'mixed'): string {
  if (dir === 'higher') return 'elevated';
  if (dir === 'lower') return 'reduced';
  return 'shifted';
}

function metricsPhrase(findings: StatsFinding[]): string {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const f of findings) {
    const l = metricLabel(f);
    if (!seen.has(l)) { seen.add(l); labels.push(l); }
  }
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  if (labels.length === 3) return `${labels[0]}, ${labels[1]}, and ${labels[2]}`;
  return `${labels[0]}, ${labels[1]}, and ${labels.length - 2} more`;
}

// Join distinct region labels into a noun phrase, e.g. "Ring 2 and Rings 4–5".
function joinLabels(findings: StatsFinding[]): string {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const f of findings) {
    const l = f.comparison.left;
    if (!seen.has(l)) { seen.add(l); labels.push(l); }
  }
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

// Whether the subject phrase reads as singular (for verb agreement).
function isSingularSubject(findings: StatsFinding[]): boolean {
  // A single finding whose label names one region (no "Rings"/"Quadrants"/"Sectors" plural).
  if (findings.length !== 1) return false;
  return !/^(Rings|Quadrants|Sectors)\b/.test(findings[0].comparison.left);
}

// Ring labels: "Ring 1 (core)", "Ring 2", "Ring N (edge)", or merged "Rings 1–3".
function ringSentence(findings: StatsFinding[]): string {
  const dir = dominantDirection(findings);
  const allEdge = findings.every(f => f.comparison.left.includes('(edge)'));
  const allCore = findings.every(f => f.comparison.left.includes('(core)'));
  let subject: string;
  let singular: boolean;
  if (allCore) { subject = 'The core ring'; singular = true; }
  else if (allEdge && findings.length > 1) { subject = 'The edge rings'; singular = false; }
  else { subject = joinLabels(findings); singular = isSingularSubject(findings); }
  return `${subject} show${singular ? 's' : ''} ${dirWord(dir)} ${metricsPhrase(findings)}.`;
}

// Quadrant labels: bare compass "NE" (single) or merged "Quadrants NW, SW & SE".
function quadrantSentence(findings: StatsFinding[]): string {
  const dir = dominantDirection(findings);
  // Single bare-compass labels need the "quadrant(s)" noun appended; merged
  // labels already include it.
  const merged = findings.filter(f => f.comparison.left.startsWith('Quadrants'));
  const bare = findings.filter(f => !f.comparison.left.startsWith('Quadrants'));
  const parts: string[] = [];
  if (bare.length === 1) parts.push(`the ${bare[0].comparison.left} quadrant`);
  else if (bare.length > 1) parts.push(`the ${joinLabels(bare)} quadrants`);
  for (const m of merged) parts.push(m.comparison.left.replace(/^Quadrants/, 'quadrants'));
  const subject = parts.join(' and ');
  const singular = bare.length === 1 && merged.length === 0;
  const lead = subject.charAt(0).toUpperCase() + subject.slice(1);
  return `${lead} show${singular ? 's' : ''} ${dirWord(dir)} ${metricsPhrase(findings)}.`;
}

// Sector labels: "Sector NE" (single) or merged "Sectors NE–E".
function sectorSentence(findings: StatsFinding[]): string {
  const dir = dominantDirection(findings);
  // Strip the "Sector(s) " prefix and rejoin so single and merged labels read
  // uniformly, e.g. "NE region" / "the NE–E and SW sectors".
  const bearings: string[] = [];
  const seen = new Set<string>();
  for (const f of findings) {
    const b = f.comparison.left.replace(/^Sectors? /, '');
    if (!seen.has(b)) { seen.add(b); bearings.push(b); }
  }
  let region: string;
  let singular: boolean;
  if (bearings.length === 1) {
    // One sector arc — "NE region" reads naturally; a merged arc keeps its range.
    region = `the ${bearings[0]} ${findings[0].comparison.left.startsWith('Sectors') ? 'sectors' : 'region'}`;
    singular = !findings[0].comparison.left.startsWith('Sectors');
  } else {
    region = `the ${bearings.length === 2 ? bearings.join(' and ') : `${bearings.slice(0, -1).join(', ')}, and ${bearings[bearings.length - 1]}`} sectors`;
    singular = false;
  }
  const lead = region.charAt(0).toUpperCase() + region.slice(1);
  return `${lead} show${singular ? 's' : ''} ${dirWord(dir)} ${metricsPhrase(findings)}.`;
}

// Cluster labels: "Cluster at (x, y)"
function clusterSentence(findings: StatsFinding[]): string {
  if (findings.length === 1) {
    return `A failure cluster at ${findings[0].comparison.left.replace(/^Cluster at /, '')}.`;
  }
  const largest = findings.reduce((a, b) =>
    (a.stats.sampleSizeLeft ?? 0) >= (b.stats.sampleSizeLeft ?? 0) ? a : b
  );
  const loc = largest.comparison.left.replace(/^Cluster at /, '');
  return `${findings.length} failure clusters identified; the largest at ${loc}.`;
}

// Edge-arc labels: "Edge arc ~NW"
function edgeArcSentence(findings: StatsFinding[]): string {
  const bearing = findings[0].comparison.left.replace(/^Edge arc ~/, '');
  if (findings.length === 1) {
    return `An edge arc near ${bearing} shows localised failures.`;
  }
  return `${findings.length} edge arcs detected, including near ${bearing}.`;
}

// Reticle-position labels: arbitrary
function reticlePositionSentence(findings: StatsFinding[]): string {
  const dir = dominantDirection(findings);
  if (findings.length === 1) {
    return `Reticle-position variation: ${findings[0].comparison.left} shows ${dirWord(dir)} ${metricsPhrase(findings)}.`;
  }
  return `Reticle-position variation across ${findings.length} cells (${dirWord(dir)} ${metricsPhrase(findings)}).`;
}

// Spatial-pattern label: e.g. "Edge-ring", "Center cluster". When the pattern
// links a localised supporting finding (edge-arc / cluster), name where the
// failures concentrate so the lead sentence describes the problem, not just its type.
function spatialPatternSentence(pattern: StatsFinding, all: StatsFinding[]): string {
  const conf = pattern.stats.method === 'geometry'
    ? ` (${pattern.severity === 'unusual' ? 'high' : pattern.severity === 'notable' ? 'medium' : 'low'} confidence)`
    : '';
  const related = new Set(pattern.relatedIds ?? []);
  const locus = all.find(f => related.has(f.id) && (f.comparison.family === 'edge-arc' || f.comparison.family === 'cluster'));
  let where = '';
  if (locus) {
    if (locus.comparison.family === 'edge-arc') {
      where = `; failures concentrated at the wafer edge near ${locus.comparison.left.replace(/^Edge arc ~/, '')}`;
    } else {
      where = `; failures concentrated near ${locus.comparison.left.replace(/^Cluster at /, '')}`;
    }
  }
  return `${pattern.comparison.left} failure pattern detected${conf}${where}.`;
}

// Lowercase the leading article/word of a follow-on clause and drop its period,
// so it reads naturally after "… while".
function asClause(sentence: string): string {
  const trimmed = sentence.replace(/\.$/, '');
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

// Net direction of a region's findings. Yield is the canonical pass/fail signal,
// so when present it decides; otherwise fall back to the majority across metrics.
// (A region with higher yield necessarily has a lower fail-bin rate — counting
// every metric would make the region look "mixed" when it is not.)
function regionNetDirection(findings: StatsFinding[]): 'higher' | 'lower' | 'mixed' {
  const yield_ = findings.filter(f => f.variable.kind === 'yield');
  if (yield_.length > 0) return dominantDirection(yield_);
  return dominantDirection(findings);
}

/**
 * Build a directional family's sentence. When the group's regions split cleanly
 * into a higher set and a lower set, emit two clauses ("… show elevated X while
 * … show reduced Y") instead of the vague "shifted". Each region is placed by its
 * net direction (see {@link regionNetDirection}) so it is named exactly once.
 */
function directionalSentence(
  builder: (fs: StatsFinding[]) => string,
  findings: StatsFinding[],
): string {
  // Bucket findings by their region's net direction.
  const byRegion = new Map<string, StatsFinding[]>();
  for (const f of findings) {
    const g = byRegion.get(f.comparison.left) ?? [];
    g.push(f);
    byRegion.set(f.comparison.left, g);
  }
  const higher: StatsFinding[] = [];
  const lower: StatsFinding[] = [];
  for (const group of byRegion.values()) {
    const net = regionNetDirection(group);
    // Place the region in one clause by its net direction, but keep only the
    // findings whose own direction agrees — so a higher-yield region does not
    // drag its (necessarily lower) fail-bin finding into the "elevated" clause.
    if (net === 'higher') higher.push(...group.filter(f => f.effect.direction === 'higher'));
    else if (net === 'lower') lower.push(...group.filter(f => f.effect.direction === 'lower'));
    else higher.push(...group);  // genuinely mixed region → keep together
  }
  // Guard: a region must never appear in both clauses. If a label in the lower
  // clause overlaps any label already in the higher clause (incl. merged-vs-bare,
  // e.g. "Quadrants NW, SW & SE" vs "SW"), drop it from the lower clause.
  const higherLabels = higher.map(f => f.comparison.left);
  const dedupedLower = lower.filter(f => !higherLabels.some(hl => labelsOverlap(hl, f.comparison.left)));
  if (higher.length > 0 && dedupedLower.length > 0) {
    // For yield/pass-bin metrics, lower yield is the problem — lead with it so the
    // sentence opens on the failures, not the healthy region. Test values have no
    // inherent good/bad direction, so keep the natural higher-first order there.
    const yieldLed = findings.some(f => f.variable.kind === 'yield');
    const [first, second] = yieldLed ? [dedupedLower, higher] : [higher, dedupedLower];
    return `${builder(first).replace(/\.$/, '')} while ${asClause(builder(second))}.`;
  }
  if (higher.length > 0 && lower.length > 0 && dedupedLower.length === 0) {
    return builder(higher);
  }
  // Single-direction (after net-direction bucketing): if yield is present, let it
  // define the wording and drop pass/fail bin findings that merely restate it in
  // the opposite direction — otherwise the sentence reads "shifted" and lists a
  // contradictory metric for what is one physical signal.
  const yieldDir = regionNetDirection(findings);
  if (yieldDir !== 'mixed' && findings.some(f => f.variable.kind === 'yield')) {
    const coherent = findings.filter(f => f.effect.direction === yieldDir);
    if (coherent.length > 0) return builder(coherent);
  }
  return builder(findings);
}

// Mean compass angle (degrees) of a set of region findings, or null if no
// bearing is known. Averages on the unit circle so wrap-around is handled.
function meanBearing(findings: StatsFinding[]): number | null {
  let sx = 0, sy = 0, n = 0;
  for (const f of findings) {
    for (const tok of regionTokens(f.comparison.left)) {
      const deg = BEARING_DEG[tok];
      if (deg === undefined) continue;
      const rad = (deg * Math.PI) / 180;
      sx += Math.cos(rad); sy += Math.sin(rad); n++;
    }
  }
  if (n === 0 || (sx === 0 && sy === 0)) return null;
  return (((Math.atan2(sy, sx) * 180) / Math.PI) + 360) % 360;
}

// Nearest 16-point compass name for an angle in degrees.
function bearingName(deg: number): string {
  let best = 'E', bestDiff = 360;
  for (const [name, d] of Object.entries(BEARING_DEG)) {
    const diff = Math.abs(((deg - d + 540) % 360) - 180);
    if (diff < bestDiff) { bestDiff = diff; best = name; }
  }
  return best;
}

/**
 * If the higher- and lower-direction regions sit on roughly opposite sides of the
 * wafer (a directional gradient) and a single metric dominates, return a one-line
 * "‹metric› increases from ‹low› toward ‹high›" phrase. Otherwise return null and
 * let the caller fall back to the two-clause builder.
 */
function gradientPhrase(findings: StatsFinding[]): string | null {
  const higher = findings.filter(f => f.effect.direction === 'higher');
  const lower  = findings.filter(f => f.effect.direction === 'lower');
  if (higher.length === 0 || lower.length === 0) return null;

  // Single dominant metric only — a gradient is one measurement varying in space.
  const metrics = new Set(findings.map(metricLabel));
  if (metrics.size !== 1) return null;

  const hi = meanBearing(higher);
  const lo = meanBearing(lower);
  if (hi === null || lo === null) return null;

  // Roughly antipodal: the high and low centroids point in near-opposite directions.
  const sep = Math.abs(((hi - lo + 540) % 360) - 180);
  if (sep < 120) return null;

  return `${[...metrics][0]} increases from ${bearingName(lo)} toward ${bearingName(hi)} across the wafer.`;
}

/**
 * One consolidated sentence for the directional region families (ring/quadrant/
 * sector). Folds redundant bin metrics into yield, verbalizes only the single
 * best-evidenced family (sector > quadrant > ring on ties), and prefers a compact
 * gradient phrase when the signal is directional.
 */
function regionalSentence(findings: StatsFinding[]): string {
  const deduped = dropRedundantBinMetrics(findings);
  if (deduped.length === 0) return '';

  const FAMILY_RES: StatsComparisonFamily[] = ['sector', 'quadrant', 'ring'];
  const byFamily = new Map<StatsComparisonFamily, StatsFinding[]>();
  for (const f of deduped) {
    const g = byFamily.get(f.comparison.family) ?? [];
    g.push(f);
    byFamily.set(f.comparison.family, g);
  }

  // Choose the family with the strongest evidence (min adjusted p); tie-break by
  // resolution preference sector > quadrant > ring.
  const chosen = [...byFamily.keys()].sort((a, b) => {
    const pa = Math.min(...byFamily.get(a)!.map(adjustedP));
    const pb = Math.min(...byFamily.get(b)!.map(adjustedP));
    if (pa !== pb) return pa - pb;
    return FAMILY_RES.indexOf(a) - FAMILY_RES.indexOf(b);
  })[0];

  const chosenFindings = byFamily.get(chosen)!;
  const gradient = gradientPhrase(chosenFindings);
  if (gradient) return gradient;

  const builder = chosen === 'ring' ? ringSentence : chosen === 'quadrant' ? quadrantSentence : sectorSentence;
  return directionalSentence(builder, chosenFindings);
}

function standaloneSentence(family: StatsComparisonFamily, findings: StatsFinding[]): string {
  switch (family) {
    case 'cluster':           return clusterSentence(findings);
    case 'edge-arc':          return edgeArcSentence(findings);
    case 'reticle-position':  return directionalSentence(reticlePositionSentence, findings);
    default:                  return '';
  }
}

const REGIONAL_FAMILIES = new Set<StatsComparisonFamily>(['ring', 'quadrant', 'sector']);

export function buildFindingsNarrative(findings: StatsFinding[]): string {
  if (findings.length === 0) return '';

  const significant = findings.filter(f => f.severity !== 'info');
  if (significant.length === 0) {
    return 'Minor spatial variation detected; no strongly significant patterns.';
  }

  const sentences: string[] = [];

  // ── A. Lead with the problem ──────────────────────────────────────────────
  const patterns = significant.filter(f => f.comparison.family === 'spatial-pattern');
  const leadPattern = patterns.length ? pickStrongest(patterns) : null;
  // Findings already explained by the lead pattern — excluded from later sentences.
  const relatedToLead = new Set(leadPattern?.relatedIds ?? []);

  if (leadPattern) {
    sentences.push(spatialPatternSentence(leadPattern, significant));
  }

  const remaining = significant.filter(
    f => f !== leadPattern && f.comparison.family !== 'spatial-pattern' && !relatedToLead.has(f.id),
  );

  // ── B. One consolidated regional sentence ─────────────────────────────────
  let regional = remaining.filter(f => REGIONAL_FAMILIES.has(f.comparison.family));
  // When a pattern already names the problem, a regional sentence that only
  // describes the *healthy* complement (elevated yield in the un-failed regions)
  // adds nothing — suppress it. Check the deduped set (bins folded into yield) so
  // a redundant fail-bin finding doesn't keep the sentence alive.
  if (leadPattern && regional.length) {
    const deduped = dropRedundantBinMetrics(regional);
    const onlyHealthyYield = deduped.length > 0 && deduped.every(
      f => f.variable.kind === 'yield' && f.effect.direction === 'higher',
    );
    if (onlyHealthyYield) regional = [];
  }
  // Families already verbalized, so step C does not repeat them.
  const consumedFamilies = new Set<StatsComparisonFamily>();
  if (regional.length) {
    const s = regionalSentence(regional);
    if (s) { sentences.push(s); for (const fam of REGIONAL_FAMILIES) consumedFamilies.add(fam); }
  } else if (!leadPattern) {
    // No pattern and no regional families: lead with the single strongest finding.
    const strongest = pickStrongest(remaining);
    if (strongest) {
      const fam = strongest.comparison.family;
      const s = standaloneSentence(fam, remaining.filter(f => f.comparison.family === fam));
      if (s) { sentences.push(s); consumedFamilies.add(fam); }
    }
  }

  // ── C. One optional supporting sentence (distinct localised signal) ───────
  if (sentences.length < 3) {
    const supporting = remaining.filter(
      f => (f.comparison.family === 'cluster' || f.comparison.family === 'edge-arc') &&
           !consumedFamilies.has(f.comparison.family),
    );
    if (supporting.length) {
      const fam = supporting[0].comparison.family;
      const s = standaloneSentence(fam, supporting.filter(f => f.comparison.family === fam));
      if (s) sentences.push(s);
    }
  }

  // ── D. Cap at 3 sentences ─────────────────────────────────────────────────
  return sentences.slice(0, 3).join(' ');
}
