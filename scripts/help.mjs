#!/usr/bin/env node
// `npm run help` — the commands you actually type, grouped by task.
//
// This repo has ~20 npm scripts and `npm run` lists them flat, with no
// indication that most are invoked by npm's own lifecycle, by CI, or by another
// script rather than by you. That list is why "which do I run?" became a real
// question. This prints the short answer.
//
// `--check` (wired into `npm run check`) enforces two things:
//   1. every command named below still exists as a script
//   2. every script in package.json is classified — listed below, marked
//      INTERNAL, or an npm lifecycle hook
//
// So the list cannot silently rot, and a newly added script forces a one-line
// decision about whether it is something you type. That decision is the whole
// point: the pile grew because nothing ever asked.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scripts = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts;

const GROUPS = [
  {
    title: 'Every day',
    items: [
      ['npm run dev', 'Docs site with live examples on :8001'],
      ['npm run verify', 'Everything CI will run — check + tests. Run before pushing'],
    ],
  },
  {
    title: 'Releasing',
    items: [
      ['npm version patch', 'The whole bump: verify, changelog check, commit, tag (or minor)'],
      ['npm publish', 'Straight after the bump. postversion prints both commands'],
    ],
  },
  {
    title: 'Docs and assets',
    items: [
      ['npm run preview:site', 'The real bundled site, served on :8002'],
      ['npm run build:images', 'Regenerate doc screenshots after a UI change'],
    ],
  },
  {
    title: 'Occasional',
    items: [
      ['npm run check:drift', 'Compare agent/tooling config against the config repo'],
    ],
  },
];

// Scripts that exist for npm, CI, or another script to call — not for you.
// Adding a name here is a deliberate "no, you don't type this".
const INTERNAL = [
  'build', 'build:guide', 'build:examples-index', 'build:agents-page', 'build:site',
  'check', 'clean', 'pack:check', 'screenshots', 'screenshots:list', 'test',
];

// npm runs these itself, around other commands.
const isLifecycle = (name) =>
  /^(pre|post)/.test(name) || name === 'version' || name === 'help';

if (!process.argv.includes('--check')) {
  const width = Math.max(...GROUPS.flatMap((g) => g.items.map(([c]) => c.length)));
  console.log('\n  wafermap — the commands you type\n');
  for (const { title, items } of GROUPS) {
    console.log(`  ${title}`);
    for (const [cmd, desc] of items) console.log(`    ${cmd.padEnd(width)}  ${desc}`);
    console.log('');
  }
  console.log('  Everything else in `npm run` is machinery: npm lifecycle hooks, steps that');
  console.log('  CI calls, or sub-steps of the commands above. You should not need them.\n');
  process.exit(0);
}

// ── --check ────────────────────────────────────────────────────────────────

const problems = [];
const listed = new Set();

for (const { title, items } of GROUPS) {
  for (const [cmd] of items) {
    const name = /^npm run ([\w:.-]+)/.exec(cmd)?.[1];
    if (!name) continue; // a bare npm command such as `npm version patch`
    listed.add(name);
    if (!scripts[name]) {
      problems.push(`help lists "${cmd}" under ${title}, but there is no "${name}" script`);
    }
  }
}

for (const name of INTERNAL) {
  if (!scripts[name]) problems.push(`INTERNAL names "${name}", which is no longer a script`);
}

for (const name of Object.keys(scripts)) {
  if (listed.has(name) || INTERNAL.includes(name) || isLifecycle(name)) continue;
  problems.push(
    `"${name}" is not classified — add it to a group in scripts/help.mjs if you type it, ` +
      'or to INTERNAL if npm, CI, or another script calls it'
  );
}

if (problems.length) {
  console.error(`help check failed (${problems.length}):\n`);
  for (const p of problems) console.error('  • ' + p);
  console.error('');
  process.exit(1);
}

console.log(`help OK — ${listed.size} commands listed, ${Object.keys(scripts).length} scripts classified`);
