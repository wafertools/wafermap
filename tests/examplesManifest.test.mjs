import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// docs/examples/manifest.json is the single source for the examples list. Four
// things read it — demo-nav.js at runtime, the index.md generator, the zensical
// nav check, and the downloadable archive builder — and they used to be four
// hand-maintained copies that silently disagreed.
//
// Drift here does not throw at build time; it ships as a demo that is missing
// from the nav, a Guide link that lands on the wrong page state, or an archive
// with a 404 in it. So it is asserted in CI rather than left to review.
// ─────────────────────────────────────────────────────────────────────────────

const root     = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EX_DIR   = resolve(root, 'docs/examples');
const manifest = JSON.parse(readFileSync(resolve(EX_DIR, 'manifest.json'), 'utf8'));

test('check-examples-manifest passes', () => {
  const p = spawnSync(process.execPath, [resolve(root, 'scripts/check-examples-manifest.mjs')], { encoding: 'utf8' });
  assert.equal(p.status, 0, (p.stdout || '') + (p.stderr || ''));
});

test('every demo entry has the fields its consumers read', () => {
  for (const d of manifest.demos) {
    assert.ok(d.id,      `entry missing id: ${JSON.stringify(d)}`);
    assert.ok(d.file,    `entry '${d.id}' missing file`);
    assert.ok(d.title,   `entry '${d.id}' missing title`);
    assert.ok(d.blurb,   `entry '${d.id}' missing blurb`);
    assert.ok(d.section, `entry '${d.id}' missing section`);
    assert.ok(Array.isArray(d.dataFiles), `entry '${d.id}' missing dataFiles array`);
  }
});

test('demo ids are unique', () => {
  const seen = new Set();
  for (const d of manifest.demos) {
    assert.ok(!seen.has(d.id), `duplicate demo id: ${d.id}`);
    seen.add(d.id);
  }
});

test('entries sharing a file are contiguous and grouped by section', () => {
  // demo-nav.js derives prev/next from the distinct file sequence. If a file's
  // entries are split apart in the manifest, that sequence revisits the page and
  // the Next arrow loops back on itself.
  const firstIndex = new Map();
  const lastIndex  = new Map();
  manifest.demos.forEach((d, i) => {
    if (!firstIndex.has(d.file)) firstIndex.set(d.file, i);
    lastIndex.set(d.file, i);
  });
  for (const [file, first] of firstIndex) {
    const last  = lastIndex.get(file);
    const count = manifest.demos.filter(d => d.file === file).length;
    assert.equal(last - first + 1, count, `entries for ${file} are not contiguous in manifest.json`);
  }
});

test('every referenced file and data file exists', () => {
  for (const d of manifest.demos) {
    assert.ok(existsSync(resolve(EX_DIR, d.file)), `missing docs/examples/${d.file}`);
    for (const df of d.dataFiles) {
      assert.ok(existsSync(resolve(EX_DIR, df)), `entry '${d.id}': missing docs/examples/${df}`);
    }
  }
});

test('anchors named by the manifest are defined by their page', () => {
  // A stale anchor is invisible — the page still loads, it just shows the wrong
  // state. That is precisely what the anchor scheme exists to prevent.
  for (const d of manifest.demos) {
    if (!d.anchor) continue;
    const html = readFileSync(resolve(EX_DIR, d.file), 'utf8');
    const id   = d.anchor.slice(1);
    const ok = html.includes(`id="${id}"`) ||
               html.includes(`'${d.anchor}'`) ||
               html.includes(`"${d.anchor}"`);
    assert.ok(ok, `${d.file} defines no anchor ${d.anchor} (entry '${d.id}')`);
  }
});

test('every consolidated page keeps a redirect stub pointing somewhere real', () => {
  for (const [from, to] of Object.entries(manifest.redirects)) {
    const stub = resolve(EX_DIR, from);
    assert.ok(existsSync(stub), `missing redirect stub docs/examples/${from}`);

    const html = readFileSync(stub, 'utf8');
    assert.match(html, /http-equiv="refresh"/, `${from} is not a redirect stub`);
    assert.ok(html.includes(to), `${from} does not redirect to ${to}`);

    const [file, anchor] = to.split('#');
    assert.ok(existsSync(resolve(EX_DIR, file)), `redirect ${from} → ${to}: target missing`);
    if (anchor) {
      const target = readFileSync(resolve(EX_DIR, file), 'utf8');
      const ok = target.includes(`id="${anchor}"`) ||
                 target.includes(`'#${anchor}'`) ||
                 target.includes(`"#${anchor}"`);
      assert.ok(ok, `redirect ${from} → ${to}: ${file} defines no anchor #${anchor}`);
    }
  }
});

test('no doc or script still links to a consolidated page', () => {
  // The stubs keep old external URLs working, but our own docs should point at
  // the real page — a redirect hop inside the site is a stale link, not a feature.
  const gone = Object.keys(manifest.redirects);
  const p = spawnSync('grep', [
    '-rn', '--include=*.md', '--include=*.mjs', '--include=*.toml',
    gone.map(f => `examples/${f.replace('.', '\\.')}`).join('\\|'),
    'docs', 'scripts', 'zensical.toml', 'README.md',
  ], { cwd: root, encoding: 'utf8' });

  // grep exits 1 when there are no matches, which is the passing case.
  assert.equal(p.stdout.trim(), '', `stale links to consolidated demos:\n${p.stdout}`);
});
