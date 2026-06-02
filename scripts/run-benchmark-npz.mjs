/**
 * Benchmark classifier against an npz wafer map dataset.
 * Streams wafers line-by-line from a Python subprocess to avoid memory limits.
 * Usage: node scripts/run-benchmark-npz.mjs [path-to.npz]
 */
import { spawn }        from 'child_process';
import { createInterface } from 'readline';
import { buildWaferMap }  from '../dist/index.js';
import { classifyPattern } from '../dist/packages/stats/patternClassification.js';

const NPZ_PATH = process.argv[2] ?? './tests/fixtures/wm811k-benchmark.npz';
const VENV_PY  = './.venv/bin/python3';

const LABEL_MAP = {
  'Center':    'center',  'Donut':     'donut',
  'Edge-Loc':  'edge-local', 'Edge-Ring': 'edge-ring',
  'Loc':       'random',  'Near-full': 'near-full',
  'Random':    'random',  'Scratch':   'scratch',  'none': 'none',
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

const classes = [...new Set(Object.values(LABEL_MAP))].sort();
const confusion = {};
for (const a of classes) { confusion[a] = {}; for (const b of classes) confusion[a][b] = 0; }
let total = 0, correct = 0, processed = 0;

console.log(`Benchmarking ${NPZ_PATH}...`);

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

    const c   = classifyPattern(result.dies, result.wafer, { passBins: [1], ringCount: 4 });
    const got = c?.pattern ?? 'none';
    if (confusion[expected]?.[got] !== undefined) confusion[expected][got]++;
    total++;
    if (got === expected) correct++;
    processed++;
    if (processed % 2000 === 0) process.stderr.write(`  ${processed} classified...\n`);
  });
});

// Results
const colW = 11;
console.log(`\nPer-class results:`);
console.log('─'.repeat(70));
console.log('Class'.padEnd(14)+'Expected'.padEnd(10)+'Correct'.padEnd(10)+'Precision'.padEnd(12)+'Recall');
console.log('─'.repeat(70));
for (const cls of classes) {
  const tp       = confusion[cls]?.[cls] ?? 0;
  const totalExp = Object.values(confusion[cls] ?? {}).reduce((a,b)=>a+b,0);
  const totalGot = classes.reduce((a,c)=>a+(confusion[c]?.[cls]??0),0);
  if (totalExp === 0) continue;
  const prec = totalGot > 0 ? tp/totalGot : 0;
  const rec  = totalExp > 0 ? tp/totalExp : 0;
  console.log(cls.padEnd(14)+String(totalExp).padEnd(10)+String(tp).padEnd(10)+(prec*100).toFixed(1).padEnd(12)+'%'+(rec*100).toFixed(1)+'%');
}
console.log('─'.repeat(70));
console.log(`\nOverall: ${correct}/${total} = ${(correct/total*100).toFixed(1)}%`);

console.log('\nConfusion matrix:');
process.stdout.write(''.padEnd(14));
for (const cls of classes) process.stdout.write(cls.slice(0,10).padEnd(colW));
console.log();
for (const exp of classes) {
  const row = confusion[exp];
  if (!row || Object.values(row).reduce((a,b)=>a+b,0)===0) continue;
  process.stdout.write(exp.padEnd(14));
  for (const got of classes) process.stdout.write(String(row[got]??0).padEnd(colW));
  console.log();
}
