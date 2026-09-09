// The clustered horizontal bar plot: one cluster per row, a sub-bar per group.
//
// Extracted from `binCluster.ts` and `testPassRate.ts`, which were the same
// chart written twice — identical `CLUSTER_GAP`/`SUBBAR_GAP`/`SUBBAR_HEIGHT`
// constants, an identical `plotMetrics()`, an identical `subBarAt()` modulo
// whether it called the index `bin` or `row`, and an identical draw loop down
// to the order the hover highlight is painted in. The duplication was visible
// in the comments themselves: binCluster's said "same fix as
// charts/testPassRate.ts", and testPassRate's said "see binCluster.ts" — each
// file pointing at the other for the reasoning, which is what a shared
// component is for.
//
// What the two genuinely differ in is data, not drawing:
//   - bin counts normalise to the largest count in the chart; pass rates are a
//     fixed 0-100% axis, because a 99% and a 98% test must not both draw a
//     full-width bar.
//   - a pass rate can be "nothing measured" (drawn as an empty track saying so)
//     where a bin count cannot.
//   - the trailing value column is a count in one and a percentage in the other.
// All three are expressed here as inputs, so neither caller needs its own copy
// of the plot to say them.

import { categorical } from './palette.js';
import { SPACE, FONT, CLR } from '../toolbar.js';
import {
  observeResize, positionChartTooltip, growCardToFitContent, prepareCanvas,
  chartSwatchCss, PADDING, VALUE_WIDTH,
} from './chartShell.js';

const CLUSTER_GAP = 8;
const SUBBAR_GAP = 1;
const SUBBAR_HEIGHT = 14;
const DEFAULT_MAX_VISIBLE_ROWS = 8;

/** One cluster: a label, a sub-bar per group, and a trailing value. */
export interface GroupedBarRow {
  label: string;
  /**
   * One entry per group, in group order.
   *
   * `fraction` is the bar's share of the track, 0-1 — already resolved by the
   * caller, because that is exactly where the two charts differ (normalised to
   * the chart maximum vs a fixed 0-100% scale). `null` means nothing was
   * measured for this group, drawn as an empty track with `emptyBarText`
   * rather than a zero-width bar, which would read as a real zero.
   */
  bars: Array<{ fraction: number | null }>;
  /** Right-hand value column, formatted by the caller. */
  trailing: string;
}

export interface GroupedBarPlotOptions {
  rows: GroupedBarRow[];
  /** Group names, in the order `GroupedBarRow.bars` uses. Drives the legend. */
  groups: string[];
  /** Width reserved for the row labels. */
  labelWidth: number;
  /** Rows visible before the plot scrolls. */
  maxVisibleRows?: number;
  /** Show the group legend above the plot. */
  showLegend?: boolean;
  /** Truncate row labels beyond this many characters. Off when omitted. */
  maxLabelChars?: number;
  /** Drawn inside an empty track where `fraction` is null. */
  emptyBarText?: string;
  /** Sub-bar colour by group index. Defaults to the CVD-safe categorical ramp. */
  colorOf?: (groupIndex: number) => string;
  /** Tooltip HTML for a hovered sub-bar. */
  tooltipHtml: (rowIndex: number, groupIndex: number) => string;
}

export interface GroupedBarPlotHandle {
  /** Redraw — call when the theme changes or data is replaced. */
  draw(): void;
  destroy(): void;
}

/**
 * Build the legend, scroll area and canvas into `body`, and wire hover.
 *
 * `card` is needed for the theme and for tooltip positioning; `tooltip` is the
 * caller's own element so a panel keeps one tooltip across rebuilds.
 */
export function renderGroupedBarPlot(
  card: HTMLElement,
  body: HTMLElement,
  tooltip: HTMLElement,
  options: GroupedBarPlotOptions,
): GroupedBarPlotHandle {
  const {
    rows, groups, labelWidth, tooltipHtml,
    maxVisibleRows = DEFAULT_MAX_VISIBLE_ROWS,
    showLegend = true,
    maxLabelChars,
    emptyBarText,
    colorOf = categorical,
  } = options;

  const doc = card.ownerDocument;
  const seriesCount = Math.max(1, groups.length);
  const clusterHeight = seriesCount * SUBBAR_HEIGHT + (seriesCount - 1) * SUBBAR_GAP;
  const rowPitch = clusterHeight + CLUSTER_GAP;

  let legendHeight = 0;
  if (showLegend) {
    const legend = doc.createElement('div');
    Object.assign(legend.style, {
      display: 'flex', flexWrap: 'wrap', gap: `${SPACE.xs} ${SPACE.xl}`, marginBottom: SPACE.xs,
    } as Partial<CSSStyleDeclaration>);
    groups.forEach((g, i) => {
      const item = doc.createElement('span');
      Object.assign(item.style, {
        display: 'inline-flex', alignItems: 'center', gap: SPACE.sm,
        fontSize: FONT.body, color: CLR.text,
      } as Partial<CSSStyleDeclaration>);
      const sw = doc.createElement('span');
      // The shared chip. Both callers previously built a 10px `RADIUS.control`
      // square here by hand, which is a fourth copy of the colour key the chart
      // suite already standardised.
      sw.style.cssText = chartSwatchCss(colorOf(i));
      const txt = doc.createElement('span');
      txt.textContent = g;
      item.append(sw, txt);
      legend.appendChild(item);
    });
    body.appendChild(legend);
    legendHeight = legend.offsetHeight;
  }

  const scrollArea = doc.createElement('div');
  const visibleHeight = PADDING * 2 + Math.min(rows.length, maxVisibleRows) * rowPitch;
  // overflowX explicit, not left at its 'visible' default — pairing 'visible'
  // with overflowY's non-'visible' value forces it to compute as 'auto' per the
  // CSS overflow spec, adding an unintended horizontal scroll axis (see
  // chartShell.ts's cardShell() comment).
  Object.assign(scrollArea.style, {
    overflowX: 'hidden', overflowY: 'auto', minHeight: '0', flex: '1',
    maxHeight: `${visibleHeight}px`, scrollbarGutter: 'stable',
  } as Partial<CSSStyleDeclaration>);
  growCardToFitContent(card, body, legendHeight + visibleHeight);
  body.appendChild(scrollArea);

  const canvas = doc.createElement('canvas');
  canvas.style.display = 'block';
  canvas.style.cursor = 'default';
  scrollArea.appendChild(canvas);

  let hovered: { row: number; group: number } | null = null;

  function plotMetrics() {
    const barX = PADDING + labelWidth;
    const barMaxWidth = Math.max(10, canvas.clientWidth - barX - VALUE_WIDTH - PADDING);
    return { barX, barMaxWidth };
  }

  function subBarAt(offsetX: number, offsetY: number): { row: number; group: number } | null {
    const row = Math.floor((offsetY - PADDING) / rowPitch);
    if (row < 0 || row >= rows.length) return null;
    const within = (offsetY - PADDING) - row * rowPitch;
    const group = Math.floor(within / (SUBBAR_HEIGHT + SUBBAR_GAP));
    if (group < 0 || group >= seriesCount) return null;
    const { barX, barMaxWidth } = plotMetrics();
    if (offsetX < barX || offsetX > barX + barMaxWidth) return null;
    return { row, group };
  }

  function draw(): void {
    // scrollArea's own width, not the card's — stays correct once scrollArea's
    // vertical scrollbar is active (rows.length > maxVisibleRows).
    const width = scrollArea.clientWidth;
    const height = PADDING * 2 + rows.length * rowPitch;
    const prep = prepareCanvas(canvas, card, width, height);
    if (!prep) return;
    const { ctx, theme } = prep;

    const { barX, barMaxWidth } = plotMetrics();

    rows.forEach((row, ri) => {
      const clusterTop = PADDING + ri * rowPitch;

      // Hover highlight FIRST, before the label and bars. It spans the full row
      // width (x = 0 … width), so painting it inside the per-group loop — after
      // the label had already been drawn — covered the row's name with the
      // highlight wherever the hovered sub-bar overlapped the vertically centred
      // label. Both original charts carried this fix and a comment pointing at
      // the other one; there is now a single place for it to be right.
      if (hovered && hovered.row === ri) {
        const hy = clusterTop + hovered.group * (SUBBAR_HEIGHT + SUBBAR_GAP);
        ctx.fillStyle = theme.bgHover;
        ctx.fillRect(0, hy - 1, width, SUBBAR_HEIGHT + 2);
      }

      ctx.fillStyle = theme.text;
      ctx.textAlign = 'right';
      const label = maxLabelChars !== undefined && row.label.length > maxLabelChars
        ? `${row.label.slice(0, maxLabelChars - 1)}…`
        : row.label;
      ctx.fillText(label, PADDING + labelWidth - 8, clusterTop + clusterHeight / 2);

      row.bars.forEach((bar, gi) => {
        const y = clusterTop + gi * (SUBBAR_HEIGHT + SUBBAR_GAP);
        ctx.fillStyle = theme.track;
        ctx.fillRect(barX, y, barMaxWidth, SUBBAR_HEIGHT);
        if (bar.fraction === null) {
          if (emptyBarText) {
            ctx.fillStyle = theme.textMuted;
            ctx.textAlign = 'left';
            ctx.fillText(emptyBarText, barX + 4, y + SUBBAR_HEIGHT / 2);
          }
          return;
        }
        // A non-zero value always paints at least 1px, so "present but tiny"
        // never renders identically to "absent".
        const w = Math.max(bar.fraction > 0 ? 1 : 0, bar.fraction * barMaxWidth);
        ctx.fillStyle = colorOf(gi);
        ctx.fillRect(barX, y, w, SUBBAR_HEIGHT);
      });

      ctx.fillStyle = theme.text;
      ctx.textAlign = 'right';
      ctx.fillText(row.trailing, barX + barMaxWidth + VALUE_WIDTH, clusterTop + clusterHeight / 2);
    });
  }

  const onMove = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const hit = subBarAt(e.clientX - rect.left, e.clientY - rect.top);
    const changed = (hit?.row !== hovered?.row) || (hit?.group !== hovered?.group);
    hovered = hit;
    if (changed) draw();
    if (!hit) { tooltip.style.display = 'none'; return; }
    tooltip.innerHTML = tooltipHtml(hit.row, hit.group);
    tooltip.style.display = 'block';
    positionChartTooltip(tooltip, card, e.clientX, e.clientY);
  };
  const onLeave = () => {
    if (hovered) { hovered = null; draw(); }
    tooltip.style.display = 'none';
  };
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);

  const resizeHandle = observeResize(card, () => draw());
  draw();

  return {
    draw,
    destroy: () => {
      resizeHandle?.disconnect();
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
    },
  };
}
