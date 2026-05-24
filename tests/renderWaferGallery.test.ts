import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { renderWaferGallery } from '../packages/canvas-adapter/renderWaferGallery.js';
import type { GalleryItem, GalleryController } from '../packages/canvas-adapter/renderWaferGallery.js';
import type { WaferCanvasController, WaferViewOptions } from '../packages/canvas-adapter/renderWaferMap.js';
import type { Die } from '../packages/core/dies.js';
import type { Wafer } from '../packages/core/wafer.js';

// --- Mocks for renderWaferGallery dependencies ---

// Mock Wafer object
const mockWafer: Wafer = {
  diameter: 300, radius: 150, center: { x: 0, y: 0 }, orientation: 0,
};

// Mock renderWaferMap function
let capturedRenderWaferMapCalls: Array<{
  canvas: HTMLCanvasElement;
  wafer: Wafer;
  dies: Die[];
  options: any; // WaferCanvasController options
}> = [];

const mockRenderWaferMap = mock.fn((
  canvas: HTMLCanvasElement,
  wafer: Wafer,
  dies: Die[],
  options: any,
): WaferCanvasController => {
  capturedRenderWaferMapCalls.push({ canvas, wafer, dies, options });
  return {
    setDies: mock.fn(() => {}),
    setOptions: mock.fn(() => {}),
    getOptions: mock.fn(() => options.viewOptions), // Return the options it was initialized with
    setSelection: mock.fn(() => {}),
    clearSelection: mock.fn(() => {}),
    resetZoom: mock.fn(() => {}),
    setFallbackFormat: mock.fn(() => {}),
    setStatsSummary: mock.fn(() => {}),
    destroy: mock.fn(() => {}),
  };
});

// Mock other internal dependencies that renderWaferGallery uses
mock.module('../packages/canvas-adapter/renderWaferMap.js', { renderWaferMap: mockRenderWaferMap });
mock.module('../packages/canvas-adapter/toolbar.js', {
  createTooltip: mock.fn(() => document.createElement('div')),
  createToolbarHelpers: mock.fn(() => ({
    makeBtn: mock.fn(() => document.createElement('button')),
    setActive: mock.fn(() => {}),
    makeSep: mock.fn(() => document.createElement('div')),
    makeMenuRow: mock.fn(() => document.createElement('div')),
    makeMenuSection: mock.fn(() => document.createElement('div')),
    makeDropdown: mock.fn(() => document.createElement('button')),
    closeOpenMenu: mock.fn(() => {}),
    getOpenMenu: mock.fn(() => null),
    setOpenMenu: mock.fn(() => {}),
  })),
  CLR: { icon: '#000', menuBorder: '#000' },
  ROTATIONS: [0, 90, 180, 270],
  INLINE_TEST_LIMIT: 6,
  MODE_LABELS: {
    value: 'Test Value', hardBin: 'Hard Bin', softBin: 'Soft Bin',
    stackedValues: 'Stacked Test Values', stackedBins: 'Stacked Hard Bins', stackedSoftBins: 'Stacked Soft Bins'
  },
  BIN_LEGEND_MODES: new Set(['hardBin', 'softBin']),
  STACKED_MODES: new Set(['stackedValues', 'stackedBins', 'stackedSoftBins']),
});
mock.module('../packages/canvas-adapter/summaryPanel.js', {
  createSummaryPanelEl: mock.fn(() => document.createElement('div')),
  wrapWithSummaryPanel: mock.fn((canvas: HTMLElement, panel: HTMLElement, placement: string) => {
    const wrapper = document.createElement('div');
    wrapper.appendChild(canvas);
    wrapper.appendChild(panel);
    return wrapper;
  }),
  renderLotSummaryContent: mock.fn(() => {}),
  renderWaferSummaryContent: mock.fn(() => {}),
  buildWaferDetailHeader: mock.fn(() => document.createElement('div')),
});
mock.module('../packages/core/aggregates.js', {
  aggregateValues: mock.fn((diesByWafer: Die[][], method: string, paramIndex?: number) => {
    const aggregatedDies: Die[] = [];
    const allDies = diesByWafer.flat();
    const uniqueCoords = new Set(allDies.map(d => `${d.x},${d.y}`));
    for (const coord of uniqueCoords) {
      const [x, y] = coord.split(',').map(Number);
      const templateDie = allDies.find(d => d.x === x && d.y === y);
      if (templateDie) {
        aggregatedDies.push({ ...templateDie, testValues: { 0: 100 } });
      }
    }
    return aggregatedDies;
  }),
  aggregateBinCounts: mock.fn((diesByWafer: Die[][], targetBin: number, binSpace: string) => {
    const aggregatedDies: Die[] = [];
    const allDies = diesByWafer.flat();
    const uniqueCoords = new Set(allDies.map(d => `${d.x},${d.y}`));
    for (const coord of uniqueCoords) {
      const [x, y] = coord.split(',').map(Number);
      const templateDie = allDies.find(d => d.x === x && d.y === y);
      if (templateDie) {
        aggregatedDies.push({
          ...templateDie,
          testValues: { 0: 2 },
          hbin: binSpace === 'hard' ? targetBin : undefined,
          sbin: binSpace === 'soft' ? targetBin : undefined,
        });
      }
    }
    return aggregatedDies;
  }),
});
mock.module('../packages/renderer/colorSchemes.js', {
  listColorSchemes: mock.fn(() => [{ name: 'color', label: 'Color' }]),
  getColorScheme: mock.fn(() => ({
    label: 'Color', forBin: () => '#000', forValue: () => '#000',
  })),
});

describe('renderWaferGallery stacked modes with definition discovery', () => {
  let container: HTMLElement;
  let galleryController: GalleryController;

  const mockItems: GalleryItem[] = [
    {
      wafer: mockWafer,
      dies: [
        { id: '0_0', x: 0, y: 0, testValues: { 100: 10, 200: 20 }, hbin: 1, sbin: 10, width: 10, height: 10, physX: 0, physY: 0 },
        { id: '1_0', x: 1, y: 0, testValues: { 100: 15, 200: 25 }, hbin: 2, sbin: 11, width: 10, height: 10, physX: 10, physY: 0 },
      ],
      label: 'Wafer 1',
    },
    {
      wafer: mockWafer,
      dies: [
        { id: '0_0', x: 0, y: 0, testValues: { 100: 12, 200: 22 }, hbin: 1, sbin: 10, width: 10, height: 10, physX: 0, physY: 0 },
        { id: '1_0', x: 1, y: 0, testValues: { 100: 18, 200: 28 }, hbin: 3, sbin: 12, width: 10, height: 10, physX: 10, physY: 0 },
      ],
      label: 'Wafer 2',
    },
  ];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    capturedRenderWaferMapCalls = []; // Reset mock calls
    galleryController = renderWaferGallery(container, mockItems, {});
  });

  it('should discover testDefs for stackedValues mode when not provided', () => {
    galleryController.setOptions({ plotMode: 'stackedValues' });

    // Expect 2 cards for the 2 discovered test numbers (100, 200)
    assert.strictEqual(capturedRenderWaferMapCalls.length, 2);

    const firstCardOptions = capturedRenderWaferMapCalls[0].options.viewOptions;
    assert.strictEqual(firstCardOptions.plotMode, 'stackedValues');
    assert.deepStrictEqual(firstCardOptions.testDefs, [{ index: 0, name: 'Test 100' }]);

    const secondCardOptions = capturedRenderWaferMapCalls[1].options.viewOptions;
    assert.strictEqual(secondCardOptions.plotMode, 'stackedValues');
    assert.deepStrictEqual(secondCardOptions.testDefs, [{ index: 0, name: 'Test 200' }]);
  });

  it('should discover hbinDefs for stackedBins mode when not provided', () => {
    galleryController.setOptions({ plotMode: 'stackedBins' });

    // Expect 3 cards for the 3 discovered hard bins (1, 2, 3)
    assert.strictEqual(capturedRenderWaferMapCalls.length, 3);

    const firstCardOptions = capturedRenderWaferMapCalls[0].options.viewOptions;
    assert.strictEqual(firstCardOptions.plotMode, 'stackedBins');
    assert.deepStrictEqual(firstCardOptions.hbinDefs, [{ bin: 1, name: 'Bin 1' }]);

    const secondCardOptions = capturedRenderWaferMapCalls[1].options.viewOptions;
    assert.strictEqual(secondCardOptions.plotMode, 'stackedBins');
    assert.deepStrictEqual(secondCardOptions.hbinDefs, [{ bin: 2, name: 'Bin 2' }]);

    const thirdCardOptions = capturedRenderWaferMapCalls[2].options.viewOptions;
    assert.strictEqual(thirdCardOptions.plotMode, 'stackedBins');
    assert.deepStrictEqual(thirdCardOptions.hbinDefs, [{ bin: 3, name: 'Bin 3' }]);
  });

  it('should discover sbinDefs for stackedSoftBins mode when not provided', () => {
    galleryController.setOptions({ plotMode: 'stackedSoftBins' });

    // Expect 3 cards for the 3 discovered soft bins (10, 11, 12)
    assert.strictEqual(capturedRenderWaferMapCalls.length, 3);

    const firstCardOptions = capturedRenderWaferMapCalls[0].options.viewOptions;
    assert.strictEqual(firstCardOptions.plotMode, 'stackedSoftBins');
    assert.deepStrictEqual(firstCardOptions.sbinDefs, [{ bin: 10, name: 'Bin 10' }]);

    const secondCardOptions = capturedRenderWaferMapCalls[1].options.viewOptions;
    assert.strictEqual(secondCardOptions.plotMode, 'stackedSoftBins');
    assert.deepStrictEqual(secondCardOptions.sbinDefs, [{ bin: 11, name: 'Bin 11' }]);

    const thirdCardOptions = capturedRenderWaferMapCalls[2].options.viewOptions;
    assert.strictEqual(thirdCardOptions.plotMode, 'stackedSoftBins');
    assert.deepStrictEqual(thirdCardOptions.sbinDefs, [{ bin: 12, name: 'Bin 12' }]);
  });

  it('should use provided definitions over discovery if available', () => {
    const customTestDefs = [{ testNumber: 100, name: 'Custom Test A', unit: 'V' }];
    galleryController.setOptions({ plotMode: 'stackedValues', testDefs: customTestDefs });

    // Should only create 1 card for the provided testDef
    assert.strictEqual(capturedRenderWaferMapCalls.length, 1);
    const cardOptions = capturedRenderWaferMapCalls[0].options.viewOptions;
    assert.deepStrictEqual(cardOptions.testDefs, [{ index: 0, name: 'Custom Test A', unit: 'V' }]);
  });

  it('should revert to original items when switching from stacked mode', () => {
    galleryController.setOptions({ plotMode: 'stackedValues' });
    assert.strictEqual(capturedRenderWaferMapCalls.length, 2); // 2 tests discovered

    capturedRenderWaferMapCalls = []; // Clear calls
    galleryController.setOptions({ plotMode: 'hardBin' });

    // Should revert to the original 2 items
    assert.strictEqual(capturedRenderWaferMapCalls.length, 2);
    assert.strictEqual(capturedRenderWaferMapCalls[0].dies, mockItems[0].dies);
    assert.strictEqual(capturedRenderWaferMapCalls[1].dies, mockItems[1].dies);
  });
});