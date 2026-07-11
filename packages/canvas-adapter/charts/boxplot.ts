// Boxplot panel — per-item (typically per-wafer) five-number summary for one
// parametric test, with a log-scale toggle. Ported from tsmap's
// charts/boxplot.ts. `items` is whatever population the Analysis tab's
// shared Group-by control currently has selected (see capability.ts's own
// doc comment — same contract). `setTest` lets another panel (the
// capability panel) drive this one's selected test in place, matching
// tsmap's original cross-panel link.
//
// Grouping matches tsmap's actual UX (verified by reading
// `src/charts/boxplot.ts`, not assumed — an earlier pass here got this
// wrong): unlike capability's restrict-to-one-group dropdown, boxplot shows
// one pooled row per group by default, and clicking a group's row drills
// in place into that group's per-item rows with a Back button. See `groups`
// below.
//
// Still trimmed from tsmap's version for this port: no trend-line toggle, no
// click-to-open-wafer (no equivalent wafer-detail action wired up yet in the
// Analysis tab). Tracked in tsmap's WMAP_ISSUES.md as explicit follow-ups,
// not silently dropped.

import { getColorScheme } from '../../renderer/colorSchemes.js';
import { buildTestBoxplotData, type BoxplotDatum, type BoxplotItem } from '../../stats/boxplot.js';
import type { TestDef } from '../../renderer/buildWaferMap.js';
import { CLR } from '../toolbar.js';
import { cardShell, formatValue, observeResize, makeTooltip, makeBackButton, makeTestSelect, makeToggle, renderEmptyState, growCardToFitContent, resolveChartCanvasColors, PADDING, VALUE_WIDTH, type SaveImageHandler } from './chartShell.js';

const BOX_ROW_HEIGHT = 24;
const BOX_ROW_GAP = 5;
const BOX_LABEL_WIDTH = 110;
const BOX_MAX_VISIBLE_ROWS = 12;
const AXIS_HEIGHT = 20;

/** A `BoxplotItem` carrying enough identity for the panel to open its wafer
 *  on a leaf-row click — the tab's own item shape already has this. */
export type BoxplotPanelItem = BoxplotItem & { waferIndex?: number };

export interface BoxplotPanelOptions {
  title?: string;
  items: BoxplotPanelItem[];
  testDefs: TestDef[];
  selectedTestNumber?: number;
  colorScheme?: string;
  onSaveImage?: SaveImageHandler;
  /**
   * When the Analysis tab's "Group by" is active, this panel shows one
   * pooled row per group by default (all of that group's items' dies
   * combined into one five-number summary); clicking a group's row drills
   * in place into that group's own per-item rows, with a Back button.
   * `items` above is ignored when `groups` is provided. Absent ⇒ today's
   * plain ungrouped per-item rows, no drill.
   */
  groups?: { key: string; items: BoxplotPanelItem[] }[];
  /** Human label of the active facet (e.g. "Split"), used in the overview
   *  hint text ("click a <label>'s box to see it by wafer"). */
  groupLabelText?: string;
  /** Clicking a leaf row (a real per-item row — ungrouped, or drilled into
   *  a group) calls this with that item's `waferIndex` and the boxplot's
   *  currently selected `testNumber`, so the opened wafer can land on the
   *  same test in value mode instead of defaulting to hard-bin mode.
   *  Never called for a pooled group-overview row (that drills instead). */
  onOpen?: (waferIndex: number, testNumber: number) => void;
}

export interface BoxplotPanelHandle {
  card: HTMLElement;
  /** Cross-panel link (e.g. from the capability panel): switch to `testNumber` in place. */
  setTest: (testNumber: number) => void;
  destroy: () => void;
}

export function renderBoxplotPanel(options: BoxplotPanelOptions): BoxplotPanelHandle {
  const { title = 'Test value distribution', items, testDefs, colorScheme = 'default', onSaveImage, groups, groupLabelText = 'group', onOpen } = options;
  const { card, heading, body, controlsRow } = cardShell(title, onSaveImage);

  // Unlike capability's fill-the-container canvas, this panel's canvas is an
  // in-flow element sized from its own content (row count) — it wants to be
  // exactly as tall as its data, not stretched or squeezed by a parent flex
  // allocation. `cardShell()`'s default `flex: '1'` (grow to fill) is right
  // for fill-style panels but wrong here: with flex-basis 0 and no definite
  // height anywhere up the ancestor chain (e.g. several of these panels
  // stacked in an auto-height list), the flex algorithm can resolve the
  // grow-share to 0 and `overflow-y: auto` then clips the real content into
  // an invisible box. `flex: '0 0 auto'` makes both the card and its body
  // size to their natural content height instead.
  card.style.flex = '0 0 auto';
  body.style.flex = '0 0 auto';
  // `card` is a *grid* item inside analysisTab's chart grid (makeChartGridWrap),
  // where `flex` above has no effect on sizing — `align-items: stretch`
  // (the grid default) still force-stretches card to match its tallest
  // row-neighbor (e.g. Process capability). Since body deliberately does
  // NOT grow to fill that extra height (flex:'0 0 auto' above), a stretch
  // makes card taller than body — corrupting growCardToFitContent's
  // `overhead = card.offsetHeight - body.clientHeight` with the stretch
  // amount, which gets baked into the next minHeight, stretching the row
  // even further: a runaway growth ratchet on every redraw. alignSelf
  // opts this card out of grid stretch, keeping its height always exactly
  // what growCardToFitContent set, so overhead stays stable.
  card.style.alignSelf = 'start';

  const testOptions = testDefs.filter((d): d is TestDef & { testNumber: number } => d.testNumber !== undefined);
  let activeTest = options.selectedTestNumber ?? testOptions[0]?.testNumber ?? null;
  let logScale = false;
  let axisIncludesLimits = false;
  let drillGroup: string | null = null;
  let backBtn: HTMLElement | null = null;

  // Memoized on the group/drill state alone (not logScale/axisIncludesLimits)
  // — those toggles redraw the same row population, so re-flattening every
  // group's dies (potentially thousands) on a display-only toggle would be
  // pure waste. `items`/`groups` are fixed for this panel's lifetime (the
  // Analysis tab tears down and rebuilds every panel on data change), so
  // caching by the group/drill key alone is sound.
  let cachedRowItems: BoxplotPanelItem[] | null = null;
  let cachedRowItemsKey: string | null = null;
  function currentDataItems(): BoxplotPanelItem[] {
    const key = !groups || groups.length === 0 ? '' : (drillGroup ?? '\0overview');
    if (cachedRowItems && cachedRowItemsKey === key) return cachedRowItems;
    const result = !groups || groups.length === 0 ? items
      : drillGroup !== null ? (groups.find(g => g.key === drillGroup)?.items ?? [])
      : groups.map(g => ({ label: g.key, dies: g.items.flatMap(it => it.dies ?? []) }));
    cachedRowItems = result;
    cachedRowItemsKey = key;
    return result;
  }

  // Sync the back button + hint text + heading to the current drillGroup
  // state — mirrors tsmap's syncDrillChrome. Called on construction and
  // after every drill open/close (never a card rebuild).
  function syncDrillChrome(): void {
    if (drillGroup !== null && !backBtn) {
      backBtn = makeBackButton(() => { drillGroup = null; syncDrillChrome(); rebuildBody(); });
      controlsRow.appendChild(backBtn);
    } else if (drillGroup === null && backBtn) {
      backBtn.remove();
      backBtn = null;
    }
    heading.textContent = drillGroup !== null ? `${title} — ${groupLabelText}: ${drillGroup}` : title;
  }

  const select = makeTestSelect(testOptions, activeTest, n => { activeTest = n; rebuildBody(); }, { maxWidth: '240px', emptyText: 'No parametric tests' });
  controlsRow.appendChild(select);

  controlsRow.appendChild(makeToggle('Log scale', logScale, v => { logScale = v; rebuildBody(); }));
  controlsRow.appendChild(makeToggle('Axis includes limits', axisIncludesLimits, v => { axisIncludesLimits = v; rebuildBody(); }));

  const hint = document.createElement('div');
  Object.assign(hint.style, { color: CLR.label, fontSize: '11px', marginBottom: '6px' } as Partial<CSSStyleDeclaration>);
  card.insertBefore(hint, body);

  function syncHint(): void {
    const isGroupOverview = !!groups && groups.length > 0 && drillGroup === null;
    const parts: string[] = [];
    if (isGroupOverview) parts.push(`click a ${groupLabelText}'s box to see it by wafer`);
    else if (onOpen) parts.push('click a box to open that wafer');
    const prefix = parts.length ? `${parts[0][0].toUpperCase()}${parts[0].slice(1)} · ` : '';
    hint.textContent = `${prefix}box = Q1–Q3, line = median, whiskers = min/max`;
  }
  syncHint();
  syncDrillChrome();

  const tooltip = makeTooltip(card);
  let resizeHandle: { disconnect: () => void } | null = null;

  function rebuildBody(): void {
    syncHint();
    body.innerHTML = '';
    if (testOptions.length === 0 || activeTest === null) {
      renderEmptyState(body, 'No parametric test data available for box plots.');
      return;
    }

    const rowItems = currentDataItems();
    const data = buildTestBoxplotData(rowItems, activeTest);
    const def = testDefs.find(d => d.testNumber === activeTest);
    const unit = def?.unit;
    const limitLow = def?.limitLow;
    const limitHigh = def?.limitHigh;

    if (data.every(d => d.count === 0)) {
      renderEmptyState(body, 'No parametric test data available for box plots.');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.cursor = 'default';
    body.appendChild(canvas);

    const visibleAreaHeight = PADDING * 2 + Math.min(data.length, BOX_MAX_VISIBLE_ROWS) * (BOX_ROW_HEIGHT + BOX_ROW_GAP) + AXIS_HEIGHT;
    body.style.maxHeight = `${visibleAreaHeight}px`;
    // This panel's body caps height and can genuinely scroll (many tests) —
    // cardShell()'s default is overflow-y:hidden (see its comment), so opt
    // back in here, the one place it's deliberately needed. Reserve the
    // scrollbar's gutter unconditionally too, so a classic scrollbar
    // appearing/disappearing across that cap doesn't change clientWidth
    // mid-measurement.
    body.style.overflowY = 'auto';
    body.style.scrollbarGutter = 'stable';
    // growCardToFitContent itself is called after the first draw() below,
    // not here — canvas was just created and is still at its unstyled
    // browser default size (300×150), so body.clientHeight measured now
    // would reflect that stale default rather than the real content,
    // corrupting growCardToFitContent's `overhead = card.offsetHeight -
    // body.clientHeight` every single rebuild (each rebuild recreates
    // canvas from scratch via body.innerHTML = ''). That inflated overhead
    // then gets baked into card's new minHeight, which becomes next
    // rebuild's stale card.offsetHeight — an unbounded growth ratchet on
    // every redraw (e.g. every checkbox toggle in this panel's controls).

    let hovered = -1;
    const dpr = window.devicePixelRatio || 1;

    const finite = data.filter(d => d.count > 0);
    const dataMin = Math.min(...finite.map(d => d.min));
    const dataMax = Math.max(...finite.map(d => d.max));
    const globalMin = axisIncludesLimits && limitLow !== undefined ? Math.min(dataMin, limitLow) : dataMin;
    const globalMax = axisIncludesLimits && limitHigh !== undefined ? Math.max(dataMax, limitHigh) : dataMax;
    const span = globalMax - globalMin || 1;
    const useLog = logScale && globalMin > 0;
    const logMin = useLog ? Math.log10(globalMin) : 0;
    const logMax = useLog ? Math.log10(globalMax) : 0;
    const logSpan = logMax - logMin || 1;

    const forValue = getColorScheme(colorScheme).forValue;

    function plotRect() {
      const plotX = PADDING + BOX_LABEL_WIDTH;
      const plotMaxWidth = canvas.clientWidth - plotX - VALUE_WIDTH - PADDING;
      return { plotX, plotMaxWidth: Math.max(10, plotMaxWidth) };
    }

    function xFor(value: number, plotX: number, plotMaxWidth: number): number {
      if (useLog) return plotX + ((Math.log10(value) - logMin) / logSpan) * plotMaxWidth;
      return plotX + ((value - globalMin) / span) * plotMaxWidth;
    }

    function axisTickValues(): number[] {
      const ticks: number[] = [];
      for (let i = 0; i <= 4; i++) ticks.push(useLog ? Math.pow(10, logMin + (logSpan * i) / 4) : globalMin + (span * i) / 4);
      return ticks;
    }

    function draw() {
      const theme = resolveChartCanvasColors(card);
      // body's own width, not card's — canvas is a direct child of body here
      // (no separate scroll wrapper), so measuring from it directly stays
      // correct even when body has its own vertical scrollbar (data.length
      // > BOX_MAX_VISIBLE_ROWS) narrowing its content box.
      const width = body.clientWidth;
      const height = PADDING * 2 + data.length * (BOX_ROW_HEIGHT + BOX_ROW_GAP) + AXIS_HEIGHT;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.font = '11px system-ui, sans-serif';
      ctx.textBaseline = 'middle';

      const { plotX, plotMaxWidth } = plotRect();

      data.forEach((datum, i) => {
        const y = PADDING + i * (BOX_ROW_HEIGHT + BOX_ROW_GAP);
        const midY = y + BOX_ROW_HEIGHT / 2;

        if (i === hovered) {
          ctx.fillStyle = theme.bgHover;
          ctx.fillRect(0, y - BOX_ROW_GAP / 2, width, BOX_ROW_HEIGHT + BOX_ROW_GAP);
        }

        ctx.fillStyle = theme.text;
        ctx.textAlign = 'right';
        const label = datum.label.length > 16 ? `${datum.label.slice(0, 15)}…` : datum.label;
        ctx.fillText(label, PADDING + BOX_LABEL_WIDTH - 8, midY);

        if (datum.count === 0) {
          ctx.fillStyle = theme.textMuted;
          ctx.textAlign = 'left';
          ctx.fillText('no data', plotX, midY);
          return;
        }

        const xMin = xFor(datum.min, plotX, plotMaxWidth);
        const xQ1 = xFor(datum.q1, plotX, plotMaxWidth);
        const xMedian = xFor(datum.median, plotX, plotMaxWidth);
        const xQ3 = xFor(datum.q3, plotX, plotMaxWidth);
        const xMax = xFor(datum.max, plotX, plotMaxWidth);
        const boxTop = y + 3;
        const boxBottom = y + BOX_ROW_HEIGHT - 3;

        ctx.strokeStyle = theme.textMuted;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xMin, midY); ctx.lineTo(xQ1, midY);
        ctx.moveTo(xQ3, midY); ctx.lineTo(xMax, midY);
        ctx.moveTo(xMin, boxTop); ctx.lineTo(xMin, boxBottom);
        ctx.moveTo(xMax, boxTop); ctx.lineTo(xMax, boxBottom);
        ctx.stroke();

        const normalizedMedian = useLog ? (Math.log10(datum.median) - logMin) / logSpan : (datum.median - globalMin) / span;
        const boxColor = forValue(Math.max(0, Math.min(1, normalizedMedian)));

        ctx.fillStyle = boxColor;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(xQ1, boxTop, Math.max(1, xQ3 - xQ1), boxBottom - boxTop);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = boxColor;
        ctx.strokeRect(xQ1, boxTop, Math.max(1, xQ3 - xQ1), boxBottom - boxTop);

        ctx.strokeStyle = theme.text;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(xMedian, boxTop); ctx.lineTo(xMedian, boxBottom);
        ctx.stroke();
        ctx.lineWidth = 1;

        ctx.fillStyle = theme.textMuted;
        ctx.textAlign = 'left';
        ctx.fillText(`med ${formatValue(datum.median)}${unit ? ` ${unit}` : ''}`, plotX + plotMaxWidth + 10, midY);
      });

      const axisY = PADDING + data.length * (BOX_ROW_HEIGHT + BOX_ROW_GAP);

      ctx.font = '10px system-ui, sans-serif';
      for (const [limit, limLabel] of [[limitLow, 'LSL'], [limitHigh, 'USL']] as const) {
        if (limit === undefined) continue;
        const x = xFor(limit, plotX, plotMaxWidth);
        ctx.strokeStyle = theme.warnBorder;
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 0); ctx.lineTo(x, axisY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = theme.warnBorder;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(limLabel, x, axisY - 1);
      }
      ctx.font = '11px system-ui, sans-serif';

      ctx.strokeStyle = theme.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plotX, axisY); ctx.lineTo(plotX + plotMaxWidth, axisY);
      ctx.stroke();

      ctx.fillStyle = theme.textMuted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (const tick of axisTickValues()) {
        const x = xFor(tick, plotX, plotMaxWidth);
        ctx.beginPath();
        ctx.moveTo(x, axisY); ctx.lineTo(x, axisY + 4);
        ctx.stroke();
        ctx.fillText(formatValue(tick), x, axisY + 6);
      }
      ctx.textBaseline = 'middle';
    }

    function rowAt(offsetY: number): number {
      const index = Math.floor((offsetY - PADDING + BOX_ROW_GAP / 2) / (BOX_ROW_HEIGHT + BOX_ROW_GAP));
      return index >= 0 && index < data.length ? index : -1;
    }

    function fmt(v: number): string { return `${formatValue(v)}${unit ? ` ${unit}` : ''}`; }

    const isGroupOverview = !!groups && groups.length > 0 && drillGroup === null;
    const leafClickable = (row: number) => !isGroupOverview && !!onOpen && rowItems[row]?.waferIndex !== undefined;

    canvas.addEventListener('mousemove', e => {
      const rect = canvas.getBoundingClientRect();
      const row = rowAt(e.clientY - rect.top);
      const clickable = row >= 0 && data[row].count > 0 && (isGroupOverview || leafClickable(row));
      if (row !== hovered) { hovered = row; canvas.style.cursor = clickable ? 'pointer' : 'default'; draw(); }
      if (row >= 0 && data[row].count > 0) {
        const d = data[row];
        const cardRect = card.getBoundingClientRect();
        const clickHint = isGroupOverview
          ? `<br><em>click to see this ${groupLabelText} by wafer</em>`
          : (leafClickable(row) ? '<br><em>click to open this wafer</em>' : '');
        tooltip.innerHTML = `<strong>${d.label}</strong> (${d.count} dies)<br>max ${fmt(d.max)}<br>q3 ${fmt(d.q3)}<br>median ${fmt(d.median)}<br>q1 ${fmt(d.q1)}<br>min ${fmt(d.min)}${clickHint}`;
        tooltip.style.display = 'block';
        tooltip.style.left = `${e.clientX - cardRect.left + 14}px`;
        tooltip.style.top = `${e.clientY - cardRect.top + 14}px`;
      } else {
        tooltip.style.display = 'none';
      }
    });
    canvas.addEventListener('mouseleave', () => { if (hovered !== -1) { hovered = -1; draw(); } tooltip.style.display = 'none'; });
    canvas.addEventListener('click', e => {
      const rect = canvas.getBoundingClientRect();
      const row = rowAt(e.clientY - rect.top);
      if (row === -1 || data[row].count === 0) return;
      if (isGroupOverview) {
        drillGroup = data[row].label;
        syncDrillChrome();
        syncHint();
        rebuildBody();
        return;
      }
      const waferIndex = rowItems[row]?.waferIndex;
      if (onOpen && waferIndex !== undefined && activeTest !== null) onOpen(waferIndex, activeTest);
    });

    resizeHandle?.disconnect();
    resizeHandle = observeResize(card, () => draw());
    draw();
    // Now that canvas has its real, final size, body.clientHeight
    // accurately reflects the content — safe to measure card's true
    // overhead from it (see the comment above where this used to be).
    growCardToFitContent(card, body, visibleAreaHeight);
  }

  rebuildBody();

  function setTest(testNumber: number): void {
    if (!testOptions.some(t => t.testNumber === testNumber) || testNumber === activeTest) return;
    activeTest = testNumber;
    select.value = String(testNumber);
    rebuildBody();
  }

  return { card, setTest, destroy: () => resizeHandle?.disconnect() };
}
