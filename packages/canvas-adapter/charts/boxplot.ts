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
// Still trimmed from tsmap's version for this port: no trend-line toggle.
// Click-to-open-wafer IS wired up now (`onOpen`, from the Insights tab), and
// what a click does depends on the host — a gallery opens that wafer already on
// this test, a single-wafer host shows the test on the map it already has (see
// `openActionLabel`, and `InsightsTabDeps.focusTest`).

import { buildTestBoxplotData, type BoxplotItem } from '../../stats/boxplot.js';
import type { TestDef } from '../../renderer/buildWaferMap.js';
import { SPACE, fontPx, FONT, CLR } from '../toolbar.js';
import { fmt as fmtUnit } from '../../renderer/fmt.js';
import { fitTicks } from '../../renderer/axisTicks.js';
import { QUANTITY } from './palette.js';
import { cardShell, observeResize, makeTooltip, positionChartTooltip, makeBackButton, makeLinkedTestSelect, makeToggle, makeLinkedAxisPrefs, renderEmptyState, fitRowsHeight, setChartGrow, resolveChartCanvasColors, makeAxisFormat, horizontalTickSpacing, resolveAxisRange, shouldIncludeLimitsByDefault, drawOffAxisLimits, limitLabelSide, PADDING, VALUE_WIDTH, type AxisPrefs, type SaveImageHandler, type WaferContextMenuHandler, WAFER_MENU_HINT, prepareCanvas } from './chartShell.js';
import { escHtml, maxOf, minOf } from '../../core/utils.js';

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
  /** Initial axis toggles, shared with the sibling distribution panels. */
  axisPrefs?: AxisPrefs;
  /** Fired when the user changes an axis toggle here, so siblings can follow. */
  onAxisPrefsChange?: (prefs: AxisPrefs) => void;
  /** Fired when the USER picks a test here, so siblings can follow. */
  onTestChange?: (testNumber: number) => void;
  /** Human label of the active facet (e.g. "Split"), used in the overview
   *  hint text ("click a <label>'s box to see it by wafer"). */
  groupLabelText?: string;
  /** Fired when the user narrows to one group here — by clicking a group's box
   *  to drill in, or Back to leave. The Insights tab owns the scope; this panel
   *  only reports the gesture. */
  onGroupChange?: (key: string | null) => void;
  /** Clicking a leaf row (a real per-item row — ungrouped, or drilled into
   *  a group) calls this with that item's `waferIndex` and the boxplot's
   *  currently selected `testNumber`, so the opened wafer can land on the
   *  same test in value mode instead of defaulting to hard-bin mode.
   *  Never called for a pooled group-overview row (that drills instead). */
  onOpen?: (waferIndex: number, testNumber: number) => void;
  /** Right-click on a wafer's box — see `WaferContextMenuHandler`. Not called
   *  for a pooled group row. */
  onWaferContextMenu?: WaferContextMenuHandler;
  /** What `onOpen` will actually do, in the user's words — substituted into
   *  both click affordances ("click a box to …" / "click to …"). Default
   *  wording describes opening that wafer, which is what a gallery host does;
   *  a single-wafer host, where there is no other wafer to open and the click
   *  instead shows the selected test on the map it already has, passes its own
   *  (see `InsightsTabDeps.focusTest`). One string rather than two because the
   *  two affordances describe one action — if they can disagree, they will. */
  openActionLabel?: string;
  /** Document to build this panel's DOM into. Default `document` — pass the
   *  host's own `ownerDocument` when the container might live in a
   *  different document (e.g. a gallery card detached into its own popup
   *  window). */
  ownerDocument?: Document;
}

export interface BoxplotPanelHandle {
  card: HTMLElement;
  /** Cross-panel link (e.g. from the capability panel): switch to `testNumber` in place. */
  setTest: (testNumber: number) => void;
  /** Adopt the shared axis toggles (see `AxisPrefs`). */
  setAxisPrefs: (prefs: AxisPrefs) => void;
  destroy: () => void;
}

export function renderBoxplotPanel(options: BoxplotPanelOptions): BoxplotPanelHandle {
  // Box fills are the fixed neutral quantity colour (palette.ts).
  const { title = 'Test value distribution', items, testDefs, onSaveImage, groups, groupLabelText = 'group', onOpen } = options;
  // Two defaults, one override: the stock wording differs by position ("a box"
  // is any box, the hovered one is "this wafer"), while a host-supplied label
  // names one action and reads correctly in both slots.
  const openHintLabel    = options.openActionLabel ?? 'open that wafer';
  const openTooltipLabel = options.openActionLabel ?? 'open this wafer';
  const { card, heading, body, controlsRow } = cardShell(title, onSaveImage, options.ownerDocument);
  setChartGrow(card, 'rows');

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
  // `undefined` = derive from the data on each rebuild (see
  // shouldIncludeLimitsByDefault); a boolean means the user has chosen, and their
  // choice sticks across test changes.
  let lastClippedCount = 0;
  // The section's shared group scope, mirrored here (see `makeLinkedGroupSelect`).
  // `null` is the pooled one-row-per-group overview this panel has always
  // opened on; a key is that group drilled to its own wafers — the state the
  // click-to-drill affordance already produced. The only change is that the
  // state is now shared: it used to be private, so drilling here told capability
  // and the histogram nothing and they carried on showing other populations.
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
      backBtn = makeBackButton(() => { setDrill(null); options.onGroupChange?.(null); }, card.ownerDocument);
      controlsRow.appendChild(backBtn);
    } else if (drillGroup === null && backBtn) {
      backBtn.remove();
      backBtn = null;
    }
    heading.textContent = drillGroup !== null ? `${title} — ${groupLabelText}: ${drillGroup}` : title;
  }

  /** Apply a group scope locally — chrome, select and body. Never broadcasts;
   *  callers that represent a USER action fire `onGroupChange` themselves. */
  function setDrill(key: string | null): boolean {
    if (drillGroup === key) return false;
    if (key !== null && !(groups ?? []).some(g => g.key === key)) return false;
    drillGroup = key;
    syncDrillChrome();
    syncHint();
    rebuildBody();
    return true;
  }


  const testSel = makeLinkedTestSelect(testOptions, activeTest, n => {
    activeTest = n;
    rebuildBody();
    options.onTestChange?.(n);
  }, { maxWidth: '240px', emptyText: 'No parametric tests', ownerDocument: card.ownerDocument });
  const select = testSel.el;
  controlsRow.appendChild(select);

  controlsRow.appendChild(makeToggle('Log scale', logScale, v => { logScale = v; rebuildBody(); }, card.ownerDocument));
  // Rebuilt on every rebuildBody so the "Axis includes limits" checkbox reflects
  // the RESOLVED state — with the default derived from the data, an unchecked box
  // beside an axis that plainly does include the limits would be a lie.
  const axisTogglesRow = card.ownerDocument.createElement('span');
  Object.assign(axisTogglesRow.style, { display: 'inline-flex', gap: SPACE.lg, alignItems: 'center' } as Partial<CSSStyleDeclaration>);
  controlsRow.appendChild(axisTogglesRow);
  // The toggles, their state, and the notify — one shared control instead of
  // a copy in each of the three panels that offers them.
  const axisCtl = makeLinkedAxisPrefs(axisTogglesRow, options.axisPrefs, prefs => {
    options.onAxisPrefsChange?.(prefs);
    rebuildBody();
  }, card.ownerDocument);


  const hint = card.ownerDocument.createElement('div');
  Object.assign(hint.style, { color: CLR.label, fontSize: FONT.body, marginBottom: SPACE.sm } as Partial<CSSStyleDeclaration>);
  card.insertBefore(hint, body);

  function syncHint(): void {
    const isGroupOverview = !!groups && groups.length > 0 && drillGroup === null;
    const parts: string[] = [];
    if (isGroupOverview) parts.push(`click a ${groupLabelText}'s box to see it by wafer`);
    else if (onOpen) parts.push(`click a box to ${openHintLabel}`);
    const prefix = parts.length ? `${parts[0][0].toUpperCase()}${parts[0].slice(1)} · ` : '';
    hint.textContent = `${prefix}box = Q1–Q3, line = median, whiskers = min/max · value shown is the median`
      // Clipping moves the AXIS only; every box's statistics are computed over the
      // full population. Saying how many points sit outside the view is what keeps
      // that honest.
      + (lastClippedCount ? ` · axis clipped, ${lastClippedCount} value${lastClippedCount === 1 ? '' : 's'} outside` : '');
  }
  syncHint();
  syncDrillChrome();

  const tooltip = makeTooltip(card);
  let resizeHandle: { disconnect: () => void } | null = null;

  function rebuildBody(): void {
    // Read once per rebuild from the shared control, which owns this state.
    const { includeLimits: axisIncludesLimits, clipOutliers } = axisCtl.get();
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

    const canvas = card.ownerDocument.createElement('canvas');
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
    // The card's height request and this cap are both set in draw(), through
    // fitRowsHeight — which measures the card's chrome from its siblings, so it
    // no longer depends on the canvas having its final size first.

    let hovered = -1;

    const finite = data.filter(d => d.count > 0);
    const dataMin = minOf(finite.map(d => d.min));
    const dataMax = maxOf(finite.map(d => d.max));
    const resolvedIncludeLimits = axisIncludesLimits
      ?? shouldIncludeLimitsByDefault(dataMin, dataMax, limitLow, limitHigh);
    axisCtl.sync(resolvedIncludeLimits, limitLow !== undefined || limitHigh !== undefined);

    // Clipping uses each box's own min/max as the value population — the raw dies
    // are not held here. It clips the AXIS only; every box's statistics are
    // untouched, and no reported number changes.
    const range = resolveAxisRange({
      dataMin, dataMax, limitLow, limitHigh,
      includeLimits: resolvedIncludeLimits,
      clipOutliers,
      values: finite.flatMap(d => [d.min, d.q1, d.median, d.q3, d.max]) });
    lastClippedCount = range.clippedCount;
    syncHint();
    const globalMin = range.lo;
    const globalMax = range.hi;
    const span = globalMax - globalMin || 1;
    const useLog = logScale && globalMin > 0;
    const logMin = useLog ? Math.log10(globalMin) : 0;
    const logMax = useLog ? Math.log10(globalMax) : 0;
    const logSpan = logMax - logMin || 1;

    const axisRef = Math.max(Math.abs(globalMin), Math.abs(globalMax));

    function plotRect() {
      const plotX = PADDING + BOX_LABEL_WIDTH;
      const plotMaxWidth = canvas.clientWidth - plotX - VALUE_WIDTH - PADDING;
      return { plotX, plotMaxWidth: Math.max(10, plotMaxWidth) };
    }

    function xFor(value: number, plotX: number, plotMaxWidth: number): number {
      if (useLog) return plotX + ((Math.log10(value) - logMin) / logSpan) * plotMaxWidth;
      return plotX + ((value - globalMin) / span) * plotMaxWidth;
    }

    /**
     * Linear: round values, as many as the measured labels allow in the plot's
     * width, labelled to their step. Log: five decade-spaced ticks with
     * size-based labels, as before.
     */
    function axisTicks(ctx: CanvasRenderingContext2D, plotMaxWidth: number): { ticks: number[]; axis: ReturnType<typeof makeAxisFormat> } {
      if (useLog) {
        const ticks: number[] = [];
        for (let i = 0; i <= 4; i++) ticks.push(Math.pow(10, logMin + (logSpan * i) / 4));
        return { ticks, axis: makeAxisFormat(axisRef, unit) };
      }
      const fit = fitTicks(globalMin, globalMax, plotMaxWidth, horizontalTickSpacing(ctx, axisRef, unit));
      return { ticks: fit.ticks, axis: makeAxisFormat(axisRef, unit, fit.step || undefined) };
    }

    function draw() {
      const theme = resolveChartCanvasColors(card);
      // body's own width, not card's — canvas is a direct child of body here
      // (no separate scroll wrapper), so measuring from it directly stays
      // correct even when body has its own vertical scrollbar (data.length
      // > BOX_MAX_VISIBLE_ROWS) narrowing its content box.
      const height = PADDING * 2 + data.length * (BOX_ROW_HEIGHT + BOX_ROW_GAP) + AXIS_HEIGHT;
      // Before measuring the width: a new cap can add or remove the scrollbar.
      body.style.maxHeight = `${fitRowsHeight(card, body, visibleAreaHeight, height)}px`;
      const width = body.clientWidth;
      const prep = prepareCanvas(canvas, card, width, height);
      if (!prep) return;
      const { ctx } = prep;
      ctx.font = `${fontPx(-1)}px system-ui, sans-serif`;
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

        // Clamped to the plot rect, and the clamp is TRACKED, not just applied.
        // `clipOutliers` shrinks the AXIS to a robust fence over every box's
        // min/q1/median/q3/max (see resolveAxisRange's own doc comment) — it
        // narrows the view, it does not touch the statistics. A box whose own
        // min/max sits outside that narrowed axis previously drew its whisker
        // past the plot edge and over the row label / axis ticks on the low
        // side, because `xFor` has no bound of its own — it only maps a value
        // to a position, and a position outside [plotX, plotRight] is exactly
        // what "clipped" produces for the box that got clipped.
        //
        // Q1/Q3/median are clamped defensively too: the fence is computed over
        // every box's five statistics pooled together, so one box that sits far
        // from the rest of the population can have its whole span — not just its
        // extremes — fall outside a fence built from the pooled set.
        const plotRight = plotX + plotMaxWidth;
        const clamp = (x: number) => Math.min(plotRight, Math.max(plotX, x));
        const rawXMin = xFor(datum.min, plotX, plotMaxWidth);
        const rawXMax = xFor(datum.max, plotX, plotMaxWidth);
        const xMin = clamp(rawXMin);
        const xQ1 = clamp(xFor(datum.q1, plotX, plotMaxWidth));
        const xMedian = clamp(xFor(datum.median, plotX, plotMaxWidth));
        const xQ3 = clamp(xFor(datum.q3, plotX, plotMaxWidth));
        const xMax = clamp(rawXMax);
        const minClipped = rawXMin < xMin;
        const maxClipped = rawXMax > xMax;
        const boxTop = y + 3;
        const boxBottom = y + BOX_ROW_HEIGHT - 3;

        ctx.strokeStyle = theme.textMuted;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xMin, midY); ctx.lineTo(xQ1, midY);
        ctx.moveTo(xQ3, midY); ctx.lineTo(xMax, midY);
        // A whisker CAP — the flat tick — asserts "this is the exact value".
        // Drawn only on the end that was NOT clamped; a clamped end draws an
        // outward chevron instead (open V, same stroke as the whisker line),
        // so it reads as "truncated here, continues past this point" rather
        // than claiming a precision the plotted position does not have. This
        // is the same "state it, don't hide it" rule `drawOffAxisLimits` uses
        // for a limit that falls outside the axis, in the same visual family
        // as an arrow: a mark that points outward instead of a flat boundary.
        const chevronR = 3;
        if (minClipped) {
          ctx.moveTo(xMin + chevronR, midY - chevronR); ctx.lineTo(xMin, midY);
          ctx.lineTo(xMin + chevronR, midY + chevronR);
        } else {
          ctx.moveTo(xMin, boxTop); ctx.lineTo(xMin, boxBottom);
        }
        if (maxClipped) {
          ctx.moveTo(xMax - chevronR, midY - chevronR); ctx.lineTo(xMax, midY);
          ctx.lineTo(xMax - chevronR, midY + chevronR);
        } else {
          ctx.moveTo(xMax, boxTop); ctx.lineTo(xMax, boxBottom);
        }
        ctx.stroke();

        // One neutral box fill for every row — the box's position along the
        // axis already encodes the median; tinting the box by that same
        // position (as the map value ramp used to) duplicated the axis as
        // colour noise (see palette.ts).
        ctx.fillStyle = QUANTITY;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(xQ1, boxTop, Math.max(1, xQ3 - xQ1), boxBottom - boxTop);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = QUANTITY;
        ctx.strokeRect(xQ1, boxTop, Math.max(1, xQ3 - xQ1), boxBottom - boxTop);

        ctx.strokeStyle = theme.text;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(xMedian, boxTop); ctx.lineTo(xMedian, boxBottom);
        ctx.stroke();
        ctx.lineWidth = 1;

        ctx.fillStyle = theme.textMuted;
        ctx.textAlign = 'left';
        // Value only. The word "med" repeated on every row was thirteen copies
        // of a column heading printed as data — it said the same thing on each
        // line and still never said it clearly. The column is labelled once, in
        // the card's caption ("line = median").
        ctx.fillText(fmtUnit(datum.median, unit, 'engineering'), plotX + plotMaxWidth + 10, midY);
      });

      const axisY = PADDING + data.length * (BOX_ROW_HEIGHT + BOX_ROW_GAP);

      ctx.font = `${fontPx(-1)}px system-ui, sans-serif`;
      // A limit outside the plotted range gets an edge marker instead of a line
      // drawn off-canvas — otherwise "limits are off-screen" and "this test has no
      // limits" render identically, which is the one thing the reader must not
      // confuse.
      drawOffAxisLimits(ctx, range.offAxis,
        { left: plotX, right: plotX + plotMaxWidth, top: 0, bottom: axisY },
        'horizontal', theme.limitLine, v => fmtUnit(v, unit, 'engineering'));
      const offAxisValues = new Set(range.offAxis.map(o => o.value));
      for (const [limit, limLabel] of [[limitLow, 'LSL'], [limitHigh, 'USL']] as const) {
        if (limit === undefined || offAxisValues.has(limit)) continue;
        const x = xFor(limit, plotX, plotMaxWidth);
        ctx.strokeStyle = theme.limitLine;
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 0); ctx.lineTo(x, axisY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = theme.limitLine;
        // BESIDE the line, not centred on it. This rule runs the full plot
        // height (0 → axisY) with the label inside that span, so a centred
        // label had the dashed line struck through its glyphs — an `S` with a
        // vertical stroke through it reads as `$`, which is how this was
        // spotted. The histogram's label needs no such offset: it sits above
        // `plotTop`, clear of where its own line begins.
        //
        // OUTWARD — LSL to the left of its line, USL to the right — because
        // that is the side each limit means. LSL bounds the low out-of-spec
        // region and USL the high one, so a label placed on the far side sits
        // in the in-spec region and reads as belonging to the data rather than
        // to the boundary. An earlier version offset inward purely to keep the
        // text off the plot edge; that is a layout worry overriding what the
        // mark says, which is the wrong way round.
        const dir = limitLabelSide(
          x, ctx.measureText(limLabel).width, plotX, plotX + plotMaxWidth, limLabel === 'LSL');
        ctx.textAlign = dir < 0 ? 'right' : 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(limLabel, x + dir * 3, axisY - 1);
      }
      ctx.font = `${fontPx(-1)}px system-ui, sans-serif`;

      ctx.strokeStyle = theme.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plotX, axisY); ctx.lineTo(plotX + plotMaxWidth, axisY);
      ctx.stroke();

      ctx.fillStyle = theme.textMuted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const { ticks: tickValues, axis } = axisTicks(ctx, plotMaxWidth);
      for (const tick of tickValues) {
        const x = xFor(tick, plotX, plotMaxWidth);
        ctx.beginPath();
        ctx.moveTo(x, axisY); ctx.lineTo(x, axisY + 4);
        ctx.stroke();
        ctx.fillText(axis.tick(tick), x, axisY + 6);
      }
      if (axis.unitLabel) {
        ctx.textAlign = 'left';
        ctx.font = `${fontPx(-1)}px system-ui, sans-serif`;
        // +22 clears the last tick label, which is centred on the axis end
        // and extends past it.
        ctx.fillText(`(${axis.unitLabel})`, plotX + plotMaxWidth + 22, axisY + 6);
        ctx.font = `${fontPx(-1)}px system-ui, sans-serif`;
      }
      ctx.textBaseline = 'middle';
    }

    function rowAt(offsetY: number): number {
      const index = Math.floor((offsetY - PADDING + BOX_ROW_GAP / 2) / (BOX_ROW_HEIGHT + BOX_ROW_GAP));
      return index >= 0 && index < data.length ? index : -1;
    }

    function fmt(v: number): string { return fmtUnit(v, unit, 'engineering'); }

    const isGroupOverview = !!groups && groups.length > 0 && drillGroup === null;
    const leafClickable = (row: number) => !isGroupOverview && !!onOpen && rowItems[row]?.waferIndex !== undefined;

    canvas.addEventListener('mousemove', e => {
      const rect = canvas.getBoundingClientRect();
      const row = rowAt(e.clientY - rect.top);
      const clickable = row >= 0 && data[row].count > 0 && (isGroupOverview || leafClickable(row));
      if (row !== hovered) { hovered = row; canvas.style.cursor = clickable ? 'pointer' : 'default'; draw(); }
      if (row >= 0 && data[row].count > 0) {
        const d = data[row];
        const clickHint = isGroupOverview
          ? `<br><em>click to see this ${escHtml(groupLabelText)} by wafer</em>`
          : (leafClickable(row) ? `<br><em>click to ${escHtml(openTooltipLabel)}</em>` : '');
        const menuHint = !isGroupOverview && options.onWaferContextMenu && rowItems[row]?.waferIndex !== undefined ? WAFER_MENU_HINT : '';
        tooltip.innerHTML = `<strong>${escHtml(d.label)}</strong> (${d.count} dies)<br>max ${escHtml(fmt(d.max))}<br>q3 ${escHtml(fmt(d.q3))}<br>median ${escHtml(fmt(d.median))}<br>q1 ${escHtml(fmt(d.q1))}<br>min ${escHtml(fmt(d.min))}${clickHint}${menuHint}`;
        tooltip.style.display = 'block';
        positionChartTooltip(tooltip, card, e.clientX, e.clientY);
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
        const key = data[row].label;
        setDrill(key);
        options.onGroupChange?.(key);
        return;
      }
      const waferIndex = rowItems[row]?.waferIndex;
      if (onOpen && waferIndex !== undefined && activeTest !== null) onOpen(waferIndex, activeTest);
    });
    canvas.addEventListener('contextmenu', e => {
      const rect = canvas.getBoundingClientRect();
      const row = rowAt(e.clientY - rect.top);
      const waferIndex = row === -1 ? undefined : rowItems[row]?.waferIndex;
      if (isGroupOverview || waferIndex === undefined || !options.onWaferContextMenu) return;
      tooltip.style.display = 'none';
      options.onWaferContextMenu(waferIndex, activeTest ?? undefined, e);
    });

    resizeHandle?.disconnect();
    resizeHandle = observeResize(card, () => draw());
    draw();
  }

  rebuildBody();

  function setTest(testNumber: number): void {
    // The guard and the control sync both live in `makeLinkedTestSelect` now.
    if (!testSel.set(testNumber)) return;
    activeTest = testNumber;
    rebuildBody();
  }

  /** Adopt a sibling panel's axis toggles without re-firing the change back. */
  function setAxisPrefs(prefs: AxisPrefs): void {
    // Guard and state both live in the control now.
    if (!axisCtl.set(prefs)) return;
    rebuildBody();
  }

  return { card, setTest, setAxisPrefs, destroy: () => resizeHandle?.disconnect() };
}
