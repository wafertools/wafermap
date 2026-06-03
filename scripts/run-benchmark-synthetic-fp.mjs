/**
 * Synthetic false positive benchmark — minimumRegionExcessFails sweep.
 *
 * Generates wafers with purely random (i.i.d. Bernoulli) die failures at
 * varying yield levels and grid sizes representative of the WM-811K dataset.
 * Sweeps minimumRegionExcessFails to find a value that suppresses the 10%
 * failure-rate FP spike without hurting the rescue rate on real patterns.
 *
 * Usage: node scripts/run-benchmark-synthetic-fp.mjs
 */
import { spawn }           from 'child_process';
import { createInterface } from 'readline';
import { buildWaferMap }   from '../dist/index.js';
import { classifyPattern } from '../dist/packages/stats/patternClassification.js';
import { analyzeWaferMap } from '../dist/packages/stats/analyzeWaferMap.js';

const GRID_SIZES  = [20, 30, 40, 52];
const FAIL_RATES  = [0.02, 0.05, 0.10, 0.20, 0.40, 0.60];
const REPLICATES  = 500;
const DIAMETER    = 300;
const NPZ_PATH    = './tests/fixtures/wm811k-benchmark.npz';
const VENV_PY     = './.venv/bin/python3';

// Candidate excess-fail gate values to sweep
const GATE_VALUES = [0, 5, 10, 15, 20, 30];

const REGIONAL_FAMILIES = new Set(['ring', 'quadrant', 'sector', 'edge-arc', 'cluster']);

const SEMANTIC_FAMILIES = {
  'center':     ['ring', 'cluster'],
  'donut':      ['ring', 'cluster'],
  'edge-local': ['edge-arc', 'cluster', 'ring', 'sector', 'quadrant'],
  'edge-ring':  ['ring', 'edge-arc'],
  'near-full':  ['ring'],
  'scratch':    ['cluster', 'edge-arc', 'sector', 'quadrant'],
};

const LABEL_MAP = {
  'Center':    'center',    'Donut':     'donut',
  'Edge-Loc':  'edge-local','Edge-Ring': 'edge-ring',
  'Loc':       'random',    'Near-full': 'near-full',
  'Random':    'random',    'Scratch':   'scratch',   'none': 'none',
};

const PY_SCRIPT = `
import numpy as np, json, sys
d = np.load(sys.argv[1], allow_pickle=True)
maps, grid_rows, grid_cols, labels = d['maps'], d['grid_rows'], d['grid_cols'], d['labels']
for i in range(len(maps)):
    nrows, ncols = int(grid_rows[i]), int(grid_cols[i])
    wmap = maps[i, :nrows, :ncols]
    cx, cy = ncols // 2, nrows // 2
    r_idx, c_idx = np.where(wmap != 0)
    if r_idx.size == 0: continue
    xs    = (c_idx - cx).tolist()
    ys    = (cy - r_idx).tolist()
    hbins = np.where(wmap[r_idx, c_idx] == 2, 2, 1).tolist()
    results = [{'x':int(x),'y':int(y),'hbin':int(h)} for x,y,h in zip(xs,ys,hbins)]
    sys.stdout.write(json.dumps({'f': str(labels[i]), 'r': nrows, 'c': ncols, 'd': results}) + '\\n')
    sys.stdout.flush()
`;

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function generateRandomWafer(gridSize, failRate, rng) {
  const cx = Math.floor(gridSize / 2);
  const cy = Math.floor(gridSize / 2);
  const radius = gridSize / 2;
  const results = [];
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const dx = col - cx, dy = row - cy;
      if (Math.sqrt(dx * dx + dy * dy) > radius - 0.5) continue;
      results.push({ x: dx, y: -dy, hbin: rng() < failRate ? 2 : 1 });
    }
  }
  return results;
}

const pct = (n, d) => d > 0 ? (n / d * 100).toFixed(1).padStart(5) + '%' : '   n/a';

// ------------------------------------------------------------------
// Part 1: Synthetic FP sweep
// ------------------------------------------------------------------

console.log('Pre-generating synthetic wafers...');
const syntheticWafers = {};
for (const g of GRID_SIZES) {
  syntheticWafers[g] = {};
  for (const f of FAIL_RATES) {
    const rng = mulberry32(g * 1000 + Math.round(f * 10000));
    syntheticWafers[g][f] = Array.from({ length: REPLICATES }, () => generateRandomWafer(g, f, rng));
  }
}
console.log('Done.\n');

// fp[gate][gridSize][failRate] = { regionalFP, total }
const fp = {};
for (const gate of GATE_VALUES) {
  fp[gate] = {};
  for (const g of GRID_SIZES) {
    fp[gate][g] = {};
    for (const f of FAIL_RATES) fp[gate][g][f] = { regionalFP: 0, total: 0 };
  }
}

for (const gate of GATE_VALUES) {
  let processed = 0;
  for (const g of GRID_SIZES) {
    const pitch = DIAMETER / g;
    for (const f of FAIL_RATES) {
      const cell = fp[gate][g][f];
      for (const dies of syntheticWafers[g][f]) {
        let result;
        try {
          result = buildWaferMap({
            results: dies,
            waferConfig: { diameter: DIAMETER },
            dieConfig: { width: pitch, height: pitch },
          });
        } catch { continue; }
        cell.total++;
        let summary;
        try {
          summary = analyzeWaferMap(result, { passBins: [1], minimumRegionExcessFails: gate });
        } catch { continue; }
        if (summary.findings.some(f => REGIONAL_FAMILIES.has(f.comparison.family))) cell.regionalFP++;
        processed++;
      }
    }
  }
  process.stderr.write(`  FP sweep gate=${gate}: ${processed} processed\n`);
}

// ------------------------------------------------------------------
// Part 2: WM-811K rescue rate at each gate value
// ------------------------------------------------------------------

// rescue[gate] = { classifierDetected, rescuedAny, rescuedMatch, missTotal, realPatternTotal }
const rescue = {};
for (const gate of GATE_VALUES) {
  rescue[gate] = { classifierDetected: 0, rescuedAny: 0, rescuedMatch: 0, missTotal: 0, realPatternTotal: 0 };
}

// Stream WM-811K once per gate value to avoid buffering all entries in memory
for (const gate of GATE_VALUES) {
  const r = rescue[gate];
  let wm811kProcessed = 0;

  await new Promise((resolve, reject) => {
    const py = spawn(VENV_PY, ['-c', PY_SCRIPT, NPZ_PATH]);
    const rl = createInterface({ input: py.stdout });
    py.stderr.on('data', d => process.stderr.write(d));
    py.on('error', reject);
    py.on('close', code => code === 0 ? resolve() : reject(new Error(`Python exited ${code}`)));

    rl.on('line', line => {
      if (!line) return;
      let entry;
      try { entry = JSON.parse(line); } catch { return; }

      const expected = LABEL_MAP[entry.f];
      if (expected === undefined) return;
      if (expected === 'none' || expected === 'random') return;

      const pitchX = entry.c > 0 ? 300 / entry.c : 10;
      const pitchY = entry.r > 0 ? 300 / entry.r : 10;
      let result;
      try {
        result = buildWaferMap({
          results: entry.d,
          waferConfig: { diameter: 300 },
          dieConfig: { width: pitchX, height: pitchY },
        });
      } catch { return; }

      r.realPatternTotal++;
      const c = classifyPattern(result.dies, result.wafer, { passBins: [1], ringCount: 4 });
      const classifierFired = (c?.pattern ?? 'none') !== 'none' && (c?.pattern ?? 'none') !== 'random';
      if (classifierFired) { r.classifierDetected++; return; }

      r.missTotal++;
      let summary;
      try {
        summary = analyzeWaferMap(result, { passBins: [1], minimumRegionExcessFails: gate });
      } catch { return; }

      const families = summary.findings.map(f => f.comparison.family).filter(f => REGIONAL_FAMILIES.has(f));
      if (families.length > 0) r.rescuedAny++;
      if (families.some(f => (SEMANTIC_FAMILIES[expected] ?? []).includes(f))) r.rescuedMatch++;

      wm811kProcessed++;
      if (wm811kProcessed % 2000 === 0) process.stderr.write(`  WM-811K gate=${gate}: ${wm811kProcessed} processed\n`);
    });
  });
  process.stderr.write(`  WM-811K gate=${gate}: done\n`);
}

// ------------------------------------------------------------------
// Report
// ------------------------------------------------------------------

const FR_LABELS = FAIL_RATES.map(f => `${Math.round(f * 100)}%`);
const colW = 9;

console.log('\n' + '═'.repeat(72));
console.log('PART 1 — SYNTHETIC FP RATE  (marginal across grid sizes)');
console.log('Regional analysis only, i.i.d. random failures, N=' + REPLICATES + '/cell');
console.log('─'.repeat(72));
process.stdout.write('Gate'.padEnd(8));
for (const fl of FR_LABELS) process.stdout.write(('fail=' + fl).padEnd(colW));
console.log();
console.log('─'.repeat(72));
for (const gate of GATE_VALUES) {
  process.stdout.write(String(gate).padEnd(8));
  for (const f of FAIL_RATES) {
    const totN  = GRID_SIZES.reduce((a, g) => a + fp[gate][g][f].total, 0);
    const totFP = GRID_SIZES.reduce((a, g) => a + fp[gate][g][f].regionalFP, 0);
    process.stdout.write(pct(totFP, totN).padEnd(colW));
  }
  console.log();
}
console.log('─'.repeat(72));

console.log('\n' + '═'.repeat(72));
console.log('PART 2 — WM-811K RESCUE RATE  (classifier misses only)');
console.log('─'.repeat(72));
console.log('Gate'.padEnd(8) + 'Any rescue'.padEnd(16) + 'Match rescue'.padEnd(16) + 'Combined (any)'.padEnd(18) + 'Combined (match)');
console.log('─'.repeat(72));
for (const gate of GATE_VALUES) {
  const r = rescue[gate];
  const combinedAny   = r.classifierDetected + r.rescuedAny;
  const combinedMatch = r.classifierDetected + r.rescuedMatch;
  console.log(
    String(gate).padEnd(8) +
    `${r.rescuedAny}/${r.missTotal} = ${pct(r.rescuedAny, r.missTotal)}`.padEnd(16) +
    `${r.rescuedMatch}/${r.missTotal} = ${pct(r.rescuedMatch, r.missTotal)}`.padEnd(16) +
    `${pct(combinedAny, r.realPatternTotal)}`.padEnd(18) +
    `${pct(combinedMatch, r.realPatternTotal)}`,
  );
}
console.log('─'.repeat(72));
