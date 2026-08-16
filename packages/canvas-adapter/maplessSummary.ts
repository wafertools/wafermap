// Compact, plot-mode-aware summary for a set of dies with no position data —
// used wherever buildDieListSection's dense table doesn't fit (a small
// gallery card, the mixed-wafer footer's expanded panel). Deliberately reuses
// existing building blocks rather than inventing a new chart type:
//   - bin modes (hardBin/softBin) reuse summaryPanel.ts's buildBinSection
//     directly, so colours are guaranteed to match a positioned card's own
//     bin legend (same colour-scheme function) with zero new rendering code.
//   - value mode gets a small histogram built from stats/histogram.ts's pure
//     buildTestHistogramData — not the full Insights-tab renderHistogramPanel,
//     which is ~230px with axis/dropdown chrome too heavy for a card corner.
//   - every other mode (metadata, stacked-*, yield) falls back to a one-line
//     message rather than silently rendering a blank panel — see
//     WMAP_ISSUES.md #39's follow-up entry for why metadata/stacked modes
//     don't get a dedicated representation yet.

import type { Die } from '../core/dies.js';
import type { TestDef, BinDef } from '../renderer/buildWaferMap.js';
import { getDieTestValue } from '../renderer/buildWaferMap.js';
import type { PlotMode } from '../renderer/buildView.js';
import { resolveTestNumber, findTestDef } from '../renderer/buildView.js';
import { buildBinSection } from './summaryPanel.js';
import { buildTestHistogramData, type HistogramBucket } from '../stats/histogram.js';
import { getColorScheme } from '../renderer/colorSchemes.js';
import { CLR, getTooltip, positionTooltip, hideTooltip } from './toolbar.js';
import { fmt as fmtValue } from '../renderer/fmt.js';

export interface MaplessSummaryOptions {
  plotMode: PlotMode;
  activeTest?: number;
  hbinDefs?: BinDef[];
  sbinDefs?: BinDef[];
  colorScheme?: string;
  /** Effective log-scale setting for the active test — same resolution the
   *  map itself uses (explicit viewOpts.logScale, falling back to the
   *  TestDef's own default). */
  logScale?: boolean;
  /** 'spec' colours the full spec-limit window (like the map's colorbar
   *  range toggle); 'data' colours just the observed value range. Default 'spec'. */
  colorbarRangeMode?: 'data' | 'spec';
  /**
   * Full wafer/lot die population for this test (positioned + unpositioned),
   * used only to compute the value→colour range — NOT what gets bucketed
   * into bars, which always stays scoped to `dies` (the caller's own
   * argument, below). Falls back to `dies` when omitted. Passing the full
   * population (e.g. a mixed wafer's footer passing every die, not just the
   * unpositioned subset it's charting) keeps bar colours consistent with
   * whatever range the wafer's own visible map is using for the same test.
   */
  valueRangeDies?: Die[];
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  styles?: Partial<CSSStyleDeclaration>,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (styles) Object.assign(e.style, styles);
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * Wires the same shared, themed tooltip the map's own die hover uses
 * (getTooltip/positionTooltip/hideTooltip, toolbar.ts) onto a plain DOM
 * element — native `title` attributes were used here originally, which is a
 * different, browser-native tooltip: slow to appear (OS hover delay) and an
 * unthemed system font/colour, unlike this instant, small, dark tooltip
 * every other hover surface in the app already uses.
 *
 * Unlike the map canvas (where per-die hover data has no DOM equivalent to
 * fall back to), these bars are real elements — so the bucket range/count
 * this tooltip carries is real information with no other visible copy. Also
 * wires focus/blur alongside mouse events (WCAG 1.4.13 — content shown on
 * hover must also be reachable and dismissable via keyboard) and sets
 * `aria-label` so the same text reaches a screen reader without requiring
 * either hover or focus. `tabIndex=0`/`role="img"` make the bar a stop on
 * the page's own tab order and announce it as a single data point, not an
 * unlabelled generic `div`.
 */
function wireHoverTooltip(target: HTMLElement, text: string): void {
  target.tabIndex = 0;
  target.setAttribute('role', 'img');
  target.setAttribute('aria-label', text);
  const show = (e?: MouseEvent) => {
    const tooltip = getTooltip(target.ownerDocument);
    tooltip.textContent = text;
    tooltip.style.display = 'block';
    if (e) {
      positionTooltip(tooltip, target, e.clientX, e.clientY);
    } else {
      // Keyboard focus carries no pointer coordinates — anchor the tooltip to
      // the bar's own box instead of a cursor position that doesn't exist.
      const r = target.getBoundingClientRect();
      positionTooltip(tooltip, target, r.left + r.width / 2, r.top);
    }
  };
  const hide = () => hideTooltip(target.ownerDocument);
  target.addEventListener('mousemove', show);
  target.addEventListener('mouseleave', hide);
  target.addEventListener('focus', () => show());
  target.addEventListener('blur', hide);
}

/**
 * Value→[0,1] normalizer for colouring, resolved the same way buildView.ts's
 * own (non-exported) normalize does: spec-range or data-range window, then
 * linear or log10 — so a value here and the same value on the actual map
 * (when one is drawn) land on the same colour. Duplicated rather than
 * imported because buildView's version is private to one big function body,
 * closed over `dies: PositionedDie[]`; re-deriving the ~20 lines of range
 * logic here is cheaper and less risky than exporting/refactoring that
 * function during this pass.
 */
function resolveValueNormalize(
  rangeDies: Die[], testNumber: number, testDef: TestDef | undefined,
  colorbarRangeMode: 'data' | 'spec', logScale: boolean,
): (v: number) => number {
  let lo = Infinity, hi = -Infinity;
  for (const d of rangeDies) {
    const v = getDieTestValue(d, testNumber);
    if (v !== undefined) { if (v < lo) lo = v; if (v > hi) hi = v; }
  }
  const useSpecRange = colorbarRangeMode === 'spec' &&
    testDef && (testDef.limitLow !== undefined || testDef.limitHigh !== undefined);
  let vMin: number, vMax: number;
  if (useSpecRange) {
    vMin = testDef!.limitLow  !== undefined ? testDef!.limitLow  : (isFinite(lo) ? lo : 0);
    vMax = testDef!.limitHigh !== undefined ? testDef!.limitHigh : (isFinite(hi) ? hi : 1);
  } else {
    vMin = isFinite(lo) ? lo : 0;
    vMax = isFinite(hi) ? hi : 1;
  }
  if (vMin === vMax) vMax = vMin + 1;

  const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
  if (logScale && vMin > 0 && vMax > 0) {
    const logMin = Math.log10(vMin);
    const logRange = Math.log10(vMax) - logMin;
    return (v: number) => (v <= 0 ? 0 : clamp01((Math.log10(v) - logMin) / logRange));
  }
  return (v: number) => clamp01((v - vMin) / (vMax - vMin));
}

function buildMiniHistogram(
  buckets: HistogramBucket[], testDef: TestDef | undefined, testNumber: number,
  colorScheme: string | undefined, rangeDies: Die[],
  colorbarRangeMode: 'data' | 'spec', logScale: boolean,
): HTMLDivElement {
  // flex:1;minHeight:0 — lets this stretch to fill whatever height its
  // container (contentMount, renderWaferMap.ts) actually has, rather than
  // sizing to its own fixed-height content and leaving the rest of a large
  // card empty. barsRow (below) gets the same treatment so it's the chart
  // area that grows, not the fixed-height title/axis/label rows around it.
  const wrap = el('div', { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0', flex: '1', minHeight: '0' });
  wrap.appendChild(el('div', {
    fontSize: '10px', fontWeight: '700', letterSpacing: '0.06em', textTransform: 'uppercase', color: CLR.label,
  }, testDef?.name ? `${testDef.name} distribution` : 'Value distribution'));

  const spanLow = buckets[0]!.rangeLow;
  const spanHigh = buckets[buckets.length - 1]!.rangeHigh;
  const span = spanHigh - spanLow || 1;
  // Axis position (where a bucket/limit sits left-to-right in this chart) —
  // always linear over the bucket range, independent of colour normalize.
  const axisT = (v: number) => Math.min(1, Math.max(0, (v - spanLow) / span));

  // Bars coloured by bucket midpoint value through the same colour-scheme
  // function AND the same value→[0,1] range/log resolution the map's own
  // value-mode colorbar uses — so a bar and the map (or the map's colour
  // legend) agree on what a given reading looks like regardless of the
  // log-scale/colorbar-range toggles currently active.
  const scheme = getColorScheme(colorScheme);
  const normalize = resolveValueNormalize(rangeDies, testNumber, testDef, colorbarRangeMode, logScale);
  const maxCount = Math.max(1, ...buckets.map(b => b.count));
  const barsRow = el('div', {
    position: 'relative', display: 'flex', alignItems: 'flex-end', gap: '2px',
    flex: '1', minHeight: '48px',
  });
  for (const b of buckets) {
    // No minimum-height floor — a zero-count bucket gets no visible bar,
    // matching the Insights histogram's own convention (charts/histogram.ts:
    // `barHeight = (bucket.count / maxCount) * plotMaxHeight`, zero for an
    // empty bucket). An earlier version floored this at 2% so every bucket
    // stayed hoverable, which reads as "there's a die here" for a range that
    // has none — standard histograms don't do that, and neither should this.
    const bar = el('div', {
      flex: '1', minWidth: '2px',
      background: scheme.forValue(normalize((b.rangeLow + b.rangeHigh) / 2)),
      height: `${(b.count / maxCount) * 100}%`,
      borderRadius: '1px 1px 0 0',
    });
    // No styling purpose — a stable selector for tests, since this element
    // carries no native title attribute any more (see wireHoverTooltip).
    bar.dataset.wmapBar = '1';
    wireHoverTooltip(bar, `${fmtValue(b.rangeLow, testDef?.unit)} – ${fmtValue(b.rangeHigh, testDef?.unit)}: ${b.count}`);
    barsRow.appendChild(bar);
  }

  // Spec-limit markers (LSL/USL) — buildTestHistogramData was already asked
  // to expand its bucket range to include limitLow/limitHigh (below), so any
  // limit that falls inside [rangeLow, rangeHigh] here is guaranteed to land
  // on the visible axis. Solid (not dashed) high-contrast line + a white-on-
  // dark chip for the label — the bars are now a full colour gradient, so a
  // thin dashed line in a single accent colour could disappear against a
  // similarly-coloured bar; the chip stays legible regardless of what's
  // behind it. Mirrors the Insights histogram's dashed-line convention
  // loosely (charts/histogram.ts) — that one draws over a flat/mostly-empty
  // canvas background, so a dashed line alone is enough there.
  const limits: { pct: number; text: string }[] = [];
  for (const [limit, label] of [[testDef?.limitLow, 'LSL'], [testDef?.limitHigh, 'USL']] as const) {
    if (limit === undefined || limit < spanLow || limit > spanHigh) continue;
    const pct = axisT(limit) * 100;
    // pointerEvents:'none' — the marker sits on top of a bar and must let
    // mouse events pass through to it for that bar's own hover tooltip to
    // fire, so it deliberately carries no hover of its own; its LSL/USL
    // value is already always-visible via the label chip below, not
    // hover-gated.
    const marker = el('div', {
      position: 'absolute', top: '0', bottom: '0', left: `${pct}%`, width: '2px', marginLeft: '-1px',
      background: CLR.value, boxShadow: `0 0 0 1px ${CLR.panelBg}`, pointerEvents: 'none',
    });
    marker.dataset.wmapLimitMarker = '1'; // stable selector for tests, no styling purpose
    barsRow.appendChild(marker);
    limits.push({ pct, text: `${label} ${fmtValue(limit, testDef?.unit)}` });
  }
  wrap.appendChild(barsRow);

  // One label per marker, each anchored under its own line (not a single
  // combined string) — a prior version joined both into one right-aligned
  // row, which visually read as "both labels belong to USL" whenever LSL
  // and USL sat close together.
  if (limits.length) {
    const labelsRow = el('div', { position: 'relative', height: '14px' });
    for (const { pct, text } of limits) {
      const clampedPct = Math.min(96, Math.max(4, pct));
      labelsRow.appendChild(el('span', {
        position: 'absolute', left: `${clampedPct}%`, top: '0', transform: 'translateX(-50%)', whiteSpace: 'nowrap',
        fontSize: '9px', fontWeight: '600', color: CLR.text, background: CLR.panelBg,
        border: `1px solid ${CLR.value}`, borderRadius: '2px', padding: '0 3px', lineHeight: '12px',
      }, text));
    }
    wrap.appendChild(labelsRow);
  }

  const axisRow = el('div', { display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: CLR.label });
  axisRow.appendChild(el('span', {}, fmtValue(buckets[0]!.rangeLow, testDef?.unit)));
  axisRow.appendChild(el('span', {}, fmtValue(buckets[buckets.length - 1]!.rangeHigh, testDef?.unit)));
  wrap.appendChild(axisRow);

  return wrap;
}

/**
 * Compact, plot-mode-aware summary for dies with no position data. Always
 * returns a mountable element — an unhandled mode/empty data still renders a
 * one-line message rather than leaving the caller with nothing to show.
 */
export function buildMaplessSummary(
  dies: Die[],
  testDefs: TestDef[] | undefined,
  options: MaplessSummaryOptions,
): HTMLElement {
  const {
    plotMode, activeTest, hbinDefs, sbinDefs, colorScheme,
    logScale = false, colorbarRangeMode = 'spec', valueRangeDies,
  } = options;

  if (plotMode === 'hardBin' || plotMode === 'softBin') {
    const binDefs = plotMode === 'hardBin' ? hbinDefs : sbinDefs;
    const section = buildBinSection(dies, binDefs, plotMode === 'hardBin' ? 'hard' : 'soft', colorScheme);
    if (section) return section;
  } else if (plotMode === 'value') {
    const { testNumber } = resolveTestNumber(activeTest ?? 0, testDefs);
    const testDef = findTestDef(testDefs, activeTest ?? 0);
    const buckets = buildTestHistogramData([{ dies }], testNumber, 12, testDef?.limitLow, testDef?.limitHigh);
    if (buckets.length) {
      return buildMiniHistogram(
        buckets, testDef, testNumber, colorScheme, valueRangeDies ?? dies, colorbarRangeMode, logScale,
      );
    }
  }

  return el('div', {
    padding: '12px', fontSize: '11px', color: CLR.label, textAlign: 'center',
  }, 'No summary available for this view.');
}
