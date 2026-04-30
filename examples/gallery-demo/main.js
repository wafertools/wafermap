import { buildWaferMap, aggregateValues, aggregateBinCounts } from 'wafermap';
import { renderWaferGallery } from 'wafermap/canvas-adapter';

const PITCH = 10;
const WAFER_IDS = ['W01', 'W02', 'W03', 'W04'];

const TEST_DEFS_WITH_UNITS = [
  { index: 0, name: 'Idsat', unit: 'A' },
  { index: 1, name: 'Vth',   unit: 'V' },
  { index: 2, name: 'Ioff',  unit: 'A' },
  { index: 3, name: 'Cgg',   unit: 'F' },
];
const TEST_DEFS_NO_UNITS = [
  { index: 0, name: 'Idsat' },
  { index: 1, name: 'Vth'   },
  { index: 2, name: 'Ioff'  },
  { index: 3, name: 'Cgg'   },
];

const HBIN_DEFS = [
  { bin: 1, name: 'Pass' },
  { bin: 2, name: 'Leakage' },
  { bin: 3, name: 'Vth Shift' },
];
const SBIN_DEFS = [
  { bin: 10, name: 'Pass - Nominal' },
  { bin: 11, name: 'Pass - Hi Idsat' },
  { bin: 12, name: 'Pass - Lo Idsat' },
  { bin: 20, name: 'Leakage - Gate' },
  { bin: 21, name: 'Leakage - Junction' },
  { bin: 22, name: 'Leakage - Bulk' },
  { bin: 23, name: 'Leakage - STI' },
  { bin: 25, name: 'Leakage - Corner' },
  { bin: 26, name: 'Leakage - Edge' },
  { bin: 40, name: 'Vth - Hi NMOS' },
  { bin: 41, name: 'Vth - Lo NMOS' },
  { bin: 42, name: 'Vth - Hi PMOS' },
];

// ── State ──────────────────────────────────────────────────────────────────
let showUnits      = true;
let fallbackFormat = 'engineering';
let aggrMethod     = 'mean';   // method for Stacked Values mode

let gallery         = null;
let waferItems      = [];       // one item per wafer, for Value/Hard Bin/Soft Bin modes
let waferDiesByWafer = [];      // Die[][] used by aggregation functions

function currentTestDefs() {
  return showUnits ? TEST_DEFS_WITH_UNITS : TEST_DEFS_NO_UNITS;
}

function currentPlotMode() {
  return gallery?.getOptions()?.plotMode ?? 'value';
}

// Build gallery items appropriate for the current plot mode.
//   Value / Hard Bin / Soft Bin  →  individual wafer cards
//   Stacked Values               →  one card per test parameter (lot mean/median/etc.)
//   Stacked Bins                 →  one card per bin (lot occurrence count)
function buildGalleryItems(plotMode) {
  if (plotMode === 'stackedValues') {
    return currentTestDefs().map(def => ({
      wafer: waferItems[0].wafer,
      dies:  aggregateValues(waferDiesByWafer, aggrMethod, def.index),
      label: def.name,
    }));
  }

  if (plotMode === 'stackedBins') {
    return HBIN_DEFS.map(def => ({
      wafer: waferItems[0].wafer,
      dies:  aggregateBinCounts(waferDiesByWafer, def.bin, 0),
      label: `${def.bin} · ${def.name}`,
    }));
  }

  return waferItems;
}

function stacked_opts(mode) {
  if (mode === 'stackedValues') return { aggrMethod, lotSize: undefined };
  if (mode === 'stackedBins')   return { valueRange: [0, WAFER_IDS.length], lotSize: WAFER_IDS.length, aggrMethod: undefined };
  return { aggrMethod: undefined, lotSize: undefined, valueRange: undefined };
}

function refreshGallery() {
  if (!gallery) return;
  const mode = currentPlotMode();
  gallery.setItems(buildGalleryItems(mode));
  const opts = { testDefs: currentTestDefs(), hbinDefs: HBIN_DEFS, sbinDefs: SBIN_DEFS, ...stacked_opts(mode) };
  gallery.setOptions(opts);
  gallery.setFallbackFormat(fallbackFormat);
  syncControlVis();
}

// ── Controls ───────────────────────────────────────────────────────────────

let elAggrMethod = null;   // Method dropdown, shown only in Stacked Values mode

function syncControlVis() {
  if (!elAggrMethod) return;
  elAggrMethod.closest('label').style.display =
    currentPlotMode() === 'stackedValues' ? '' : 'none';
}

function buildControls() {
  const bar = document.getElementById('controls');
  bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:8px 12px;';

  // Unitless format
  const fmtLabel = document.createElement('label');
  fmtLabel.textContent = 'Unitless format: ';
  const fmtSel = document.createElement('select');
  [['engineering', 'Engineering (12E-6)'], ['si', 'SI prefix (12 µ)']].forEach(([v, t]) => {
    const o = document.createElement('option');
    o.value = v; o.textContent = t;
    if (v === fallbackFormat) o.selected = true;
    fmtSel.appendChild(o);
  });
  fmtSel.addEventListener('change', () => { fallbackFormat = fmtSel.value; refreshGallery(); });
  fmtLabel.appendChild(fmtSel);

  // Units toggle
  const unitLabel = document.createElement('label');
  unitLabel.textContent = 'Test units: ';
  const unitSel = document.createElement('select');
  [['units', 'With units (A / V / F)'], ['no-units', 'Without units']].forEach(([v, t]) => {
    const o = document.createElement('option');
    o.value = v; o.textContent = t;
    if ((v === 'units') === showUnits) o.selected = true;
    unitSel.appendChild(o);
  });
  unitSel.addEventListener('change', () => { showUnits = unitSel.value === 'units'; refreshGallery(); });
  unitLabel.appendChild(unitSel);

  // Aggregation method (Stacked Values mode only)
  const methodLabel = document.createElement('label');
  methodLabel.textContent = 'Method: ';
  elAggrMethod = document.createElement('select');
  [['mean','Mean'],['median','Median'],['stddev','Std dev'],['min','Min'],['max','Max']].forEach(([v,t]) => {
    const o = document.createElement('option');
    o.value = v; o.textContent = t;
    if (v === aggrMethod) o.selected = true;
    elAggrMethod.appendChild(o);
  });
  elAggrMethod.addEventListener('change', () => { aggrMethod = elAggrMethod.value; refreshGallery(); });
  methodLabel.appendChild(elAggrMethod);

  bar.appendChild(fmtLabel);
  bar.appendChild(unitLabel);
  bar.appendChild(methodLabel);
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const rows = await loadCsv('../../data/fmt-demo.csv');
  waferItems = [];
  waferDiesByWafer = [];

  for (const waferId of WAFER_IDS) {
    const waferRows = rows.filter(row => row.wafer === waferId);
    const firstRow  = waferRows[0] ?? {};

    const results = waferRows.map(row => ({
      x:      Number(row.x),
      y:      Number(row.y),
      bins:   [Number(row.hbin), Number(row.sbin)],
      values: [Number(row.Idsat), Number(row.Vth), Number(row.Ioff), Number(row.Cgg)],
    }));

    const result = buildWaferMap({
      results,
      waferConfig: {
        diameter: 150,
        notch: { type: 'bottom' },
        metadata: { lot: firstRow.lot ?? 'FMTDEMO', waferNumber: Number(waferId.replace(/\D/g, '')) },
      },
      dieConfig: { width: PITCH, height: PITCH },
      testDefs:  TEST_DEFS_WITH_UNITS,
      hbinDefs:  HBIN_DEFS,
      sbinDefs:  SBIN_DEFS,
    });

    waferItems.push({ wafer: result.wafer, dies: result.dies, label: `${firstRow.lot ?? 'FMTDEMO'} · ${waferId}` });
    waferDiesByWafer.push(result.dies);
  }

  buildControls();

  gallery = renderWaferGallery(
    document.getElementById('gallery'),
    buildGalleryItems('value'),
    {
      sceneOptions: {
        plotMode: 'value',
        testDefs: currentTestDefs(),
        hbinDefs: HBIN_DEFS,
        sbinDefs: SBIN_DEFS,
      },
      fallbackFormat,
      onSceneOptionsChange: (opts) => {
        if (opts.plotMode !== undefined) {
          gallery.setItems(buildGalleryItems(opts.plotMode));
          gallery.setOptions(stacked_opts(opts.plotMode));
        }
        syncControlVis();
      },
    },
  );

  syncControlVis();
}

async function loadCsv(path) {
  const text = await (await fetch(path)).text();
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(',');
  return lines.filter(Boolean).map(line => {
    const values = line.split(',');
    return Object.fromEntries(headers.map((h, i) => [h, values[i]]));
  });
}

main().catch(err => {
  document.getElementById('gallery').textContent = `Failed to load: ${err.message}`;
});
