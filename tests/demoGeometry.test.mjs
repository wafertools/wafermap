// The demo lots' generator (docs/examples/data/generate-demos.js) at a wafer size of its own.
//
// tsmap cuts its sample lots at different wafer and die sizes (`--geometry`). A lot must read as the same lot at any size: the same
// pattern, the same share of failing dies. Scaling the patterns by the wafer radius alone did not do that — a coarse wafer's outermost
// dies sit further inside the rim, so the edge-ring lot lost about a third of its failures and its pattern stopped being found.
// The default geometry must not move at all: the committed CSVs, the docs and other tests are built on it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'examples', 'data');
const NAMES = ['edge-ring', 'parametric', 'cluster', 'high-yield'];

function generate(...geometry) {
  const out = mkdtempSync(join(tmpdir(), 'wmap-demos-'));
  const args = [join(DATA_DIR, 'generate-demos.js'), '--out', out];
  for (const g of geometry) args.push('--geometry', g);
  execFileSync('node', args, { stdio: 'ignore' });
  return out;
}

/** The share of dies that are not hard bin 1, and the dies per wafer. */
function failShare(dir, name) {
  const [head, ...rows] = readFileSync(join(dir, `${name}.csv`), 'utf8').trim().split('\n');
  const bin = head.split(',').indexOf('hbin');
  const wafer = head.split(',').indexOf('wafer');
  const failing = rows.filter(r => r.split(',')[bin] !== '1').length;
  return { share: failing / rows.length, perWafer: rows.length / new Set(rows.map(r => r.split(',')[wafer])).size };
}

test('the default geometry reproduces the committed demo lots exactly', () => {
  const out = generate();
  try {
    for (const name of NAMES) {
      assert.equal(readFileSync(join(out, `${name}.csv`), 'utf8'), readFileSync(join(DATA_DIR, `${name}.csv`), 'utf8'), `${name}.csv`);
    }
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('the edge-ring lot keeps its share of failing dies on a coarse wafer', () => {
  const fine = generate();
  const coarse = generate('edge-ring=300:10x8');
  try {
    const a = failShare(fine, 'edge-ring');
    const b = failShare(coarse, 'edge-ring');
    assert.ok(b.perWafer < a.perWafer / 1.3, `a coarser wafer has fewer dies (${b.perWafer} against ${a.perWafer})`);
    // Sampling noise on ~6,400 dies is about 6%; the bias this guards against was about 31%.
    assert.ok(b.share > a.share * 0.85 && b.share < a.share * 1.15, `failing share ${(100 * b.share).toFixed(2)}% against ${(100 * a.share).toFixed(2)}%`);
  } finally { rmSync(fine, { recursive: true, force: true }); rmSync(coarse, { recursive: true, force: true }); }
});

test('a geometry given for one lot leaves the others as they were', () => {
  const out = generate('edge-ring=300:10x8');
  try {
    for (const name of ['parametric', 'cluster', 'high-yield']) {
      assert.equal(readFileSync(join(out, `${name}.csv`), 'utf8'), readFileSync(join(DATA_DIR, `${name}.csv`), 'utf8'), `${name}.csv`);
    }
  } finally { rmSync(out, { recursive: true, force: true }); }
});
