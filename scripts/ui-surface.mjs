#!/usr/bin/env node
/**
 * Writes down the whole interactive surface, so it can be reviewed as one page
 * and so a change to it shows up as a diff.
 *
 * Every other check here asks whether the UI is built *correctly* — one shared
 * button class, values on the scale, contrast against every ground. None of them
 * asks what the UI actually *says*, or whether the surface makes sense read end
 * to end. Those two gaps produced most of a session's worth of defects:
 *
 *   - a toolbar tooltip advertising a die list that had moved to another panel
 *   - a dialog describing "Save/Load list" buttons renamed two releases earlier
 *   - two menu entries that loaded the same file to the same effect
 *   - an About row sitting in the middle of the menu instead of the end
 *
 * Every one was found by a person opening a menu and reading it. None was
 * findable by any check in either repo, because the label, the hint and the
 * ordering are data no test looked at.
 *
 * So: drive the real UI, open every menu, and serialise what a user would read —
 * labels, accessible names, hints, ordering, disabled state — into a committed
 * text file. Two things fall out of that:
 *
 *   1. **Drift is a diff.** Rename a button and the snapshot moves; the reviewer
 *      sees it next to the code that caused it.
 *   2. **Incoherence becomes visible.** Reading the entire surface as one page is
 *      what makes "these two menu items do the same thing" and "About is not
 *      last" obvious — they are invisible while each menu is only ever seen
 *      alone.
 *
 * It is deliberately NOT an assertion about what the UI should contain: that
 * would be a second copy of the design, needing its own maintenance. It records
 * what is there and makes changing it deliberate.
 *
 * Run:    node scripts/ui-surface.mjs           (regenerate)
 * Check:  node scripts/ui-surface.mjs --check   (fail on drift; used by `npm run check`)
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve, join, extname } from 'path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');
const OUT = join(DOCS, 'ui-surface.txt');
const CHECK = process.argv.includes('--check');

// Chromium is not installed by Playwright here; the system browser is used for
// every other capture in this repo too (see capture-screenshots.mjs).
const CHROME = process.env.CHROME_PATH ?? '/opt/google/chrome/chrome';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.csv': 'text/csv',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.zip': 'application/zip', '.wasm': 'application/wasm',
};

// ── The scenes to walk ───────────────────────────────────────────────────────
//
// One entry per distinct chrome the library renders. `first-map` and the gallery
// are separate deliberately: their toolbars differ (the gallery adds Columns and
// an aggregation picker, and its stacked plot modes are always available), and
// that difference is exactly the kind of thing worth seeing side by side.
const SCENES = [
  { name: 'Single wafer map',  url: '/examples/first-map.html' },
  { name: 'Lot gallery',       url: '/examples/statistics.html#lot-gallery' },
  { name: 'Insights tab',      url: '/examples/insights.html' },
];

// ── Serialisation ────────────────────────────────────────────────────────────

/**
 * Volatile text that would make the snapshot differ run to run for no real
 * change. Kept as narrow as possible: over-normalising hides the very drift this
 * exists to show.
 */
function normalise(text) {
  return text
    .replace(/\b\d{4}-\d{2}-\d{2}T[\d:.]+Z?\b/g, '<timestamp>')
    .replace(/\bv?\d+\.\d+\.\d+\b/g, '<version>')
    .replace(/\bseg-[a-z0-9]{5,}\b/g, '<generated-id>')
    .replace(/\s+/g, ' ')
    .trim();
}

const controlsIn = (scope) => `
  [...${scope}.querySelectorAll('button,[role="button"],[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],[role="option"],[role="tab"]')]
    .filter(e => e.offsetParent !== null)
    .map(e => ({
      label: (e.textContent || '').trim(),
      aria:  e.getAttribute('aria-label') || '',
      hint:  e.getAttribute('data-tip') || e.getAttribute('title') || '',
      role:  e.getAttribute('role') || e.tagName.toLowerCase(),
      pop:   e.getAttribute('aria-haspopup') || '',
      disabled: e.disabled === true || e.getAttribute('aria-disabled') === 'true',
      checked:  e.getAttribute('aria-checked') || '',
    }))
`;

function renderControl(c, indent = '  ') {
  const name = normalise(c.label || c.aria || '(unnamed)');
  const bits = [];
  if (c.aria && c.label && normalise(c.aria) !== name) bits.push(`aria="${normalise(c.aria)}"`);
  if (c.checked) bits.push(c.checked === 'true' ? 'checked' : 'unchecked');
  if (c.disabled) bits.push('disabled');
  if (c.pop) bits.push(`opens ${c.pop}`);
  const suffix = bits.length ? `  [${bits.join(', ')}]` : '';
  const hint = c.hint ? `\n${indent}    hint: ${normalise(c.hint)}` : '';
  return `${indent}· ${name}${suffix}${hint}`;
}

// ── Walk ─────────────────────────────────────────────────────────────────────

async function walkScene(page, scene, port) {
  const lines = [`## ${scene.name}`, ''];

  await page.goto(`http://127.0.0.1:${port}${scene.url}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  const top = await page.evaluate(`(${controlsIn('document')})`);
  lines.push('Controls:');
  // A gallery repeats one card's chrome per wafer — 13 identical zoom/pan sets
  // would bury every real change in the diff. Collapse repeats to one line with
  // a count, keeping first-occurrence order so the toolbar's own ordering (which
  // is the thing worth reviewing) survives intact.
  const counts = new Map();
  for (const c of top) {
    const line = renderControl(c);
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  const emitted = new Set();
  for (const c of top) {
    const line = renderControl(c);
    if (emitted.has(line)) continue;
    emitted.add(line);
    const n = counts.get(line);
    lines.push(n > 1 ? `${line}   (×${n})` : line);
  }
  lines.push('');

  // Descend into anything that says it opens a menu. Identified by accessible
  // name rather than position, so reordering the toolbar does not reshuffle the
  // whole snapshot and drown the real change in noise.
  const menus = top.filter(c => c.pop === 'menu');
  for (const m of menus) {
    const name = normalise(m.aria || m.label);
    const opened = await page.evaluate((wanted) => {
      const btn = [...document.querySelectorAll('button,[role="button"]')]
        .filter(e => e.offsetParent !== null)
        .find(e => ((e.getAttribute('aria-label') || e.textContent || '').trim()) === wanted);
      if (!btn) return false;
      btn.click();
      return true;
    }, m.aria || m.label);

    lines.push(`Menu — ${name}:`);
    if (!opened) {
      lines.push('    (could not be opened by name — see ui-surface.mjs)');
      lines.push('');
      continue;
    }
    await page.waitForTimeout(400);

    // Menu rows live in a popup appended to the body, so read the whole document
    // and subtract what was already on the page.
    const after = await page.evaluate(`(${controlsIn('document')})`);
    const before = new Set(top.map(c => `${c.label}|${c.aria}`));
    const rows = after.filter(c => !before.has(`${c.label}|${c.aria}`));
    for (const r of rows) lines.push(renderControl(r, '    '));
    if (rows.length === 0) lines.push('    (no rows captured)');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    lines.push('');
  }

  return lines;
}

// ── Static server (same shape as capture-screenshots.mjs) ────────────────────

function startServer() {
  return new Promise((res) => {
    const server = createServer((req, out) => {
      let path = req.url.split('?')[0];
      if (path === '/') path = '/index.html';
      const fsPath = path.startsWith('/dist/') ? join(ROOT, path) : join(DOCS, path);
      if (!existsSync(fsPath)) { out.writeHead(404); out.end('Not found: ' + fsPath); return; }
      out.writeHead(200, { 'Content-Type': MIME[extname(fsPath)] ?? 'application/octet-stream' });
      out.end(readFileSync(fsPath));
    });
    server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port }));
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

if (!existsSync(join(ROOT, 'dist', 'index.js'))) {
  console.error('ui-surface: dist/ not found — run `npm run build` first.');
  process.exit(1);
}

const { server, port } = await startServer();
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const out = [
  '# wafermap — interactive surface',
  '',
  'GENERATED by scripts/ui-surface.mjs — do not edit. Regenerate with:',
  '    node scripts/ui-surface.mjs',
  '',
  'Every control a user can reach, with its accessible name, hint and state.',
  'Read it end to end when reviewing UI changes: a rename shows up as a diff, and',
  'reading the whole surface at once is what makes duplicated or oddly-ordered',
  'entries visible — they are invisible while each menu is only ever seen alone.',
  '',
];

try {
  for (const scene of SCENES) out.push(...await walkScene(page, scene, port));
} finally {
  await browser.close();
  server.close();
}

const text = out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';

if (CHECK) {
  const existing = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (existing !== text) {
    console.error('ui-surface check failed — the interactive surface has changed.\n');
    console.error('  Review the difference, then commit the regenerated file:');
    console.error('    node scripts/ui-surface.mjs\n');
    console.error('  This is not an error in itself: it means a control, label, hint,');
    console.error('  ordering or disabled state moved. Confirm the change is intended.\n');
    process.exit(1);
  }
  const controls = (text.match(/^\s+· /gm) ?? []).length;
  console.log(`ui surface OK — ${controls} controls across ${SCENES.length} scenes, unchanged`);
} else {
  writeFileSync(OUT, text);
  const controls = (text.match(/^\s+· /gm) ?? []).length;
  console.log(`ui surface written — ${controls} controls across ${SCENES.length} scenes → docs/ui-surface.txt`);
}
