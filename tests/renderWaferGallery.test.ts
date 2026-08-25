import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { renderWaferGallery } from '../packages/canvas-adapter/renderWaferGallery.js';
import type { WaferMapDisplayItem, GalleryController } from '../packages/canvas-adapter/renderWaferGallery.js';
import type { WaferMapController } from '../packages/canvas-adapter/renderWaferMap.js';
import type { Die } from '../packages/core/dies.js';
import type { Wafer } from '../packages/core/wafer.js';

// ── Shared mock fixtures ──────────────────────────────────────────────────────

const mockWafer: Wafer = {
  diameter: 300, radius: 150, center: { x: 0, y: 0 }, orientation: 0,
};

const mockView = {} as any;

const mockInference = {
  wafer:    { confidence: 1, method: 'provided' },
  diePitch: { confidence: 1, units: 'mm' as const },
  grid:     { confidence: 1 },
};

const mockDataCoverage = { filledDies: 2, totalDies: 2, edgeExcludedDies: 0, ratio: 1 };

const mockYield = { yieldPercent: 50, passDies: 1, failDies: 1, totalDies: 2, edgeExcludedDies: 0, partialDies: 0 };

function makeMockController(): WaferMapController {
  return {
    setDies:              mock.fn(),
    setResult:            mock.fn(),
    setOptions:           mock.fn(),
    getOptions:           mock.fn(() => ({})),
    setSelection:         mock.fn(),
    clearSelection:       mock.fn(),
    resetZoom:            mock.fn(),
    setFallbackFormat:    mock.fn(),
    setStatsSummary:      mock.fn(),
    setSummaryVisible:    mock.fn(),
    setViewControlsVisible: mock.fn(),
    setExpandVisible:     mock.fn(),
    setTooltipParent:     mock.fn(),
    getActiveLegend:      mock.fn(() => null),
    destroy:              mock.fn(),
  };
}

// ── Module mocks ──────────────────────────────────────────────────────────────

let capturedRenderWaferMapCalls: Array<{ container: HTMLElement; result: any; options: any }> = [];

mock.module('../packages/canvas-adapter/renderWaferMap.js', {
  namedExports: {
    renderWaferMap: mock.fn((container: HTMLElement, result: any, options: any): WaferMapController => {
      capturedRenderWaferMapCalls.push({ container, result, options });
      return makeMockController();
    }),
  },
});

mock.module('../packages/canvas-adapter/toolbar.js', {
  namedExports: {
    createToolbarHelpers: mock.fn(() => ({
      makeBtn:        mock.fn(() => document.createElement('button')),
      setActive:      mock.fn(),
      makeSep:        mock.fn(() => document.createElement('div')),
      makeMenuRow:    mock.fn(() => document.createElement('div')),
      makeMenuSection: mock.fn(() => document.createElement('div')),
      makeDropdown:   mock.fn(() => document.createElement('button')),
      makeCheckMenuBtn: mock.fn(() => document.createElement('button')),
      closeOpenMenu:  mock.fn(),
      getOpenMenu:    mock.fn(() => null),
      setOpenMenu:    mock.fn(),
    })),
    buildModeMenuEl:   mock.fn(() => document.createElement('div')),
    buildCheckMenuEl:  mock.fn(() => document.createElement('div')),
    openDetachWindow:  mock.fn(() => null), // no window.open in this unit-test harness; detach silently no-ops
    copyWmapThemeTokens: mock.fn(),
    CLR: {
      icon: '#506784', iconHover: '#2a3f5f', iconActive: '#1a66cc',
      bgHover: '#edf0f8', bgActive: '#dce8f8', separator: 'rgba(0,0,0,0.12)',
      menuBg: '#fff', menuBorder: 'rgba(0,0,0,0.12)', menuHover: '#f0f4fc', menuActive: '#dce8f8',
    },
    ROTATIONS:         [0, 90, 180, 270],
    INLINE_TEST_LIMIT: 6,
    MODE_LABELS: {
      value: 'Test Value', hardBin: 'Hard Bin', softBin: 'Soft Bin',
      stackedValues: 'Stacked Test Values', stackedBins: 'Stacked Hard Bins', stackedSoftBins: 'Stacked Soft Bins',
    },
    BIN_LEGEND_MODES:  new Set(['hardBin', 'softBin']),
    STACKED_MODES:     new Set(['stackedValues', 'stackedBins', 'stackedSoftBins']),
  },
});

mock.module('../packages/canvas-adapter/summaryPanel.js', {
  namedExports: {
    createSummaryPanelEl:      mock.fn(() => document.createElement('div')),
    wrapWithSummaryPanel:      mock.fn((_c: HTMLElement, _p: HTMLElement) => document.createElement('div')),
    renderLotSummaryContent:   mock.fn(),
    renderWaferSummaryContent: mock.fn(),
    buildWaferDetailHeader:    mock.fn(() => document.createElement('div')),
  },
});

mock.module('../packages/core/aggregates.js', {
  namedExports: {
    aggregateValues: mock.fn((diesByWafer: Die[][]) => {
      const allDies = diesByWafer.flat();
      const seen = new Set<string>();
      return allDies.filter(d => {
        const k = `${d.x},${d.y}`;
        return seen.has(k) ? false : (seen.add(k), true);
      }).map(d => ({ ...d, testValues: { 0: 100 } }));
    }),
    aggregateBinCounts: mock.fn((diesByWafer: Die[][], targetBin: number, binSpace: string) => {
      const allDies = diesByWafer.flat();
      const seen = new Set<string>();
      return allDies.filter(d => {
        const k = `${d.x},${d.y}`;
        return seen.has(k) ? false : (seen.add(k), true);
      }).map(d => ({
        ...d,
        testValues: { 0: 2 },
        hbin: binSpace === 'hard' ? targetBin : undefined,
        sbin: binSpace === 'soft' ? targetBin : undefined,
      }));
    }),
  },
});

mock.module('../packages/renderer/colorSchemes.js', {
  namedExports: {
    listColorSchemes: mock.fn(() => [{ name: 'color', label: 'Color' }]),
    getColorScheme:   mock.fn(() => ({ label: 'Color', forBin: () => '#4caf50', forValue: () => '#000' })),
  },
});

// ── Shared test items ─────────────────────────────────────────────────────────

// Two wafers: bins 1+2 on W1, bins 1+3 on W2 — combined unique hbins: 1, 2, 3
const ITEMS: WaferMapDisplayItem[] = [
  {
    wafer: mockWafer, view: mockView, units: 'mm', inference: mockInference,
    dataCoverage: mockDataCoverage, yield: mockYield, reticles: [],
    plotMode: 'hardBin', metadata: null, isLotStack: false,
    label: 'W01',
    dies: [
      { id: '0_0', x: 0, y: 0, hbin: 1, sbin: 10, testValues: { 100: 10 }, width: 10, height: 10, physX: 0,  physY: 0  },
      { id: '1_0', x: 1, y: 0, hbin: 2, sbin: 11, testValues: { 100: 15 }, width: 10, height: 10, physX: 10, physY: 0  },
    ],
  },
  {
    wafer: mockWafer, view: mockView, units: 'mm', inference: mockInference,
    dataCoverage: mockDataCoverage, yield: mockYield, reticles: [],
    plotMode: 'hardBin', metadata: null, isLotStack: false,
    label: 'W02',
    dies: [
      { id: '0_0', x: 0, y: 0, hbin: 1, sbin: 10, testValues: { 100: 12 }, width: 10, height: 10, physX: 0,  physY: 0  },
      { id: '1_0', x: 1, y: 0, hbin: 3, sbin: 12, testValues: { 100: 18 }, width: 10, height: 10, physX: 10, physY: 0  },
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns all direct child divs of the legend element (the bin entries). */
function getLegendEntries(container: HTMLElement): HTMLElement[] {
  return Array.from(getLegendEl(container).children) as HTMLElement[];
}

function getLegendEl(container: HTMLElement): HTMLElement {
  // Queried by its stable data hook, not position — legendEl now lives inside
  // a sticky header wrapper alongside barEl rather than as container's own
  // direct second child.
  return container.querySelector('[data-wmap-gallery-legend]') as HTMLElement;
}

/**
 * The grid body — the element that used to be container's third direct child
 * (barEl, legendEl, bodyEl in order). Both barEl and legendEl moved inside a
 * sticky wrapper, so bodyEl is now container's SECOND child, not third.
 */
function getBodyEl(container: HTMLElement): HTMLElement {
  return container.children[1] as HTMLElement;
}

function getLabelText(entry: HTMLElement): string {
  return (entry.children[1] as HTMLElement).textContent ?? '';
}

// ── Tests: stacked mode definition discovery ──────────────────────────────────

describe('renderWaferGallery stacked modes with definition discovery', () => {
  let container: HTMLElement;
  let ctrl: GalleryController;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    capturedRenderWaferMapCalls = [];
    ctrl = renderWaferGallery(container, ITEMS, {});
  });

  it('discovers testDefs for stackedValues mode when not provided', () => {
    ctrl.setOptions({ plotMode: 'stackedValues' });
    assert.strictEqual(capturedRenderWaferMapCalls.length, 2);
    // testDefs now live on result.testDefs, not viewOptions
    assert.strictEqual(capturedRenderWaferMapCalls[0].options.viewOptions.plotMode, 'stackedValues');
    assert.deepStrictEqual(capturedRenderWaferMapCalls[0].result.testDefs, [{ testNumber: 0, name: 'Test 100' }]);
    assert.deepStrictEqual(capturedRenderWaferMapCalls[1].result.testDefs, [{ testNumber: 0, name: 'Test 100' }]);
  });

  it('discovers hbinDefs for stackedBins mode when not provided', () => {
    ctrl.setOptions({ plotMode: 'stackedBins' });
    assert.strictEqual(capturedRenderWaferMapCalls.length, 3);
    assert.deepStrictEqual(capturedRenderWaferMapCalls[0].result.hbinDefs, [{ bin: 1, name: 'Bin 1' }]);
    assert.deepStrictEqual(capturedRenderWaferMapCalls[1].result.hbinDefs, [{ bin: 2, name: 'Bin 2' }]);
    assert.deepStrictEqual(capturedRenderWaferMapCalls[2].result.hbinDefs, [{ bin: 3, name: 'Bin 3' }]);
  });

  it('discovers sbinDefs for stackedSoftBins mode when not provided', () => {
    ctrl.setOptions({ plotMode: 'stackedSoftBins' });
    assert.strictEqual(capturedRenderWaferMapCalls.length, 3);
    assert.deepStrictEqual(capturedRenderWaferMapCalls[0].result.sbinDefs, [{ bin: 10, name: 'Bin 10' }]);
    assert.deepStrictEqual(capturedRenderWaferMapCalls[1].result.sbinDefs, [{ bin: 11, name: 'Bin 11' }]);
    assert.deepStrictEqual(capturedRenderWaferMapCalls[2].result.sbinDefs, [{ bin: 12, name: 'Bin 12' }]);
  });

  it('uses item-level testDefs when items carry them', () => {
    // Provide items with testDefs on the result — these take priority over auto-discovery
    const customTestDefs = [{ testNumber: 100, name: 'Custom Test A', unit: 'V' as const }];
    const itemsWithDefs: WaferMapDisplayItem[] = ITEMS.map(it => ({ ...it, testDefs: customTestDefs }));
    const c2 = renderWaferGallery(document.createElement('div'), itemsWithDefs, {});
    capturedRenderWaferMapCalls = [];
    c2.setOptions({ plotMode: 'stackedValues' });
    assert.strictEqual(capturedRenderWaferMapCalls.length, 1);
    assert.deepStrictEqual(capturedRenderWaferMapCalls[0].result.testDefs, [{ testNumber: 0, name: 'Custom Test A', unit: 'V' }]);
  });

  it('reverts to original items when leaving stacked mode', () => {
    ctrl.setOptions({ plotMode: 'stackedValues' });
    capturedRenderWaferMapCalls = [];
    ctrl.setOptions({ plotMode: 'hardBin' });
    assert.strictEqual(capturedRenderWaferMapCalls.length, 2);
    assert.strictEqual(capturedRenderWaferMapCalls[0].result.dies, ITEMS[0].dies);
    assert.strictEqual(capturedRenderWaferMapCalls[1].result.dies, ITEMS[1].dies);
  });
});

// ── Tests: shared bin legend ──────────────────────────────────────────────────

describe('renderWaferGallery shared bin legend', () => {
  let container: HTMLElement;
  let ctrl: GalleryController;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    capturedRenderWaferMapCalls = [];
    ctrl = renderWaferGallery(container, ITEMS, { viewOptions: { plotMode: 'hardBin' } });
  });

  it('renders an entry for each unique hard bin across all wafers', () => {
    const entries = getLegendEntries(container);
    // ITEMS has hbins 1, 2 (W01) and 1, 3 (W02) → unique sorted: 1, 2, 3
    assert.strictEqual(entries.length, 3);
    assert.strictEqual(getLabelText(entries[0]), 'Bin 1');
    assert.strictEqual(getLabelText(entries[1]), 'Bin 2');
    assert.strictEqual(getLabelText(entries[2]), 'Bin 3');
  });

  it('is visible in hardBin mode', () => {
    assert.strictEqual(getLegendEl(container).style.display, 'flex');
  });

  it('is hidden in value mode', () => {
    ctrl.setOptions({ plotMode: 'value' });
    assert.strictEqual(getLegendEl(container).style.display, 'none');
  });

  it('is hidden in stacked modes', () => {
    ctrl.setOptions({ plotMode: 'stackedBins' });
    assert.strictEqual(getLegendEl(container).style.display, 'none');
  });

  it('shows soft bin entries when in softBin mode', () => {
    ctrl.setOptions({ plotMode: 'softBin' });
    const entries = getLegendEntries(container);
    // ITEMS has sbins 10 (both wafers), 11 (W01), 12 (W02) → unique sorted: 10, 11, 12
    assert.strictEqual(entries.length, 3);
    assert.strictEqual(getLabelText(entries[0]), 'Bin 10');
    assert.strictEqual(getLabelText(entries[1]), 'Bin 11');
    assert.strictEqual(getLabelText(entries[2]), 'Bin 12');
  });

  it('uses binDef names from items when provided', () => {
    // hbinDefs now live on WaferMapResult items, not in viewOptions
    const hbinDefs = [
      { bin: 1, name: 'Pass' },
      { bin: 2, name: 'Contact Open' },
      { bin: 3, name: 'Leakage' },
    ];
    const itemsWithDefs: WaferMapDisplayItem[] = ITEMS.map(it => ({ ...it, hbinDefs }));
    const innerContainer = document.createElement('div');
    renderWaferGallery(innerContainer, itemsWithDefs, { viewOptions: { plotMode: 'hardBin' } });
    const entries = getLegendEntries(innerContainer);
    assert.strictEqual(getLabelText(entries[0]), '1 · Pass');
    assert.strictEqual(getLabelText(entries[1]), '2 · Contact Open');
    assert.strictEqual(getLabelText(entries[2]), '3 · Leakage');
  });

  it('clicking a bin entry highlights it in the legend', () => {
    getLegendEntries(container)[1].click(); // click bin 2
    const entries = getLegendEntries(container);
    const lbl1 = entries[1].children[1] as HTMLElement;
    assert.strictEqual(lbl1.style.fontWeight, '700', 'clicked bin label should be bold');
    // Other entries should remain inactive
    assert.strictEqual((entries[0].children[1] as HTMLElement).style.fontWeight, '400');
    assert.strictEqual((entries[2].children[1] as HTMLElement).style.fontWeight, '400');
  });

  it('clicking the active bin again deselects it', () => {
    const entries = getLegendEntries(container);
    entries[0].click(); // select bin 1
    getLegendEntries(container)[0].click(); // deselect bin 1

    const updatedEntries = getLegendEntries(container);
    const lbl0 = updatedEntries[0].children[1] as HTMLElement;
    assert.strictEqual(lbl0.style.fontWeight, '400');
  });

  it('active bin entry gets a highlighted swatch border', () => {
    getLegendEntries(container)[0].click(); // select bin 1
    const swatch = getLegendEntries(container)[0].children[0] as HTMLElement;
    assert.ok(swatch.style.border.includes('#1a66cc'), 'active swatch should have blue border');
  });

  it('rebuilds correctly after switching mode and back', () => {
    ctrl.setOptions({ plotMode: 'value' });
    assert.strictEqual(getLegendEl(container).style.display, 'none');
    ctrl.setOptions({ plotMode: 'hardBin' });
    assert.strictEqual(getLegendEl(container).style.display, 'flex');
    assert.strictEqual(getLegendEntries(container).length, 3);
  });
});

// ── Tests: card size cap (maxSize) ─────────────────────────────────────────────

describe('renderWaferGallery card size cap', () => {
  /** bodyEl → gridEl → card divs (see container.appendChild order in renderWaferGallery). */
  function getCards(container: HTMLElement): HTMLElement[] {
    const bodyEl = getBodyEl(container);
    const gridEl = bodyEl.children[0] as HTMLElement;
    return Array.from(gridEl.children) as HTMLElement[];
  }

  /** ITEMS use a 10mm die on a 300mm wafer; `pitchMm` re-pitches that fixture. */
  function itemWithPitch(pitchMm: number): WaferMapDisplayItem {
    return { ...ITEMS[0], dies: ITEMS[0].dies.map(d => ({ ...d, width: pitchMm, height: pitchMm })) };
  }

  it('caps a single card at the default 480px, not stretched to fill the container', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderWaferGallery(container, [ITEMS[0]], {});
    const [card] = getCards(container);
    assert.strictEqual(card.style.maxWidth, '480px');
    assert.strictEqual(card.style.maxHeight, '480px');
  });

  it('widens the default cap for high-DPW wafers so dies stay readable', () => {
    // 3mm pitch on a 300mm wafer needs 300*(4/3)+124 = 524px for 4px dies —
    // above the 480 floor, below the 720 ceiling, so the cap tracks it exactly.
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderWaferGallery(container, [itemWithPitch(3)], {});
    const [card] = getCards(container);
    assert.strictEqual(card.style.maxWidth, '524px');
    assert.strictEqual(card.style.maxHeight, '524px');
  });

  it('stops widening the default cap at the 720px ceiling', () => {
    // 1mm pitch would need 1324px for 4px dies; the ceiling holds it at 720
    // rather than letting a dense wafer fill the container again.
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderWaferGallery(container, [itemWithPitch(1)], {});
    const [card] = getCards(container);
    assert.strictEqual(card.style.maxWidth, '720px');
    assert.strictEqual(card.style.maxHeight, '720px');
  });

  it('sizes the cap from the densest wafer, not the first one in the lot', () => {
    // Cards are all sized alike, so a coarse-pitch wafer arriving first must
    // not starve a finer-pitch wafer later in the lot.
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderWaferGallery(container, [itemWithPitch(10), { ...itemWithPitch(1), label: 'W02' }], {});
    for (const card of getCards(container)) {
      assert.strictEqual(card.style.maxWidth, '720px');
    }
  });

  it('never widens an explicit maxSize, however dense the wafer', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderWaferGallery(container, [itemWithPitch(1)], { maxSize: 300 });
    const [card] = getCards(container);
    assert.strictEqual(card.style.maxWidth, '300px');
    assert.strictEqual(card.style.maxHeight, '300px');
  });

  it('packs columns from the left instead of stretching tracks to full width', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderWaferGallery(container, ITEMS, { maxSize: 250 });
    const gridEl = getBodyEl(container).children[0] as HTMLElement;
    assert.strictEqual(gridEl.style.justifyContent, 'start');
    assert.match(gridEl.style.gridTemplateColumns, /minmax\(0(px)?, 250px\)/);
  });

  it('overrides the cap with options.maxSize', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderWaferGallery(container, [ITEMS[0]], { maxSize: 200 });
    const [card] = getCards(container);
    assert.strictEqual(card.style.maxWidth, '200px');
    assert.strictEqual(card.style.maxHeight, '200px');
  });

  it('applies the same cap to every card, regardless of item count', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderWaferGallery(container, ITEMS, { maxSize: 300 });
    for (const card of getCards(container)) {
      assert.strictEqual(card.style.maxWidth, '300px');
      assert.strictEqual(card.style.maxHeight, '300px');
    }
  });
});
