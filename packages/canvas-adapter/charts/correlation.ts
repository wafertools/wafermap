// Correlation matrix panel — Pearson r for every parametric test pair, drawn
// as colour-graduated cells. Clicking a non-diagonal cell calls
// `onSelectPair` so the scatter panel can update its X/Y in place. Ported
// from tsmap's charts/correlation.ts.
//
// Grouping matches tsmap's actual UX (verified by reading the real source,
// not assumed): its own "Group: <value> ▾" restrict-to-one-group dropdown,
// same pattern as capability — pooling across groups is misleading
// (Simpson's paradox), so the matrix is always restricted to a single group
// when grouping is on, never averaged/combined across groups.
//
// Deliberate simplification vs. tsmap's exact shape: tsmap's `filter`
// callback and `initialLimit`/`onLimitChange` exist because `main.ts` owns
// cross-panel caching; this panel computes `buildCorrelationMatrix`/
// `filterCorrelationMatrix`/`buildFacetTable` (for the Simpson's-paradox
// warning) itself from `items`/`groups`, and owns its own matrix-size state
// internally — same end-user behavior, one fewer indirection.

import { buildCorrelationMatrix, filterCorrelationMatrix, type CorrelationMatrix, type CorrelationTestInfo } from '../../stats/correlation.js';
import { CORRELATION_POSITIVE, CORRELATION_NEGATIVE } from './palette.js';
import { buildFacetTable, type FacetItem } from '../../stats/facets.js';
import type { Die } from '../../core/dies.js';
import type { TestDef } from '../../renderer/buildWaferMap.js';
import { CLR } from '../toolbar.js';
import { cardShell, observeResize, makeTooltip, positionChartTooltip, makeLabeledSelect, makeWaferSelect, renderEmptyState, resolveChartCanvasColors, type SaveImageHandler } from './chartShell.js';

const MATRIX_LIMIT_MIN = 5;
const MATRIX_LIMIT_MAX = 100;
const MATRIX_LIMIT_DEFAULT = 20;

type CorrelationItem = FacetItem & { dies?: Die[]; label?: string };

export interface CorrelationPanelOptions {
  title?: string;
  items: CorrelationItem[];
  testDefs: TestDef[];
  colorScheme?: string;
  onSaveImage?: SaveImageHandler;
  /**
   * When the Analysis tab's "Group by" is active, this panel gets its own
   * "Group: <value> ▾" restrict-to-one-group dropdown (matching capability's
   * pattern exactly) — the matrix is always computed for exactly one group's
   * dies, never pooled across groups. `items` above is ignored when `groups`
   * is provided. Absent ⇒ today's plain ungrouped behavior.
   */
  groups?: { key: string; items: CorrelationItem[] }[];
  /** Clicking a non-diagonal cell calls this — the Analysis tab wires it to drive the scatter panel's X/Y in place. */
  onSelectPair?: (xTestNumber: number, yTestNumber: number) => void;
  /** Document to build this panel's DOM into. Default `document` — pass the
   *  host's own `ownerDocument` when the container might live in a
   *  different document (e.g. a gallery card detached into its own popup
   *  window). */
  ownerDocument?: Document;
}

export interface CorrelationPanelHandle {
  card: HTMLElement;
  destroy: () => void;
}

// Parse a CSS colour string (rgb/rgba/#rrggbb) into [r,g,b] components.
function parseCssRgb(css: string): [number, number, number] | null {
  const m = css.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
  if (m) return [+m[1], +m[2], +m[3]];
  const hex = css.trim().replace('#', '');
  if (hex.length === 6) {
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }
  return null;
}

// Interpolate a colour string toward a background RGB by factor t (0=bg, 1=colour).
function blendTowardBg(colour: string, bg: [number, number, number], t: number): string {
  const fg = parseCssRgb(colour);
  if (!fg) return colour;
  const R = Math.round(bg[0] + (fg[0] - bg[0]) * t);
  const G = Math.round(bg[1] + (fg[1] - bg[1]) * t);
  const B = Math.round(bg[2] + (fg[2] - bg[2]) * t);
  return `rgb(${R},${G},${B})`;
}

export function renderCorrelationPanel(options: CorrelationPanelOptions): CorrelationPanelHandle {
  // `colorScheme` is deliberately no longer read — cells use the fixed
  // sign-aware correlation hues (palette.ts); the option stays for API compatibility.
  const { title = 'Test correlation matrix', items, testDefs, onSaveImage, groups, onSelectPair } = options;
  const { card, body, controlsRow } = cardShell(title, onSaveImage, options.ownerDocument);

  body.style.overflowX = 'auto';
  // Size to the matrix's own content instead of stretching to the grid
  // row's tallest neighbour (the scatter panel) — a 3×3 matrix in a
  // scatter-height card is mostly dead space (same opt-out boxplot uses).
  card.style.alignSelf = 'start';

  let limit = MATRIX_LIMIT_DEFAULT;
  let activeGroup: string | undefined = groups && groups.length > 0 ? groups[0].key : undefined;
  // Only meaningful when ungrouped — mutually exclusive with `activeGroup`,
  // same as histogram's per-item selector. Defaults to pooling every wafer
  // (matching today's behavior); narrowing to one wafer also resolves the
  // Simpson's-paradox warning below, since a single wafer can't be "mixed".
  let activeWaferIndex: number | null = null;

  const matrixLimitLabel = card.ownerDocument.createElement('label');
  matrixLimitLabel.textContent = 'Max tests:';
  matrixLimitLabel.title = 'Cap on how many tests the matrix includes (strongest correlations kept first)';
  Object.assign(matrixLimitLabel.style, { color: CLR.label, fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' } as Partial<CSSStyleDeclaration>);
  const matrixLimitInput = card.ownerDocument.createElement('input');
  matrixLimitInput.type = 'number';
  matrixLimitInput.min = String(MATRIX_LIMIT_MIN);
  matrixLimitInput.max = String(MATRIX_LIMIT_MAX);
  matrixLimitInput.value = String(limit);
  Object.assign(matrixLimitInput.style, { width: '52px', fontSize: '12px', padding: '2px 4px', background: CLR.menuBg, color: CLR.value, border: `1px solid ${CLR.menuBorder}`, borderRadius: '3px' } as Partial<CSSStyleDeclaration>);
  matrixLimitInput.addEventListener('change', () => {
    const v = Math.max(MATRIX_LIMIT_MIN, Math.min(MATRIX_LIMIT_MAX, parseInt(matrixLimitInput.value, 10) || MATRIX_LIMIT_DEFAULT));
    matrixLimitInput.value = String(v);
    if (v !== limit) { limit = v; rebuild(); }
  });
  matrixLimitLabel.appendChild(matrixLimitInput);
  controlsRow.appendChild(matrixLimitLabel);

  if (groups && groups.length > 0) {
    controlsRow.appendChild(makeLabeledSelect(
      'Group:',
      groups.map(g => ({ value: g.key, label: g.key })),
      activeGroup ?? '',
      v => { activeGroup = v; rebuild(); },
      { ownerDocument: card.ownerDocument },
    ));
  } else if (items.length > 1) {
    controlsRow.appendChild(makeWaferSelect(items, activeWaferIndex, i => { activeWaferIndex = i; rebuild(); }, { ownerDocument: card.ownerDocument }));
  }

  function currentItems(): CorrelationItem[] {
    if (groups && groups.length > 0) return groups.find(g => g.key === activeGroup)?.items ?? [];
    if (activeWaferIndex !== null) return items[activeWaferIndex] ? [items[activeWaferIndex]] : [];
    return items;
  }

  const hintRow = card.ownerDocument.createElement('div');
  Object.assign(hintRow.style, { display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '6px' } as Partial<CSSStyleDeclaration>);
  card.insertBefore(hintRow, body);

  const dpr = window.devicePixelRatio || 1;
  const tooltip = makeTooltip(card);

  let draw: () => void = () => {};

  function renderSummary(strongPairs: number, moderatePairs: number, hiddenWeakPairs: number, strongestPair: { xLabel: string; yLabel: string; r: number } | null, mixedFields: string[]): void {
    hintRow.innerHTML = '';

    if (mixedFields.length > 0) {
      const warn = card.ownerDocument.createElement('div');
      warn.textContent = `⚠ Mixed ${mixedFields.join(', ')} within this set — correlations may be misleading (Simpson's paradox). Use Group by, or the Wafer picker, to narrow to a like-for-like set.`;
      Object.assign(warn.style, { color: CLR.warnText, background: CLR.warnBg, border: `1px solid ${CLR.warnBorder}`, borderRadius: '4px', padding: '4px 8px', fontSize: '11px' } as Partial<CSSStyleDeclaration>);
      hintRow.appendChild(warn);
    }

    // One-line key with an inline colour scale — the sign hues were
    // previously unexplained anywhere on the card.
    const hint = card.ownerDocument.createElement('span');
    Object.assign(hint.style, { display: 'inline-flex', alignItems: 'center', gap: '6px', color: CLR.label, fontSize: '11px', flexWrap: 'wrap' } as Partial<CSSStyleDeclaration>);
    const hintText = card.ownerDocument.createElement('span');
    hintText.textContent = 'Pearson r · click a cell to view that pair in scatter ·';
    hint.appendChild(hintText);
    const scaleWrap = card.ownerDocument.createElement('span');
    Object.assign(scaleWrap.style, { display: 'inline-flex', alignItems: 'center', gap: '4px' } as Partial<CSSStyleDeclaration>);
    const lo = card.ownerDocument.createElement('span'); lo.textContent = '−1';
    const bar = card.ownerDocument.createElement('span');
    Object.assign(bar.style, {
      display: 'inline-block', width: '64px', height: '8px', borderRadius: '2px',
      border: `1px solid ${CLR.menuBorder}`,
      background: `linear-gradient(to right, ${CORRELATION_NEGATIVE}, ${CLR.menuBg}, ${CORRELATION_POSITIVE})`,
    } as Partial<CSSStyleDeclaration>);
    const hi = card.ownerDocument.createElement('span'); hi.textContent = '+1';
    scaleWrap.append(lo, bar, hi);
    hint.appendChild(scaleWrap);
    hintRow.appendChild(hint);

    const summaryLine = card.ownerDocument.createElement('span');
    Object.assign(summaryLine.style, { color: CLR.value, fontSize: '12px', fontWeight: '500' } as Partial<CSSStyleDeclaration>);
    if (strongPairs === 0 && moderatePairs === 0) {
      summaryLine.textContent = strongestPair
        ? `No significant correlations found — strongest pair: ${strongestPair.xLabel} ↔ ${strongestPair.yLabel} (r = ${strongestPair.r.toFixed(2)})`
        : 'No significant correlations found';
    } else {
      const parts: string[] = [];
      if (strongPairs > 0) parts.push(`${strongPairs} strong (|r| ≥ 0.7)`);
      if (moderatePairs > 0) parts.push(`${moderatePairs} moderate (0.4–0.7)`);
      const total = strongPairs + moderatePairs;
      let text = parts.join(', ') + ` pair${total !== 1 ? 's' : ''} found`;
      if (hiddenWeakPairs > 0) text += ` · ${hiddenWeakPairs} weak pair${hiddenWeakPairs !== 1 ? 's' : ''} not shown`;
      summaryLine.textContent = text;
    }
    hintRow.appendChild(summaryLine);
  }

  function buildMatrixView(matrix: CorrelationMatrix): () => void {
    body.innerHTML = '';

    if (matrix.tests.length < 2) {
      renderEmptyState(body, 'Need at least two parametric tests for a correlation matrix.');
      return () => {};
    }

    const canvas = card.ownerDocument.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.cursor = 'default';
    body.appendChild(canvas);

    const n = matrix.tests.length;

    const shortLabel = (t: CorrelationTestInfo) => t.label.split(' (#')[0];
    const maxLabelChars = Math.min(14, Math.max(...matrix.tests.map(t => shortLabel(t).length)));
    const LABEL_W = maxLabelChars * 6.5 + 8;

    const MAX_HEADER_LBL = 10;
    const LABEL_H = Math.round(MAX_HEADER_LBL * 6.5 * Math.sin(Math.PI / 4)) + 14;

    const MIN_CELL = 14;
    const PREF_CELL = 26;

    let selectedXi = -1;
    let selectedYi = -1;

    function cellSize(availW: number): number {
      const plotW = Math.max(0, availW - LABEL_W);
      return Math.max(MIN_CELL, Math.min(PREF_CELL, Math.floor(plotW / n)));
    }

    const cellsByRow = new Map<number, typeof matrix.cells>();
    for (const cell of matrix.cells) {
      let row = cellsByRow.get(cell.yIndex);
      if (!row) { row = []; cellsByRow.set(cell.yIndex, row); }
      row.push(cell);
    }

    function drawMatrix() {
      const theme = resolveChartCanvasColors(card);
      const bgRgb: [number, number, number] = parseCssRgb(theme.bg) ?? [255, 255, 255];

      // body's own width, not card's — see capability.ts's identical fix.
      const availW = body.clientWidth;
      const cs = cellSize(availW);
      const plotW = cs * n;
      const totalH = LABEL_H + cs * n + 4;
      const totalW = LABEL_W + plotW;

      canvas.width = Math.max(1, Math.floor(totalW * dpr));
      canvas.height = Math.max(1, Math.floor(totalH * dpr));
      canvas.style.width = `${totalW}px`;
      canvas.style.height = `${totalH}px`;

      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, totalW, totalH);

      ctx.font = '10px system-ui, sans-serif';
      ctx.fillStyle = theme.text;
      matrix.tests.forEach((t, xi) => {
        const lbl = shortLabel(t);
        const truncated = lbl.length > MAX_HEADER_LBL ? `${lbl.slice(0, MAX_HEADER_LBL - 1)}…` : lbl;
        const cx = LABEL_W + xi * cs + cs / 2;
        ctx.save();
        ctx.translate(cx, LABEL_H - 4);
        ctx.rotate(-Math.PI / 4);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = xi === selectedXi ? theme.text : theme.textMuted;
        ctx.fillText(truncated, 0, 0);
        ctx.restore();
      });

      matrix.tests.forEach((t, yi) => {
        const lbl = shortLabel(t);
        const cy = LABEL_H + yi * cs;
        const midY = cy + cs / 2;

        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = yi === selectedYi ? theme.text : theme.textMuted;
        ctx.fillText(lbl.length > maxLabelChars ? `${lbl.slice(0, maxLabelChars - 1)}…` : lbl, LABEL_W - 4, midY);

        (cellsByRow.get(yi) ?? []).forEach(cell => {
          const xi = cell.xIndex;
          const cx = LABEL_W + xi * cs;
          const isSelected = xi === selectedXi && yi === selectedYi;
          const isDiag = xi === yi;
          const r = cell.r;

          if (r === null) {
            ctx.fillStyle = theme.border;
            ctx.globalAlpha = 0.4;
            ctx.fillRect(cx + 1, cy + 1, cs - 2, cs - 2);
            ctx.globalAlpha = 1;
            return;
          }

          if (isDiag) {
            ctx.fillStyle = theme.bgHover;
          } else {
            // Sign carried by hue (blue = positive, vermillion = negative —
            // palette.ts), magnitude by intensity. The old |r| ramp threw the
            // sign away entirely: r = −0.9 and r = +0.9 drew identically.
            ctx.fillStyle = blendTowardBg(r >= 0 ? CORRELATION_POSITIVE : CORRELATION_NEGATIVE, bgRgb, Math.abs(r));
          }
          ctx.fillRect(cx + 1, cy + 1, cs - 2, cs - 2);

          if (cs >= 28 && !isDiag) {
            ctx.font = `${Math.min(10, cs * 0.35)}px system-ui, sans-serif`;
            ctx.fillStyle = Math.abs(r) > 0.6 ? theme.bg : theme.text;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(r.toFixed(2), cx + cs / 2, cy + cs / 2);
          }

          if (isSelected) {
            ctx.strokeStyle = theme.text;
            ctx.lineWidth = 2;
            ctx.strokeRect(cx + 1, cy + 1, cs - 2, cs - 2);
            ctx.lineWidth = 1;
          }
        });
      });

      ctx.strokeStyle = theme.bg;
      ctx.lineWidth = 1;
      for (let i = 0; i <= n; i++) {
        const x = LABEL_W + i * cs;
        ctx.beginPath(); ctx.moveTo(x, LABEL_H); ctx.lineTo(x, LABEL_H + n * cs); ctx.stroke();
        const y = LABEL_H + i * cs;
        ctx.beginPath(); ctx.moveTo(LABEL_W, y); ctx.lineTo(LABEL_W + n * cs, y); ctx.stroke();
      }
    }

    function cellAt(e: MouseEvent) {
      const rect = canvas.getBoundingClientRect();
      const availW = body.clientWidth;
      const cs = cellSize(availW);
      const ox = (e.clientX - rect.left) * (canvas.width / dpr / rect.width);
      const oy = (e.clientY - rect.top) * (canvas.height / dpr / rect.height);
      const xi = Math.floor((ox - LABEL_W) / cs);
      const yi = Math.floor((oy - LABEL_H) / cs);
      return (xi >= 0 && xi < n && yi >= 0 && yi < n) ? { xi, yi } : null;
    }

    canvas.addEventListener('mousemove', e => {
      const hit = cellAt(e);
      if (!hit) { tooltip.style.display = 'none'; canvas.style.cursor = 'default'; return; }
      const { xi, yi } = hit;
      const isDiag = xi === yi;
      canvas.style.cursor = isDiag || !onSelectPair ? 'default' : 'pointer';
      const cell = matrix.cells.find(c => c.xIndex === xi && c.yIndex === yi);
      const xLabel = matrix.tests[xi].label;
      const yLabel = matrix.tests[yi].label;
      if (isDiag) {
        tooltip.innerHTML = `<strong>${xLabel}</strong>`;
      } else if (cell?.r !== null && cell?.r !== undefined) {
        tooltip.innerHTML = `<strong>${shortLabel(matrix.tests[yi])}</strong> (#${matrix.tests[yi].testNumber}) vs <strong>${shortLabel(matrix.tests[xi])}</strong> (#${matrix.tests[xi].testNumber})<br>r = ${cell.r.toFixed(4)}${onSelectPair ? '<br><em>click to view in scatter</em>' : ''}`;
      } else {
        tooltip.innerHTML = `${yLabel} vs ${xLabel}<br><em>insufficient data</em>`;
      }
      tooltip.style.display = 'block';
      positionChartTooltip(tooltip, card, e.clientX, e.clientY);
    });
    canvas.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });

    canvas.addEventListener('click', e => {
      const hit = cellAt(e);
      if (!hit || !onSelectPair) return;
      const { xi, yi } = hit;
      if (xi === yi) return;
      selectedXi = xi;
      selectedYi = yi;
      drawMatrix();
      onSelectPair(matrix.tests[xi].testNumber, matrix.tests[yi].testNumber);
    });

    return drawMatrix;
  }

  function rebuild(): void {
    const scopedItems = currentItems();
    const dies = scopedItems.flatMap(it => it.dies ?? []);
    const fullMatrix = buildCorrelationMatrix(dies, testDefs);
    const { matrix, strongPairs, moderatePairs, hiddenWeakPairs, strongestPair } = filterCorrelationMatrix(fullMatrix, { minTests: 6, maxTests: limit });
    const mixedFields = buildFacetTable(scopedItems, { facetableOnly: true }).filter(f => f.splittable).map(f => f.label);
    renderSummary(strongPairs, moderatePairs, hiddenWeakPairs, strongestPair, mixedFields);
    draw = buildMatrixView(matrix);
    draw();
  }

  const resizeHandle = observeResize(card, () => draw());
  rebuild();
  return { card, destroy: () => resizeHandle.disconnect() };
}
