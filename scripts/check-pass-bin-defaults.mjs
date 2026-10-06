#!/usr/bin/env node
// Bans a default for pass bins anywhere but the one place that applies it.
//
// Bin 1 passes ONLY when an input states no pass bins, and that happens once, in `buildWaferMap`
// (`normalizePassBins`, core/passBins.ts). Everywhere else the value arrives on the result and is read, never
// replaced. A user who states pass bins "3, 5" has made bin 1 a FAIL bin: any surface that falls back to `[1]`
// reports a wrong yield and says nothing, and a yield is what lots are dispositioned on.
//
// It has recurred in every round of development: first as a missing pass-through (0.31.0 fixed that and wrote the
// rule down), then as `?? [1]`, then as `passBins = [1]` parameter and destructuring defaults, which a search for
// `?? [1]` does not find. A rule in prose did not hold, so this makes it mechanical. It fails when, outside comments:
//
//   1. a `[1]` literal sits on the same line as `passBins` (`passBins = [1]`, `passBins ?? [1]`, `passBins: [1]`);
//   2. `INPUT_DEFAULT_PASS_BINS` is named outside core/passBins.ts (it is not exported; this catches a re-export);
//   3. `normalizePassBins(` is called anywhere but renderer/buildWaferMap.ts, the one entry point;
//   4. core/passBins.ts holds anything but exactly one `[1]` literal (the constant's own definition).
//
// The ring count follows the same rule (core/ringCount.ts, applied by `buildWaferMap` alone), so the same check fails on a
// `4` beside `ringCount` (`ringCount = 4`, `ringCount ?? 4`, `ringCount: 4`), on `defaultRingCount(` outside buildWaferMap,
// and on core/ringCount.ts holding anything but exactly one `4` literal.
//
// What it cannot see is a default written without the word `passBins` on the line. The compiler covers the rest:
// `passBins` is a required property of every item, option and result that carries it, so a missing one is a type
// error, and `requirePassBins` refuses at run time what a JavaScript caller leaves out (tests/passBinsDefault.test.mjs).
//
// Run:  node scripts/check-pass-bin-defaults.mjs   (wired into `npm run check`)
import { readFileSync, readdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve, join, relative } from 'path';

export const DEFINITION_FILE = 'packages/core/passBins.ts';
export const ENTRY_POINT_FILE = 'packages/renderer/buildWaferMap.ts';
export const RING_DEFINITION_FILE = 'packages/core/ringCount.ts';

/** Source with block comments and line comments blanked, so prose that names the banned form is not read as code. */
export function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, pre) => pre);
}

const LITERAL = /\[\s*1\s*\]/;
/** A bare `4`, not part of a longer number or a name (`[4]`, `x4`, `0.4`, `4.5`). */
const FOUR = /(?<![\w.\[])4(?![\w.\]])/;

/**
 * Every violation in `files` (`{ path, text }`, path relative to the repo root with `/` separators).
 * @returns {{ path: string, line: number, rule: string, text: string }[]}
 */
export function findViolations(files) {
  const out = [];
  for (const { path, text } of files) {
    const lines = stripComments(text).split('\n');
    const isDefinition = path === DEFINITION_FILE;
    const isRingDefinition = path === RING_DEFINITION_FILE;
    let definitionLiterals = 0, ringDefinitionLiterals = 0;
    lines.forEach((line, i) => {
      const at = (rule) => out.push({ path, line: i + 1, rule, text: line.trim() });
      if (isRingDefinition) { if (FOUR.test(line)) ringDefinitionLiterals++; }
      else if (/\bringCount\b/i.test(line) && FOUR.test(line)) at('a 4 beside ringCount: the ring count has no default here');
      if (isDefinition) { if (LITERAL.test(line)) definitionLiterals++; }
      else if (/\bpassBins\b/.test(line) && LITERAL.test(line)) at('a [1] literal beside passBins: pass bins have no default here');
      if (!isDefinition && /\bINPUT_DEFAULT_PASS_BINS\b/.test(line)) at('INPUT_DEFAULT_PASS_BINS is private to core/passBins.ts');
      if (path !== ENTRY_POINT_FILE && !isDefinition && /\bnormalizePassBins\s*\(/.test(line)) at('normalizePassBins applies the default and is called by buildWaferMap only');
      if (path !== ENTRY_POINT_FILE && !isRingDefinition && /\bdefaultRingCount\s*\(/.test(line)) at('defaultRingCount applies the default and is called by buildWaferMap only');
    });
    if (isRingDefinition && ringDefinitionLiterals !== 1) {
      out.push({ path, line: 0, rule: `core/ringCount.ts must hold exactly one 4 literal (the constant), found ${ringDefinitionLiterals}`, text: '' });
    }
    if (isDefinition && definitionLiterals !== 1) {
      out.push({ path, line: 0, rule: `core/passBins.ts must hold exactly one [1] literal (the constant), found ${definitionLiterals}`, text: '' });
    }
  }
  return out;
}

/** The library's own sources: packages/**\/*.ts, without tests and the generated guide. */
export function libraryFiles(root) {
  const out = [];
  (function walk(dir) {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'userGuideHtml.ts') {
        out.push({ path: relative(root, p).split('\\').join('/'), text: readFileSync(p, 'utf8') });
      }
    }
  })(resolve(root, 'packages'));
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const files = libraryFiles(root);
  const problems = findViolations(files);
  if (problems.length) {
    console.error(`pass-bin defaults: ${problems.length} violation${problems.length === 1 ? '' : 's'}\n`);
    for (const p of problems) console.error(`  ${p.path}${p.line ? `:${p.line}` : ''}  ${p.rule}${p.text ? `\n      ${p.text}` : ''}`);
    console.error('\nPass bins have ONE default, applied in buildWaferMap (core/passBins.ts normalizePassBins). Read the result\'s passBins; never replace them.');
    process.exit(1);
  }
  console.log(`pass-bin and ring-count defaults OK — ${files.length} files, the defaults live in core/passBins.ts and core/ringCount.ts only`);
}
