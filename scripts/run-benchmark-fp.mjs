/**
 * False positive rate: how often do we flag a pattern on wafers with
 * ground-truth label 'Random' or 'none' (no real pattern)?
 *
 * Usage: node scripts/run-benchmark-fp.mjs [path-to.npz]
 */
import { spawn }           from 'child_process';
import { createInterface } from 'readline';
import { buildWaferMap }   from '../dist/index.js';
import { classifyPattern } from '../dist/packages/stats/patternClassification.js';
import { analyzeWaferMap } from '../dist/packages/stats/analyzeWaferMap.js';

const NPZ_PATH = process.argv[2] ?? './tests/fixtures/wm811k-benchmark.npz';
const VENV_PY  = './.venv/bin/python3';

const LABEL_MAP = {
  'Center':    'center',    'Donut':     'donut',
  'Edge-Loc':  'edge-local','Edge-Ring': 'edge-ring',
  'Loc':       'random',    'Near-full': 'near-full',
  'Random':    'random',    'Scratch':   'scratch',   'none': 'none',
};

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

let randomTotal = 0, classifierFP = 0, regionalFP = 0, combinedFP = 0, processed = 0;

console.log(`Benchmarking false positives on ${NPZ_PATH}...\n`);

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

    // Only interested in random/none ground truth
    if (expected !== 'random' && expected !== 'none') {
      processed++;
      return;
    }

    const pitchX = entry.c > 0 ? 300 / entry.c : 10;
    const pitchY = entry.r > 0 ? 300 / entry.r : 10;
    let result;
    try {
      result = buildWaferMap({
        results: entry.d,
        waferConfig: { diameter: 300 },
        dieConfig: { width: pitchX, height: pitchY },
      });
    } catch { processed++; return; }

    randomTotal++;

    const c = classifyPattern(result.dies, result.wafer, { passBins: [1], ringCount: 4 });
    const classifierFired = (c?.pattern ?? 'none') !== 'none' && (c?.pattern ?? 'none') !== 'random';
    if (classifierFired) classifierFP++;

    let summary;
    try { summary = analyzeWaferMap(result, { passBins: [1] }); } catch { processed++; return; }

    const regionalFired = summary.findings.some(f => REGIONAL_FAMILIES.has(f.comparison.family));
    if (regionalFired) regionalFP++;
    if (classifierFired || regionalFired) combinedFP++;

    processed++;
    if (processed % 2000 === 0) process.stderr.write(`  ${processed} processed...\n`);
  });
});

const pct = (n, d) => d > 0 ? (n / d * 100).toFixed(1) + '%' : 'n/a';

console.log('═'.repeat(60));
console.log('FALSE POSITIVE RATES  (ground truth: Random or none)');
console.log('═'.repeat(60));
console.log(`Random/none wafers       : ${randomTotal}`);
console.log();
console.log(`Classifier FP            : ${classifierFP}/${randomTotal} = ${pct(classifierFP, randomTotal)}`);
console.log(`Regional analysis FP     : ${regionalFP}/${randomTotal} = ${pct(regionalFP, randomTotal)}`);
console.log(`Combined FP              : ${combinedFP}/${randomTotal} = ${pct(combinedFP, randomTotal)}`);
console.log('═'.repeat(60));
