#!/usr/bin/env node
/**
 * Keeps the counted claims in docs/api.md honest.
 *
 * api.md tells a reader how much of this API they actually need — "`RenderOptions`
 * has N top-level fields", "tsmap passes 6 of them" — because the reference is
 * ~34,000 words and its *size* otherwise reads as the size of the thing you have
 * to learn. Those numbers are the reassurance, so they have to be right.
 *
 * They were not. Both shipped wrong the day they were written (32 and 24 against
 * a real 29 and 21) because they were counted with a regex that matched any
 * indented `name:` line — which also matches the PARAMETERS of a callback
 * signature declared inside the interface. That is the whole argument for
 * deriving a number instead of reading it once: the mistake is invisible in
 * prose and obvious in code.
 *
 * Run:    node scripts/check-api-claims.mjs
 * Write:  node scripts/check-api-claims.mjs --write   (regenerates, used by `npm version`)
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const problems = [];
const written = [];
const skipped = new Set();

/**
 * Top-level fields of an exported interface.
 *
 * Anchored to exactly two spaces of indent — one level in. A looser `^\s+`
 * silently includes the parameters of any callback signature the interface
 * declares, which is precisely how the published figures came to be three too
 * high in both cases.
 */
function countTopLevelFields(file, interfaceName) {
  const src = readFileSync(resolve(root, file), 'utf8');
  const start = src.indexOf(`export interface ${interfaceName} `);
  if (start === -1) {
    problems.push(`${file}: no \`export interface ${interfaceName}\` — renamed or moved?`);
    return null;
  }
  const end = src.indexOf('\n}', start);
  return src.slice(start, end).split('\n').filter(l => /^ {2}[a-zA-Z_]+\??:/.test(l)).length;
}

const API = 'docs/api.md';

/** Check (or rewrite) every place a count is quoted. `re` must capture the digits.
 *  `file` may live in a sibling repo — the figures are quoted on the org site and
 *  the org profile too, and those are the surfaces a stranger reads first. */
function claim(re, expected, what, file = API) {
  if (expected === null) return;
  const path = resolve(root, file);
  if (!existsSync(path)) { skipped.add(file); return; }
  const text = readFileSync(path, 'utf8');
  const all = [...text.matchAll(re)];
  if (all.length === 0) {
    problems.push(`${API}: could not find the ${what} claim — has the wording changed? ` +
                  `This check pins it, so the prose cannot drift from the interface.`);
    return;
  }
  for (const m of all) {
    const quoted = Number(m[1]);
    if (quoted === expected) continue;
    if (WRITE) {
      const fresh = readFileSync(path, 'utf8');
      writeFileSync(path, fresh.replace(m[0], m[0].replace(String(quoted), String(expected))));
      written.push(`${file}: ${what} ${quoted} -> ${expected}`);
    } else {
      problems.push(`${file}: says ${what} is ${quoted}, source says ${expected}.`);
    }
  }
}

/**
 * The cross-repo claims: "tsmap imports N of its ~M exports" and "passes N
 * options". They are the docs' answer to "how much of this must I learn?", and
 * the most persuasive thing the reference can say — but the numerator lives in a
 * DIFFERENT REPO, so it can go stale here without one file changing on this side.
 *
 * Skipped, not failed, when tsmap is absent: CI clones one repo at a time, and a
 * hard failure would break every build that isn't a local side-by-side checkout.
 * The skip is announced, so a green run never silently means "checked nothing".
 */
function tsmapFigures() {
  const tsmapSrc = resolve(root, '..', 'tsmap', 'src');
  if (!existsSync(tsmapSrc)) return null;

  const files = [];
  (function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(resolve(dir, e.name));
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) files.push(resolve(dir, e.name));
    }
  })(tsmapSrc);

  // RUNTIME imports only — `import type {...}` costs nothing at runtime and is
  // not what "uses N exports" means to a reader weighing the API's size.
  const imported = new Set();
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s*from\s*'@wafertools\/wafermap[^']*'/g)) {
      if (m[1]) continue;
      for (const part of m[2].split(',')) {
        const name = part.trim();
        if (name && !name.startsWith('type ')) imported.add(name.split(' as ')[0].trim());
      }
    }
  }

  // Options passed to renderWaferMap — brace-matched from the call site, because
  // the object spans dozens of lines and a flat regex would count nested keys.
  const main = readFileSync(resolve(tsmapSrc, 'main.ts'), 'utf8');
  let options = null;
  const call = main.match(/\brenderWaferMap\(/);
  if (call) {
    let i = call.index + call[0].length, depth = 1, start = null;
    while (i < main.length && depth > 0) {
      const c = main[i];
      if ('([{'.includes(c)) { if (c === '{' && depth === 1 && start === null) start = i; depth++; }
      else if (')]}'.includes(c)) depth--;
      i++;
    }
    if (start !== null) {
      options = new Set([...main.slice(start, i).matchAll(/^\s{4,8}([a-zA-Z]\w*)\s*:/gm)].map(m => m[1])).size;
    }
  }
  return { imported: imported.size, options };
}

const renderFields  = countTopLevelFields('packages/canvas-adapter/renderWaferMap.ts', 'RenderOptions');
const galleryFields = countTopLevelFields('packages/canvas-adapter/renderWaferGallery.ts', 'GalleryOptions');

// `\s+` rather than a bounded wildcard: it spans the line wrap (the claim is
// prose, and the digits routinely land on a different line from the interface
// name) without being able to swallow part of the number itself — a greedy
// `[\s\S]{0,3}` here matched " 3" and captured "2" out of "32".
claim(/`RenderOptions` has\s+(\d+)/g,  renderFields,  'the RenderOptions field count');
claim(/`GalleryOptions` has\s+(\d+)/g, galleryFields, 'the GalleryOptions field count');

// ── Cross-repo: how much of this API a real application actually uses ────────
// Quoted on four surfaces in three repos, because with GitHub Pages there is no
// single landing page — a stranger may arrive at any of them first.
const ts = tsmapFigures();
if (ts === null) {
  console.log('note: ../tsmap not present — the "N of ~M exports" claims were skipped');
} else {
  claim(/imports \*\*(\d+)\*\* of its ~\d+ exports/g, ts.imported, "tsmap's import count");
  claim(/imports \*\*(\d+)\*\* of its ~\d+ exports/g, ts.imported, "tsmap's import count", 'README.md');
  // `[\s>]+` not `\s+`: the claim sits in a blockquote and wraps, so the text
  // between "passes" and the number is "\n> " — a marker, not just whitespace.
  claim(/passes[\s>]+\*\*(\d+)\*\*:/g,                 ts.options,  "tsmap's option count");
  // The org site and org profile are separate repos; both skip cleanly if absent.
  for (const f of ['../wafertools.github.io/docs/index.md', '../.github/profile/README.md']) {
    const path = resolve(root, f);
    if (!existsSync(path)) { skipped.add(f); continue; }
    const text = readFileSync(path, 'utf8');
    // These two spell the number in words ("ten of the library's hundred-odd").
    // Words age exactly as badly as digits, so they are pinned the same way.
    const WORDS = ['zero','one','two','three','four','five','six','seven','eight','nine','ten',
                   'eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen','twenty'];
    const m = text.match(/uses ([a-z]+) of the library's|imports \*\*(\d+)\*\*|uses ([a-z]+) of its/);
    if (!m) continue;   // that surface does not quote the figure
    const quotedWord = (m[1] ?? m[3] ?? '').toLowerCase();
    const quoted = m[2] ? Number(m[2]) : WORDS.indexOf(quotedWord);
    if (quoted !== ts.imported) {
      problems.push(`${f}: says tsmap uses ${m[2] ?? quotedWord}, source says ${ts.imported} (${WORDS[ts.imported] ?? ts.imported}).`);
    }
  }
}

if (WRITE) {
  console.log(written.length
    ? `api claims regenerated:\n${written.map(w => `  ${w}`).join('\n')}\n\nStage these with the release commit.`
    : 'api claims already current — nothing to regenerate');
  process.exit(problems.length ? 1 : 0);
}

if (problems.length) {
  console.error(`\napi claims check failed (${problems.length}):\n`);
  for (const p of problems) console.error(`  • ${p}`);
  console.error('\nThese counts are the docs\' answer to "how much of this must I learn?".');
  console.error('Run `node scripts/check-api-claims.mjs --write` to regenerate them.\n');
  process.exit(1);
}
console.log(`api claims OK — RenderOptions ${renderFields} fields, GalleryOptions ${galleryFields} fields`
  + (ts ? `, tsmap uses ${ts.imported} exports and ${ts.options} options` : '')
  + (skipped.size ? `  (skipped, not present: ${[...skipped].join(', ')})` : ''));
