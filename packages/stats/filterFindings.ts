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
