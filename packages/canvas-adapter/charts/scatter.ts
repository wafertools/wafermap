// Scatter panel — die-level X/Y scatter for two parametric tests, coloured
// by hard bin with a click-to-filter legend. Returns `{ card, setXY,
// destroy }` so the correlation matrix can update X/Y in place. Ported from
// tsmap's charts/scatter.ts.
//
// Grouping is a fourth distinct pattern (verified by reading the real
// source, not assumed): unlike capability/correlation's restrict-dropdown
// or boxplot's drill-in-place, scatter never restricts — every group's
// points are always plotted together, just coloured by group instead of
// hard bin, with a click-to-filter (not click-to-emphasize) legend.
//
// Trimmed from tsmap's version for this port: legend swatches use the
// native `title` attribute instead of porting tsmap's `attachTooltip` chrome
// helper, matching histogram's same trim.

import { getColorScheme } from '../../renderer/colorSchemes.js';
import { categorical } from './palette.js';
import { buildScatterData, buildScatterDataGrouped, type ScatterItem, type ScatterPoint } from '../../stats/scatter.js';
import { buildFacetTable, type FacetItem } from '../../stats/facets.js';
import type { Die } from '../../core/dies.js';
import type { TestDef } from '../../renderer/buildWaferMap.js';
import { CLR } from '../toolbar.js';
import { cardShell, observeResize, makeTooltip, makeTestSelect, makeWaferSelect, chartFillHeight, applyCanvasFlow, drawAxisUnit, resolveChartCanvasColors, makeAxisFormat, type SaveImageHandler } from './chartShell.js';

const SCATTER_LEFT = 52;
const SCATTER_RIGHT = 16;
const SCATTER_TOP = 16;
const SCATTER_BOTTOM = 44;

type ScatterPanelItem = FacetItem & ScatterItem & { label?: string };

export interface ScatterPanelOptions {
  title?: string;
  items: ScatterPanelItem[];
  testDefs: TestDef[];
  xTestNumber?: number;
  yTestNumber?: number;
  colorScheme?: string;
  onSaveImage?: SaveImageHandler;
  /**
   * When the Analysis tab's "Group by" is active, every group's points are
   * plotted together (never restricted to one group, unlike capability/
   * correlation) but coloured by group instead of hard bin, with a
   * click-to-filter legend keyed on group instead of bin. `items` above is
   * used to compute the Simpson's-paradox warning when `groups` is absent;
   * ignored for point data when `groups` is provided.
   */
  groups?: { key: string; items: ScatterPanelItem[] }[];
}

export interface ScatterPanelHandle {
  card: HTMLElement;
  /** Cross-panel link (e.g. from the correlation matrix): switch X/Y in place. */
  setXY: (xTestNumber: number, yTestNumber: number) => void;
  destroy: () => void;
}

export function renderScatterPanel(options: ScatterPanelOptions): ScatterPanelHandle {
  const { title = 'Test scatter', items, testDefs, colorScheme = 'default', onSaveImage, groups } = options;
  const { card, body, controlsRow } = cardShell(title, onSaveImage);

  const testOptions = testDefs.filter((d): d is TestDef & { testNumber: number } => d.testNumber !== undefined);
  const byGroup = !!(groups && groups.length > 0);
  const groupKeys = (groups ?? []).map(g => g.key);
  const groupColorIndex = new Map<string, number>(groupKeys.map((g, i) => [g, i]));

  let activeX = options.xTestNumber ?? testOptions[0]?.testNumber ?? null;
  let activeY = options.yTestNumber ?? testOptions[1]?.testNumber ?? activeX;
  // Only meaningful when ungrouped (scatter never restricts a group — see
  // the file header — so this scope control only applies to the ungrouped
  // "every wafer pooled" case, same as histogram/correlation). Narrowing to
  // one wafer also resolves the Simpson's-paradox warning below, since a
  // single wafer can't be "mixed".
  let activeWaferIndex: number | null = null;
  const currentItems = (): ScatterPanelItem[] =>
    activeWaferIndex !== null ? (items[activeWaferIndex] ? [items[activeWaferIndex]] : []) : items;

  function makeLabeledTestSelect(labelText: string, selected: number | null, onChange: (n: number) => void): { wrap: HTMLElement; select: HTMLElement & { value: string } } {
    const wrap = document.createElement('label');
    Object.assign(wrap.style, { display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: CLR.label } as Partial<CSSStyleDeclaration>);
    const lbl = document.createElement('span');
    lbl.textContent = labelText;
    const select = makeTestSelect(testOptions, selected, onChange, { maxWidth: '180px', emptyText: 'No tests' });
    wrap.append(lbl, select);
    return { wrap, select };
  }

  const { wrap: xWrap, select: xSel } = makeLabeledTestSelect('X:', activeX, n => { activeX = n; rebuildBody(); });
  const { wrap: yWrap, select: ySel } = makeLabeledTestSelect('Y:', activeY, n => { activeY = n; rebuildBody(); });
  controlsRow.append(xWrap, yWrap);
  if (!byGroup && items.length > 1) {
    controlsRow.appendChild(makeWaferSelect(items, activeWaferIndex, i => { activeWaferIndex = i; rebuildBody(); }));
  }

  const warn = document.createElement('div');
  Object.assign(warn.style, { color: CLR.warnText, background: CLR.warnBg, border: `1px solid ${CLR.warnBorder}`, borderRadius: '4px', padding: '4px 8px', fontSize: '11px', marginBottom: '4px', display: 'none' } as Partial<CSSStyleDeclaration>);
  card.insertBefore(warn, body);

  // Recomputed on every rebuild (not just at construction) — narrowing the
  // new "Wafer:" selector to a single wafer can resolve the mix that
  // triggered this warning, so it must not stay stuck on once shown.
  function syncMixedFieldsWarning(): void {
    const mixedFields = !byGroup ? buildFacetTable(currentItems(), { facetableOnly: true }).filter(f => f.splittable).map(f => f.label) : [];
    if (mixedFields.length > 0) {
      warn.textContent = `⚠ Mixed ${mixedFields.join(', ')} across these points — trends here may be confounded (Simpson's paradox). Use Group by, or the Wafer picker, to narrow to a like-for-like set.`;
      warn.style.display = '';
    } else {
      warn.style.display = 'none';
    }
  }
  syncMixedFieldsWarning();

  const hint = document.createElement('div');
  hint.textContent = byGroup
    ? 'One point per die · coloured by group · click legend to filter'
    : 'One point per die across all wafers · coloured by hard bin · click legend to filter';
  Object.assign(hint.style, { color: CLR.label, fontSize: '11px', marginBottom: '4px' } as Partial<CSSStyleDeclaration>);
  card.insertBefore(hint, body);

  const scheme = getColorScheme(colorScheme);
  const { forBin } = scheme;
  // Bin 0 is the codebase-wide no-data grey sentinel (BIN_PALETTE[0] in every
  // registered colour scheme) — a die with no hard-bin result is categorized
  // there rather than coerced into a real bin, matching the wafer map's own
  // "missing bin ≠ bin 0/any bin" rule.
  const categoryOf = (p: ScatterPoint): string => byGroup ? (p.group ?? '—') : String(p.hbin ?? 0);
  const colorOfCategory = (cat: string): string => {
    // Bin identity keeps the map's registered scheme (`forBin`) so a bin is
    // the same colour here as on the wafer map — including the accessible
    // scheme when selected. Facet groups have no map identity, so they use
    // the fixed CVD-safe categorical palette instead (palette.ts).
    if (byGroup) return categorical(groupColorIndex.get(cat) ?? 0);
    return forBin(Number(cat));
  };
  const labelOfCategory = (cat: string): string => byGroup ? cat : cat === '0' ? 'No bin data' : `Bin ${cat}`;
  const activeCats = new Set<string>();

  const legend = document.createElement('div');
  Object.assign(legend.style, { display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' } as Partial<CSSStyleDeclaration>);
  body.appendChild(legend);

  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  canvas.style.cursor = 'crosshair';
  body.appendChild(canvas);

  const dpr = window.devicePixelRatio || 1;
  const tooltip = makeTooltip(card);

  let points: ScatterPoint[] = [];
  let xLo = 0, xHi = 1, yLo = 0, yHi = 1;

  function testMeta(testNumber: number): { unit?: string; limitLow?: number; limitHigh?: number } {
    const def = testDefs.find(d => d.testNumber === testNumber);
    return { unit: def?.unit, limitLow: def?.limitLow, limitHigh: def?.limitHigh };
  }

  function dims() {
    // body's own width, not card's — canvas fills body via applyCanvasFlow,
    // so measuring from it directly stays correct even when body has its
    // own horizontal scrollbar narrowing it. body's overflow-y is 'hidden'
    // (cardShell default) so this can no longer be perturbed by a
    // vertical-scrollbar toggle feeding back into this width-derived height.
    const w = body.clientWidth;
    const gridH = Math.max(200, Math.min(400, w * 0.65));
    const h = chartFillHeight(card, body, canvas, gridH);
    return { w, h, plotW: Math.max(10, w - SCATTER_LEFT - SCATTER_RIGHT), plotH: Math.max(10, h - SCATTER_TOP - SCATTER_BOTTOM) };
  }

  function updateLegend(): void {
    for (const btn of legend.querySelectorAll<HTMLElement>('[data-cat]')) {
      const cat = btn.dataset.cat!;
      const active = activeCats.size === 0 || activeCats.has(cat);
      btn.style.opacity = active ? '1' : '0.35';
      // box-shadow, not `outline` — this is the "actively filtering on this
      // category" indicator, a static state unrelated to keyboard focus.
      // Using `outline` for it clobbered the browser's real focus ring
      // (forced to 'none' on every non-active swatch, so a keyboard-focused
      // inactive swatch showed no focus indicator at all).
      const filtering = activeCats.has(cat);
      btn.style.boxShadow = filtering ? `0 0 0 2px ${CLR.text}` : 'none';
      // Same "actively filtering" state, exposed to a screen reader — the
      // box-shadow ring alone doesn't reach one.
      btn.setAttribute('aria-pressed', filtering ? 'true' : 'false');
    }
  }

  function rebuildLegend(cats: string[]): void {
    legend.innerHTML = '';
    activeCats.clear();
    for (const cat of cats) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.dataset.cat = cat;
      swatch.title = `${labelOfCategory(cat)} — click to filter`;
      const color = colorOfCategory(cat);
      Object.assign(swatch.style, { display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 7px', borderRadius: '10px', border: `1px solid ${CLR.menuBorder}`, background: 'none', cursor: 'pointer', fontSize: '11px', color: CLR.text, whiteSpace: 'nowrap' } as Partial<CSSStyleDeclaration>);
      const dot = document.createElement('span');
      Object.assign(dot.style, { display: 'inline-block', width: '9px', height: '9px', borderRadius: '50%', background: color, flexShrink: '0' } as Partial<CSSStyleDeclaration>);
      swatch.append(dot, document.createTextNode(labelOfCategory(cat)));
      swatch.addEventListener('click', () => {
        if (activeCats.has(cat)) activeCats.delete(cat); else activeCats.add(cat);
        updateLegend();
        draw();
      });
      legend.appendChild(swatch);
    }
    updateLegend();
  }

  function draw(): void {
    applyCanvasFlow(canvas, legend.offsetHeight);
    const theme = resolveChartCanvasColors(card);
    const xSpan = xHi - xLo, ySpan = yHi - yLo;
    const { w, h, plotW, plotH } = dims();
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (points.length === 0) {
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillStyle = theme.textMuted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No data — select two parametric tests with values.', w / 2, h / 2);
      return;
    }

    const ticks = 4;
    // One shared SI scale per axis (makeAxisFormat) — bare "861E-6" ticks
    // with a lone "(A)" in the corner become "861 · 1020 · …" with "(µA)".
    const xAxisFmt = makeAxisFormat(Math.max(Math.abs(xLo), Math.abs(xHi)), activeX !== null ? testMeta(activeX).unit : undefined);
    const yAxisFmt = makeAxisFormat(Math.max(Math.abs(yLo), Math.abs(yHi)), activeY !== null ? testMeta(activeY).unit : undefined);
    ctx.font = '10px system-ui, sans-serif';
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 0.5;
    ctx.fillStyle = theme.textMuted;

    for (let i = 0; i <= ticks; i++) {
      const xv = xLo + (xSpan * i) / ticks;
      const cx = SCATTER_LEFT + (i / ticks) * plotW;
      ctx.beginPath(); ctx.moveTo(cx, SCATTER_TOP); ctx.lineTo(cx, SCATTER_TOP + plotH); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(xAxisFmt.tick(xv), cx, SCATTER_TOP + plotH + 4);

      const yv = yLo + (ySpan * i) / ticks;
      const cy = SCATTER_TOP + (1 - i / ticks) * plotH;
      ctx.beginPath(); ctx.moveTo(SCATTER_LEFT, cy); ctx.lineTo(SCATTER_LEFT + plotW, cy); ctx.stroke();
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(yAxisFmt.tick(yv), SCATTER_LEFT - 4, cy);
    }

    if (xAxisFmt.unitLabel) drawAxisUnit(ctx, xAxisFmt.unitLabel, SCATTER_LEFT + plotW / 2, SCATTER_TOP + plotH + 24, theme.textMuted);
    if (yAxisFmt.unitLabel) {
      ctx.save();
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillStyle = theme.textMuted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.translate(6, SCATTER_TOP + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(`(${yAxisFmt.unitLabel})`, 0, 0);
      ctx.restore();
    }

    const visible = activeCats.size === 0 ? points : points.filter(p => activeCats.has(categoryOf(p)));
    const step = visible.length > 5000 ? Math.ceil(visible.length / 5000) : 1;
    ctx.globalAlpha = Math.max(0.15, Math.min(0.7, 200 / (visible.length / step)));
    for (let i = 0; i < visible.length; i += step) {
      const p = visible[i];
      const cx = SCATTER_LEFT + ((p.x - xLo) / xSpan) * plotW;
      const cy = SCATTER_TOP + (1 - (p.y - yLo) / ySpan) * plotH;
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = colorOfCategory(categoryOf(p));
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (activeX !== null && activeY !== null) {
      const xMeta = testMeta(activeX);
      const yMeta = testMeta(activeY);
      ctx.strokeStyle = theme.textMuted;
      ctx.fillStyle = theme.textMuted;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.font = '9px system-ui, sans-serif';
      ctx.textBaseline = 'top';

      for (const [lim, label] of [[xMeta.limitLow, 'LSL'], [xMeta.limitHigh, 'USL']] as const) {
        if (lim === undefined || lim < xLo || lim > xHi) continue;
        const cx = SCATTER_LEFT + ((lim - xLo) / xSpan) * plotW;
        ctx.beginPath();
        ctx.moveTo(cx, SCATTER_TOP);
        ctx.lineTo(cx, SCATTER_TOP + plotH);
        ctx.stroke();
        ctx.textAlign = 'left';
        ctx.fillText(label, cx + 2, SCATTER_TOP + 2);
      }

      for (const [lim, label] of [[yMeta.limitLow, 'LSL'], [yMeta.limitHigh, 'USL']] as const) {
        if (lim === undefined || lim < yLo || lim > yHi) continue;
        const cy = SCATTER_TOP + (1 - (lim - yLo) / ySpan) * plotH;
        ctx.beginPath();
        ctx.moveTo(SCATTER_LEFT, cy);
        ctx.lineTo(SCATTER_LEFT + plotW, cy);
        ctx.stroke();
        // Label at the left end of the line, inside the plot — at the right
        // end it collided with the card border / scrollbar gutter.
        ctx.textAlign = 'left';
        ctx.fillText(label, SCATTER_LEFT + 3, cy + 2);
      }

      ctx.setLineDash([]);
    }

    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(SCATTER_LEFT, SCATTER_TOP); ctx.lineTo(SCATTER_LEFT, SCATTER_TOP + plotH);
    ctx.moveTo(SCATTER_LEFT, SCATTER_TOP + plotH); ctx.lineTo(SCATTER_LEFT + plotW, SCATTER_TOP + plotH);
    ctx.stroke();
  }

  function rebuildBody(): void {
    syncMixedFieldsWarning();
    if (testOptions.length < 2 || activeX === null || activeY === null) {
      points = [];
      rebuildLegend([]);
      draw();
      return;
    }
    points = byGroup ? buildScatterDataGrouped(groups!, activeX, activeY) : buildScatterData(currentItems(), activeX, activeY);
    let cats: string[];
    if (byGroup) {
      const present = new Set(points.map(categoryOf));
      cats = groupKeys.filter(g => present.has(g));
    } else {
      cats = Array.from(new Set(points.map(p => p.hbin ?? 0))).sort((a, b) => a - b).map(String);
    }
    rebuildLegend(cats);

    if (points.length > 0) {
      const xs = points.map(p => p.x), ys = points.map(p => p.y);
      const xMin = Math.min(...xs), xMax = Math.max(...xs);
      const yMin = Math.min(...ys), yMax = Math.max(...ys);
      const xPad = (xMax - xMin) * 0.05 || 1, yPad = (yMax - yMin) * 0.05 || 1;
      xLo = xMin - xPad; xHi = xMax + xPad;
      yLo = yMin - yPad; yHi = yMax + yPad;
    }
    draw();
  }

  const resizeHandle = observeResize(card, () => draw());
  rebuildBody();

  function setXY(xTestNumber: number, yTestNumber: number): void {
    activeX = xTestNumber;
    activeY = yTestNumber;
    xSel.value = String(xTestNumber);
    ySel.value = String(yTestNumber);
    rebuildBody();
  }

  return { card, setXY, destroy: () => resizeHandle.disconnect() };
}
