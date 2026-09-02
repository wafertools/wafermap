#!/usr/bin/env node
// "One value, many places" — the check that finds the class of defect a diff
// review structurally cannot.
//
// It does not ask "is this value on the scale?" (that is a per-site question).
// It asks: HOW MANY distinct literal values of this kind exist, and should
// there be that many? Every styling defect found on 2026-09-01 had that shape —
// four definitions of the secondary button, two tooltip looks, two card frames,
// three font stacks, eight radii. Each is defensible in isolation; the defect
// exists only in the comparison, which is why reading one file never finds it.
//
// Budgets are ceilings on DISTINCT literals, not on usage. Raising one is a
// deliberate act: add the value to a scale instead, or record here why a new
// role genuinely exists.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BUDGETS = {
  'box-shadow':     { max: 3, why: 'SHADOW / --shadow-*: panel, menu, modal' },
  'transition':     { max: 3, why: 'MOTION / --motion-*: fast, base' },
  'line-height':    { max: 4, why: 'LEADING / --leading-*: none, tight, base' },
  'letter-spacing': { max: 2, why: 'TRACKING / --tracking' },
  'font-family':    { max: 3, why: 'FONT.family (inherits) + ui-monospace' },
};
const PATTERNS = {
  // Both quote styles. A template literal is matched whole so the token-skip
  // below can see the `${MOTION.…}` inside it — an earlier version only matched
  // single quotes, so a correctly-tokenised `\`transform ${MOTION.base}\`` was
  // counted as yet another distinct literal and the check failed on its own fix.
  'box-shadow':     [/boxShadow:\s*(?:'([^']+)'|`([^`]+)`)/g, /box-shadow:\s*([^;'"}]+)/g],
  'transition':     [/transition:\s*(?:'([^']+)'|`([^`]+)`)/g, /transition:\s*([^;'"}]+)/g],
  'line-height':    [/lineHeight:\s*(?:'([^']+)'|`([^`]+)`)/g, /line-height:\s*([^;'"}]+)/g],
  'letter-spacing': [/letterSpacing:\s*(?:'([^']+)'|`([^`]+)`)/g, /letter-spacing:\s*([^;'"}]+)/g],
  'font-family':    [/fontFamily:\s*(?:'([^']+)'|`([^`]+)`)/g, /font-family:\s*([^;'"}]+)/g],
};
const SKIP = ['guideExtension.ts', 'icons.ts', 'version.ts', 'userGuideHtml.ts'];

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== 'node_modules') walk(p, out); }
    else if (/\.(ts|html|css)$/.test(e) && !SKIP.some(s => e.endsWith(s))) out.push(p);
  }
  return out;
}

const roots = process.argv.slice(2).length ? process.argv.slice(2) : ['src', 'index.html'];
const files = roots.flatMap(r => (statSync(r).isDirectory() ? walk(r) : [r]));
const failures = [];

for (const [prop, { max, why }] of Object.entries(BUDGETS)) {
  const seen = new Map();
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const re of PATTERNS[prop]) {
      for (const m of text.matchAll(re)) {
        const v = (m[1] ?? m[2] ?? '').trim().replace(/,$/, '');
        // Token references are the point — only literals count against budget.
        // `includes`, not a prefix test: a template literal wraps the token.
        if (!v) continue;
        if (/(var\(--|SHADOW\.|MOTION\.|LEADING\.|TRACKING|ALPHA\.|FONT\.)/.test(v)) continue;
        if (/^(inherit|none|unset|initial)$/.test(v)) continue;
        if (!seen.has(v)) seen.set(v, f);
      }
    }
  }
  if (seen.size > max) {
    failures.push({ prop, max, why, values: [...seen.entries()] });
  }
}

if (failures.length) {
  console.error('\nstyle scales: a property has more distinct literal values than its budget.\n');
  for (const { prop, max, why, values } of failures) {
    console.error(`  ${prop}: ${values.length} distinct (budget ${max}) — use ${why}`);
    for (const [v, f] of values.slice(0, 8)) console.error(`      ${v.slice(0, 52).padEnd(54)} ${f}`);
    console.error('');
  }
  process.exit(1);
}
console.log('style scales OK — no property exceeds its distinct-value budget');
