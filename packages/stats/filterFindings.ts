import type {
  StatsFinding,
  StatsSummary,
  LotStatsSummary,
  StatsSeverity,
  StatsVariableKind,
  StatsComparisonFamily,
  StatsLevel,
} from './types.js';

export interface FindingsFilter {
  severity?: StatsSeverity | StatsSeverity[];
  kind?: StatsVariableKind | StatsVariableKind[];
  family?: StatsComparisonFamily | StatsComparisonFamily[];
  level?: StatsLevel | StatsLevel[];
}

function toArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

export function filterFindings(
  source: StatsSummary | LotStatsSummary,
  filter: FindingsFilter,
): StatsFinding[] {
  let findings = source.findings;

  if (filter.severity !== undefined) {
    const allowed = new Set(toArray(filter.severity));
    findings = findings.filter(f => allowed.has(f.severity));
  }
  if (filter.kind !== undefined) {
    const allowed = new Set(toArray(filter.kind));
    findings = findings.filter(f => allowed.has(f.variable.kind));
  }
  if (filter.family !== undefined) {
    const allowed = new Set(toArray(filter.family));
    findings = findings.filter(f => allowed.has(f.comparison.family));
  }
  if (filter.level !== undefined) {
    const allowed = new Set(toArray(filter.level));
    findings = findings.filter(f => allowed.has(f.level));
  }

  return findings;
}


/**
 * Drop findings another finding has claimed as an exact restatement of itself —
 * a soft-bin twin covering the same dies, or the single pass bin's row against
 * the yield row that says the same thing.
 *
 * The claimer's own label names what it absorbed ("hard bin and soft bin 3 (same
 * dies)"), so listing both prints one fact twice: once merged, once not. The full
 * uncollapsed list stays on `summary.findings` for any host that wants it.
 *
 * Extracted because this rule existed in three places and one of them was wrong:
 * the Summary panel and the findings report both applied it, while the summary
 * report printed every finding — so a wafer with 8 merged twins listed 16 rows,
 * each duplicate contradicting the merge the label had just described.
 */
export function visibleFindings<T extends { id: string; absorbedIds?: string[] }>(findings: T[]): T[] {
  const claimed = new Set(findings.flatMap(f => f.absorbedIds ?? []));
  return findings.filter(f => !claimed.has(f.id));
}
