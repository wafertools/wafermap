#!/usr/bin/env node
// Enforces that docs/examples/manifest.json agrees with everything derived from
// it. The examples list used to live in three hand-maintained places; the
// manifest replaced them, and this is what stops them drifting apart again.
//
// Checks:
//   1. every manifest `file` exists on disk
//   2. every `dataFiles` entry exists on disk
//   3. zensical.toml's Examples nav lists exactly the manifest's nav files, in order
//   4. every redirect target names a real file (and anchor-bearing targets point
//      at a page that actually defines that anchor)
//   5. docs/examples/index.md matches what build-examples-index.mjs would write
//   6. no orphan .html in docs/examples/ that the manifest never mentions
//
// Run:  node scripts/check-examples-manifest.mjs
import { readFileSync, existsSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { loadManifest } from './build-examples-index.mjs';

const root     = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EX_DIR   = resolve(root, 'docs/examples');
const ZENSICAL = resolve(root, 'zensical.toml');

const errors = [];
const fail = (msg) => errors.push(msg);

const manifest = loadManifest();
const navDemos = manifest.demos.filter(d => d.nav !== false);

// ── 1 & 2. Files and data referenced by the manifest exist ──────────────────

for (const d of manifest.demos) {
  if (!existsSync(resolve(EX_DIR, d.file))) {
    fail(`manifest entry '${d.id}': file not found — docs/examples/${d.file}`);
  }
  for (const df of d.dataFiles ?? []) {
    if (!existsSync(resolve(EX_DIR, df))) {
      fail(`manifest entry '${d.id}': dataFile not found — docs/examples/${df}`);
    }
  }
}

// ── Anchors named by the manifest are actually defined by the page ──────────
//
// A stale anchor is invisible: the page still loads, it just silently shows the
// wrong thing. That is exactly the failure the anchor scheme exists to prevent.

for (const d of manifest.demos) {
  if (!d.anchor) continue;
  const file = resolve(EX_DIR, d.file);
  if (!existsSync(file)) continue;
  const html = readFileSync(file, 'utf8');
  const id   = d.anchor.slice(1);
  const defined =
    html.includes(`id="${id}"`) ||
    html.includes(`'${d.anchor}'`) ||   // hash routed in JS (see statistics.html SCENES)
    html.includes(`"${d.anchor}"`);
  if (!defined) {
    fail(`manifest entry '${d.id}': ${d.file} defines no anchor ${d.anchor}`);
  }
}

// ── 3. zensical.toml nav matches the manifest ───────────────────────────────

const toml = readFileSync(ZENSICAL, 'utf8');

// The Examples block is the nav entry between `{ "Examples" = [` and the
// matching close. Pull every examples/*.html path from it, in order.
const exBlockStart = toml.indexOf('{ "Examples" = [');
if (exBlockStart === -1) {
  fail('zensical.toml: could not find the `{ "Examples" = [` nav block');
} else {
  // The Examples entry sits at nav top level (2-space indent), and its
  // subsections close at 4. Terminate on the 2-space close, not the first
  // subsection's — otherwise only "Getting started" is ever inspected.
  const tail  = toml.slice(exBlockStart);
  const end   = tail.search(/\n {2}\]\},/);
  const block = end === -1 ? tail : tail.slice(0, end);

  const navFiles = [...block.matchAll(/"examples\/([A-Za-z0-9._-]+\.html)"/g)].map(m => m[1]);

  const expected = [];
  for (const d of navDemos) if (!expected.includes(d.file)) expected.push(d.file);

  const missing = expected.filter(f => !navFiles.includes(f));
  const extra   = navFiles.filter(f => !expected.includes(f));

  for (const f of missing) fail(`zensical.toml nav is missing examples/${f}`);
  for (const f of extra)   fail(`zensical.toml nav lists examples/${f}, which the manifest does not (add it, or mark the manifest entry nav:false)`);

  if (!missing.length && !extra.length) {
    const inOrder = navFiles.join(',') === expected.join(',');
    if (!inOrder) {
      fail(
        'zensical.toml nav order differs from manifest order.\n' +
        `  manifest: ${expected.join(' ')}\n` +
        `  zensical: ${navFiles.join(' ')}`
      );
    }
  }
}

// ── 4. Redirect targets resolve ─────────────────────────────────────────────

for (const [from, to] of Object.entries(manifest.redirects ?? {})) {
  const [targetFile, anchor] = to.split('#');
  if (!existsSync(resolve(EX_DIR, targetFile))) {
    fail(`redirect ${from} → ${to}: target file does not exist`);
    continue;
  }
  if (!existsSync(resolve(EX_DIR, from))) {
    fail(`redirect ${from} → ${to}: the stub docs/examples/${from} is missing`);
  }
  if (anchor) {
    const html = readFileSync(resolve(EX_DIR, targetFile), 'utf8');
    const ok = html.includes(`id="${anchor}"`) || html.includes(`'#${anchor}'`) || html.includes(`"#${anchor}"`);
    if (!ok) fail(`redirect ${from} → ${to}: ${targetFile} defines no anchor #${anchor}`);
  }
}

// ── 5. index.md is current ──────────────────────────────────────────────────

const { status } = await import('child_process')
  .then(cp => new Promise((res) => {
    const p = cp.spawnSync(process.execPath, [resolve(root, 'scripts/build-examples-index.mjs'), '--check'], { encoding: 'utf8' });
    res({ status: p.status, out: (p.stderr || '') + (p.stdout || '') });
  }));
if (status !== 0) {
  fail('docs/examples/index.md is out of date — run: node scripts/build-examples-index.mjs');
}

// ── 6. No orphan example pages ──────────────────────────────────────────────

const known = new Set(manifest.demos.map(d => d.file));
for (const f of Object.keys(manifest.redirects ?? {})) known.add(f);
known.add('index.html'); // generated by zensical from index.md

for (const f of readdirSync(EX_DIR)) {
  if (!f.endsWith('.html')) continue;
  if (!known.has(f)) {
    fail(`docs/examples/${f} is not in manifest.json (add an entry, or delete the file)`);
  }
}

// ── Report ──────────────────────────────────────────────────────────────────

if (errors.length) {
  console.error(`examples manifest check failed (${errors.length}):\n`);
  for (const e of errors) console.error('  • ' + e);
  console.error('');
  process.exit(1);
}

console.log(`examples manifest OK — ${navDemos.length} entries across ${new Set(navDemos.map(d => d.file)).size} nav pages`);
