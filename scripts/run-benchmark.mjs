/**
 * Benchmark our spatial pattern classifier against labelled WM-811K wafers.
 * Usage: node scripts/run-benchmark.mjs [path/to/benchmark.json]
 *
 * Prints per-class precision/recall and overall accuracy.
 */
import { readFileSync } from 'fs';
import { buildWaferMap } from '../dist/index.js';
import { classifyPattern } from '../dist/packages/stats/patternClassification.js';

const BENCHMARK_PATH = process.argv[2] ?? './tests/fixtures/wm811k-benchmark.json';

// WM-811K label → our PatternLabel
const LABEL_MAP = {
  'Center':    'center',
  'Donut':     'donut',
  'Edge-Loc':  'edge-local',
  'Edge-Ring': 'edge-ring',
  'Loc':       'random',    // local cluster — maps loosely to random (we don't have 'local')
  'Near-full': 'near-full',
  'Random':    'random',
  'Scratch':   'scratch',
  'none':      'none',
};

console.log(`Loading ${BENCHMARK_PATH}...`);
const data = JSON.parse(readFileSync(BENCHMARK_PATH, 'utf8'));
console.log(`${data.length} labelled wafers\n`);

// confusion[expected][got] = count
const confusion = {};
const classes = [...new Set(Object.values(LABEL_MAP))].sort();
for (const a of classes) { confusion[a] = {}; for (const b of classes) confusion[a][b] = 0; }

let total = 0, correct = 0;
const errors = [];

for (const entry of data) {
  const expected = LABEL_MAP[entry.failureType];
  if (expected === undefined) continue;

  const pitchX = entry.gridCols > 0 ? 300 / entry.gridCols : 10;
  const pitchY = entry.gridRows > 0 ? 300 / entry.gridRows : 10;

  let result;
  try {
    result = buildWaferMap({
      results: entry.results,
      waferConfig: { diameter: 300 },
      dieConfig: { width: pitchX, height: pitchY },
    });
  } catch {
    continue;
  }

  const c = classifyPattern(result.dies, result.wafer, { passBins: [1], ringCount: 4 });
  const got = c?.pattern ?? 'none';

  if (confusion[expected] && confusion[expected][got] !== undefined) {
    confusion[expected][got]++;
  }
  total++;
  if (got === expected) correct++;
  else if (errors.length < 20) {
    errors.push({ failureType: entry.failureType, expected, got, confidence: c?.confidence, features: c?.features });
  }
}

// Per-class stats
console.log('Per-class results:');
console.log('─'.repeat(70));
console.log('Class'.padEnd(14) + 'Expected'.padEnd(10) + 'Correct'.padEnd(10) + 'Precision'.padEnd(12) + 'Recall');
console.log('─'.repeat(70));

for (const cls of classes) {
  const tp = confusion[cls]?.[cls] ?? 0;
  const totalExpected = Object.values(confusion[cls] ?? {}).reduce((a, b) => a + b, 0);
  const totalGot = classes.reduce((a, c) => a + (confusion[c]?.[cls] ?? 0), 0);
  const precision = totalGot > 0 ? tp / totalGot : 0;
  const recall    = totalExpected > 0 ? tp / totalExpected : 0;
  if (totalExpected === 0) continue;
  console.log(
    cls.padEnd(14) +
    String(totalExpected).padEnd(10) +
    String(tp).padEnd(10) +
    (precision * 100).toFixed(1).padEnd(12) + '%' +
    (recall * 100).toFixed(1) + '%',
  );
}

console.log('─'.repeat(70));
console.log(`\nOverall accuracy: ${correct}/${total} = ${(correct/total*100).toFixed(1)}%`);

// Show confusion matrix for misclassified
console.log('\nConfusion matrix (rows=expected, cols=got):');
const colW = 11;
process.stdout.write(''.padEnd(14));
for (const cls of classes) process.stdout.write(cls.slice(0,10).padEnd(colW));
console.log();
for (const exp of classes) {
  const row = confusion[exp];
  if (!row) continue;
  const rowTotal = Object.values(row).reduce((a, b) => a + b, 0);
  if (rowTotal === 0) continue;
  process.stdout.write(exp.padEnd(14));
  for (const got of classes) process.stdout.write(String(row[got] ?? 0).padEnd(colW));
  console.log();
}

if (errors.length) {
  console.log('\nSample misclassifications (first 20):');
  for (const e of errors) {
    const f = e.features;
    console.log(`  ${e.failureType} → got ${e.got} (${e.confidence})`);
    if (f) console.log(`    gRdd=${f.globalRdd.toFixed(2)} eRdd=${f.edgeRdd.toFixed(2)} cDist=${f.centroidDistNorm.toFixed(2)} minD=${f.minDistNorm.toFixed(2)} maxD=${f.maxDistNorm.toFixed(2)} ecc=${f.eccentricity.toFixed(2)} lin=${f.linearScore.toFixed(2)}`);
  }
}
