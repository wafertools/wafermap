// Generic horizontal bar-chart panel — backs both yield and bin pareto,
// mirroring tsmap's charts/render.ts's `renderPanel`/`ChartPanel`.

import type { ChartDatum } from '../../stats/yield.js';
import { CLR } from '../toolbar.js';
import { cardShell, formatValue, observeResize, makeTooltip, positionChartTooltip, makeBackButton, makeSegmented, growCardToFitContent, resolveChartCanvasColors, PADDING, VALUE_WIDTH, type SaveImageHandler } from './chartShell.js';

const ROW_HEIGHT = 24;
const ROW_GAP = 5;
const LABEL_WIDTH = 110;
const MAX_VISIBLE_ROWS = 12;

export interface ChartPanel {
  title: string;
  data: ChartDatum[];
  barColor?: (datum: ChartDatum, index: number) => string;
  valueLabel?: (datum: ChartDatum) => string;
  /**
   * Optional self-contained segmented control (yield sort, hard/soft bins).
   * When present the panel renders a radio group and, on change, recomputes
   * its own data and redraws in place.
   */
  selfControl?: {
    current: string;
    options: Array<[value: string, label: string]>;
    onChange: (value: string) => { data: ChartDatum[]; title?: string };
  };
  /**
   * In-place drill-down for a grouped row (`itemCount > 1`). When present,
   * clicking such a row calls `onOpenGroup`, which returns the detail
   * data/title to redraw in place (no modal, no grid rebuild) and shows a
   * Back button; clicking it calls `onBack`, which returns the overview
   * data/title.
   */
  drill?: {
    onOpenGroup: (datum: ChartDatum) => { data: ChartDatum[]; title: string };
    onBack: () => { data: ChartDatum[]; title: string };
    groupLabelText: string;
  };
  /**
   * Clicking a leaf row (`itemCount === 1` — a single wafer, whether reached
   * directly or by drilling into a group first) calls this to open that
   * wafer's map. A group row (`itemCount > 1`, drill not yet active) drills
   * instead, via `drill.onOpenGroup` — this is never called for those.
   */
  onOpen?: (datum: ChartDatum) => void;
}

export interface BarPanelHandle {
  card: HTMLElement;
  destroy: () => void;
}

export function renderBarPanel(panel: ChartPanel, onSaveImage?: SaveImageHandler): BarPanelHandle {
  const { barColor, valueLabel } = panel;
  let title = panel.title;
  let data = panel.data;
  const { card, heading, controlsRow, body } = cardShell(title, onSaveImage);

  if (panel.selfControl) {
    const sc = panel.selfControl;
    controlsRow.appendChild(makeSegmented(sc.options, sc.current, value => onSelfControlChange(value)));
  }

  const { drill } = panel;
  let drillActive = false;
  let backBtn: HTMLElement | null = null;

  const hint = document.createElement('div');
  Object.assign(hint.style, { color: CLR.label, fontSize: '11px', marginBottom: '6px' } as Partial<CSSStyleDeclaration>);
  card.insertBefore(hint, body);

  function syncHint(): void {
    const parts: string[] = [];
    if (panel.onOpen) parts.push('click to open this wafer');
    if (drill && !drillActive) parts.push(`click a ${drill.groupLabelText} to see it by wafer`);
    const text = parts.join(', or ');
    hint.textContent = text ? `${text[0].toUpperCase()}${text.slice(1)}.` : '';
  }
  syncHint();

  const scrollArea = document.createElement('div');
  const visibleAreaHeight = () => PADDING * 2 + Math.min(data.length, MAX_VISIBLE_ROWS) * (ROW_HEIGHT + ROW_GAP);
  // overflowX explicit, not left at its 'visible' default — pairing
  // 'visible' with overflowY's non-'visible' value would force it to
  // compute as 'auto' per the CSS overflow spec, adding an unintended
  // horizontal scroll axis (see chartShell.ts's cardShell() comment).
  Object.assign(scrollArea.style, { overflowX: 'hidden', overflowY: 'auto', minHeight: '0', flex: '1', maxHeight: `${visibleAreaHeight()}px`, scrollbarGutter: 'stable' } as Partial<CSSStyleDeclaration>);
  body.appendChild(scrollArea);

  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  canvas.style.cursor = 'default';
  scrollArea.appendChild(canvas);

  const tooltip = makeTooltip(card);

  let hovered = -1;
  const dpr = window.devicePixelRatio || 1;
  let maxValue = Math.max(1, ...data.map(d => d.value));

  const valueTextOf = (datum: ChartDatum) =>
    valueLabel ? valueLabel(datum) : `${formatValue(datum.value)} (${datum.percent.toFixed(1)}%)`;

  function rowRect(index: number) {
    const y = PADDING + index * (ROW_HEIGHT + ROW_GAP);
    const barX = PADDING + LABEL_WIDTH;
    const barMaxWidth = canvas.clientWidth - barX - VALUE_WIDTH - PADDING;
    return { y, barX, barMaxWidth: Math.max(10, barMaxWidth) };
  }

  function draw() {
    scrollArea.style.maxHeight = `${visibleAreaHeight()}px`;
    growCardToFitContent(card, body, visibleAreaHeight());
    // scrollArea's own width, not card's — scrollArea sits inside body/card's
    // padding box, so measuring from it directly (rather than re-deriving via
    // card.clientWidth minus a padding constant) stays correct even when
    // scrollArea has its own vertical scrollbar (data.length > MAX_VISIBLE_ROWS)
    // narrowing its content box.
    const width = scrollArea.clientWidth;
    const height = PADDING * 2 + data.length * (ROW_HEIGHT + ROW_GAP);
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    const theme = resolveChartCanvasColors(card);

    data.forEach((datum, i) => {
      const { y, barX, barMaxWidth } = rowRect(i);

      if (i === hovered) {
        ctx.fillStyle = theme.bgHover;
        ctx.fillRect(0, y - ROW_GAP / 2, width, ROW_HEIGHT + ROW_GAP);
      }

      ctx.fillStyle = theme.text;
      ctx.textAlign = 'right';
      const label = datum.label.length > 16 ? `${datum.label.slice(0, 15)}…` : datum.label;
      ctx.fillText(label, PADDING + LABEL_WIDTH - 8, y + ROW_HEIGHT / 2);

      ctx.fillStyle = theme.track;
      ctx.fillRect(barX, y, barMaxWidth, ROW_HEIGHT);

      const barWidth = Math.max(1, (datum.value / maxValue) * barMaxWidth);
      ctx.fillStyle = barColor ? barColor(datum, i) : theme.text;
      ctx.fillRect(barX, y, barWidth, ROW_HEIGHT);

      ctx.fillStyle = theme.text;
      ctx.textAlign = 'right';
      ctx.fillText(valueTextOf(datum), barX + barMaxWidth + VALUE_WIDTH, y + ROW_HEIGHT / 2);
    });
  }

  function onSelfControlChange(value: string): void {
    if (!panel.selfControl) return;
    panel.selfControl.current = value;
    const next = panel.selfControl.onChange(value);
    data = next.data;
    maxValue = Math.max(1, ...data.map(d => d.value));
    hovered = -1;
    if (next.title) { title = next.title; heading.textContent = title; }
    draw();
  }

  function onDrillOpen(datum: ChartDatum): void {
    if (!drill) return;
    const next = drill.onOpenGroup(datum);
    data = next.data;
    title = next.title;
    heading.textContent = title;
    maxValue = Math.max(1, ...data.map(d => d.value));
    hovered = -1;
    if (!drillActive) {
      drillActive = true;
      backBtn = makeBackButton(() => onDrillBack());
      controlsRow.appendChild(backBtn);
    }
    syncHint();
    draw();
  }
  function onDrillBack(): void {
    if (!drill) return;
    const next = drill.onBack();
    data = next.data;
    title = next.title;
    heading.textContent = title;
    maxValue = Math.max(1, ...data.map(d => d.value));
    hovered = -1;
    drillActive = false;
    backBtn?.remove();
    backBtn = null;
    syncHint();
    draw();
  }

  function rowAt(offsetY: number): number {
    const index = Math.floor((offsetY - PADDING + ROW_GAP / 2) / (ROW_HEIGHT + ROW_GAP));
    return index >= 0 && index < data.length ? index : -1;
  }

  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    const row = rowAt(e.clientY - rect.top);
    const isGroupRow = row >= 0 && drill && !drillActive && data[row].itemCount > 1;
    const clickable = row >= 0 && (isGroupRow || (!!panel.onOpen && row >= 0 && !isGroupRow));
    if (row !== hovered) { hovered = row; canvas.style.cursor = clickable ? 'pointer' : 'default'; draw(); }
    if (row >= 0) {
      const d = data[row];
      const hintLine = isGroupRow
        ? `<br><em>click to see this ${drill!.groupLabelText} by wafer</em>`
        : (panel.onOpen ? '<br><em>click to open this wafer</em>' : '');
      tooltip.innerHTML = `<strong>${d.label}</strong><br>${valueTextOf(d)}${hintLine}`;
      tooltip.style.display = 'block';
      positionChartTooltip(tooltip, card, e.clientX, e.clientY);
    } else { tooltip.style.display = 'none'; }
  });
  canvas.addEventListener('mouseleave', () => { if (hovered !== -1) { hovered = -1; draw(); } tooltip.style.display = 'none'; });
  canvas.addEventListener('click', e => {
    const rect = canvas.getBoundingClientRect();
    const row = rowAt(e.clientY - rect.top);
    if (row === -1) return;
    const datum = data[row];
    if (drill && !drillActive && datum.itemCount > 1) { onDrillOpen(datum); return; }
    panel.onOpen?.(datum);
  });

  const resizeHandle = observeResize(card, () => draw());
  draw();
  return { card, destroy: () => resizeHandle.disconnect() };
}
