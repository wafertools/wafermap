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
import { SPACE, FONT, CLR } from '../toolbar.js';
import {
  cardShell, makeTooltip, makeSegmented, renderEmptyState, type SaveImageHandler,
} from './chartShell.js';
import { renderGroupedBarPlot, type GroupedBarPlotHandle } from './groupedBarPlot.js';
import { escHtml } from '../../core/utils.js';

const CLUSTER_LABEL_WIDTH = 100;
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
  let plot: GroupedBarPlotHandle | null = null;

  function rebuildBody(): void {
    plot?.destroy();
    plot = null;
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
    // QUANTITY, not CLR.barFill: `CLR.*` values are `var(--wmap-…, fallback)`
    // strings for CSS, and canvas cannot resolve a CSS custom property — the
    // fillStyle assignment is silently ignored and the bar keeps whatever colour
    // was set last (the track), rendering it invisible. Canvas colours come from
    // palette.ts (plain hex) or resolveChartCanvasColors (resolved at draw time).
    const colorOf = (i: number) => grouped ? categorical(i) : QUANTITY;

    plot = renderGroupedBarPlot(card, body, tooltip, {
      // A fixed 0-100% axis, never normalised to the best row: a 99% and a 98%
      // test must not both draw a full-width bar.
      rows: rows.map(row => ({
        label: row.label,
        bars: row.byGroup.map(v => ({
          fraction: v.passRatePercent === null ? null : v.passRatePercent / 100,
        })),
        trailing: row.overall.passRatePercent === null
          ? '—' : `${row.overall.passRatePercent.toFixed(1)}%`,
      })),
      groups: data.groups,
      labelWidth: CLUSTER_LABEL_WIDTH,
      maxVisibleRows: MAX_VISIBLE_TESTS,
      showLegend: grouped,
      maxLabelChars: 14,
      emptyBarText: 'no data',
      colorOf,
      tooltipHtml: (ri, gi) => {
        const row = rows[ri];
        const value = row.byGroup[gi];
        const who = grouped ? ` · ${escHtml(String(data.groups[gi]))}` : '';
        if (value.passRatePercent === null) {
          return `<strong>${escHtml(row.label)}</strong>${who}<br>no dies with a verdict`;
        }
        // Fail direction is parametric-only and belongs on the specific test's
        // own row: "failing high" and "failing low" are different process stories.
        const dir = (kind === 'spec' && !grouped && (row.failLowDies || row.failHighDies))
          ? `<br>${row.failLowDies ?? 0} below LSL · ${row.failHighDies ?? 0} above USL`
          : '';
        return `<strong>${escHtml(row.label)}</strong>${who}<br>`
          + `${value.passRatePercent.toFixed(1)}% pass<br>`
          + `${value.passDies.toLocaleString()} pass · ${value.failDies.toLocaleString()} fail · n = ${value.totalDies.toLocaleString()}`
          + dir;
      },
    });
  }

  rebuildBody();
  return { card, destroy: () => { plot?.destroy(); tooltip.remove(); card.remove(); } };
}
