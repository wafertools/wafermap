import { buildWaferMap, analyzeWaferMap, analyzeWaferLot } from 'wafermap';
import { renderWaferGallery } from 'wafermap/canvas-adapter';

const PITCH = 10;
const WAFER_IDS = ['W01', 'W02', 'W03', 'W04'];

// Each wafer uses a different coordinate convention to exercise origin/axis handling.
// The underlying die data is identical — only how coordinates are expressed differs.
//   W01: centred (prober outputs −7..+7 on both axes)           → default 'center' origin
//   W02: lower-left origin (prober outputs 0..14 on both axes)  → auto-detected 'LL'
//   W03: upper-left origin (x: 0..14, y: 0..14 top-down)       → explicit 'UL'
//   W04: lower-right origin (x: 0..14 right-to-left, y: 0..14) → explicit 'LR'
const WAFER_COORD_CONFIGS = {
  W01: { xform: (x, y) => ({ x,       y       }), dieConfig: { width: PITCH, height: PITCH } },
  W02: { xform: (x, y) => ({ x: x+7,  y: y+7  }), dieConfig: { width: PITCH, height: PITCH } },
  W03: { xform: (x, y) => ({ x: x+7,  y: 7-y  }), dieConfig: { width: PITCH, height: PITCH, coordinateOrigin: { type: 'UL' } } },
  W04: { xform: (x, y) => ({ x: 7-x,  y: y+7  }), dieConfig: { width: PITCH, height: PITCH, coordinateOrigin: { type: 'LR' } } },
};

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

let gallery = null;

function currentTestDefs() {
  return showUnits ? TEST_DEFS_WITH_UNITS : TEST_DEFS_NO_UNITS;
}

// ── Controls ───────────────────────────────────────────────────────────────

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
  fmtSel.addEventListener('change', () => {
    fallbackFormat = fmtSel.value;
    gallery?.setFallbackFormat(fallbackFormat);
  });
  fmtLabel.appendChild(fmtSel);

  // Units toggle — updates testDefs so names and units in tooltips stay correct
  const unitLabel = document.createElement('label');
  unitLabel.textContent = 'Test units: ';
  const unitSel = document.createElement('select');
  [['units', 'With units (A / V / F)'], ['no-units', 'Without units']].forEach(([v, t]) => {
    const o = document.createElement('option');
    o.value = v; o.textContent = t;
    if ((v === 'units') === showUnits) o.selected = true;
    unitSel.appendChild(o);
  });
  unitSel.addEventListener('change', () => {
    showUnits = unitSel.value === 'units';
    gallery?.setOptions({ testDefs: currentTestDefs() });
  });
  unitLabel.appendChild(unitSel);

  // Aggregation method — only relevant in Stacked Test Values mode
  const methodLabel = document.createElement('label');
  methodLabel.textContent = 'Method: ';
  const methodSel = document.createElement('select');
  [['mean','Mean'],['median','Median'],['stddev','Std dev'],['min','Min'],['max','Max']].forEach(([v,t]) => {
    const o = document.createElement('option');
    o.value = v; o.textContent = t;
    if (v === 'mean') o.selected = true;
    methodSel.appendChild(o);
  });
  // gallery.setOptions({ aggrMethod }) triggers re-aggregation automatically when
  // the current mode is stackedValues.
  methodSel.addEventListener('change', () => gallery?.setOptions({ aggrMethod: methodSel.value }));
  methodLabel.appendChild(methodSel);

  bar.appendChild(fmtLabel);
  bar.appendChild(unitLabel);
  bar.appendChild(methodLabel);
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const rows = await loadCsv('../../data/fmt-demo.csv');
  const waferItems   = [];
  const waferResults = [];

  for (const waferId of WAFER_IDS) {
    const waferRows = rows.filter(row => row.wafer === waferId);
    const firstRow  = waferRows[0] ?? {};

    const coordCfg = WAFER_COORD_CONFIGS[waferId];
    const results = waferRows.map(row => {
      const { x, y } = coordCfg.xform(Number(row.x), Number(row.y));
      return {
        x, y,
        bins:   [Number(row.hbin), Number(row.sbin)],
        values: [Number(row.Idsat), Number(row.Vth), Number(row.Ioff), Number(row.Cgg)],
      };
    });

    const originLabel = { W01: 'centre', W02: 'LL', W03: 'UL', W04: 'LR' }[waferId];
    const result = buildWaferMap({
      results,
      waferConfig: {
        diameter: 150,
        notch: { type: 'bottom' },
        metadata: { lot: firstRow.lot ?? 'FMTDEMO', waferNumber: Number(waferId.replace(/\D/g, '')) },
      },
      dieConfig:      coordCfg.dieConfig,
      reticleConfig:  { width: 3, height: 2 },
      testDefs:   TEST_DEFS_WITH_UNITS,
      hbinDefs:   HBIN_DEFS,
      sbinDefs:   SBIN_DEFS,
    });

    waferItems.push({
      wafer: result.wafer,
      dies:  result.dies,
      label: `${waferId} (${originLabel} origin)`,
      hasReticle: true,
      sceneOptions: { reticles: result.reticles },
    });
    waferResults.push(result);
  }

  buildControls();

  // Run wafer-level stats for the findings panel on each card.
  const waferStats = waferResults.map(r => analyzeWaferMap(r));
  waferItems.forEach((item, i) => { item.statsSummary = waferStats[i]; });

  // Run lot-level stats across all wafers.
  const lotStats = analyzeWaferLot(waferResults);

  // Stacked modes (Stacked Hard Bins, Stacked Soft Bins, Stacked Test Values) are
  // handled automatically by the gallery — switching modes re-aggregates internally.
  gallery = renderWaferGallery(
    document.getElementById('gallery'),
    waferItems,
    {
      sceneOptions: {
        plotMode: 'value',
        testDefs: currentTestDefs(),
        hbinDefs: HBIN_DEFS,
        sbinDefs: SBIN_DEFS,
      },
      fallbackFormat,
      lotStatsSummary: lotStats,
    },
  );
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
