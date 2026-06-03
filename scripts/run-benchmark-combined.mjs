/**
 * Combined benchmark: spatial pattern classifier + regional analysis.
 *
 * For wafers where the pattern classifier misses (returns 'none' or 'random'
 * when a real pattern exists), we also run analyzeWaferMap and check whether
 * regional findings (ring, quadrant, sector, edge-arc, cluster) fire.
 *
 * Reports three detection rates:
 *   1. Classifier only   — baseline (reproduces the 86% figure)
 *   2. Combined (any)    — upper bound: any regional finding fires on a miss
 *   3. Combined (match)  — honest measure: finding family semantically matches
 *                          the true WM-811K label
 *
 * Usage: node scripts/run-benchmark-combined.mjs [path-to.npz]
 */
import { spawn }           from 'child_process';
import { createInterface } from 'readline';
import { buildWaferMap }   from '../dist/index.js';
import { classifyPattern } from '../dist/packages/stats/patternClassification.js';
import { analyzeWaferMap } from '../dist/packages/stats/analyzeWaferMap.js';

const NPZ_PATH = process.argv[2] ?? './tests/fixtures/wm811k-benchmark.npz';
const VENV_PY  = './.venv/bin/python3';

const LABEL_MAP = {
  'Center':    'center',
  'Donut':     'donut',
  'Edge-Loc':  'edge-local',
  'Edge-Ring': 'edge-ring',
  'Loc':       'random',
  'Near-full': 'near-full',
  'Random':    'random',
  'Scratch':   'scratch',
  'none':      'none',
};

// Which regional finding families are semantically consistent with each WM-811K label.
// A miss is counted as "matched" if any finding from one of these families fires.
const SEMANTIC_FAMILIES = {
  'center':     ['ring', 'cluster'],
  'donut':      ['ring', 'cluster'],
  'edge-local': ['edge-arc', 'cluster', 'ring', 'sector', 'quadrant'],
  'edge-ring':  ['ring', 'edge-arc'],
  'near-full':  ['ring'],
  'scratch':    ['cluster', 'edge-arc', 'sector', 'quadrant'],
  // random/none: no real pattern — regional findings on these are false positives
};

// Regional finding families (excludes 'spatial-pattern' which is the classifier itself
// and 'wafer'/'reticle-position'/'test-site' which are unrelated to spatial defect shape)
const REGIONAL_FAMILIES = new Set(['ring', 'quadrant', 'sector', 'edge-arc', 'cluster']);

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

// Counters
let total = 0, processed = 0;

// Wafers with a real pattern (excludes 'none' and 'random' ground truth)
let realPatternTotal = 0;

// Detection by classifier alone (pattern != 'none' and != 'random')
let classifierDetected = 0;

// Misses: real pattern, classifier returned none/random
let missTotal = 0;
// Of those misses, regional analysis rescued them
let rescuedAny   = 0;  // any regional finding fired
let rescuedMatch = 0;  // a semantically matching finding fired

// Per-label breakdown of misses and rescues
const perLabel = {};
for (const label of Object.keys(SEMANTIC_FAMILIES)) {
  perLabel[label] = { misses: 0, rescuedAny: 0, rescuedMatch: 0 };
}

console.log(`Benchmarking ${NPZ_PATH}...\n`);

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

    total++;

    const c   = classifyPattern(result.dies, result.wafer, { passBins: [1], ringCount: 4 });
    const got = c?.pattern ?? 'none';

    const isRealPattern = expected !== 'none' && expected !== 'random';
    const classifierFired = got !== 'none' && got !== 'random';

    if (isRealPattern) {
      realPatternTotal++;
      if (classifierFired) classifierDetected++;
    }

    // Only run regional analysis on misses for real patterns
    if (isRealPattern && !classifierFired) {
      missTotal++;
      if (perLabel[expected]) perLabel[expected].misses++;

      let summary;
      try {
        summary = analyzeWaferMap(result, { passBins: [1] });
      } catch { return; }

      const regionalFamilies = summary.findings
        .map(f => f.comparison.family)
        .filter(f => REGIONAL_FAMILIES.has(f));

      const anyFired   = regionalFamilies.length > 0;
      const matchFired = regionalFamilies.some(
        f => (SEMANTIC_FAMILIES[expected] ?? []).includes(f),
      );

      if (anyFired) {
        rescuedAny++;
        if (perLabel[expected]) perLabel[expected].rescuedAny++;
      }
      if (matchFired) {
        rescuedMatch++;
        if (perLabel[expected]) perLabel[expected].rescuedMatch++;
      }
    }

    processed++;
    if (processed % 1000 === 0) process.stderr.write(`  ${processed} processed...\n`);
  });
});

// ── Results ──────────────────────────────────────────────────────────────────

const pct = (n, d) => d > 0 ? (n / d * 100).toFixed(1) + '%' : 'n/a';

console.log('═'.repeat(72));
console.log('DETECTION RATES  (wafers with a real WM-811K pattern label)');
console.log('═'.repeat(72));
console.log(`Total wafers processed          : ${total}`);
console.log(`Wafers with real pattern label  : ${realPatternTotal}`);
console.log();
console.log(`Classifier only                 : ${classifierDetected}/${realPatternTotal} = ${pct(classifierDetected, realPatternTotal)}`);
console.log(`Combined — any regional finding : ${classifierDetected + rescuedAny}/${realPatternTotal} = ${pct(classifierDetected + rescuedAny, realPatternTotal)}`);
console.log(`Combined — matched finding      : ${classifierDetected + rescuedMatch}/${realPatternTotal} = ${pct(classifierDetected + rescuedMatch, realPatternTotal)}`);

console.log();
console.log('─'.repeat(72));
console.log('CLASSIFIER MISSES — regional rescue breakdown');
console.log('─'.repeat(72));
console.log(`Total classifier misses (real patterns) : ${missTotal}`);
console.log(`  Rescued by any regional finding       : ${rescuedAny}/${missTotal} = ${pct(rescuedAny, missTotal)}`);
console.log(`  Rescued by matched finding            : ${rescuedMatch}/${missTotal} = ${pct(rescuedMatch, missTotal)}`);

console.log();
console.log('Per-label breakdown (misses only):');
console.log('─'.repeat(72));
console.log('Label'.padEnd(14) + 'Misses'.padEnd(10) + 'Any rescue'.padEnd(14) + 'Match rescue');
console.log('─'.repeat(72));
for (const [label, counts] of Object.entries(perLabel)) {
  if (counts.misses === 0) continue;
  console.log(
    label.padEnd(14) +
    String(counts.misses).padEnd(10) +
    `${counts.rescuedAny} (${pct(counts.rescuedAny, counts.misses)})`.padEnd(14) +
    `${counts.rescuedMatch} (${pct(counts.rescuedMatch, counts.misses)})`,
  );
}
console.log('─'.repeat(72));
