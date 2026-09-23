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

import { buildCorrelationMatrix, filterCorrelationMatrix, correlationSampleNote, type CorrelationMatrix, type CorrelationTestInfo } from '../../stats/correlation.js';
import { csvField, maxOf } from '../../core/utils.js';
import { CORRELATION_POSITIVE, CORRELATION_NEGATIVE } from './palette.js';
import { buildFacetTable, type FacetItem } from '../../stats/facets.js';
import type { Die } from '../../core/dies.js';
import type { TestDef } from '../../renderer/buildWaferMap.js';
import { wireControlHover, controlStyle, SPACE, RADIUS, fontPx, FONT, CLR, saveTextFile, type SaveTextHandler } from '../toolbar.js';
import { attachChartTip, cardShell, setChartGrow, isExpandedCard, bodyRoom, observeResize, makeTooltip, positionChartTooltip, makeWaferSelect, renderEmptyState, resolveChartCanvasColors, type SaveImageHandler, prepareCanvas, chartDpr } from './chartShell.js';
import { escHtml } from '../../core/utils.js';
import { unmarkedLabel, derivedCsvCell, DERIVED_CSV_HEADER, DERIVED_MARK, DERIVED_KEY } from '../../renderer/testLabel.js';

const MATRIX_LIMIT_MIN = 5;
const MATRIX_LIMIT_MAX = 100;
const MATRIX_LIMIT_DEFAULT = 20;

type CorrelationItem = FacetItem & { dies?: Die[]; label?: string };

export interface CorrelationPanelOptions {
  /** Host hook for the Export CSV button — see `saveTextFile` (toolbar.ts).
   *  Omit and no button is offered. */
  onSaveText?: SaveTextHandler;
  title?: string;
  items: CorrelationItem[];
  testDefs: TestDef[];
  onSaveImage?: SaveImageHandler;
  /**
   * Grouping is NOT this panel's concern — the Insights tab owns one "Show:"
   * scope for every view and hands each panel the population it names. This
   * previously took a `groups` list and silently restricted to `groups[0]`,
   * with no way back to the pooled matrix.
   */
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

/**
 * Black or white, whichever reads better ON the given fill.
 *
 * The in-cell r values previously picked their colour from |r| alone
 * (`|r| > 0.6 ? theme.bg : theme.text`). That was tuned against a light
 * background, where a strong cell is saturated and `theme.bg` is white. Invert
 * the theme and the same rule puts near-black text on a mid-saturation blue,
 * because it was reasoning about correlation strength rather than about the
 * colour actually under the text. Measuring the fill works in both themes and
 * needs no threshold — the same approach the wafer map already uses for its
 * out-of-spec markers, which are drawn per die against each die's own fill.
 *
 * Rec. 601 luma: cheap, and adequate for a black-or-white decision.
 */
function textOn(fill: string): string {
  const rgb = parseCssRgb(fill);
  if (!rgb) return '#000';
  const luma = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
  return luma > 140 ? '#111' : '#fff';
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
  // Cells use the fixed sign-aware correlation hues (palette.ts).
  const { title = 'Test correlation matrix', items, testDefs, onSaveImage, onSelectPair } = options;
  const { card, body, controlsRow } = cardShell(title, onSaveImage, options.ownerDocument);
  setChartGrow(card, 'square');

  body.style.overflowX = 'auto';
  // Size to the matrix's own content instead of stretching to the grid
  // row's tallest neighbour (the scatter panel) — a 3×3 matrix in a
  // scatter-height card is mostly dead space (same opt-out boxplot uses).
  card.style.alignSelf = 'start';

  let limit = MATRIX_LIMIT_DEFAULT;
  // Defaults to pooling every wafer
  // (matching today's behavior); narrowing to one wafer also resolves the
  // Simpson's-paradox warning below, since a single wafer can't be "mixed".
  let activeWaferIndex: number | null = null;

  const matrixLimitLabel = card.ownerDocument.createElement('label');
  matrixLimitLabel.textContent = 'Max tests:';

  Object.assign(matrixLimitLabel.style, { color: CLR.label, fontSize: FONT.body, display: 'flex', alignItems: 'center', gap: SPACE.xs } as Partial<CSSStyleDeclaration>);
  const matrixLimitInput = card.ownerDocument.createElement('input');
  matrixLimitInput.type = 'number';
  matrixLimitInput.min = String(MATRIX_LIMIT_MIN);
  matrixLimitInput.max = String(MATRIX_LIMIT_MAX);
  matrixLimitInput.value = String(limit);
  Object.assign(matrixLimitInput.style, { width: '52px', fontSize: FONT.body, padding: `${SPACE.xxs} ${SPACE.xs}`, background: CLR.menuBg, color: CLR.value, border: `1px solid ${CLR.menuBorder}`, borderRadius: RADIUS.control } as Partial<CSSStyleDeclaration>);
  matrixLimitInput.addEventListener('change', () => {
    const v = Math.max(MATRIX_LIMIT_MIN, Math.min(MATRIX_LIMIT_MAX, parseInt(matrixLimitInput.value, 10) || MATRIX_LIMIT_DEFAULT));
    matrixLimitInput.value = String(v);
    if (v !== limit) { limit = v; rebuild(); }
  });
  matrixLimitLabel.appendChild(matrixLimitInput);
  controlsRow.appendChild(matrixLimitLabel);

  // No group control of its own. This panel used to carry a
  // restrict-to-one-group dropdown defaulting to `groups[0]` — so grouping a
  // six-lot load silently reduced the matrix to one lot, with no "all groups"
  // option to return to and nothing on the card saying which lot it was. The
  // Insights tab now owns one "Show:" scope for every view, and a narrowed
  // population arrives here with `groups` already undefined.
  if (items.length > 1) {
    controlsRow.appendChild(makeWaferSelect(items, activeWaferIndex, i => { activeWaferIndex = i; rebuild(); }, { ownerDocument: card.ownerDocument }));
  }

  function currentItems(): CorrelationItem[] {
    if (activeWaferIndex !== null) return items[activeWaferIndex] ? [items[activeWaferIndex]] : [];
    return items;
  }

  // Export CSV — the one Insights panel that gets one.
  //
  // Not every panel should: boxplot and trend would re-export per-wafer
  // mean/σ/quartiles, which the Overview's test-values CSV already carries, and a
  // second button for the same numbers is chrome without information. The
  // correlation matrix is the exception — it is computed here, it is matrix-shaped
  // (awkward to lift out of rendered HTML), and it is deliberately absent from the
  // summary report, whose length a 250-test matrix would wreck.
  if (options.onSaveText) {
    const exportBtn = card.ownerDocument.createElement('button');
    exportBtn.type = 'button';
    exportBtn.textContent = 'Correlation CSV';
    Object.assign(exportBtn.style, {
      ...controlStyle('outlined'), color: CLR.text,
    } as Partial<CSSStyleDeclaration>);
  wireControlHover(exportBtn);
    exportBtn.addEventListener('click', () => {
      // Long form (one row per pair), not the square grid: a grid needs the reader
      // to reconstruct which half is which and repeats every value twice, while
      // one row per pair sorts and filters in a spreadsheet directly. `n` rides
      // along per row because it varies by pair when tests have different coverage,
      // and an r without its n is not interpretable.
      const m = lastMatrix;
      if (!m) return;
      // A CSV has no key to explain a glyph, so a derived test is stated as data
      // — a "derived from" column per side, present only when one is derived.
      const anyDerived = m.tests.some(t => t.derived);
      const lines = ['Test X,Test X number,Test Y,Test Y number,r,n'
        + (anyDerived ? `,Test X ${DERIVED_CSV_HEADER.toLowerCase()},Test Y ${DERIVED_CSV_HEADER.toLowerCase()}` : '')];
      for (let yi = 0; yi < m.tests.length; yi++) {
        for (let xi = yi + 1; xi < m.tests.length; xi++) {
          const cell = m.cells.find(c => c.xIndex === xi && c.yIndex === yi);
          if (!cell) continue;
          lines.push([
            csvField(unmarkedLabel(m.tests[xi].label)), String(m.tests[xi].testNumber),
            csvField(unmarkedLabel(m.tests[yi].label)), String(m.tests[yi].testNumber),
            cell.r === null ? '' : cell.r.toFixed(6),
            String(cell.n),
            ...(anyDerived ? [csvField(derivedCsvCell(m.tests[xi])), csvField(derivedCsvCell(m.tests[yi]))] : []),
          ].join(','));
        }
      }
      saveTextFile(lines.join('\n'), 'test-correlation.csv', 'text/csv', options.onSaveText);
    });
    controlsRow.appendChild(exportBtn);
  }

  const hintRow = card.ownerDocument.createElement('div');
  Object.assign(hintRow.style, { display: 'flex', flexDirection: 'column', gap: SPACE.xs, marginBottom: SPACE.sm } as Partial<CSSStyleDeclaration>);
  card.insertBefore(hintRow, body);

  const tooltip = makeTooltip(card);
  attachChartTip(matrixLimitLabel, card, tooltip, 'Cap on how many tests the matrix includes (strongest correlations kept first)');

  let draw: () => void = () => {};

  function renderSummary(strongPairs: number, moderatePairs: number, hiddenWeakPairs: number, strongestPair: { xLabel: string; yLabel: string; r: number } | null, mixedFields: string[], pairN: number | null, sample: CorrelationMatrix['sample'], anyDerived: boolean): void {
    hintRow.innerHTML = '';

    // A sampled matrix must say so where the reader cannot miss it. Above
    // ~25k dies the matrix is computed from an even spread rather than every die
    // (see CORRELATION_DIE_BUDGET) — a sound estimate, but an unlabelled one is a
    // number the reader takes for the whole population.
    const sampleNote = correlationSampleNote(sample);
    if (sampleNote) {
      const note = card.ownerDocument.createElement('div');
      note.textContent = `${sampleNote} — r is an estimate, not the whole population.`;
      Object.assign(note.style, { color: CLR.label, fontSize: FONT.body } as Partial<CSSStyleDeclaration>);
      hintRow.appendChild(note);
    }

    if (mixedFields.length > 0) {
      const warn = card.ownerDocument.createElement('div');
      warn.textContent = `⚠ Mixed ${mixedFields.join(', ')} within this set — correlations may be misleading (Simpson's paradox). Use Group by, or the Wafer picker, to narrow to a like-for-like set.`;
      Object.assign(warn.style, { color: CLR.warnText, background: CLR.warnBg, border: `1px solid ${CLR.warnBorder}`, borderRadius: RADIUS.control, padding: `${SPACE.xs} ${SPACE.md}`, fontSize: FONT.body } as Partial<CSSStyleDeclaration>);
      hintRow.appendChild(warn);
    }

    // One-line key with an inline colour scale — the sign hues were
    // previously unexplained anywhere on the card.
    const hint = card.ownerDocument.createElement('span');
    Object.assign(hint.style, { display: 'inline-flex', alignItems: 'center', gap: SPACE.sm, color: CLR.label, fontSize: FONT.body, flexWrap: 'wrap' } as Partial<CSSStyleDeclaration>);
    const hintText = card.ownerDocument.createElement('span');
    // Population stated up front: the summary line below counts "strong pairs"
    // by |r| alone, and |r| ≥ 0.7 over 6 dies is not the same claim as over 6,000.
    // `n` is the median across displayed pairs because tests can have different
    // coverage — a single number would otherwise silently be one pair's.
    // The derived-test key rides on this line whenever a marked name is on the
    // matrix — a glyph with no key reads as a rendering artefact.
    hintText.textContent = (pairN !== null
      ? `Pearson r · n ≈ ${pairN.toLocaleString()} dies per pair · click a cell to view that pair in scatter ·`
      : 'Pearson r · click a cell to view that pair in scatter ·')
      + (anyDerived ? ` ${DERIVED_MARK} ${DERIVED_KEY} ·` : '');
    hint.appendChild(hintText);
    const scaleWrap = card.ownerDocument.createElement('span');
    Object.assign(scaleWrap.style, { display: 'inline-flex', alignItems: 'center', gap: SPACE.xs } as Partial<CSSStyleDeclaration>);
    const lo = card.ownerDocument.createElement('span'); lo.textContent = '−1';
    const bar = card.ownerDocument.createElement('span');
    Object.assign(bar.style, {
      display: 'inline-block', width: '64px', height: '8px', borderRadius: RADIUS.control,
      border: `1px solid ${CLR.menuBorder}`,
      background: `linear-gradient(to right, ${CORRELATION_NEGATIVE}, ${CLR.menuBg}, ${CORRELATION_POSITIVE})`,
    } as Partial<CSSStyleDeclaration>);
    const hi = card.ownerDocument.createElement('span'); hi.textContent = '+1';
    scaleWrap.append(lo, bar, hi);
    hint.appendChild(scaleWrap);
    hintRow.appendChild(hint);

    const summaryLine = card.ownerDocument.createElement('span');
    Object.assign(summaryLine.style, { color: CLR.value, fontSize: FONT.body, fontWeight: '500' } as Partial<CSSStyleDeclaration>);
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
    const maxLabelChars = Math.min(14, maxOf(matrix.tests.map(t => shortLabel(t).length)));
    const LABEL_W = maxLabelChars * 6.5 + 8;

    const MAX_HEADER_LBL = 10;
    const LABEL_H = Math.round(MAX_HEADER_LBL * 6.5 * Math.sin(Math.PI / 4)) + 14;

    const MIN_CELL = 14;
    // Cell size at or above which the r value is printed inside the cell.
    const R_LABEL_MIN_CELL = 28;
    // Upper bound on cell growth. This was 26 — one pixel below
    // R_LABEL_MIN_CELL — so `cs` could never reach the threshold and the
    // in-cell r values below were unreachable code: the matrix rendered
    // colour-only at every size, in a card it left mostly empty, while the
    // caption told the reader how many strong pairs existed without letting
    // them see which. Kept deliberately above the label threshold, and the two
    // constants are named so the relationship survives future tuning.
    const PREF_CELL = 44;

    let selectedXi = -1;
    let selectedYi = -1;

    // Expanded, a cell grows to what the shorter side allows — up to this, so
    // three tests do not become three giant tiles.
    const EXPANDED_MAX_CELL = 96;

    function cellSize(availW: number): number {
      const plotW = Math.max(0, availW - LABEL_W);
      const byWidth = Math.floor(plotW / n);
      if (!isExpandedCard(card)) return Math.max(MIN_CELL, Math.min(PREF_CELL, byWidth));
      const byHeight = Math.floor((bodyRoom(card, body, canvas) - LABEL_H - 4) / n);
      return Math.max(MIN_CELL, Math.min(EXPANDED_MAX_CELL, byWidth, byHeight));
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

      const prep = prepareCanvas(canvas, card, totalW, totalH);
      if (!prep) return;
      const { ctx } = prep;

      ctx.font = `${fontPx(-1)}px system-ui, sans-serif`;
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

        ctx.font = `${fontPx(-1)}px system-ui, sans-serif`;
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

          let cellFill = theme.bgHover;
          if (isDiag) {
            ctx.fillStyle = theme.bgHover;
          } else {
            // Sign carried by hue (blue = positive, vermillion = negative —
            // palette.ts), magnitude by intensity. The old |r| ramp threw the
            // sign away entirely: r = −0.9 and r = +0.9 drew identically.
            cellFill = blendTowardBg(r >= 0 ? CORRELATION_POSITIVE : CORRELATION_NEGATIVE, bgRgb, Math.abs(r));
            ctx.fillStyle = cellFill;
          }
          ctx.fillRect(cx + 1, cy + 1, cs - 2, cs - 2);

          if (cs >= R_LABEL_MIN_CELL && !isDiag) {
            ctx.font = `${Math.min(10, cs * 0.35)}px system-ui, sans-serif`;
            ctx.fillStyle = textOn(cellFill);
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
      const ox = (e.clientX - rect.left) * (canvas.width / chartDpr(canvas) / rect.width);
      const oy = (e.clientY - rect.top) * (canvas.height / chartDpr(canvas) / rect.height);
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
        tooltip.innerHTML = `<strong>${escHtml(xLabel)}</strong>`;
      } else if (cell?.r !== null && cell?.r !== undefined) {
        tooltip.innerHTML = `<strong>${escHtml(shortLabel(matrix.tests[yi]))}</strong> (#${matrix.tests[yi].testNumber}) vs <strong>${escHtml(shortLabel(matrix.tests[xi]))}</strong> (#${matrix.tests[xi].testNumber})<br>r = ${cell.r.toFixed(4)} · n = ${cell.n.toLocaleString()}${onSelectPair ? '<br><em>click to view in scatter</em>' : ''}`;
      } else {
        tooltip.innerHTML = `${escHtml(`${yLabel} vs ${xLabel}`)}<br><em>insufficient data</em>`;
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

  // Held for the CSV export, which must emit exactly what is on screen — the
  // TRIMMED matrix (see filterCorrelationMatrix), not the full one, so the file
  // and the card can never disagree about which tests were included.
  let lastMatrix: CorrelationMatrix | null = null;

  function rebuild(): void {
    const scopedItems = currentItems();
    const dies = scopedItems.flatMap(it => it.dies ?? []);
    const fullMatrix = buildCorrelationMatrix(dies, testDefs);
    const { matrix, strongPairs, moderatePairs, hiddenWeakPairs, strongestPair } = filterCorrelationMatrix(fullMatrix, { minTests: 6, maxTests: limit });
    const mixedFields = buildFacetTable(scopedItems, { facetableOnly: true }).filter(f => f.splittable).map(f => f.label);
    // Median of the off-diagonal pair counts, not the die total: tests can have
    // different coverage, so no single n describes every cell. Median is the
    // honest one-number summary and the per-cell tooltip carries the exact value.
    const offDiag = matrix.cells.filter(c => c.xIndex !== c.yIndex).map(c => c.n).sort((a, b) => a - b);
    const pairN = offDiag.length ? offDiag[Math.floor(offDiag.length / 2)] : null;
    lastMatrix = matrix;
    // `fullMatrix`'s sample note, not `matrix`'s: filterCorrelationMatrix narrows
    // which tests are shown, and does not carry the sampling forward.
    renderSummary(strongPairs, moderatePairs, hiddenWeakPairs, strongestPair, mixedFields, pairN, fullMatrix.sample, matrix.tests.some(t => t.derived));
    draw = buildMatrixView(matrix);
    draw();
  }

  const resizeHandle = observeResize(card, () => draw());
  rebuild();
  return { card, destroy: () => resizeHandle.disconnect() };
}
