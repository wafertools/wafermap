#!/usr/bin/env node
// Verifies AGENTS.md against the built type declarations.
//
// An agent guide that names a removed API is worse than no guide at all: agents
// follow it confidently and emit code that does not compile, or — far worse —
// code that compiles and silently produces a wrong wafer map. This file is the
// only thing standing between "the API moved" and "the guide now lies".
//
// Checks:
//   1. every symbol in the "Use instead" column really exists in dist/**/*.d.ts
//   2. every removed symbol that can be checked by name really is gone
//   3. structural claims hold — DieResult has no `values`, TestDef no `index`
//   4. the copy-paste RULES block markers are intact and non-empty
//
// Requires a build first (reads dist/). Run:  node scripts/check-agents-guide.mjs
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';

const root   = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST   = resolve(root, 'dist');
const AGENTS = resolve(root, 'AGENTS.md');

if (!existsSync(DIST)) {
  console.error('check-agents-guide: dist/ not found — run `npm run build` first.');
  process.exit(1);
}

const errors = [];
const fail = (m) => errors.push(m);

// ── Gather the public type surface ──────────────────────────────────────────

let types = '';
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.d.ts')) types += readFileSync(p, 'utf8') + '\n';
  }
})(DIST);

const guide = readFileSync(AGENTS, 'utf8');
const has = (sym) => new RegExp(`\\b${sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(types);

// ── 1. The copy-paste block is intact ───────────────────────────────────────

const block = guide.match(/<!-- RULES:START -->([\s\S]*?)<!-- RULES:END -->/);
if (!block) {
  fail('AGENTS.md: the <!-- RULES:START --> / <!-- RULES:END --> markers are missing — ' +
       'scripts/build-agents-page.mjs extracts the copy-paste block from them.');
} else if (block[1].trim().length < 500) {
  fail('AGENTS.md: the RULES block is suspiciously short — did an edit truncate it?');
}

// ── 2. Recommended symbols exist ────────────────────────────────────────────
//
// Names the guide tells an agent to reach for. If one of these disappears, the
// guide is actively steering agents at something that is not there.

const MUST_EXIST = [
  'buildWaferMap', 'renderWaferMap', 'renderWaferGallery', 'toCanvas', 'buildView',
  'analyzeWaferMap', 'analyzeWaferLot', 'createWafermapWorker',
  'getTestPassStatus', 'getDieKey', 'registerColorScheme',
  'testValues', 'testNumber', 'passFailDisplay', 'activeTest', 'passBins',
  'retestCount', 'retestPolicy', 'isLotStack', 'dieConfig', 'waferConfig',
  'BIN_PALETTE', 'WaferMapDisplayItem', 'RenderOptions', 'WaferMapController',
  'HitTarget', 'ViewOptions', 'WaferNotch', 'isInsideWafer', 'DieResult',
  // These are the CURRENT names of the geometry inputs. Worth pinning: an
  // internal note claimed they had been renamed to WaferOptions/DieOptions,
  // which do not exist — following that would send agents at a phantom type.
  'WaferConfig', 'DieConfig',
  // Scale guidance: the options an agent has to choose between deliberately.
  'testDefs', 'testNumbers', 'computePerTestStats', 'enableTestValueAnalysis',
  'perWaferSummaries', 'warnings',
];

const mentions = (sym) => new RegExp(`\\b${sym}\\b`).test(guide);

for (const sym of MUST_EXIST) {
  if (!has(sym)) fail(`AGENTS.md recommends '${sym}', which no longer exists in dist/**/*.d.ts`);
  // Word-boundary, not substring: 'getDieKey' must not be satisfied by a typo
  // like 'getDieKeyXYZ' sitting in the guide.
  if (!mentions(sym)) fail(`'${sym}' is checked but no longer mentioned in AGENTS.md — update one or the other`);
}

// ── 3. Removed symbols really are gone ──────────────────────────────────────
//
// Only names that are unambiguous when grepped. Deliberately excluded, because
// each still exists in a DIFFERENT legitimate role and a bare name match would
// produce a false failure:
//   values         — `testValues`, `aggregateValues`, jsdoc prose
//   colorBySpec    — removed as an INPUT option, retained as a View OUTPUT field
//   getDieAtPoint  — removed as a standalone export, retained on HitTarget
//   index          — far too generic
// Those three are covered structurally in step 4 instead.

// Derived from the guide's own removal table, not a second hand-maintained list.
// A duplicate list is how "the table says X is gone, the checker never looks at
// X" happens — the table is what an agent reads, so the table is what is checked.
const AMBIGUOUS = new Map([
  ['values',        'appears as testValues / aggregateValues and in prose'],
  ['colorBySpec',   'removed as an input option, retained as a View output field'],
  ['getDieAtPoint', 'removed as a standalone export, retained on HitTarget'],
  ['index',         'far too generic to grep'],
  ['flat',          'ordinary English word'],
  ['color',         'ordinary English word'],
]);

const tableRows = [...guide.matchAll(/^\| (`[^|]*?) \| ([^|]+?) \|$/gm)];
const MUST_BE_GONE = [];
for (const [, neverCell] of tableRows) {
  for (const m of neverCell.matchAll(/`([^`]+)`/g)) {
    // Cells hold things like `DieResult.values`, `colorScheme: 'color'`,
    // `buildScene` / `BuildSceneOptions`. Reduce each to a bare identifier.
    // For a `property: 'value'` pair it is the VALUE that was removed, not the
    // property — `plotMode` is very much still there, `'specLimit'` is not.
    const cell = m[1].includes(':')
      ? m[1].split(':').slice(1).join(':').trim().replace(/^['"]|['"]$/g, '')
      : m[1];
    const sym = cell.trim().split('.').pop();
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(sym)) continue;
    if (AMBIGUOUS.has(sym)) continue;
    if (!MUST_BE_GONE.includes(sym)) MUST_BE_GONE.push(sym);
  }
}

if (MUST_BE_GONE.length < 15) {
  fail(`only parsed ${MUST_BE_GONE.length} removed symbols from AGENTS.md's table — ` +
       `has the table's format changed? The checker reads it directly.`);
}

for (const sym of MUST_BE_GONE) {
  if (has(sym)) {
    fail(`AGENTS.md says '${sym}' was removed, but it is still in the public types — ` +
         `either it came back, or the guide's removal table is wrong`);
  }
}

// ── 3b. The guide invents nothing ───────────────────────────────────────────
//
// The reverse direction, and the one that actually catches rot: every API-looking
// identifier the rules block names must exist in the public types, or be listed
// as removed. Without this, a renamed symbol in the guide sails through — and an
// agent then emits a call to a function that was never there.

const removedSet = new Set(MUST_BE_GONE);

// Terms in the rules that are deliberately not API symbols: English words in
// code spans, string-literal values, npm/CLI words, and property names belonging
// to the consumer's own code rather than to ours.
const NOT_API = new Set([
  'markdown', 'true', 'false', 'null', 'undefined', 'number', 'string', 'boolean',
  'Record', 'die', 'result', 'x', 'y', 'flat', 'notch', 'values', 'index', 'grey',
  'hardBin', 'softBin', 'value', 'metadata', 'stackedValues', 'stackedBins',
  'stackedSoftBins', 'specLimit', 'spec', 'test', 'off', 'best', 'worst', 'mean',
  'default', 'color', 'P', 'F', 'N',
]);

const spans = [...rulesText().matchAll(/`([^`]+)`/g)].map(m => m[1]);
for (const raw of spans) {
  // Reduce `getDieKey(die)` / `foo()` / `Type.prop` to a bare identifier;
  // skip anything left that is an expression, literal, path or prose.
  const sym = raw.replace(/\(.*\)$/, '').replace(/^[A-Za-z]+\./, '');
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(sym)) continue;
  if (NOT_API.has(sym) || NOT_API.has(raw)) continue;
  if (removedSet.has(sym)) continue;                 // named precisely to warn against it
  if (/^[a-z]+$/.test(sym) && sym.length < 4) continue;

  if (!has(sym)) {
    fail(`AGENTS.md names '${raw}', which does not exist in dist/**/*.d.ts — ` +
         `either it is a typo or the API moved. Agents will emit this verbatim.`);
  }
}

function rulesText() { return block ? block[1] : guide; }

// ── 3c. Numbers quoted from the source ──────────────────────────────────────
//
// The guide states the test-count cap as a literal. A hardcoded number in prose
// is the classic stale fact, and this one matters: it is the threshold past which
// analyzeWaferMap stops returning test findings at all. Pin it to the constant.

const capSrc = resolve(root, 'packages/stats/analyzeWaferMap.ts');
if (existsSync(capSrc)) {
  const m = readFileSync(capSrc, 'utf8').match(/TEST_COUNT_WARN_THRESHOLD\s*=\s*(\d+)/);
  if (!m) {
    fail('could not find TEST_COUNT_WARN_THRESHOLD in packages/stats/analyzeWaferMap.ts — ' +
         'AGENTS.md quotes its value and can no longer be verified');
  } else if (!new RegExp(`\\b${m[1]}\\b`).test(rulesText())) {
    fail(`AGENTS.md must state the test-count cap as ${m[1]} (TEST_COUNT_WARN_THRESHOLD) — ` +
         `the quoted value is stale`);
  }
}

// ── 4. Structural claims ────────────────────────────────────────────────────

function propsOf(interfaceName) {
  const m = types.match(new RegExp(`interface ${interfaceName} \\{([\\s\\S]*?)\\n\\}`));
  if (!m) return null;
  return [...m[1].matchAll(/^\s+(\w+)\??[:(]/gm)].map(x => x[1]);
}

const structural = [
  ['DieResult', 'values',      'testValues'],
  ['DieResult', 'channel',     null],
  ['TestDef',   'index',       'testNumber'],
];

for (const [iface, banned, replacement] of structural) {
  const props = propsOf(iface);
  if (!props) { fail(`could not locate 'interface ${iface}' in dist/**/*.d.ts`); continue; }
  if (props.includes(banned)) {
    fail(`AGENTS.md says ${iface}.${banned} was removed, but it is declared` +
         (replacement ? ` (guide points agents at ${iface}.${replacement})` : ''));
  }
  if (replacement && !props.includes(replacement)) {
    fail(`AGENTS.md points agents at ${iface}.${replacement}, which ${iface} does not declare`);
  }
}

// colorBySpec: removed as an input, retained as a View output. Assert exactly that,
// since the guide's table makes the narrower claim.
const viewOpts = types.match(/interface ViewOptions \{([\s\S]*?)\n\}/);
if (viewOpts && /^\s+colorBySpec\??:/m.test(viewOpts[1])) {
  fail("AGENTS.md says ViewOptions.colorBySpec was removed, but it is declared on ViewOptions");
}

// ── 4c. Optionality claims ──────────────────────────────────────────────────
//
// Symbol existence is not enough. `result.warnings` is required and always an
// array; `summary.stats.warnings` is optional and is `undefined` on a clean
// wafer — which is most wafers. A guide that flattens the two into "both are
// WaferWarning[]" produces `summary.stats.warnings.length`, a TypeError that
// passes local testing (no warnings) and fails in production. That is the same
// silently-wrong-shape class as the string[] → WaferWarning[] change the guide
// already warns about, so it gets a checker rather than a comment.

/** Body of `name`'s declaration, brace-matched so nested objects survive. */
function blockOf(src, header) {
  const m = src.match(header);
  if (!m) return null;
  let i = src.indexOf('{', m.index);
  if (i < 0) return null;
  for (let depth = 0, j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(i + 1, j);
  }
  return null;
}

/**
 * 'required' | 'optional' | null for `prop` declared at the TOP level of `body`.
 *
 * Depth matters: WaferMapResult holds both a top-level `warnings: WaferWarning[]`
 * and, nested inside `inference`, the deprecated `warnings?: string[]` mirror. A
 * plain multiline regex finds the nested one first and reports the opposite
 * answer, so nested blocks are elided before matching.
 */
function optionality(body, prop) {
  if (body == null) return null;
  let flat = '', depth = 0;
  for (const ch of body) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (depth === 0) flat += ch;
  }
  const m = flat.match(new RegExp(`(?:^|\\n)\\s*${prop}(\\??):`));
  return m ? (m[1] ? 'optional' : 'required') : null;
}

const statsBody = blockOf(types, /interface StatsSummary\b/);

const OPTIONALITY = [
  // [label, interface body, property, expected, why it matters]
  ['WaferMapResult.warnings', blockOf(types, /interface WaferMapResult\b/), 'warnings', 'required',
   'the guide tells agents they can read it unguarded'],
  ['StatsSummary.stats.warnings', statsBody && blockOf(statsBody, /^\s*stats\s*:/m), 'warnings', 'optional',
   'the guide tells agents to reach for it with `?.`'],
];

for (const [label, body, prop, expected, why] of OPTIONALITY) {
  const actual = optionality(body, prop);
  if (actual === null) {
    fail(`could not locate '${label}' in dist/**/*.d.ts — AGENTS.md describes its ` +
         `optionality and can no longer be verified`);
  } else if (actual !== expected) {
    fail(`AGENTS.md assumes ${label} is ${expected}, but it is declared ${actual} — ` +
         `${why}, so the guidance is now wrong`);
  }
}

// The guide must actually carry the distinction, not merely happen to be
// consistent with it: an optional-chained read of stats.warnings has to appear.
if (!/summary\.stats\.warnings\?\./.test(rulesText())) {
  fail('AGENTS.md must show `summary.stats.warnings?.` — stats.warnings is optional ' +
       'and undefined on a clean wafer, so an unguarded read is a TypeError');
}

// ── 5. The terminology rule applies to the guide itself ─────────────────────

const rules = block ? block[1] : guide;
for (const m of rules.matchAll(/\bchannels?\b/gi)) {
  // The rule forbidding the word is allowed to quote it.
  const around = rules.slice(Math.max(0, m.index - 60), m.index + 60);
  if (!/Never write|hardware jargon/.test(around)) {
    fail(`AGENTS.md uses the word "${m[0]}" outside the rule that forbids it`);
  }
}

// ── Report ──────────────────────────────────────────────────────────────────

if (errors.length) {
  console.error(`agents guide check failed (${errors.length}):\n`);
  for (const e of errors) console.error('  • ' + e);
  console.error('');
  process.exit(1);
}

console.log(`agents guide OK — ${MUST_EXIST.length} recommended symbols present, ${MUST_BE_GONE.length} removed symbols absent`);
