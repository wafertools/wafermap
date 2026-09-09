// The statistical thresholds live in two places — the resolved defaults and the
// severity ladder in `packages/stats/analyzeWaferMap.ts`, and the numbers quoted
// throughout `docs/api.md` §7.3/§7.3.1. Nothing tied them together, and they
// silently disagreed for three months: commit 955ebc9 (v0.12.8, 2026-06-02)
// retuned every gate and the docs kept the old values, including a worked
// example describing a finding the code rejects. A reader deciding whether their
// wafer *should* have produced a finding got the wrong answer.
//
// Reading numbers out of prose is ugly, but the alternative — trusting a human
// to update six scattered sentences — is what already failed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = fs.readFileSync(path.join(root, 'packages/stats/analyzeWaferMap.ts'), 'utf8');
const docs   = fs.readFileSync(path.join(root, 'docs/api.md'), 'utf8');
// guide.md restates the same ladder in its own words and drifted further than
// api.md did — it still carried the pre-0.12.8 minimumRelativeEffect of 0.5.
// Both documents are checked, or fixing one just moves the problem.
const guide  = fs.readFileSync(path.join(root, 'docs/guide.md'), 'utf8');

/** The value the code actually resolves a default option to. */
function codeDefault(name) {
  const m = new RegExp(`^\\s*${name}:\\s*([0-9.]+)\\s*,`, 'm').exec(source);
  assert.ok(m, `no default for ${name} in analyzeWaferMap.ts — was it renamed?`);
  return Number(m[1]);
}

/** The severity ladder's four numeric gates, read from severityForFinding. */
function severityGates() {
  const body = /function severityForFinding\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(source);
  assert.ok(body, 'severityForFinding not found — was it renamed or moved?');
  const grab = (sev) => {
    const line = new RegExp(`if \\(pValue <= ([0-9.]+) && \\(absDelta >= ([0-9.]+) \\|\\| absRel >= ([0-9.]+)\\)\\) return '${sev}'`)
      .exec(body[1]);
    assert.ok(line, `severityForFinding no longer has a recognisable '${sev}' branch`);
    return { p: Number(line[1]), delta: Number(line[2]), rel: Number(line[3]) };
  };
  return { unusual: grab('unusual'), notable: grab('notable') };
}

test('docs/api.md quotes the analysis thresholds the code actually uses', () => {
  const minEffect = codeDefault('minimumEffectSize');
  const minRel    = codeDefault('minimumRelativeEffect');
  const alpha     = codeDefault('significanceLevel');

  // Compare parsed numbers, not literals: the code writes 0.20 and JS parses it
  // to 0.2, while the docs legitimately write either.
  const docNum = (re, what) => {
    const m = re.exec(docs);
    assert.ok(m, `could not find ${what} in docs/api.md — was it reworded?`);
    return Number(m[1]);
  };
  const near = (a, b) => Math.abs(a - b) < 1e-9;

  const sites = [
    // No AnalyzeWaferMapOptions entry to check since 0.27.0 — these stopped being
    // callable options. §7.3.2 still documents the values, and must stay right.
    [/\| `minimumEffectSize` \| `([0-9.]+)` \|/,
     "the threshold table's minimumEffectSize row", minEffect],
    [/absolute `\|delta\| ≥ minimumEffectSize` \(([0-9.]+) by default\)/,
     'the effect-size gate', minEffect],
    [/\|effectSize\| ≥ ([0-9.]+)/,
     'the test-value Cohen\'s d gate', minEffect],
    [/\| `minimumRelativeEffect` \| `([0-9.]+)` \|/,
     "the threshold table's minimumRelativeEffect row", minRel],
    [/\| `significanceLevel` \| `([0-9.]+)` \|/,
     "the threshold table's significanceLevel row", alpha],
  ];
  for (const [re, what, expected] of sites) {
    const got = docNum(re, what);
    assert.ok(near(got, expected), `${what} says ${got}, the code uses ${expected}`);
  }

  const { unusual, notable } = severityGates();
  const row = (sev) => {
    const m = new RegExp(`\\| \`${sev}\` \\| ≤ ([0-9.]+) \\| ≥ ([0-9.]+) \\| ≥ ([0-9.]+)× background \\|`).exec(docs);
    assert.ok(m, `the severity table has no recognisable '${sev}' row`);
    return { p: Number(m[1]), delta: Number(m[2]), rel: Number(m[3]) };
  };
  for (const [sev, code] of [['unusual', unusual], ['notable', notable]]) {
    const doc = row(sev);
    assert.ok(near(doc.p, code.p) && near(doc.delta, code.delta) && near(doc.rel, code.rel),
      `the severity table's '${sev}' row says p ≤ ${doc.p}, δ ≥ ${doc.delta}, rel ≥ ${doc.rel}× `
      + `but the code uses p ≤ ${code.p}, δ ≥ ${code.delta}, rel ≥ ${code.rel}×`);
  }
});

test('the docs\' worked example of the relative-effect gate actually passes that gate', () => {
  // The previous example — 2pp on a 3% background — is a 67% elevation, which is
  // BELOW the 1.0 default and so produces no finding, while the prose called it
  // "statistically and practically significant". An example that the library
  // would reject teaches the rule backwards.
  const minRel = codeDefault('minimumRelativeEffect');
  const minEffect = codeDefault('minimumEffectSize');
  const m = /with a (\d+)% background failure rate a (\d+) percentage-point increase is a (\d+)% relative elevation/.exec(docs);
  assert.ok(m, 'the relative-effect worked example is missing or was reworded');
  const [, bg, pp, claimed] = m.map(Number);

  const actual = (pp / bg) * 100;
  assert.ok(Math.abs(actual - claimed) < 1,
    `the example says ${claimed}% elevation but ${pp}pp on ${bg}% is ${actual.toFixed(0)}%`);
  assert.ok(actual / 100 >= minRel,
    `the example (${actual.toFixed(0)}%) must clear minimumRelativeEffect (${minRel * 100}%) or it describes a finding the code rejects`);
  assert.ok(pp / 100 < minEffect,
    'the example must fall below the absolute gate, or it does not demonstrate the relative one');
});

test('docs/api.md quotes the test-count cap the code actually applies', () => {
  // These two statements sat in the same document contradicting each other —
  // §7.3 said 100, §7.3.2 said 250 — with only one of them right.
  const m = /const TEST_COUNT_WARN_THRESHOLD = (\d+);/.exec(source);
  assert.ok(m, 'TEST_COUNT_WARN_THRESHOLD not found — was it renamed?');
  const cap = Number(m[1]);

  const inline = /all tests up to (\d+) — beyond that analysis is skipped/.exec(docs);
  assert.ok(inline, 'the testNumbers option comment no longer states the cap');
  assert.equal(Number(inline[1]), cap,
    `the testNumbers option comment says ${inline[1]}, the code caps at ${cap}`);

  const prose = /auto-skipped if the data contains more than (\d+) distinct tests/.exec(docs);
  assert.ok(prose, 'the test-count-capped explanation no longer states the cap');
  assert.equal(Number(prose[1]), cap,
    `the test-count-capped explanation says ${prose[1]}, the code caps at ${cap}`);
});

test('docs/guide.md quotes the same severity ladder as the code', () => {
  const { unusual, notable } = severityGates();
  const row = (sev) => {
    const m = new RegExp(`\\| \`${sev}\` \\| ≤ ([0-9.]+) \\| ≥ ([0-9.]+) \\| ≥ ([0-9.]+)× background \\|`).exec(guide);
    assert.ok(m, `docs/guide.md has no recognisable '${sev}' severity row`);
    return { p: Number(m[1]), delta: Number(m[2]), rel: Number(m[3]) };
  };
  for (const [sev, code] of [['unusual', unusual], ['notable', notable]]) {
    const doc = row(sev);
    assert.ok(Math.abs(doc.p - code.p) < 1e-9 && Math.abs(doc.delta - code.delta) < 1e-9
              && Math.abs(doc.rel - code.rel) < 1e-9,
      `docs/guide.md's '${sev}' row says p ≤ ${doc.p}, δ ≥ ${doc.delta}, rel ≥ ${doc.rel}× `
      + `but the code uses p ≤ ${code.p}, δ ≥ ${code.delta}, rel ≥ ${code.rel}×`);
  }
});

test('docs/guide.md states the effect-size gates the code uses', () => {
  const minEffect = codeDefault('minimumEffectSize');
  const minRel    = codeDefault('minimumRelativeEffect');
  const abs = /absolute `\|delta\| ≥ ([0-9.]+)`/.exec(guide);
  assert.ok(abs, "docs/guide.md no longer states the absolute effect-size gate");
  assert.ok(Math.abs(Number(abs[1]) - minEffect) < 1e-9,
    `docs/guide.md says the absolute gate is ${abs[1]}, the code uses ${minEffect}`);
  const rel = /relative `\|delta \/ background\| ≥ ([0-9.]+)`/.exec(guide);
  assert.ok(rel, "docs/guide.md no longer states the relative effect-size gate");
  assert.ok(Math.abs(Number(rel[1]) - minRel) < 1e-9,
    `docs/guide.md says the relative gate is ${rel[1]}, the code uses ${minRel}`);
});
