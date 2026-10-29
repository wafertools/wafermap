// The numbers behind a plot, as a table: what Save data as CSV and Copy data write.
//
// One table per kind of mark, in the terms the chart is drawn in: a scatter is its points, a histogram or a probability
// plot its values, a box its five-number summary per category and colour, a bar or line its value per category or X, a
// heatmap its cells, a control chart its points and limits, a goal plot its tests. A plot of panels is its panels' tables
// one after another, with the panel named. Pure and DOM-free, so the same rows serve the menu, tests and a host.

import type { CsvColumn } from '../core/tableCsv.js';
import { quantile } from './math.js';
import { probabilityPosition, type PlotMarks, type ResolvedAxis, type ResolvedPlot } from './plotData.js';

export type PlotTableCell = string | number | null;
export type PlotTableRow = PlotTableCell[];

export interface PlotTable {
  /** A file name stem: the plot's title, safe to use. */
  name: string;
  columns: CsvColumn<PlotTableRow>[];
  rows: PlotTableRow[];
}

const axisName = (a: ResolvedAxis | undefined, fallback: string): string => (a ? (a.unit ? `${a.label} (${a.unit})` : a.label) : fallback);
const finite = (v: number): number | null => (Number.isFinite(v) ? v : null);

const columnsOf = (headers: readonly string[]): CsvColumn<PlotTableRow>[] => headers.map((header, i) => ({ header, get: row => row[i] ?? null }));

/** A title as a file name stem: letters, numbers and single dashes. */
export function fileStem(title: string): string {
  return title.normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'plot';
}

/** The table of one plot (not its panels), or undefined for a plot with nothing drawn. */
function tableOfMarks(r: ResolvedPlot, marks: PlotMarks, waferOf: (item: number) => string): { headers: string[]; rows: PlotTableRow[] } | undefined {
  const group = (g: number): string => r.groups[g] ?? '';
  const grouped = r.groups.length > 1;
  const gHeader = grouped ? [r.colorLabel ?? 'Group'] : [];
  const gCell = (g: number): PlotTableCell[] => (grouped ? [group(g)] : []);

  switch (marks.type) {
    case 'scatter': {
      const dieCols = marks.points.some(p => p.die && p.die.x !== undefined);
      const headers = ['Wafer', ...(dieCols ? ['Die X', 'Die Y'] : []), axisName(r.x, 'X'), axisName(r.y, 'Y'), ...gHeader, ...(r.colorScale ? [r.colorScale.label] : [])];
      const rows = marks.points.map(p => [
        waferOf(p.item), ...(dieCols ? [p.die?.x ?? null, p.die?.y ?? null] : []), finite(p.x), finite(p.y), ...gCell(p.group), ...(r.colorScale ? [p.value === undefined ? null : finite(p.value)] : []),
      ]);
      return { headers, rows };
    }
    case 'histogram':
    case 'probability': {
      const isProb = marks.type === 'probability';
      const probe = marks.values.flatMap((vs, g) => vs.map((_, k) => marks.unit(marks.units[g][k]).die)).some(d => d && d.x !== undefined);
      const headers = ['Wafer', ...(probe ? ['Die X', 'Die Y'] : []), ...gHeader, axisName(r.x, 'Value'), ...(isProb ? ['Cumulative share (%)'] : [])];
      const rows: PlotTableRow[] = [];
      marks.values.forEach((vs, g) => {
        vs.forEach((v, k) => {
          const u = marks.unit(marks.units[g][k]);
          rows.push([waferOf(u.item), ...(probe ? [u.die?.x ?? null, u.die?.y ?? null] : []), ...gCell(g), finite(v), ...(isProb ? [100 * probabilityPosition(k, vs.length)] : [])]);
        });
      });
      return { headers, rows };
    }
    case 'box': {
      const levels = marks.nest?.levels ?? [r.x?.label ?? 'Category'];
      const headers = [...levels, ...gHeader, 'N', 'Min', 'Q1', 'Median', 'Q3', 'Max'];
      const rows: PlotTableRow[] = [];
      marks.categories.forEach((cat, c) => {
        marks.cells.forEach((byCat, g) => {
          const sorted = byCat[c].filter(Number.isFinite).sort((a, b) => a - b);
          if (sorted.length === 0) return;
          const label = marks.nest ? marks.nest.parts[c] : [cat];
          rows.push([...label, ...gCell(g), sorted.length, sorted[0], quantile(sorted, 0.25), quantile(sorted, 0.5), quantile(sorted, 0.75), sorted[sorted.length - 1]]);
        });
      });
      return { headers, rows };
    }
    case 'bar': {
      const levels = marks.nest?.levels ?? [r.x?.label ?? 'Category'];
      const headers = [...levels, ...gHeader, axisName(r.y, 'Value'), 'N', ...(marks.cumulative ? ['Cumulative share (%)'] : [])];
      const rows: PlotTableRow[] = [];
      marks.categories.forEach((cat, c) => {
        marks.values.forEach((byCat, g) => {
          const v = byCat[c];
          if (!Number.isFinite(v)) return;
          const label = marks.nest ? marks.nest.parts[c] : [cat];
          rows.push([...label, ...gCell(g), v, marks.cells[g]?.[c]?.length ?? null, ...(marks.cumulative ? [finite(marks.cumulative[c])] : [])]);
        });
      });
      return { headers, rows };
    }
    case 'line': {
      const band = marks.band;
      const headers = [axisName(r.x, 'X'), ...gHeader, axisName(r.y, 'Value'), 'N', ...(band ? ['Band low', 'Band high'] : [])];
      const rows: PlotTableRow[] = [];
      marks.xs.forEach((x, k) => {
        marks.values.forEach((byX, g) => {
          const v = byX[k];
          if (!Number.isFinite(v)) return;
          rows.push([x, ...gCell(g), v, marks.counts[g]?.[k] ?? null, ...(band ? [finite(band.lo[g][k]), finite(band.hi[g][k])] : [])]);
        });
      });
      return { headers, rows };
    }
    case 'control': {
      const flagged = new Map(marks.violations.map(v => [v.index, v.rules.join(' ')]));
      const headers = [axisName(r.x, 'Order'), 'Wafer', axisName(r.y, 'Value'), 'Centre', 'Lower limit', 'Upper limit', 'Rules broken'];
      const rows = marks.xs.map((x, k) => [x, waferOf(marks.items[k]), finite(marks.values[k]), marks.limits.centre, marks.limits.lcl, marks.limits.ucl, flagged.get(k) ?? '']);
      return { headers, rows };
    }
    case 'heatmap': {
      // A heatmap's axes name its rows and columns; the colour key names the value.
      const headers = [r.y?.label ?? 'Row', r.x?.label ?? 'Column', r.colorScale?.label ?? 'Value', 'N'];
      const rows: PlotTableRow[] = [];
      marks.rows.forEach((row, ri) => marks.cols.forEach((col, ci) => {
        const v = marks.values[ri][ci];
        if (Number.isFinite(v)) rows.push([row, col, v, marks.cellUnits[ri][ci].length]);
      }));
      return { headers, rows };
    }
    case 'goal': {
      const headers = ['Test number', 'Test', ...gHeader, 'Mean offset (share of limit window)', 'Spread (share of limit window)', 'Ppk', 'N', 'Limits'];
      const rows = marks.points.map(p => [p.testNumber, p.label, ...gCell(p.group), finite(p.x), finite(p.y), finite(p.ppk), p.n, p.basis === 'spec' ? 'spec' : 'test']);
      return { headers, rows };
    }
  }
}

/**
 * The table behind a resolved plot, or undefined when nothing is drawn. `waferLabel(i)` names the wafer of item i.
 * A plot of panels gives each panel's rows under a Panel column.
 */
export function plotTable(r: ResolvedPlot, waferLabel: (item: number) => string): PlotTable | undefined {
  const waferOf = (item: number): string => waferLabel(item) ?? '';
  const name = fileStem(r.spec.title ?? r.autoTitle);
  if (r.facets?.length) {
    let headers: string[] | undefined;
    const rows: PlotTableRow[] = [];
    for (const f of r.facets) {
      if (!f.plot.marks) continue;
      const t = tableOfMarks(f.plot, f.plot.marks, waferOf);
      if (!t) continue;
      headers ??= [r.facetLabel ?? 'Panel', ...t.headers];
      for (const row of t.rows) rows.push([f.label, ...row]);
    }
    return headers ? { name, columns: columnsOf(headers), rows } : undefined;
  }
  if (!r.marks) return undefined;
  const t = tableOfMarks(r, r.marks, waferOf);
  return t ? { name, columns: columnsOf(t.headers), rows: t.rows } : undefined;
}
