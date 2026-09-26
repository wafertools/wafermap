// A die's test values and verdicts are read only through core/dieTable.ts
// (`testValue`, `recordedVerdict` via `getTestPassStatus`, `dieHasValues`,
// `dieValueEntries`, `testsPresent`, …). A die built by buildWaferMap is linked
// to a column table and will not carry `testValues`/`testPass` objects at all,
// so a direct `die.testValues[n]` read would see "no data" on a real die: a
// wrong map, not a crash.
//
// The only other code that may touch these fields reads INPUT records
// (`DieResult`s) before any die exists: input cleaning, derived tests, the
// lot-stack collapse, and `attachData`. Their counts are pinned below, so a new
// access anywhere, including in those files, fails here and has to be looked at.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../packages/', import.meta.url).pathname;
const ACCESS = /\.(testValues|testPass)\b|\[['"](testValues|testPass)['"]\]/g;

const ALLOWED = {
  'core/dieTable.ts': 'the read-path itself',
  'renderer/buildWaferMap.ts': 21,          // input cleaning and its warning counts, lot-stack collapse, attachData
  'renderer/derivedTests/apply.ts': 7,      // derived tests evaluate input records
  'renderer/derivedTests/evaluate.ts': 2,   // `ctx.testPass(...)`, the expression context
};

function files(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return path.endsWith('.ts') && !path.endsWith('.test.ts') && !path.endsWith('.d.ts') ? [path] : [];
  });
}

/** Accesses outside comments. */
function accesses(src) {
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .split('\n').map(line => line.replace(/\/\/.*$/, '')).join('\n');
  const found = [];
  code.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(ACCESS)) found.push({ line: i + 1, text: line.trim() });
  });
  return found;
}

test('test values and verdicts are read only through core/dieTable.ts', () => {
  const problems = [];
  for (const path of files(ROOT)) {
    const rel = relative(ROOT, path);
    const found = accesses(readFileSync(path, 'utf8'));
    const allowed = ALLOWED[rel];
    if (typeof allowed === 'string' || found.length === (allowed ?? 0)) continue;
    problems.push(`${rel}: ${found.length} direct access(es), ${allowed ?? 0} allowed\n`
      + found.map(f => `    ${f.line}: ${f.text}`).join('\n'));
  }
  assert.deepEqual(problems, [], `Read die test data through core/dieTable.ts, not the fields:\n${problems.join('\n')}`);
});
