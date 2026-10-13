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

/**
 * What makes two findings "the same pattern" on different wafers. One key for
 * the lot's wafer count and the gallery's per-card highlight of a lot finding.
 */
export function findingPatternKey(f: StatsFinding): string {
  return [
    f.variable.kind, f.variable.index ?? '', f.variable.bin ?? '',
    f.comparison.family, f.comparison.left, f.effect.direction,
  ].join('|');
}

// ── How a findings list is arranged ───────────────────────────────────────────

/** A findings list as the reader sees it: patterns with the findings they explain, then the rest grouped by region. */
export interface ArrangedFindings {
  /** Spatial-pattern findings, each with the findings in the list it names as supporting detail, most severe first. */
  patterns: Array<{ finding: StatsFinding; children: StatsFinding[] }>;
  /**
   * Everything else grouped by region (`family` and `left`), the most severe group first and within it too. A cluster
   * of one bin leads a group of its own with the region findings of that bin it explains after it.
   */
  groups: Array<{ family: string; left: string; worst: StatsSeverity; findings: StatsFinding[] }>;
}

const SEVERITY_ORDER: Record<StatsSeverity, number> = { unusual: 0, notable: 1, info: 2 };

/**
 * The one arrangement of a findings list, read by the Summary panel and both HTML reports, so a
 * finding sits under the same heading and in the same order on every surface.
 *
 * A finding a pattern lists as supporting detail is shown under its pattern, and one a cluster lists
 * (its bin's rise in a region it makes up) in the cluster's group; neither is repeated among the
 * region groups. A finding another absorbed as an exact restatement is not shown anywhere (it stays in
 * `summary.findings` for a host reading them programmatically). Not every finding's `relatedIds`: a
 * run-merge records the constituents it replaced there, and those are gone.
 */
export function arrangeFindings(findings: readonly StatsFinding[]): ArrangedFindings {
  const absorbed = new Set(findings.flatMap((f) => f.absorbedIds ?? []));
  const shown = findings.filter((f) => !absorbed.has(f.id));
  const patternFindings = shown.filter((f) => f.comparison.family === 'spatial-pattern');
  const underPattern = new Set(patternFindings.flatMap((f) => f.relatedIds ?? []));
  // Each finding a cluster explains, by the cluster that leads it; the first cluster to name it keeps it.
  const leadOf = new Map<string, StatsFinding>();
  for (const c of shown) {
    if (c.comparison.family !== 'cluster') continue;
    for (const id of c.relatedIds ?? []) if (!underPattern.has(id) && !leadOf.has(id)) leadOf.set(id, c);
  }
  const bySeverity = (a: StatsFinding, b: StatsFinding) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  // Children most severe first, like the groups: in analysis order an unusual
  // finding sat below minor ones and read as less important. A cluster the pattern
  // explains brings the findings it explains with it.
  const patterns = patternFindings.map((finding) => {
    const own = shown.filter((f) => finding.relatedIds?.includes(f.id));
    const brought = shown.filter((f) => own.includes(leadOf.get(f.id)!));
    return { finding, children: [...own, ...brought].sort(bySeverity) };
  });

  const byRegion = new Map<string, StatsFinding[]>();
  const keyOf = (f: StatsFinding) => `${f.comparison.family}\0${f.comparison.left}`;
  for (const f of shown) {
    if (f.comparison.family === 'spatial-pattern' || underPattern.has(f.id)) continue;
    const lead = leadOf.get(f.id);
    if (lead && underPattern.has(lead.id)) continue;
    const key = keyOf(lead ?? f);
    byRegion.set(key, [...(byRegion.get(key) ?? []), f]);
  }
  const groups = [...byRegion.entries()].map(([key, members]) => {
    // A cluster leads the findings it explains, whatever their severity.
    const sorted = [...members].sort((a, b) =>
      Number(leadOf.has(a.id)) - Number(leadOf.has(b.id)) || bySeverity(a, b));
    const [family, left] = key.split('\0');
    return { family, left, worst: [...members].sort(bySeverity)[0].severity, findings: sorted };
  });
  groups.sort((a, b) => SEVERITY_ORDER[a.worst] - SEVERITY_ORDER[b.worst]);
  return { patterns, groups };
}
