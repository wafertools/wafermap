// Pass bins have ONE default, and it is checked.
//
// `[1]` applies when an input states no pass bins, in `buildWaferMap` only (`normalizePassBins`). Anywhere else a
// default would count a failing bin as a pass for a user who stated their own: with pass bins "3, 5", bin 1 is a
// fail bin and a surface that falls back to `[1]` reports a wrong yield with nothing to say so.
//
// Three layers hold this, and each is tested here:
//   1. the run-time functions: the default is applied once, and a missing value downstream is refused, not guessed;
//   2. the build check (`scripts/check-pass-bin-defaults.mjs`), shown to catch every form the default has taken;
//   3. the library as it stands passes that check.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { normalizePassBins, requirePassBins, itemPassBins, passBinsLabel } from '../dist/packages/core/passBins.js';
import { buildWaferMap } from '../dist/index.js';
import { defaultRingCount, requireRingCount, itemRingCount } from '../dist/packages/core/ringCount.js';
import { findViolations, libraryFiles, stripComments, DEFINITION_FILE, ENTRY_POINT_FILE, RING_DEFINITION_FILE } from '../scripts/check-pass-bin-defaults.mjs';

// ── 1. The functions ─────────────────────────────────────────────────────────

test('the default applies only to an input that states no pass bins', () => {
  assert.deepEqual(normalizePassBins(undefined), [1]);
  assert.deepEqual(normalizePassBins([3, 5]), [3, 5], 'stated pass bins are kept exactly');
  assert.deepEqual(normalizePassBins([]), [], 'an empty list is a statement (nothing passes), not an absence');
});

test('normalizePassBins hands back a copy, so one wafer cannot change another\'s', () => {
  const a = normalizePassBins(undefined), b = normalizePassBins(undefined);
  a.push(9);
  assert.deepEqual(b, [1]);
  const stated = [3, 5];
  assert.notEqual(normalizePassBins(stated), stated);
});

test('buildWaferMap states the default once, on the result, and keeps what the input states', () => {
  const build = (extra) => buildWaferMap({
    results: [{ x: 0, y: 0, hbin: 1 }, { x: 1, y: 0, hbin: 3 }, { x: 2, y: 0, hbin: 5 }],
    waferConfig: { diameter: 40 }, dieConfig: { width: 10, height: 10 }, ...extra,
  });
  assert.deepEqual(build({}).passBins, [1]);
  assert.deepEqual(build({ passBins: [3, 5] }).passBins, [3, 5]);
  assert.equal(build({ passBins: [3, 5] }).yield.yieldPercent.toFixed(1), '66.7', 'bin 1 fails, 3 and 5 pass: 2 of 3');
});

test('downstream, pass bins that are missing are refused with a message that says where', () => {
  assert.throws(() => requirePassBins({}, 'the Plot tab'), /the Plot tab: no pass bins/);
  assert.throws(() => requirePassBins(undefined, 'x'), /no pass bins/);
  assert.throws(() => itemPassBins({}), /no pass bins/, 'no built-in fallback inside itemPassBins');
  assert.deepEqual([...requirePassBins({ passBins: [3, 5] }, 'x')], [3, 5]);
});

test('itemPassBins takes a fallback only from the caller, and the item\'s own wins', () => {
  assert.deepEqual([...itemPassBins({}, [2])], [2]);
  assert.deepEqual([...itemPassBins({ passBins: [3, 5] }, [2])], [3, 5]);
});

test('passBinsLabel names no pass bins when there are no wafers, rather than naming bin 1', () => {
  assert.equal(passBinsLabel([]), 'no wafers');
  assert.equal(passBinsLabel([[3, 5]]), 'bins 3, 5');
});

// ── 2. The check catches each form ───────────────────────────────────────────

const lib = (text, path = 'packages/stats/example.ts') => findViolations([{ path, text }]);
const definition = (text) => findViolations([{ path: DEFINITION_FILE, text }]);

test('the check catches a default in every form the default has taken', () => {
  const forms = {
    'a destructuring default':          'const { passBins = [1], ringCount } = params;',
    'a parameter default':              'function f(items: X[], passBins: readonly number[] = [1]) {}',
    'a nullish fallback':               'const bins = result.passBins ?? [1];',
    'a logical-or fallback':            'const bins = options.passBins || [1];',
    'an object literal':                'const o = { passBins: [1], testDefs };',
    'a spaced literal':                 'passBins = [ 1 ]',
    'the private constant, re-used':    'const bins = INPUT_DEFAULT_PASS_BINS;',
    'the default applied elsewhere':    'const bins = normalizePassBins(input.passBins);',
  };
  for (const [name, text] of Object.entries(forms)) assert.equal(lib(text).length, 1, `${name}: ${text}`);
});

test('the check leaves alone what is not a pass-bin default', () => {
  const fine = [
    'const first = m[1];',
    'const x = pair[1] - other[1];',
    'const mult = decades < 3 ? [1, 2, 5] : [1];',
    '// passBins defaults to [1] only in buildWaferMap',
    '/* the old `passBins = [1]` default is gone */',
    '/**\n * `passBins ?? [1]` was how every surface judged by bin 1\n */',
    'const bins = requirePassBins(result, "x");',
    'const passBins = [...result.passBins];',
  ];
  for (const text of fine) assert.deepEqual(lib(text), [], text);
});

test('only buildWaferMap may apply the default', () => {
  const call = 'passBins: normalizePassBins(input.passBins),';
  assert.deepEqual(findViolations([{ path: ENTRY_POINT_FILE, text: call }]), []);
  assert.equal(lib(call).length, 1);
});

test('the definition file holds exactly one [1], the constant', () => {
  assert.deepEqual(definition('const INPUT_DEFAULT_PASS_BINS = [1];'), []);
  assert.equal(definition('const INPUT_DEFAULT_PASS_BINS = [1];\nconst other = [1];').length, 1, 'a second literal');
  assert.equal(definition('const nothing = 2;').length, 1, 'none');
});

test('comments are blanked without disturbing the lines around them', () => {
  const s = stripComments('a\n/* b\n c */ d\n// e\nf');
  assert.equal(s.split('\n').length, 5);
  assert.ok(/d/.test(s) && !/[bce]/.test(s.replace(/\s/g, '').replace('a', '').replace('d', '').replace('f', '')));
});

// ── 3. The library passes ────────────────────────────────────────────────────

test('the library has no pass-bin default outside the one place', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const files = libraryFiles(root);
  assert.ok(files.length > 100, 'the check reads the whole library');
  const problems = findViolations(files);
  assert.deepEqual(problems.map(p => `${p.path}:${p.line} ${p.rule}`), []);
});

// ── The ring count follows the same rule ─────────────────────────────────────

test('the ring count default applies once, in buildWaferMap, and is refused when missing downstream', () => {
  const build = (extra) => buildWaferMap({
    results: [{ x: 0, y: 0, hbin: 1 }, { x: 1, y: 0, hbin: 1 }],
    waferConfig: { diameter: 40 }, dieConfig: { width: 10, height: 10 }, ...extra,
  });
  assert.equal(build({}).ringCount, defaultRingCount());
  assert.equal(build({ ringCount: 6 }).ringCount, 6, 'a stated ring count is kept');
  assert.throws(() => requireRingCount({}, 'the ring plot'), /the ring plot: no ring count/);
  assert.throws(() => itemRingCount({}), /no ring count/);
  assert.equal(itemRingCount({}, 3), 3, 'a fallback only from a caller who holds one');
  assert.equal(itemRingCount({ ringCount: 6 }, 3), 6, 'the item\'s own wins');
});

test('the check catches a ring count default in every form, and leaves other 4s alone', () => {
  const forms = [
    'const { ringCount = 4, passBins } = params;',
    'const n = options.ringCount ?? 4;',
    'const ctx = { ringCount: 4, testDefs };',
    'function f(wafer: Wafer, ringCount: number = 4) {}',
    'const n = defaultRingCount();',
  ];
  for (const text of forms) assert.equal(lib(text).length, 1, text);
  const fine = ['const sectors = 4;', 'const q = quadrants[4];', 'const rank = r.get(k) ?? 4;', 'const x = 0.4 + ringCount;', '// ringCount = 4 by default in buildWaferMap'];
  for (const text of fine) assert.deepEqual(lib(text), [], text);
  assert.deepEqual(findViolations([{ path: ENTRY_POINT_FILE, text: 'ringCount: defaultRingCount(),' }]), []);
  assert.deepEqual(findViolations([{ path: RING_DEFINITION_FILE, text: 'const INPUT_DEFAULT_RING_COUNT = 4;' }]), []);
  assert.equal(findViolations([{ path: RING_DEFINITION_FILE, text: 'const a = 4;\nconst b = 4;' }]).length, 1);
});
