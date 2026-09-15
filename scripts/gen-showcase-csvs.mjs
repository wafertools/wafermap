#!/usr/bin/env node
// Generates a varied set of CSV files for showcase/showcase.html testing.
// Run: node scripts/gen-showcase-csvs.mjs

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../docs/data');

// ── Geometry helpers ────────────────────────────────────────────────────────
//
// Prober step coordinates are integers (i, j). Physical position is:
//   x_mm = i * pitchX,  y_mm = j * pitchY
// Clipping is done in mm against the wafer radius.
// The resulting (i, j) are what the ATE writes to the CSV.

function waferGrid({ radiusMm, pitchMmX, pitchMmY, edgeExcludeMm = 3 }) {
  const r = radiusMm - edgeExcludeMm;
  const iMax = Math.ceil(r / pitchMmX);
  const jMax = Math.ceil(r / pitchMmY);
  const dies = [];
  for (let j = -jMax; j <= jMax; j++) {
    for (let i = -iMax; i <= iMax; i++) {
      const xMm = i * pitchMmX;
      const yMm = j * pitchMmY;
      if (Math.sqrt(xMm * xMm + yMm * yMm) <= r) {
        dies.push({ x: i, y: j });
      }
    }
  }
  return dies;
}

function sparseMask(dies, fraction, rng) {
  return dies.filter(() => rng() < fraction);
}

// ── Deterministic PRNG (LCG) ────────────────────────────────────────────────

function makeLcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

// ── Failure pattern generators ──────────────────────────────────────────────

function edgeFailProb(i, j, pitchMmX, pitchMmY, radiusMm, edgeZoneMm = 8) {
  const rMm = Math.sqrt((i * pitchMmX) ** 2 + (j * pitchMmY) ** 2);
  return rMm > radiusMm - edgeZoneMm ? 0.40 : 0.04;
}

function clusterFailProb(i, j, ci, cj, clusterSteps = 3) {
  return Math.sqrt((i - ci) ** 2 + (j - cj) ** 2) < clusterSteps ? 0.75 : 0.03;
}

function quadrantFailProb(i, j) {
  return (i > 0 && j > 0) ? 0.35 : 0.04;
}

function ringFailProb(i, j, pitchMmX, pitchMmY, radiusMm, threshold) {
  const r = Math.sqrt((i * pitchMmX) ** 2 + (j * pitchMmY) ** 2) / radiusMm;
  return r > threshold ? 0.45 : 0.03;
}

// ── Value generators ────────────────────────────────────────────────────────

function gaussValue(mean, sigma, rng) {
  const u1 = Math.max(1e-10, rng());
  const u2 = rng();
  return mean + sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function spatialGradient(i, j, base, scale, rng, noise) {
  return base + i * scale + j * scale * 0.5 + gaussValue(0, noise, rng);
}

function ringGradient(i, j, pitchMmX, pitchMmY, radiusMm, base, rng) {
  const r = Math.sqrt((i * pitchMmX) ** 2 + (j * pitchMmY) ** 2) / radiusMm;
  return base + r * 0.12 + gaussValue(0, 0.025, rng);
}

// ── CSV builder ─────────────────────────────────────────────────────────────

function csv(headers, rows) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => {
      const v = row[h] ?? '';
      const s = String(v);
      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','));
  }
  return lines.join('\n') + '\n';
}

/**
 * Write the geometry and definitions sidecar that goes with a dataset.
 *
 * A flat die CSV has nowhere to record how big the wafer is or how big a die is,
 * so every demo that loaded one of these was building a *dimensionless* map:
 * `buildWaferMap` inferred a diameter from the step extent alone, which produced
 * a wafer "29.83 across" with 1×1 dies and `diePitch.units: 'normalized'`. The
 * relative positions were right, so the map looked fine — but the stated
 * diameter was fiction, every mm-denominated feature (edge exclusion, die pitch,
 * physical ring widths) was meaningless, and the inference confidence sat at
 * 0.4/0.5 on data we generated from exact physical dimensions in the first place.
 *
 * The numbers were always here in the generator. This just records them next to
 * the data so a demo can pass them back, and carries the definitions a CSV also
 * cannot hold: spec limits, units, functional-test types and bin names.
 */
function writeMeta(name, meta) {
  writeFileSync(join(OUT, `${name}.meta.json`), JSON.stringify(meta, null, 2) + '\n');
}

/** Wafer + die geometry from the physical dimensions a dataset was generated at. */
function geometry({ radiusMm, pitchMmX, pitchMmY, edgeExcludeMm, notch = 'bottom' }) {
  return {
    waferConfig: {
      diameter: radiusMm * 2,
      notch: { type: notch },
      ...(edgeExcludeMm ? { edgeExclusion: edgeExcludeMm } : {}),
    },
    dieConfig: { width: pitchMmX, height: pitchMmY },
  };
}

// ── File 1: Qualification sparse map ───────────────────────────────────────
// 200 mm wafer, large die (3.5 × 5.2 mm) → ~980 die sites, 30% tested (~294/wafer).
// hbin only, two device types, 3 wafers.
// Column names: XSTEP, YSTEP, HARD_BIN, DEVICE_TYPE, WAFER_ID, LOT_ID, OPERATOR

{
  const rng = makeLcg(0xDEAD_BEEF);
  const radiusMm = 100, pX = 3.5, pY = 5.2;
  const allDies = waferGrid({ radiusMm, pitchMmX: pX, pitchMmY: pY, edgeExcludeMm: 5 });
  const wafers = ['QV-01', 'QV-02', 'QV-03'];
  const operators = ['JSMITH', 'PBROWN', 'JSMITH'];
  const rows = [];

  for (let wi = 0; wi < wafers.length; wi++) {
    for (const die of sparseMask(allDies, 0.30, rng)) {
      const pass = rng() > edgeFailProb(die.x, die.y, pX, pY, radiusMm);
      rows.push({
        LOT_ID: 'QUAL-2024-001', WAFER_ID: wafers[wi],
        XSTEP: die.x, YSTEP: die.y,
        HARD_BIN: pass ? 1 : (rng() < 0.6 ? 2 : 3),
        DEVICE_TYPE: (die.x + die.y) % 3 === 0 ? 'DUT_B' : 'DUT_A',
        OPERATOR: operators[wi], TEST_DATE: '2024-11-15',
      });
    }
  }

  writeMeta('showcase-sparse-qual', {
    ...geometry({ radiusMm, pitchMmX: pX, pitchMmY: pY, edgeExcludeMm: 5 }),
    passBins: [1],
    hbinDefs: [
      { bin: 1, name: 'Pass' },
      { bin: 4, name: 'Edge Chip' },
    ],
  });
  writeFileSync(join(OUT, 'showcase-sparse-qual.csv'),
    csv(['LOT_ID','WAFER_ID','XSTEP','YSTEP','HARD_BIN','DEVICE_TYPE','OPERATOR','TEST_DATE'], rows));
  console.log(`showcase-sparse-qual.csv   — ${rows.length} rows · ${allDies.length} sites · 3 wafers · ~30% populated`);
}

// ── File 2: High-density small die ─────────────────────────────────────────
// 200 mm wafer, small die (2.0 × 1.5 mm) → ~3,200 die, hbin + sbin + 2 test values.
// Single wafer (tests the no-wafer-column path).
// Terse column names: X, Y, HBIN, SBIN, TST_A, TST_B, LOT, WFR

{
  const rng = makeLcg(0xCAFE_BABE);
  const radiusMm = 100, pX = 2.0, pY = 1.5;
  const dies = waferGrid({ radiusMm, pitchMmX: pX, pitchMmY: pY, edgeExcludeMm: 3 });
  const rows = [];

  for (const die of dies) {
    const pass = rng() > edgeFailProb(die.x, die.y, pX, pY, radiusMm);
    const hbin = pass ? 1 : [2, 2, 3, 4][Math.floor(rng() * 4)];
    const sbin = pass ? 10 : [20, 21, 30, 31][Math.floor(rng() * 4)];
    rows.push({
      LOT: 'HVM-0982', WFR: 'W01',
      X: die.x, Y: die.y, HBIN: hbin, SBIN: sbin,
      TST_A: spatialGradient(die.x, die.y, 1.200, 0.003, rng, 0.025).toFixed(4),
      TST_B: ringGradient(die.x, die.y, pX, pY, radiusMm, 0.850, rng).toFixed(4),
    });
  }

  writeMeta('showcase-highdensity', {
    ...geometry({ radiusMm, pitchMmX: pX, pitchMmY: pY }),
    passBins: [1],
    hbinDefs: [
      { bin: 1, name: 'Pass' },
      { bin: 2, name: 'Parametric Fail' },
      { bin: 5, name: 'Edge Ring' },
    ],
    // TST_A/TST_B are the CSV's own column names; a loader keys testValues by
    // column index, so testNumber mirrors that position.
    // Limits are set from the generated distributions (see the note in
     // gen-dummy-fulldata.mjs): near the 1st/99th percentile, so a small
     // realistic fraction fails. A limit nothing violates demonstrates nothing,
     // and one everything violates is no better.
    testDefs: [
      { testNumber: 6, name: 'TST_A', unit: 'V',  limitLow: 1.00, limitHigh: 1.40 },
      { testNumber: 7, name: 'TST_B', unit: 'mA', limitHigh: 1.02 },
    ],
  });
  writeFileSync(join(OUT, 'showcase-highdensity.csv'),
    csv(['LOT','WFR','X','Y','HBIN','SBIN','TST_A','TST_B'], rows));
  console.log(`showcase-highdensity.csv   — ${rows.length} rows · 1 wafer · ${pX}×${pY} mm die`);
}

// ── File 3: Wide rectangular die ───────────────────────────────────────────
// 200 mm wafer, wide die (8.0 × 1.2 mm, like a display driver IC) → ~300 die/wafer.
// hbin + sbin + 3 test values, cluster failure, 2 wafers.
// Column names: die_x, die_y, hard_bin, soft_bin, wafer_id, lot_id, IDD_UA, VTH_V, BW_MHZ

{
  const rng = makeLcg(0xBEEF_CAFE);
  const radiusMm = 100, pX = 8.0, pY = 1.2;
  const dies = waferGrid({ radiusMm, pitchMmX: pX, pitchMmY: pY, edgeExcludeMm: 5 });
  const wafers = ['W01', 'W02'];
  const rows = [];

  for (let wi = 0; wi < wafers.length; wi++) {
    const cX = wi === 0 ? 2 : -1, cY = wi === 0 ? 8 : -6;
    for (const die of dies) {
      const failP = Math.max(
        clusterFailProb(die.x, die.y, cX, cY, 2),
        edgeFailProb(die.x, die.y, pX, pY, radiusMm),
      );
      const pass = rng() > failP;
      const hbin = pass ? 1 : (rng() < 0.5 ? 2 : rng() < 0.5 ? 3 : 4);
      rows.push({
        lot_id: 'IMG-SENSOR-003', wafer_id: wafers[wi],
        die_x: die.x, die_y: die.y,
        hard_bin: hbin,
        soft_bin: pass ? 100 : [201, 202, 301, 302, 401][Math.floor(rng() * 5)],
        IDD_UA:  gaussValue(pass ? 12.5 : 45.0, pass ? 1.8 : 8.0, rng).toFixed(2),
        VTH_V:   spatialGradient(die.x, die.y, pass ? 0.480 : 0.620, 0.002, rng, 0.015).toFixed(4),
        BW_MHZ:  gaussValue(pass ? 480 : 310, pass ? 18 : 40, rng).toFixed(1),
        // A functional (pass/fail-only) test — no measured value, just a verdict,
        // which is what `testType: 'F'` means. Written as P/F rather than 1/0 so
        // the column cannot be mistaken for a parametric reading. Continuity
        // fails on a subset of the parametric failures plus a little of its own,
        // so functional yield and parametric yield genuinely differ.
        CONTINUITY: (pass ? rng() > 0.004 : rng() > 0.35) ? 'P' : 'F',
        // The tester's own recorded verdict for VTH_V, which is what
        // `passFailDisplay: 'test'` renders. Deliberately guard-banded tighter
        // than the spec limit, so the tester flag and the spec judgement
        // disagree on a few dies — the case that mode exists to expose.
        VTH_FLAG:   (Math.abs(+spatialGradient(die.x, die.y, pass ? 0.480 : 0.620, 0.002, rng, 0.0) - 0.48) < 0.14) ? 'P' : 'F',
      });
    }
  }

  writeMeta('showcase-wide-die', {
    ...geometry({ radiusMm, pitchMmX: pX, pitchMmY: pY }),
    passBins: [1],
    hbinDefs: [{ bin: 1, name: 'Pass' }, { bin: 3, name: 'Vth Shift' }],
    sbinDefs: [{ bin: 1, name: 'Pass' }, { bin: 31, name: 'Vth Low' }, { bin: 32, name: 'Vth High' }],
    // Values are stored in the unit each column is named for (µA, V, MHz), so
    // the limits are in that same scale — not SI base units.
    testDefs: [
      { testNumber: 6, name: 'IDD_UA', unit: 'µA',  limitHigh: 55 },
      { testNumber: 7, name: 'VTH_V',  unit: 'V',   limitLow: 0.38, limitHigh: 0.65 },
      { testNumber: 8, name: 'BW_MHZ', unit: 'MHz', limitLow: 250 },
      // Functional: a verdict, never a value. Kept in `testDefs` so a loader can
      // see it is type F and route it to `testPass` rather than `testValues`.
      { testNumber: 9, name: 'CONTINUITY', testType: 'F' },
    ],
    /**
     * Columns holding a recorded pass/fail verdict rather than a measurement,
     * keyed by the test they belong to. A loader puts these in `die.testPass`,
     * which is what drives `passFailDisplay: 'test'` and `stats.functionalYield`.
     */
    verdictColumns: { 9: 'CONTINUITY', 7: 'VTH_FLAG' },
  });
  writeFileSync(join(OUT, 'showcase-wide-die.csv'),
    csv(['lot_id','wafer_id','die_x','die_y','hard_bin','soft_bin','IDD_UA','VTH_V','BW_MHZ','CONTINUITY','VTH_FLAG'], rows));
  console.log(`showcase-wide-die.csv      — ${rows.length} rows · ${dies.length} die/wafer · 2 wafers · ${pX}×${pY} mm die`);
}

// ── File 4: Power device — quadrant failure ────────────────────────────────
// 150 mm wafer, large die (5.0 × 5.0 mm) → ~245 die/wafer.
// hbin only, 5 wafers, NE quadrant failure pattern.
// Column names: step_x, step_y, bin, wafer_num, lot_num, tester, node_nam, tst_temp

{
  const rng = makeLcg(0xF00D_CAFE);
  const radiusMm = 75, pX = 5.0, pY = 5.0;
  const dies = waferGrid({ radiusMm, pitchMmX: pX, pitchMmY: pY, edgeExcludeMm: 4 });
  const wafers = ['W01','W02','W03','W04','W05'];
  const testers = ['EAGLE-01','EAGLE-01','EAGLE-02','EAGLE-02','EAGLE-01'];
  const rows = [];

  for (let wi = 0; wi < wafers.length; wi++) {
    for (const die of dies) {
      const failP = quadrantFailProb(die.x, die.y) * (wi === 2 ? 1.4 : 1.0);
      const pass = rng() > Math.min(failP, 0.92);
      rows.push({
        lot_num: 'PWR-LOT-2025-44', wafer_num: wafers[wi],
        step_x: die.x, step_y: die.y,
        bin: pass ? 1 : (rng() < 0.7 ? 2 : 3),
        tester: testers[wi], node_nam: 'PHOENIX-3A', tst_temp: 25,
      });
    }
  }

  writeMeta('showcase-power-device', {
    ...geometry({ radiusMm, pitchMmX: pX, pitchMmY: pY }),
    passBins: [1],
    hbinDefs: [
      { bin: 1, name: 'Pass' },
      { bin: 2, name: 'BVdss Fail' },
      { bin: 6, name: 'Gate Short' },
    ],
  });
  writeFileSync(join(OUT, 'showcase-power-device.csv'),
    csv(['lot_num','wafer_num','step_x','step_y','bin','tester','node_nam','tst_temp'], rows));
  console.log(`showcase-power-device.csv  — ${rows.length} rows · ${dies.length} die/wafer · 5 wafers · NE quadrant fail`);
}

// ── File 5: RF/Analog — sbin only, 4 test values, temperature split ────────
// 200 mm wafer, medium die (2.2 × 1.8 mm) → ~2,400 die/wafer.
// No hbin. sbin + 4 test values. 2 temps (25°C, 125°C) → split-by demo.
// Column names: LOT_ID, WAFER_ID, X_LOC, Y_LOC, SBIN, GAIN_DB, NF_DB, IP3_DBM, IDQ_MA, TEMP, TESTDATE

{
  const rng = makeLcg(0x1234_5678);
  const radiusMm = 100, pX = 2.2, pY = 1.8;
  const dies = waferGrid({ radiusMm, pitchMmX: pX, pitchMmY: pY, edgeExcludeMm: 3 });
  const wafers = ['A1', 'A2'];
  const rows = [];

  for (const wid of wafers) {
    for (const temp of [25, 125]) {
      const tOff = temp === 125 ? 0.8 : 0;
      for (const die of dies) {
        const pass = rng() > edgeFailProb(die.x, die.y, pX, pY, radiusMm) + (temp === 125 ? 0.04 : 0);
        rows.push({
          LOT_ID: 'RF-PROD-2025-09', WAFER_ID: wid,
          X_LOC: die.x, Y_LOC: die.y,
          SBIN: pass ? 1 : [10, 11, 12, 20][Math.floor(rng() * 4)],
          GAIN_DB:  gaussValue(pass ? 22.5 - tOff : 15.0, pass ? 0.6 : 2.5, rng).toFixed(2),
          NF_DB:    gaussValue(pass ? 2.8 + tOff * 0.02 : 5.1, pass ? 0.3 : 1.0, rng).toFixed(3),
          IP3_DBM:  spatialGradient(die.x, die.y, pass ? 18.5 : 10.0, 0.01, rng, 0.4).toFixed(2),
          IDQ_MA:   gaussValue(pass ? 42.0 + tOff * 0.15 : 38.0, 1.5, rng).toFixed(2),
          TEMP: temp, TESTDATE: '2025-09-12',
        });
      }
    }
  }

  writeMeta('showcase-rf-analog', {
    ...geometry({ radiusMm, pitchMmX: pX, pitchMmY: pY }),
    passBins: [1],
    sbinDefs: [
      { bin: 1,  name: 'Pass' },
      { bin: 41, name: 'Gain Low' },
      { bin: 42, name: 'NF High' },
      { bin: 43, name: 'IP3 Low' },
    ],
    // A four-test RF trim sheet: every test limit-bounded, so spec-limit
    // colouring and the pass-rate pareto both have something real to show.
    testDefs: [
      { testNumber: 5, name: 'GAIN_DB', unit: 'dB',  limitLow: 14.0 },
      { testNumber: 6, name: 'NF_DB',   unit: 'dB',  limitHigh: 5.0 },
      { testNumber: 7, name: 'IP3_DBM', unit: 'dBm', limitLow: 12.0 },
      { testNumber: 8, name: 'IDQ_MA',  unit: 'mA',  limitLow: 34.0, limitHigh: 47.0 },
    ],
  });
  writeFileSync(join(OUT, 'showcase-rf-analog.csv'),
    csv(['LOT_ID','WAFER_ID','X_LOC','Y_LOC','SBIN','GAIN_DB','NF_DB','IP3_DBM','IDQ_MA','TEMP','TESTDATE'], rows));
  console.log(`showcase-rf-analog.csv     — ${rows.length} rows · ${dies.length} die/wafer · 2 wafers × 2 temps`);
}

// ── File 6: Memory — ring failure, 6 wafers ────────────────────────────────
// 200 mm wafer, rectangular die (3.0 × 2.0 mm) → ~1,600 die/wafer.
// hbin + sbin, no test values. Progressive ring failure across wafers.
// Column names: LID, WID, COL, ROW, H_BIN, S_BIN

{
  const rng = makeLcg(0xABCD_1234);
  const radiusMm = 100, pX = 3.0, pY = 2.0;
  const dies = waferGrid({ radiusMm, pitchMmX: pX, pitchMmY: pY, edgeExcludeMm: 3 });
  const wafers = ['M01','M02','M03','M04','M05','M06'];
  const rows = [];

  for (let wi = 0; wi < wafers.length; wi++) {
    const threshold = 0.82 - wi * 0.03; // outer ring degrades progressively
    for (const die of dies) {
      const pass = rng() > ringFailProb(die.x, die.y, pX, pY, radiusMm, threshold);
      rows.push({
        LID: 'MEM-2025-LOT7', WID: wafers[wi],
        COL: die.x, ROW: die.y,
        H_BIN: pass ? 1 : (rng() < 0.55 ? 2 : rng() < 0.5 ? 3 : 4),
        S_BIN: pass ? 10 : [20, 21, 22, 30, 31][Math.floor(rng() * 5)],
      });
    }
  }

  writeMeta('showcase-memory-ring', {
    ...geometry({ radiusMm, pitchMmX: pX, pitchMmY: pY }),
    passBins: [1],
    hbinDefs: [{ bin: 1, name: 'Pass' }, { bin: 2, name: 'Retention' }],
    sbinDefs: [
      { bin: 1,  name: 'Pass' },
      { bin: 21, name: 'Retention - Row' },
      { bin: 22, name: 'Retention - Column' },
    ],
  });
  writeFileSync(join(OUT, 'showcase-memory-ring.csv'),
    csv(['LID','WID','COL','ROW','H_BIN','S_BIN'], rows));
  console.log(`showcase-memory-ring.csv   — ${rows.length} rows · ${dies.length} die/wafer · 6 wafers · ring failure`);
}

// ── File 7: Parser stress — quoted fields, CRLF, comment lines ────────────
// Small wafer (150 mm, 3.0 × 3.0 mm die) → ~540 die/wafer, 2 wafers.
// Tests: Windows line endings, # comment headers, quoted fields with commas.

{
  const rng = makeLcg(0xFADE_D00D);
  const radiusMm = 75, pX = 3.0, pY = 3.0;
  const dies = waferGrid({ radiusMm, pitchMmX: pX, pitchMmY: pY, edgeExcludeMm: 5 });
  const wafers = ['P01', 'P02'];
  const lines = [
    '# Exported from ATE system v4.2.1',
    '# Lot: PILOT-LOT-001, Product: "Widget, Mark II"',
    '# DO NOT EDIT — auto-generated',
    'x,y,hbin,sbin,wafer,lot,product,note',
  ];

  for (const wid of wafers) {
    for (const die of dies) {
      const pass = rng() > 0.06;
      lines.push([
        die.x, die.y,
        pass ? 1 : 2,
        pass ? 10 : 20,
        wid, 'PILOT-LOT-001',
        '"Widget, Mark II"',
        pass ? '' : '"Failed spec, re-test pending"',
      ].join(','));
    }
  }

  writeMeta('showcase-parser-stress', {
    ...geometry({ radiusMm, pitchMmX: pX, pitchMmY: pY }),
    passBins: [1],
    hbinDefs: [{ bin: 1, name: 'Pass' }, { bin: 2, name: 'Fail' }],
  });
  writeFileSync(join(OUT, 'showcase-parser-stress.csv'), lines.join('\r\n') + '\r\n');
  console.log(`showcase-parser-stress.csv — ${lines.length - 4} rows · ${dies.length} die/wafer · 2 wafers · CRLF+quotes`);
}

// ── File 8: Bin-rich logic SoC — many hard and soft bins ───────────────────
// 200 mm wafer, 4.0 × 4.0 mm die → ~1,850 die/wafer, 4 wafers.
// 15 hard bins (two pass grades, gaps in the numbering as real programs have)
// and 32 soft bins numbered under their hard bin, the way a sort program groups
// them. Every other file here has 2–6 bins, which cannot show how bin colour
// behaves across a realistic program — including the soft-bin palette running
// out, which is what the `bin-colors-shared` warning exists to report.
// Each failure mode has its own spatial signature, so a colour can be matched
// to a shape: opens at the edge, a shorts cluster, IDDQ at the centre, an MBIST
// scratch, Vmin/Fmax tilts (the Fmax side also drives grade-2 passes), IO
// leakage in the outer ring and a tester-alarm streak on one wafer.
// Column names: LOT, WAFER, X, Y, HBIN, SBIN

{
  const radiusMm = 100, pX = 4.0, pY = 4.0;
  const dies = waferGrid({ radiusMm, pitchMmX: pX, pitchMmY: pY, edgeExcludeMm: 3 });
  const wafers = ['S01', 'S02', 'S03', 'S04'];

  const hbinDefs = [
    { bin: 1,  name: 'Pass — grade 1' },
    { bin: 2,  name: 'Pass — grade 2' },
    { bin: 3,  name: 'Open / contact' },
    { bin: 4,  name: 'Short' },
    { bin: 5,  name: 'IDDQ' },
    { bin: 6,  name: 'Scan (ATPG)' },
    { bin: 7,  name: 'Memory BIST' },
    { bin: 8,  name: 'PLL' },
    { bin: 9,  name: 'Vmin' },
    { bin: 10, name: 'Fmax' },
    { bin: 11, name: 'Analog' },
    { bin: 12, name: 'IO leakage' },
    { bin: 15, name: 'NVM / fuse' },
    { bin: 17, name: 'Thermal sensor' },
    { bin: 20, name: 'Tester alarm' },
  ];
  const sbinDefs = [
    { bin: 100,  name: 'Pass — Fmax ≥ 3.2 GHz' },
    { bin: 200,  name: 'Pass — Fmax 2.8–3.2 GHz' },
    { bin: 201,  name: 'Pass — grade 2, Vmin marginal' },
    { bin: 301,  name: 'Open — VDD' },
    { bin: 302,  name: 'Open — IO' },
    { bin: 303,  name: 'Probe contact' },
    { bin: 401,  name: 'Short — VDD to GND' },
    { bin: 402,  name: 'Short — IO' },
    { bin: 501,  name: 'IDDQ high' },
    { bin: 502,  name: 'IDDQ delta' },
    { bin: 503,  name: 'Standby current' },
    { bin: 601,  name: 'Scan stuck-at' },
    { bin: 602,  name: 'Scan transition' },
    { bin: 603,  name: 'Scan chain broken' },
    { bin: 701,  name: 'MBIST SRAM' },
    { bin: 702,  name: 'MBIST ROM' },
    { bin: 703,  name: 'MBIST repair exhausted' },
    { bin: 801,  name: 'PLL lock timeout' },
    { bin: 802,  name: 'PLL jitter' },
    { bin: 901,  name: 'Vmin — core' },
    { bin: 902,  name: 'Vmin — SRAM' },
    { bin: 1001, name: 'Fmax — core' },
    { bin: 1002, name: 'Fmax — IO timing' },
    { bin: 1101, name: 'ADC INL' },
    { bin: 1102, name: 'DAC offset' },
    { bin: 1103, name: 'Bandgap trim' },
    { bin: 1201, name: 'Input leakage' },
    { bin: 1202, name: 'Tristate leakage' },
    { bin: 1501, name: 'eFuse' },
    { bin: 1502, name: 'OTP' },
    { bin: 1701, name: 'Thermal sensor offset' },
    { bin: 2001, name: 'Tester alarm' },
  ];
  // Soft bins belong to the hard bin whose number prefixes theirs (1502 → 15).
  const sbinsByHbin = {};
  for (const { bin } of sbinDefs) {
    const h = Math.floor(bin / 100);
    (sbinsByHbin[h] ??= []).push(bin);
  }

  const rows = [];
  for (let wi = 0; wi < wafers.length; wi++) {
    const rng = makeLcg(0x5EED_0B1D + wi);
    // The shorts cluster and the MBIST scratch move from wafer to wafer.
    const cx = [-6, 8, 3, -9][wi], cy = [5, -4, 9, -7][wi];
    for (const die of dies) {
      const xMm = die.x * pX, yMm = die.y * pY;
      const r = Math.hypot(xMm, yMm) / radiusMm;             // 0 at centre, ~1 at edge
      const tilt = (xMm + yMm) / (radiusMm * Math.SQRT2);    // −1 SW … +1 NE
      let hbin = 0;
      if (r > 0.9 && rng() < 0.30) hbin = 3;
      else if (Math.hypot(die.x - cx, die.y - cy) < 2.5 && rng() < 0.8) hbin = 4;
      else if (r < 0.18 && rng() < 0.35) hbin = 5;
      else if (Math.abs(die.y - die.x * 0.6 - (wi * 3 - 4)) < 0.7 && Math.abs(die.x) < 14 && rng() < 0.85) hbin = 7;
      else if (wi === 2 && die.y === 10 && die.x > -8 && die.x < 6) hbin = 20;
      else if (tilt > 0.45 && rng() < 0.25 * tilt) hbin = 9;
      else if (tilt < -0.45 && rng() < -0.25 * tilt) hbin = 10;
      else if (r > 0.8 && rng() < 0.06) hbin = 12;
      else {
        const u = rng();
        hbin = u < 0.030 ? 6 : u < 0.042 ? 8 : u < 0.052 ? 11 : u < 0.058 ? 15 : (wi === 1 && u < 0.066) ? 17 : 0;
      }
      // Passing dies: grade 2 becomes more common towards the slow (SW) side.
      if (hbin === 0) hbin = rng() < 0.12 + Math.max(0, -tilt) * 0.35 ? 2 : 1;
      const choices = sbinsByHbin[hbin];
      rows.push({
        LOT: 'SOC-A7-2025-118', WAFER: wafers[wi],
        X: die.x, Y: die.y, HBIN: hbin,
        SBIN: choices[Math.floor(rng() * choices.length)],
      });
    }
  }

  writeMeta('showcase-bin-rich', {
    ...geometry({ radiusMm, pitchMmX: pX, pitchMmY: pY }),
    passBins: [1, 2],
    // Names only, no colours: this dataset exists to show the palette's own
    // assignment. A site colour sheet would be `color` on these entries.
    hbinDefs,
    sbinDefs,
  });
  writeFileSync(join(OUT, 'showcase-bin-rich.csv'),
    csv(['LOT','WAFER','X','Y','HBIN','SBIN'], rows));
  console.log(`showcase-bin-rich.csv      — ${rows.length} rows · ${dies.length} die/wafer · 4 wafers · ${hbinDefs.length} hard / ${sbinDefs.length} soft bins`);
}

console.log(`\nAll files written to ${OUT}`);
