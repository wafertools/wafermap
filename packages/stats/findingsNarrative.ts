import type { StatsFinding, StatsComparisonFamily } from './types.js';

const FAMILY_PRIORITY: StatsComparisonFamily[] = [
  'spatial-pattern', 'ring', 'sector', 'quadrant', 'cluster', 'edge-arc', 'reticle-position',
];

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

// Ring labels: "Ring 1 (core)", "Ring 2", "Ring N (edge)"
function ringSentence(findings: StatsFinding[]): string {
  const dir = dominantDirection(findings);
  const allEdge = findings.every(f => f.comparison.left.includes('(edge)'));
  const allCore = findings.every(f => f.comparison.left.includes('(core)'));
  let zone: string;
  if (allEdge) zone = 'Edge rings';
  else if (allCore) zone = 'The core ring';
  else if (findings.length === 1) zone = findings[0].comparison.left;
  else zone = 'Multiple rings';
  return `${zone} show${zone.startsWith('The') || zone.startsWith('Multiple') ? 's' : ''} ${dirWord(dir)} ${metricsPhrase(findings)}.`;
}

// Quadrant labels: bare compass "NE", "SW" etc.
function quadrantSentence(findings: StatsFinding[]): string {
  const dir = dominantDirection(findings);
  const labels = findings.map(f => f.comparison.left);
  let phrase: string;
  if (labels.length === 1) phrase = `${labels[0]} quadrant`;
  else if (labels.length === 2) phrase = `${labels[0]} and ${labels[1]} quadrants`;
  else phrase = 'multiple quadrants';
  const verb = labels.length <= 2 ? 'shows' : 'show';
  return `The ${phrase} ${verb} ${dirWord(dir)} ${metricsPhrase(findings)}.`;
}

const COMPASS_16 = ['E','ENE','NE','NNE','N','NNW','NW','WNW','W','WSW','SW','SSW','S','SSE','SE','ESE'];

function compassIndex(bearing: string): number {
  return COMPASS_16.indexOf(bearing);
}

// Sector labels: "Sector NE", "Sector SSW" etc.
function sectorSentence(findings: StatsFinding[]): string {
  const dir = dominantDirection(findings);
  const bearings = findings.map(f => f.comparison.left.replace(/^Sector /, ''));
  let region: string;
  if (bearings.length === 1) {
    region = `${bearings[0]} region`;
  } else {
    // Check if angular span < 90° (adjacent sectors)
    const indices = bearings.map(compassIndex).filter(i => i >= 0);
    if (indices.length >= 2) {
      const sorted = [...indices].sort((a, b) => a - b);
      const span = sorted[sorted.length - 1] - sorted[0];
      const wrapSpan = 16 - span;
      const minSpan = Math.min(span, wrapSpan);
      if (minSpan < 4) {
        // Within 90°, find midpoint bearing
        const mid = COMPASS_16[Math.round(sorted[Math.floor(sorted.length / 2)])] ?? bearings[0];
        region = `${mid} region`;
      } else {
        region = 'multiple sectors';
      }
    } else {
      region = 'multiple sectors';
    }
  }
  const verb = region.includes('multiple') ? 'show' : 'shows';
  return `The ${region} ${verb} ${dirWord(dir)} ${metricsPhrase(findings)}.`;
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

// Spatial-pattern label: e.g. "Edge-ring", "Center cluster"
function spatialPatternSentence(findings: StatsFinding[]): string {
  const f = findings[0];
  const conf = f.stats.method === 'geometry' ? ` (${f.severity === 'unusual' ? 'high' : f.severity === 'notable' ? 'medium' : 'low'} confidence)` : '';
  return `${f.comparison.left} failure pattern detected${conf}.`;
}

function buildSentence(family: StatsComparisonFamily, findings: StatsFinding[]): string {
  switch (family) {
    case 'ring':              return ringSentence(findings);
    case 'quadrant':          return quadrantSentence(findings);
    case 'sector':            return sectorSentence(findings);
    case 'cluster':           return clusterSentence(findings);
    case 'edge-arc':          return edgeArcSentence(findings);
    case 'reticle-position':  return reticlePositionSentence(findings);
    case 'spatial-pattern':   return spatialPatternSentence(findings);
    default:                  return '';
  }
}

export function buildFindingsNarrative(findings: StatsFinding[]): string {
  if (findings.length === 0) return '';

  const significant = findings.filter(f => f.severity !== 'info');
  if (significant.length === 0) {
    return 'Minor spatial variation detected; no strongly significant patterns.';
  }

  // Group by family
  const byFamily = new Map<StatsComparisonFamily, StatsFinding[]>();
  for (const f of significant) {
    const group = byFamily.get(f.comparison.family) ?? [];
    group.push(f);
    byFamily.set(f.comparison.family, group);
  }

  // Sort families: by count DESC, then by canonical priority
  const families = [...byFamily.keys()].sort((a, b) => {
    const countDiff = byFamily.get(b)!.length - byFamily.get(a)!.length;
    if (countDiff !== 0) return countDiff;
    return FAMILY_PRIORITY.indexOf(a) - FAMILY_PRIORITY.indexOf(b);
  });

  // Cap at 4 sentences
  const selectedFamilies = families.slice(0, 4);
  const sentences: string[] = [];

  for (const family of selectedFamilies) {
    const s = buildSentence(family, byFamily.get(family)!);
    if (s) sentences.push(s);
  }

  // Optional closing sentence when we have diverse metrics and families
  if (sentences.length < 4 && selectedFamilies.length >= 2) {
    const allMetrics = new Set<string>();
    for (const f of significant) allMetrics.add(metricLabel(f));
    if (allMetrics.size >= 3) {
      const labels = [...allMetrics];
      const closing = `Findings span ${allMetrics.size} metrics including ${labels[0]} and ${labels[1]}.`;
      sentences.push(closing);
    }
  }

  return sentences.join(' ');
}
