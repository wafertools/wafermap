#!/usr/bin/env node
// Bans `Math.min(...xs)` / `Math.max(...xs)` in packages/.
//
// A spread passes one argument per element, and V8 throws
// `RangeError: Maximum call stack size exceeded` somewhere above ~131k of them
// (measured: 125,000 fine, 150,000 throws). Over a per-die array that is a bug
// which passes every fixture, every demo and every small wafer, and then fails
// outright on a production lot — the worst failure shape this library has.
//
// It had already bitten twice before this check existed:
//
//   - the histogram panel overflowed on a real 25 × ~10k-die lot, "taking the
//     whole Insights rebuild with it" (its `testValueExtent` comment records it);
//   - `buildWaferMap`'s `requiredRadius` could not build a 400k-die map at all,
//     and `aggregateValues`, `toCanvas`'s hit-grid fallback, both summary
//     reports and the scatter panel all carried the same latent fault.
//
// The first was fixed where it was found and the class was left in place, which
// is how the second happened. So the rule is blanket rather than case-by-case:
// **never spread into Math.min/Math.max — use `minOf`/`maxOf` from core/utils.**
// Whether a given array is bounded today stops being a question anyone has to
// get right, and stops being something a later change can quietly invalidate.
//
// `Math.min(a, b)` with ordinary arguments is untouched — only the spread form
// is banned.
//
// Run:  node scripts/check-spread-limits.mjs   (wired into `npm run check`)
import { readFileSync, readdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve, join, relative } from 'path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKGS = resolve(root, 'packages');

const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.ts') && !f.endsWith('.test.ts')) files.push(p);
  }
})(PKGS);

const BANNED = /Math\.(min|max)\(\s*\.\.\./;
const problems = [];

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  text.split('\n').forEach((line, i) => {
    // Skip the prose that explains the rule — comments naming the banned form
    // are how the reasoning survives, not violations of it.
    const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
    if (BANNED.test(code)) {
      problems.push(`${relative(root, file)}:${i + 1}  ${line.trim().slice(0, 90)}`);
    }
  });
}

if (problems.length) {
  console.error(`spread-limit check failed (${problems.length}):\n`);
  for (const p of problems) console.error('  • ' + p);
  console.error(
    '\n  Spreading an array into Math.min/Math.max passes one argument per element,\n' +
    '  and V8 throws RangeError above ~131k of them. Over anything per-die that is a\n' +
    '  bug which only appears on a production-sized lot.\n\n' +
    "  Use minOf()/maxOf() from core/utils.js instead — they iterate.\n",
  );
  process.exit(1);
}

console.log(`spread limits OK — no Math.min/max spread across ${files.length} files`);
