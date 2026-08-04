import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// AGENTS.md tells AI coding agents how to use this library. An agent guide that
// names a removed API is worse than no guide: agents follow it confidently, and
// the resulting code either fails to compile or — the expensive case — compiles
// and renders a wafer map that is quietly wrong.
//
// So the guide is treated as executable documentation: every claim that CAN be
// checked against the built types IS checked, on every CI run.
// ─────────────────────────────────────────────────────────────────────────────

const root  = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const guide = readFileSync(resolve(root, 'AGENTS.md'), 'utf8');

const run = (script, args = []) =>
  spawnSync(process.execPath, [resolve(root, 'scripts', script), ...args], { encoding: 'utf8' });

test('check-agents-guide passes against the built types', () => {
  const p = run('check-agents-guide.mjs');
  assert.equal(p.status, 0, (p.stdout || '') + (p.stderr || ''));
});

test('docs/agents.md is regenerated from AGENTS.md', () => {
  const p = run('build-agents-page.mjs', ['--check']);
  assert.equal(p.status, 0, (p.stdout || '') + (p.stderr || ''));
});

test('the copy-paste rules block is present and self-contained', () => {
  const m = guide.match(/<!-- RULES:START -->([\s\S]*?)<!-- RULES:END -->/);
  assert.ok(m, 'RULES markers missing — the docs page generator extracts the block from them');

  const rules = m[1];
  // The block is pasted into someone else's agent config with no surrounding
  // context, so it has to name the package and stand alone.
  assert.match(rules, /@wafertools\/wafermap/, 'rules block never names the package');
  assert.ok(rules.length > 1500, 'rules block looks truncated');

  // Relative links would be dead once pasted elsewhere.
  const relative = [...rules.matchAll(/\]\((?!https?:)([^)]+)\)/g)].map(x => x[1]);
  assert.deepEqual(relative, [], `rules block has relative links that break when pasted: ${relative}`);
});

test('the guide states the traps that produce silently wrong maps', () => {
  // These are the specific wrong-but-plausible mistakes an agent makes unaided.
  // Losing any of them to an edit is a silent regression in the guide's value.
  const required = [
    /\?\?\s*0/,                       // missing bin is not bin 0
    /prober step positions/i,         // x/y are not millimetres
    /passBins/,                       // do not assume [1]
    /getTestPassStatus/,              // the only read path for functional verdicts
    /activeTest/,                     // test number, not index
    /camelCase/i,                     // PlotMode casing
    /getDieKey/,                      // die key format
    /inference\.warnings/,            // geometry mismatch is reported, not silent
    /testDefs/,                       // pass only the tests you will use
    /enableTestValueAnalysis/,        // the expensive opt-in
    /stats\.warnings/,                // the cap is reported here, not thrown
    /testNumbers/,                    // the escape hatch when past the cap
    /perWaferSummaries/,              // gallery reuse
    /pre-scan/i,                      // the recommended load shape
  ];
  for (const re of required) {
    assert.match(guide, re, `AGENTS.md no longer covers ${re}`);
  }
});

test('every removed API in the table has a stated replacement', () => {
  const rows = [...guide.matchAll(/^\| (`[^|]+?) \| ([^|]+?) \|$/gm)];
  assert.ok(rows.length >= 15, `expected the removal table, found ${rows.length} rows`);
  for (const [, never, use] of rows) {
    assert.ok(use.trim().length > 0, `no replacement given for ${never}`);
    assert.notEqual(never.trim(), use.trim(), `${never} maps to itself`);
  }
});

test('the guide obeys its own terminology rule', () => {
  // It forbids "channel" in user-facing text; it may quote the word in the rule.
  for (const m of guide.matchAll(/\bchannels?\b/gi)) {
    const around = guide.slice(Math.max(0, m.index - 60), m.index + 60);
    assert.match(around, /Never write|hardware jargon/,
      `AGENTS.md uses "${m[0]}" outside the rule forbidding it`);
  }
});

test('AGENTS.md and llms.txt are shipped in the npm package', () => {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  assert.ok(pkg.files.includes('AGENTS.md'), 'AGENTS.md missing from package.json files');
  assert.ok(pkg.files.includes('llms.txt'), 'llms.txt missing from package.json files');
});

test('llms.txt links resolve outside the repo', () => {
  // It ships in the npm package and the examples archive, where repo-relative
  // paths like docs/guide.md point at nothing.
  const llms = readFileSync(resolve(root, 'llms.txt'), 'utf8');
  const relative = [...llms.matchAll(/\]\((?!https?:)([^)]+)\)/g)].map(x => x[1]);
  assert.deepEqual(relative, [], `llms.txt has repo-relative links: ${relative}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// The user guide's toolbar tables are compiled into the app-embedded help modal,
// so drift there misleads the end user — the person least able to work out what
// is really on screen. They had drifted badly (rotate/flip listed as buttons
// long after they became menu rows; `aggr` filed under the wrong toolbar;
// `specRange` and `downloadAll` undocumented since May), which is what this
// guards against recurring.
// ─────────────────────────────────────────────────────────────────────────────

test('user-guide toolbar tables match the toolbars the code builds', () => {
  const p = run('check-toolbar-docs.mjs');
  assert.equal(p.status, 0, (p.stdout || '') + (p.stderr || ''));
});
