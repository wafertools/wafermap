// Process capability panel — one normalized boxplot per parametric test that
// has both a lower and upper spec limit (LSL→0, USL→1), sorted worst-Ppk-first.
// Ported from tsmap's charts/capability.ts (the first host to build this) —
// the first panel in wmap's own Analysis tab, proving the pattern: wmap now
// owns the underlying math (stats/capability.ts). `items` is whatever
// population the Analysis tab's shared Group-by control (owned at the tab
// level, not per-panel — see renderWaferGallery.ts) currently has selected;
// this panel doesn't compute or own grouping itself, matching every other
// panel in the tab reacting to one shared selection.

import { getColorScheme } from '../../renderer/colorSchemes.js';
import { buildCapabilityData, type CapabilityDatum, type CapabilityItem } from '../../stats/capability.js';
import type { TestDef } from '../../renderer/buildWaferMap.js';
import { CLR } from '../toolbar.js';
import { cardShell, chartFillHeight, applyCanvasFlow, formatValue, observeResize, makeTooltip, makeLabeledSelect, renderEmptyState, resolveChartCanvasColors, type SaveImageHandler } from './chartShell.js';

const CAP_MIN_COL = 30;
// The Analysis tab always gives this panel the full container width (unlike
// tsmap's original version of this panel, which usually lived in a small
// grid card and only got full width inside an expand modal) — so columns
// stretch to fill it, capped generously rather than pinned small, or a
// handful of tests would leave most of the width empty.
const CAP_MAX_COL = 160;
const CAP_LABEL_H = 90;
const CAP_TOP_MARGIN = 12;

export interface CapabilityPanelOptions {
  title?: string;
  items: CapabilityItem[];
  testDefs: TestDef[];
  colorScheme?: string;
  onSaveImage?: SaveImageHandler;
  /** Clicking a test's box calls this — the Analysis tab wires it to drive the boxplot panel's selected test in place, mirroring tsmap's original capability→boxplot link. */
  onSelectTest?: (testNumber: number) => void;
  /**
   * When the Analysis tab's "Group by" is active, this panel gets its own
   * "Group: <value> ▾" restrict-to-one-group dropdown (matching tsmap's
   * `charts/capability.ts` exactly — capability shows exactly one group's
   * data at a time, never all groups at once or pooled). `items` above is
   * ignored when `groups` is provided; the active group's own item list is
   * used instead. Absent ⇒ today's plain ungrouped behavior.
   */
  groups?: { key: string; items: CapabilityItem[] }[];
}

function ppkScore(ppk: number | null): number {
  if (ppk === null) return 1;
  return Math.max(0, Math.min(1, ppk / 1.33));
}

function fmtIndex(v: number | null): string {
  return v === null ? '—' : v.toFixed(2);
}

export interface CapabilityPanelHandle {
  card: HTMLElement;
  /**
   * Whether any test in `testDefs` has both spec limits — capability needs
   * both to normalize onto a shared axis (see `buildCapabilityData`), so a
   * lot with no spec limits assigned (common in real-world data — capture
   * setups don't always carry them) shows an empty state instead of a
   * chart. This is a property of `testDefs` alone, not the selected group —
   * spec limits are per-test, not per-wafer, so it doesn't change when the
   * "Group:" dropdown changes. The Analysis tab uses this to avoid forcing
   * a large fixed height on a card that has nothing to draw.
   */
  hasData: boolean;
  /** Disconnect this panel's own ResizeObserver. Call when removing the card from the DOM. */
  destroy: () => void;
}

export function renderCapabilityPanel(options: CapabilityPanelOptions): CapabilityPanelHandle {
  const { title = 'Process capability', items, testDefs, colorScheme = 'default', onSaveImage, onSelectTest, groups } = options;
  const { card, body, controlsRow } = cardShell(title, onSaveImage);

  const hasData = testDefs.some(d => d.limitLow !== undefined && d.limitHigh !== undefined);

  body.style.overflowX = 'auto';

  let activeGroup: string | undefined = groups && groups.length > 0 ? groups[0].key : undefined;

  if (groups && groups.length > 0) {
    controlsRow.appendChild(makeLabeledSelect(
      'Group:',
      groups.map(g => ({ value: g.key, label: g.key })),
      activeGroup ?? '',
      v => { activeGroup = v; rebuild(); },
    ));
  }

  function currentItems(): CapabilityItem[] {
    if (!groups || groups.length === 0) return items;
    return groups.find(g => g.key === activeGroup)?.items ?? [];
  }

  const hintRow = document.createElement('div');
  Object.assign(hintRow.style, { display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '6px' } as Partial<CSSStyleDeclaration>);
  card.insertBefore(hintRow, body);

  const dpr = window.devicePixelRatio || 1;
  const tooltip = makeTooltip(card);

  let draw: () => void = () => {};

  function renderCaption(shownCount: number, totalTests: number): void {
    hintRow.innerHTML = '';
    const hint = document.createElement('span');
    hint.textContent = 'Each box is one test, normalized so LSL=0, USL=1 · worst Ppk first';
    Object.assign(hint.style, { color: CLR.label, fontSize: '11px' } as Partial<CSSStyleDeclaration>);
    hintRow.appendChild(hint);

    const summary = document.createElement('span');
    Object.assign(summary.style, { color: CLR.value, fontSize: '12px', fontWeight: '500' } as Partial<CSSStyleDeclaration>);
    const excluded = totalTests - shownCount;
    summary.textContent = excluded > 0
      ? `${shownCount} of ${totalTests} tests shown — ${excluded} excluded (no spec limits, or only one)`
      : `${shownCount} test${shownCount !== 1 ? 's' : ''} shown`;
    hintRow.appendChild(summary);
  }

  function buildView(rows: CapabilityDatum[]): () => void {
    body.innerHTML = '';

    if (rows.length === 0) {
      renderEmptyState(body, 'No parametric tests have both a lower and upper spec limit — capability needs both to normalize onto a shared axis.', { maxWidth: '480px' } as Partial<CSSStyleDeclaration>);
      return () => {};
    }

    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.cursor = 'default';
    body.appendChild(canvas);

    const n = rows.length;
    const { forValue } = getColorScheme(colorScheme);

    const domainMin = Math.min(0, ...rows.map(d => d.min));
    const domainMax = Math.max(1, ...rows.map(d => d.max));
    const domainPad = (domainMax - domainMin) * 0.05 || 0.1;
    const plotMin = domainMin - domainPad;
    const plotMax = domainMax + domainPad;
    const plotSpan = plotMax - plotMin || 1;

    function colSize(availW: number): number {
      return Math.max(CAP_MIN_COL, Math.min(CAP_MAX_COL, Math.floor(availW / n)));
    }

    function yFor(v: number, plotTop: number, plotH: number): number {
      return plotTop + (1 - (v - plotMin) / plotSpan) * plotH;
    }

    let hovered = -1;

    function drawChart() {
      applyCanvasFlow(canvas);
      // body's own width, not card's — canvas lives directly in body (whose
      // overflowX:auto engages when the content-driven totalW below exceeds
      // it, an intentional horizontal scroll for many-column layouts), so
      // measuring from it directly stays correct even when body has its own
      // vertical scrollbar narrowing it.
      const availW = body.clientWidth;
      const cs = colSize(availW);
      const plotW = cs * n;
      const plotTop = CAP_TOP_MARGIN;
      const totalW = plotW;
      const totalH = chartFillHeight(card, body, canvas, CAP_TOP_MARGIN + 200 + CAP_LABEL_H);
      const plotBottom = Math.max(plotTop + 60, totalH - CAP_LABEL_H);
      const plotH = plotBottom - plotTop;

      canvas.width = Math.max(1, Math.floor(totalW * dpr));
      canvas.height = Math.max(1, Math.floor(totalH * dpr));
      canvas.style.width = `${totalW}px`;
      canvas.style.height = `${totalH}px`;

      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, totalW, totalH);

      // Resolved to concrete color strings, not raw `var(...)` — canvas
      // fillStyle/strokeStyle can't parse CSS custom-property syntax at all
      // (see chartShell.ts's resolveChartCanvasColors doc comment).
      const theme = resolveChartCanvasColors(card);

      ctx.font = '10px system-ui, sans-serif';
      for (const [v, label] of [[0, 'LSL'], [1, 'USL']] as const) {
        const y = yFor(v, plotTop, plotH);
        ctx.strokeStyle = theme.warnBorder;
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y); ctx.lineTo(plotW, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = theme.warnBorder;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(label, 2, y - 1);
      }

      rows.forEach((d, i) => {
        const x = i * cs;
        const midX = x + cs / 2;
        const boxW = Math.max(4, cs * 0.55);

        if (i === hovered) {
          // Bounded to the plot area only (not the rotated labels below it) —
          // covering the full column height smeared through the label text.
          ctx.fillStyle = theme.bgHover;
          ctx.fillRect(x, plotTop, cs, plotBottom - plotTop);
        }

        const color = forValue(ppkScore(d.ppk));
        const yMin = yFor(d.min, plotTop, plotH);
        const yQ1 = yFor(d.q1, plotTop, plotH);
        const yMedian = yFor(d.median, plotTop, plotH);
        const yQ3 = yFor(d.q3, plotTop, plotH);
        const yMax = yFor(d.max, plotTop, plotH);

        ctx.strokeStyle = theme.textMuted;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(midX, yMin); ctx.lineTo(midX, yQ1);
        ctx.moveTo(midX, yQ3); ctx.lineTo(midX, yMax);
        ctx.moveTo(midX - boxW / 4, yMin); ctx.lineTo(midX + boxW / 4, yMin);
        ctx.moveTo(midX - boxW / 4, yMax); ctx.lineTo(midX + boxW / 4, yMax);
        ctx.stroke();

        ctx.fillStyle = color;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(midX - boxW / 2, Math.min(yQ1, yQ3), boxW, Math.max(1, Math.abs(yQ3 - yQ1)));
        ctx.globalAlpha = 1;
        ctx.strokeStyle = color;
        ctx.strokeRect(midX - boxW / 2, Math.min(yQ1, yQ3), boxW, Math.max(1, Math.abs(yQ3 - yQ1)));

        ctx.strokeStyle = theme.text;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(midX - boxW / 2, yMedian); ctx.lineTo(midX + boxW / 2, yMedian);
        ctx.stroke();
        ctx.lineWidth = 1;

        const lbl = d.label.length > 12 ? `${d.label.slice(0, 11)}…` : d.label;
        ctx.save();
        ctx.translate(midX, plotBottom + 6);
        ctx.rotate(-Math.PI / 4);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillStyle = theme.textMuted;
        ctx.fillText(lbl, 0, 0);
        ctx.restore();
      });

      ctx.strokeStyle = theme.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(0, plotTop, plotW, plotH);
    }

    function colAt(e: MouseEvent): number {
      const rect = canvas.getBoundingClientRect();
      const availW = body.clientWidth;
      const cs = colSize(availW);
      const ox = (e.clientX - rect.left) * (canvas.width / dpr / rect.width);
      const col = Math.floor(ox / cs);
      return col >= 0 && col < n ? col : -1;
    }

    canvas.addEventListener('mousemove', e => {
      const col = colAt(e);
      if (col !== hovered) { hovered = col; drawChart(); }
      if (col === -1) { tooltip.style.display = 'none'; return; }
      const d = rows[col];
      const cardRect = card.getBoundingClientRect();
      const unitSuffix = d.unit ? ` ${d.unit}` : '';
      tooltip.innerHTML = `<strong>${d.label}</strong> (n=${d.n})<br>`
        + `LSL ${formatValue(d.lsl)}${unitSuffix} · USL ${formatValue(d.usl)}${unitSuffix}<br>`
        + `mean ${formatValue(d.mean)}${unitSuffix}<br>`
        + `Cp ${fmtIndex(d.cp)} · Cpk ${fmtIndex(d.cpk)}<br>`
        + `Pp ${fmtIndex(d.pp)} · Ppk ${fmtIndex(d.ppk)}`
        + (onSelectTest ? '<br><em>click to view in boxplot</em>' : '');
      tooltip.style.display = 'block';
      tooltip.style.left = `${e.clientX - cardRect.left + 14}px`;
      tooltip.style.top = `${e.clientY - cardRect.top + 14}px`;
      canvas.style.cursor = onSelectTest ? 'pointer' : 'default';
    });
    canvas.addEventListener('mouseleave', () => { if (hovered !== -1) { hovered = -1; drawChart(); } tooltip.style.display = 'none'; });
    canvas.addEventListener('click', e => {
      if (!onSelectTest) return;
      const col = colAt(e);
      if (col === -1) return;
      onSelectTest(rows[col].testNumber);
    });

    return drawChart;
  }

  function rebuild(): void {
    const data = buildCapabilityData(currentItems(), testDefs);
    const totalTestable = testDefs.filter(d => d.testNumber !== undefined).length;
    renderCaption(data.length, totalTestable);
    draw = buildView(data);
    draw();
  }

  const resizeHandle = observeResize(card, () => draw());
  rebuild();
  return { card, hasData, destroy: () => resizeHandle.disconnect() };
}
