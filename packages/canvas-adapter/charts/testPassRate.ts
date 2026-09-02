// Per-test pass rate, one cluster per test and a sub-bar per group — "which test
// is failing, and does it fail more in one split than another?".
//
// Structurally a sibling of binCluster.ts and deliberately shares its visual
// language (cluster label left, sub-bars per group, legend above), but the bars
// are RATES on a fixed 0–100% axis rather than counts on a data-relative one.
// That difference is the point: splits routinely have different wafer counts, so
// a count axis would show the bigger split failing more while it fails at the
// same rate. A fixed axis also makes clusters comparable to each other, which a
// per-row normalisation would destroy.
//
// The selector carries THREE modes, not two, because a parametric test has two
// independent pass/fail notions: the spec-limit judgement and the tester's own
// recorded flag (STDF's PTR TEST_FLG, which exists whether or not limits do).
// They can legitimately disagree — guard bands, dynamic limits, criteria the
// exported limits do not describe — so they are separate views and the hint
// reports how many dies disagree rather than silently preferring one.
// See stats/testPassRate.ts. Only the modes the data supports are offered.

import {
  buildTestPassRateData, hasJudgeableTests,
  type TestPassKind, type TestPassRateData,
} from '../../stats/testPassRate.js';
import type { TestPassRateItem } from '../../stats/testPassRate.js';
import type { TestDef } from '../../renderer/buildWaferMap.js';
import { categorical, QUANTITY } from './palette.js';
import { SPACE, RADIUS, fontPx, FONT, CLR } from '../toolbar.js';
import {
  cardShell, observeResize, makeTooltip, positionChartTooltip, makeSegmented,
  renderEmptyState, growCardToFitContent, resolveChartCanvasColors, PADDING, VALUE_WIDTH,
  type SaveImageHandler,
} from './chartShell.js';

const CLUSTER_LABEL_WIDTH = 100;
const CLUSTER_GAP = 8;
const SUBBAR_GAP = 1;
const SUBBAR_HEIGHT = 14;
const MAX_VISIBLE_TESTS = 8;

export interface TestPassRatePanelOptions {
  title?: string;
  /** One entry per group. Pass a single group for the ungrouped case. */
  groups: { key: string; items: TestPassRateItem[] }[];
  testDefs: TestDef[] | undefined;
  onSaveImage?: SaveImageHandler;
  ownerDocument?: Document;
}

export interface TestPassRatePanelHandle {
  card: HTMLElement;
  destroy: () => void;
}

const KIND_LABEL: Record<TestPassKind, string> = {
  spec:       'Spec limits',
  testFlag:   'Tester flag',
  functional: 'Functional',
};

/** Card title per mode — names the population AND how it was judged, so a
 *  screenshot of the card is never ambiguous about which of the two parametric
 *  questions it answers. */
const KIND_TITLE: Record<TestPassKind, string> = {
  spec:       'Parametric pass rate · spec limits',
  testFlag:   'Parametric pass rate · tester flag',
  functional: 'Functional test pass rate',
};

export function renderTestPassRatePanel(options: TestPassRatePanelOptions): TestPassRatePanelHandle {
  const { groups, testDefs, onSaveImage } = options;
  const doc = options.ownerDocument ?? document;

  // `hasJudgeableTests` needs the dies for 'testFlag': every parametric test
  // *could* carry a recorded verdict, so a definition-only check would offer a
  // mode that renders empty on the common data that has none.
  const allDies = groups.flatMap(g => g.items.flatMap(it => it.dies ?? []));
  const available: TestPassKind[] = (['spec', 'testFlag', 'functional'] as const)
    .filter(k => hasJudgeableTests(testDefs, k, allDies));
  let kind: TestPassKind = available[0] ?? 'spec';

  const titleOf = (k: TestPassKind) => KIND_TITLE[k];

  const { card, heading, body, controlsRow } = cardShell(titleOf(kind), onSaveImage, doc);
  card.style.alignSelf = 'start';

  // Only the modes the data supports. A one-option toggle is noise, and offering
  // a mode this dataset cannot answer just leads to an empty card.
  if (available.length > 1) {
    controlsRow.appendChild(makeSegmented(
      available.map(k => [k, KIND_LABEL[k]] as [string, string]),
      kind,
      v => { kind = v as TestPassKind; heading.textContent = titleOf(kind); rebuildBody(); },
      doc,
    ));
  }

  const hint = doc.createElement('div');
  Object.assign(hint.style, { color: CLR.label, fontSize: FONT.body, marginBottom: SPACE.sm } as Partial<CSSStyleDeclaration>);
  card.insertBefore(hint, body);

  const tooltip = makeTooltip(card);
  let resizeHandle: { disconnect: () => void } | null = null;

  function rebuildBody(): void {
    resizeHandle?.disconnect();
    resizeHandle = null;
    body.innerHTML = '';

    if (available.length === 0) {
      hint.textContent = '';
      renderEmptyState(body, 'No tests with a pass/fail verdict — parametric tests need spec limits, functional tests need recorded results.');
      return;
    }

    const data: TestPassRateData = buildTestPassRateData(groups, testDefs, kind);
    if (data.rows.length === 0) {
      hint.textContent = '';
      renderEmptyState(body,
        kind === 'spec'     ? 'No parametric test has spec limits to judge against.'
        : kind === 'testFlag' ? 'No parametric test has a recorded tester verdict.'
        : 'No functional test has recorded results.');
      return;
    }

    const grouped = data.groups.length > 1;
    const basis =
      kind === 'spec'     ? 'Dies within spec limits, per test'
      : kind === 'testFlag' ? "Dies the tester marked pass, per test"
      : 'Dies passing the recorded verdict, per test';
    hint.textContent = basis + (grouped ? ' · one bar per group' : '') + ' · worst first';

    // Surfaced, not resolved: a spec/flag disagreement is expected under guard
    // bands or dynamic limits, but it is also how a limits/data mismatch shows
    // itself, and the reader is the one who can tell those apart.
    if (data.disagreementDies) {
      const note = doc.createElement('span');
      note.textContent = ` · ${data.disagreementDies.toLocaleString()} die${data.disagreementDies === 1 ? '' : 's'} judged differently by limits and tester flag`;
      Object.assign(note.style, { color: CLR.warnText } as Partial<CSSStyleDeclaration>);
      hint.appendChild(note);
    }

    const rows = data.rows;
    const seriesCount = data.groups.length;
    const clusterHeight = seriesCount * SUBBAR_HEIGHT + (seriesCount - 1) * SUBBAR_GAP;
    const rowPitch = clusterHeight + CLUSTER_GAP;
    // QUANTITY, not CLR.barFill: `CLR.*` values are `var(--wmap-…, fallback)`
    // strings for CSS, and canvas cannot resolve a CSS custom property — the
    // fillStyle assignment is silently ignored and the bar keeps whatever colour
    // was set last (the track), rendering it invisible. Canvas colours come from
    // palette.ts (plain hex) or resolveChartCanvasColors (resolved at draw time).
    const colorOf = (i: number) => grouped ? categorical(i) : QUANTITY;

    if (grouped) {
      const legend = doc.createElement('div');
      Object.assign(legend.style, { display: 'flex', flexWrap: 'wrap', gap: `${SPACE.xs} ${SPACE.xl}`, marginBottom: SPACE.xs } as Partial<CSSStyleDeclaration>);
      data.groups.forEach((g, i) => {
        const item = doc.createElement('span');
        Object.assign(item.style, { display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: FONT.body, color: CLR.text } as Partial<CSSStyleDeclaration>);
        const sw = doc.createElement('span');
        Object.assign(sw.style, { width: '10px', height: '10px', borderRadius: RADIUS.control, background: colorOf(i) } as Partial<CSSStyleDeclaration>);
        const txt = doc.createElement('span');
        txt.textContent = g;
        item.append(sw, txt);
        legend.appendChild(item);
      });
      body.appendChild(legend);
    }

    const scrollArea = doc.createElement('div');
    const visibleHeight = PADDING * 2 + Math.min(rows.length, MAX_VISIBLE_TESTS) * rowPitch;
    // overflowX explicit — see binCluster.ts/cardShell for why 'visible' would
    // silently compute to 'auto' here and add a horizontal axis.
    Object.assign(scrollArea.style, { overflowX: 'hidden', overflowY: 'auto', minHeight: '0', flex: '1', maxHeight: `${visibleHeight}px`, scrollbarGutter: 'stable' } as Partial<CSSStyleDeclaration>);
    body.appendChild(scrollArea);
    growCardToFitContent(card, body, visibleHeight + (grouped ? 22 : 0));

    const canvas = doc.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.cursor = 'default';
    scrollArea.appendChild(canvas);

    const win = doc.defaultView ?? window;
    const dpr = win.devicePixelRatio || 1;
    let hovered: { row: number; group: number } | null = null;

    function plotMetrics() {
      const barX = PADDING + CLUSTER_LABEL_WIDTH;
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
      const theme = resolveChartCanvasColors(card);
      const width = scrollArea.clientWidth;
      const height = PADDING * 2 + rows.length * rowPitch;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.font = `${fontPx(-1)}px system-ui, sans-serif`;
      ctx.textBaseline = 'middle';

      const { barX, barMaxWidth } = plotMetrics();

      rows.forEach((row, ri) => {
        const clusterTop = PADDING + ri * rowPitch;

        // Hover highlight FIRST, before the label and bars. It spans the full row
        // width (x = 0 … width), so painting it inside the per-group loop — after
        // the label had already been drawn — covered the test name with the
        // highlight. Least visible when grouped (the label is centred across a
        // multi-row cluster, so only some rows overlap it) and total when
        // ungrouped, where the single sub-bar's highlight always covers it.
        if (hovered && hovered.row === ri) {
          const hy = clusterTop + hovered.group * (SUBBAR_HEIGHT + SUBBAR_GAP);
          ctx.fillStyle = theme.bgHover;
          ctx.fillRect(0, hy - 1, width, SUBBAR_HEIGHT + 2);
        }

        ctx.fillStyle = theme.text;
        ctx.textAlign = 'right';
        const label = row.label.length > 14 ? `${row.label.slice(0, 13)}…` : row.label;
        ctx.fillText(label, PADDING + CLUSTER_LABEL_WIDTH - 8, clusterTop + clusterHeight / 2);

        row.byGroup.forEach((value, gi) => {
          const y = clusterTop + gi * (SUBBAR_HEIGHT + SUBBAR_GAP);
          ctx.fillStyle = theme.track;
          ctx.fillRect(barX, y, barMaxWidth, SUBBAR_HEIGHT);
          // A fixed 0–100% axis, never normalised to the best row: a 99% and a
          // 98% test must not both draw a full-width bar.
          if (value.passRatePercent === null) {
            // Nothing measured for this group — leave the track empty and say so
            // in the label, rather than drawing a zero-width bar that reads as 0%.
            ctx.fillStyle = theme.textMuted;
            ctx.textAlign = 'left';
            ctx.fillText('no data', barX + 4, y + SUBBAR_HEIGHT / 2);
            return;
          }
          const w = Math.max(value.passRatePercent > 0 ? 1 : 0, (value.passRatePercent / 100) * barMaxWidth);
          ctx.fillStyle = colorOf(gi);
          ctx.fillRect(barX, y, w, SUBBAR_HEIGHT);
        });

        ctx.fillStyle = theme.text;
        ctx.textAlign = 'right';
        const overall = row.overall.passRatePercent;
        ctx.fillText(overall === null ? '—' : `${overall.toFixed(1)}%`,
          barX + barMaxWidth + VALUE_WIDTH, clusterTop + clusterHeight / 2);
      });
    }

    canvas.addEventListener('mousemove', e => {
      const rect = canvas.getBoundingClientRect();
      const hit = subBarAt(e.clientX - rect.left, e.clientY - rect.top);
      const changed = (hit?.row !== hovered?.row) || (hit?.group !== hovered?.group);
      hovered = hit;
      if (changed) draw();
      if (!hit) { tooltip.style.display = 'none'; return; }

      const row = rows[hit.row];
      const value = row.byGroup[hit.group];
      const who = grouped ? ` · ${data.groups[hit.group]}` : '';
      if (value.passRatePercent === null) {
        tooltip.innerHTML = `<strong>${row.label}</strong>${who}<br>no dies with a verdict`;
      } else {
        // Fail direction is parametric-only and belongs on the specific test's
        // own row: "failing high" and "failing low" are different process stories.
        const dir = (kind === 'spec' && !grouped
          && (row.failLowDies || row.failHighDies))
          ? `<br>${row.failLowDies ?? 0} below LSL · ${row.failHighDies ?? 0} above USL`
          : '';
        tooltip.innerHTML = `<strong>${row.label}</strong>${who}<br>`
          + `${value.passRatePercent.toFixed(1)}% pass<br>`
          + `${value.passDies.toLocaleString()} pass · ${value.failDies.toLocaleString()} fail · n = ${value.totalDies.toLocaleString()}`
          + dir;
      }
      tooltip.style.display = 'block';
      positionChartTooltip(tooltip, card, e.clientX, e.clientY);
    });
    canvas.addEventListener('mouseleave', () => {
      if (hovered) { hovered = null; draw(); }
      tooltip.style.display = 'none';
    });

    resizeHandle = observeResize(card, () => draw());
    draw();
  }

  rebuildBody();
  return { card, destroy: () => { resizeHandle?.disconnect(); tooltip.remove(); card.remove(); } };
}
