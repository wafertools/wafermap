// Process capability panel — one normalized boxplot per parametric test with
// recorded values. Tests with both a lower and upper spec limit normalize
// LSL→0/USL→1 and get full Cp/Cpk/Pp/Ppk, sorted worst-Ppk-first; tests
// without full limits still render (muted, dashed) normalized onto their own
// observed range, sorted after the spec'd tests by most-variable-first —
// see `buildCapabilityData` in stats/capability.ts for the two-tier sort.
// Ported from tsmap's charts/capability.ts (the first host to build this) —
// the first panel in wmap's own Analysis tab, proving the pattern: wmap now
// owns the underlying math (stats/capability.ts). `items` is whatever
// population the Analysis tab's shared Group-by control (owned at the tab
// level, not per-panel — see renderWaferGallery.ts) currently has selected;
// this panel doesn't compute or own grouping itself, matching every other
// panel in the tab reacting to one shared selection.

import { buildCapabilityData, type CapabilityDatum, type CapabilityItem } from '../../stats/capability.js';
import { capabilityColor } from './palette.js';
import type { TestDef } from '../../renderer/buildWaferMap.js';
import { CLR } from '../toolbar.js';
import { cardShell, chartFillHeight, applyCanvasFlow, observeResize, makeTooltip, positionChartTooltip, makeLabeledSelect, renderEmptyState, resolveChartCanvasColors, type SaveImageHandler } from './chartShell.js';
import { fmt } from '../../renderer/fmt.js';

const CAP_MIN_COL = 30;
// The Analysis tab always gives this panel the full container width (unlike
// tsmap's original version of this panel, which usually lived in a small
// grid card and only got full width inside an expand modal) — so columns
// stretch to fill it, capped generously rather than pinned small, or a
// handful of tests would leave most of the width empty.
const CAP_MAX_COL = 160;
const CAP_LABEL_H = 90;
// Room above the plot for each column's Ppk readout. The chart is sorted
// worst-Ppk-first, so printing the number turns an ordering the user has to
// infer into one they can read — and it's the figure a capability chart exists
// to communicate, previously available only by hovering.
const CAP_TOP_MARGIN = 28;
// Left gutter for the normalized axis. The y scale is a normalization, not a
// measurement, so the axis names its two meaningful levels (LSL at 0, USL at 1)
// rather than printing numbers that would be unitless and, for the unspec'd
// columns, meaningless.
const CAP_AXIS_W = 42;

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
  /** Document to build this panel's DOM into. Default `document` — pass the
   *  host's own `ownerDocument` when the container might live in a
   *  different document (e.g. a gallery card detached into its own popup
   *  window). */
  ownerDocument?: Document;
}

function fmtIndex(v: number | null): string {
  return v === null ? '—' : v.toFixed(2);
}

export interface CapabilityPanelHandle {
  card: HTMLElement;
  /**
   * Whether any test in `testDefs` is parametric at all (has a `testNumber`)
   * — a chart with zero parametric tests has nothing to draw regardless of
   * spec-limit coverage (see `buildCapabilityData`'s fallback tier: tests
   * without spec limits still render, so lacking limits is no longer an
   * empty-chart condition on its own). This is a property of `testDefs`
   * alone, not the selected group. The Analysis tab uses this to avoid
   * forcing a large fixed height on a card that has nothing to draw.
   */
  hasData: boolean;
  /** Disconnect this panel's own ResizeObserver. Call when removing the card from the DOM. */
  destroy: () => void;
}

export function renderCapabilityPanel(options: CapabilityPanelOptions): CapabilityPanelHandle {
  // `colorScheme` is deliberately no longer read — boxes use the fixed
  // capable/marginal/poor hues (palette.ts); the option stays for API compatibility.
  const { title = 'Process capability', items, testDefs, onSaveImage, onSelectTest, groups } = options;
  const { card, body, controlsRow } = cardShell(title, onSaveImage, options.ownerDocument);

  const hasData = testDefs.some(d => d.testNumber !== undefined);

  body.style.overflowX = 'auto';

  let activeGroup: string | undefined = groups && groups.length > 0 ? groups[0].key : undefined;

  if (groups && groups.length > 0) {
    controlsRow.appendChild(makeLabeledSelect(
      'Group:',
      groups.map(g => ({ value: g.key, label: g.key })),
      activeGroup ?? '',
      v => { activeGroup = v; rebuild(); },
      { ownerDocument: card.ownerDocument },
    ));
  }

  function currentItems(): CapabilityItem[] {
    if (!groups || groups.length === 0) return items;
    return groups.find(g => g.key === activeGroup)?.items ?? [];
  }

  const hintRow = card.ownerDocument.createElement('div');
  Object.assign(hintRow.style, { display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '6px' } as Partial<CSSStyleDeclaration>);
  card.insertBefore(hintRow, body);

  const dpr = window.devicePixelRatio || 1;
  const tooltip = makeTooltip(card);

  let draw: () => void = () => {};

  function renderCaption(shownCount: number, unspecCount: number, totalTests: number): void {
    hintRow.innerHTML = '';
    const line = card.ownerDocument.createElement('span');
    Object.assign(line.style, { display: 'inline-flex', alignItems: 'center', gap: '6px', color: CLR.value, fontSize: '12px', fontWeight: '500' } as Partial<CSSStyleDeclaration>);

    const excluded = totalTests - shownCount;
    const unspecNote = unspecCount > 0 ? ` · ${unspecCount} without spec limits` : '';
    const summary = card.ownerDocument.createElement('span');
    summary.textContent = excluded > 0
      ? `${shownCount} of ${totalTests} tests shown${unspecNote} · ${excluded} excluded (no recorded values)`
      : `${shownCount} test${shownCount !== 1 ? 's' : ''} shown${unspecNote}`;
    line.appendChild(summary);

    hintRow.appendChild(line);

    // The normalization used to live only in a native `title` on an ⓘ. That
    // hid the chart's entire premise: with no axis, no printed Ppk and no
    // legend, a reader who never hovered had no way to learn that y is a
    // normalization, that the order is a ranking, or that box colour is a
    // verdict. A chart whose meaning is only reachable by hover is unreadable
    // on touch, unreachable by keyboard, and undiscoverable for everyone else.
    // The axis, the per-column Ppk and the legend below now carry it visibly;
    // this line states the one thing none of them can show.
    // Describe only what is actually plotted. A lot whose tests carry no spec
    // limits at all still renders (every column falls into the unspec'd tier),
    // and telling that reader about LSL/USL normalisation would describe a
    // chart they are not looking at.
    const allUnspec = unspecCount >= shownCount;
    const method = card.ownerDocument.createElement('div');
    method.textContent = allUnspec
      ? 'No test has both spec limits, so each is normalised to its own observed range '
        + '(min = 0, max = 1) and sorted most-variable first. Ppk needs limits, so none is shown.'
      : 'Normalised to spec limits (LSL = 0, USL = 1), worst Ppk first. '
        + 'Tests without both limits are normalised to their own observed range and drawn muted/dashed.';
    Object.assign(method.style, {
      color: CLR.label, fontSize: '11px', lineHeight: '1.45', marginTop: '3px', maxWidth: '78ch',
    } as Partial<CSSStyleDeclaration>);
    hintRow.appendChild(method);

    // With nothing spec'd there are no capability verdicts to key, so the
    // three-band legend would explain colours that never appear.
    hintRow.appendChild(buildCapabilityLegend(card.ownerDocument, unspecCount > 0, allUnspec));
  }

  /**
   * Capability-verdict key. The colours already encode capable/marginal/poor
   * (Okabe-Ito, so the distinction survives colour-vision deficiency), but
   * nothing on screen said what the bands were — leaving an all-orange chart
   * reading as a palette choice rather than "every test is marginal".
   */
  function buildCapabilityLegend(doc: Document, includeUnspec: boolean, allUnspec = false): HTMLElement {
    const row = doc.createElement('div');
    Object.assign(row.style, {
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 14px',
      marginTop: '7px', fontSize: '11px', color: CLR.label,
    } as Partial<CSSStyleDeclaration>);

    const entries: Array<{ color: string; label: string; dashed?: boolean }> = allUnspec ? [] : [
      { color: capabilityColor(2),    label: 'Capable · Ppk ≥ 1.33' },
      { color: capabilityColor(1.1),  label: 'Marginal · Ppk ≥ 1.0' },
      { color: capabilityColor(0.5),  label: 'Poor · Ppk < 1.0' },
    ];
    if (includeUnspec) entries.push({ color: CLR.label, label: 'No spec limits · no Ppk', dashed: true });

    for (const e of entries) {
      const item = doc.createElement('span');
      Object.assign(item.style, { display: 'inline-flex', alignItems: 'center', gap: '5px' } as Partial<CSSStyleDeclaration>);
      const sw = doc.createElement('span');
      Object.assign(sw.style, {
        width: '11px', height: '11px', flexShrink: '0', borderRadius: '2px',
        background: e.dashed ? 'transparent' : e.color,
        border: `1px ${e.dashed ? 'dashed' : 'solid'} ${e.color}`,
        opacity: e.dashed ? '1' : '0.75',
      } as Partial<CSSStyleDeclaration>);
      const txt = doc.createElement('span');
      txt.textContent = e.label;
      item.append(sw, txt);
      row.appendChild(item);
    }
    return row;
  }

  function buildView(rows: CapabilityDatum[]): () => void {
    body.innerHTML = '';

    if (rows.length === 0) {
      renderEmptyState(body, 'No parametric tests have any recorded values.', { maxWidth: '480px' } as Partial<CSSStyleDeclaration>);
      return () => {};
    }

    const canvas = card.ownerDocument.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.cursor = 'default';
    body.appendChild(canvas);

    const n = rows.length;

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

    /**
     * Name the two levels the normalization is built around, in the left
     * gutter. Deliberately labels rather than numbers: the scale is unitless,
     * and — as the per-column dashed ticks below already account for — 0 and 1
     * are real spec limits only for the spec'd columns. Drawing full-width
     * rules here would imply every column shares one spec, which is the exact
     * falsehood those per-column ticks exist to avoid, so the gutter gets a
     * short tick and a label and the plot area stays clean.
     */
    function drawNormalisedAxis(
      ctx: CanvasRenderingContext2D,
      theme: ReturnType<typeof resolveChartCanvasColors>,
      plotTop: number, plotH: number, plotW: number,
    ): void {
      // What 0 and 1 MEAN depends on the column: a spec'd test's are its real
      // limits, an unspec'd test's are just its own observed min/max. So the
      // labels track what is actually on screen rather than assuming limits
      // exist. With no spec'd column at all, "LSL/USL" would name limits that
      // are not in the data; with a mix, the limit names are right for the
      // solid columns and the dashed ones are marked as the exception by the
      // legend, the muted styling and their "—" Ppk.
      const specd   = rows.filter(d => d.hasSpec).length;
      const allSpecd = specd === rows.length;
      const noneSpecd = specd === 0;
      const hiLabel = noneSpecd ? 'max' : 'USL';
      const loLabel = noneSpecd ? 'min' : 'LSL';
      const axisTitle = allSpecd ? 'normalised to spec'
        : noneSpecd ? 'normalised to range'
        : 'normalised (per test)';

      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (const [v, label] of [[1, hiLabel], [0, loLabel]] as const) {
        const y = yFor(v, plotTop, plotH);
        if (y < plotTop - 1 || y > plotTop + plotH + 1) continue;
        ctx.strokeStyle = theme.warnBorder;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(CAP_AXIS_W - 5, y);
        ctx.lineTo(CAP_AXIS_W, y);
        ctx.stroke();
        ctx.fillStyle = theme.textMuted;
        ctx.fillText(label, CAP_AXIS_W - 8, y);
      }
      // Axis title, rotated up the gutter — says what the scale IS, which no
      // tick label can.
      ctx.save();
      ctx.translate(9, plotTop + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillStyle = theme.textMuted;
      ctx.fillText(axisTitle, 0, 0);
      ctx.restore();
      void plotW;
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
      const cs = colSize(availW - CAP_AXIS_W);
      const plotW = cs * n;
      const plotTop = CAP_TOP_MARGIN;
      const totalW = CAP_AXIS_W + plotW;
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

      rows.forEach((d, i) => {
        const x = CAP_AXIS_W + i * cs;
        const midX = x + cs / 2;
        const boxW = Math.max(4, cs * 0.55);

        if (i === hovered) {
          // Bounded to the plot area only (not the rotated labels below it) —
          // covering the full column height smeared through the label text.
          ctx.fillStyle = theme.bgHover;
          ctx.fillRect(x, plotTop, cs, plotBottom - plotTop);
        }

        // LSL/USL reference ticks only make sense for this column's own
        // normalization — a spec'd test's 0/1 are its real limits, but an
        // unspec'd test's 0/1 are just its own min/max, so drawing a
        // full-width line at y=0/y=1 would falsely imply every column shares
        // one spec. Drawn per-column instead, only where a spec exists.
        if (d.hasSpec) {
          const yLsl = yFor(0, plotTop, plotH);
          const yUsl = yFor(1, plotTop, plotH);
          ctx.strokeStyle = theme.warnBorder;
          ctx.setLineDash([3, 3]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, yLsl); ctx.lineTo(x + cs, yLsl);
          ctx.moveTo(x, yUsl); ctx.lineTo(x + cs, yUsl);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Unspec'd tests have no Ppk to judge "good/bad" by, so they don't
        // get the semantic capability colours — a muted, dashed box signals
        // "no capability judgment available" rather than implying a score.
        // Spec'd tests use the fixed capable/marginal/poor hues (palette.ts)
        // against the conventional Ppk 1.33/1.0 thresholds, not the map's
        // value ramp (whose colours carry no capability meaning).
        const color = d.hasSpec ? capabilityColor(d.ppk) : theme.textMuted;
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
        if (!d.hasSpec) ctx.setLineDash([4, 2]);
        ctx.strokeRect(midX - boxW / 2, Math.min(yQ1, yQ3), boxW, Math.max(1, Math.abs(yQ3 - yQ1)));
        ctx.setLineDash([]);

        ctx.strokeStyle = theme.text;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(midX - boxW / 2, yMedian); ctx.lineTo(midX + boxW / 2, yMedian);
        ctx.stroke();
        ctx.lineWidth = 1;

        // Ppk above each column, in that column's own verdict colour. This is
        // the number the chart is sorted by and the number its colours encode
        // — leaving it hoverable-only meant the reader could see that one box
        // was worse than another but never by how much, or against what
        // threshold. An unspec'd column has no Ppk to show and says so.
        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = d.hasSpec ? color : theme.textMuted;
        ctx.fillText(d.hasSpec ? fmtIndex(d.ppk) : '—', midX, plotTop - 8);

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
      ctx.strokeRect(CAP_AXIS_W, plotTop, plotW, plotH);

      drawNormalisedAxis(ctx, theme, plotTop, plotH, plotW);
    }

    function colAt(e: MouseEvent): number {
      const rect = canvas.getBoundingClientRect();
      const availW = body.clientWidth;
      const cs = colSize(availW - CAP_AXIS_W);
      const ox = (e.clientX - rect.left) * (canvas.width / dpr / rect.width) - CAP_AXIS_W;
      const col = Math.floor(ox / cs);
      return col >= 0 && col < n ? col : -1;
    }

    canvas.addEventListener('mousemove', e => {
      const col = colAt(e);
      if (col !== hovered) { hovered = col; drawChart(); }
      if (col === -1) { tooltip.style.display = 'none'; return; }
      const d = rows[col];
      // fmt(v, unit) applies proper SI-prefix scaling (e.g. "33.3 pA") —
      // a naive .toFixed(2) collapses pA/nA-scale measurements to "0.00",
      // which reads as "no signal" rather than a real small value.
      const fv = (v: number) => fmt(v, d.unit);
      tooltip.innerHTML = `<strong>${d.label}</strong> (n=${d.n})<br>`
        + (d.hasSpec
          ? `LSL ${fv(d.lsl!)} · USL ${fv(d.usl!)}<br>`
            + `mean ${fv(d.mean)}<br>`
            + `Cp ${fmtIndex(d.cp)} · Cpk ${fmtIndex(d.cpk)}<br>`
            + `Pp ${fmtIndex(d.pp)} · Ppk ${fmtIndex(d.ppk)}`
          : `<em>No spec limits — sorted by variability</em><br>`
            + `mean ${fv(d.mean)} · stddev ${fv(d.stdOverall)}`)
        + (onSelectTest ? '<br><em>click to view in boxplot</em>' : '');
      tooltip.style.display = 'block';
      positionChartTooltip(tooltip, card, e.clientX, e.clientY);
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
    const unspecCount = data.filter(d => !d.hasSpec).length;
    renderCaption(data.length, unspecCount, totalTestable);
    draw = buildView(data);
    draw();
  }

  const resizeHandle = observeResize(card, () => draw());
  rebuild();
  return { card, hasData, destroy: () => resizeHandle.disconnect() };
}
