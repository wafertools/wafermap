#!/usr/bin/env node
// Checks the user guide's toolbar tables against the toolbars the code builds.
//
// docs/user-guide.md §3 documents every toolbar button with its icon. That table
// is what an end user reads, and it is also compiled into the app-embedded help
// modal — so when it drifts, it misleads the exact person least able to work out
// what is really on screen.
//
// It had drifted: `rotateCW`/`flipH`/`flipV` were listed as separate buttons long
// after they became rows inside the Orientation menu; `aggr` was listed under the
// single map when it is a gallery-only dropdown; `specRange` and `downloadAll`
// were undocumented from the day they were added. Hand-auditing two tables
// against three source files is exactly the job nobody does twice, hence this.
//
// Run:  node scripts/check-toolbar-docs.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const root  = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read  = (p) => readFileSync(resolve(root, p), 'utf8');

const single  = read('packages/canvas-adapter/renderWaferMap.ts');
const gallery = read('packages/canvas-adapter/renderWaferGallery.ts');
const toolbar = read('packages/canvas-adapter/toolbar.ts');
const guide   = read('docs/user-guide.md');

// ── Which icon does each shared helper builder use? ─────────────────────────
//
// makePaletteBtn & co. hardcode their icon inside toolbar.ts, so a caller-side
// scan alone would miss them. Resolve the mapping from the source rather than
// hardcoding a second copy of it here.

const helperIcon = {};
for (const m of toolbar.matchAll(
  // The window has to clear the builder's signature and any doc comment before
  // its helpers.make* call. 400 was enough until makeLegendStyleBtn grew its
  // per-map toggle parameter; a builder that outgrows this drops silently out
  // of helperIcon and its icon then reads as undocumented, so keep the slack
  // generous rather than tight.
  /export function (make\w+Btn)\b[\s\S]{0,900}?helpers\.make(?:Btn|Dropdown|CheckMenuBtn)[^(]*\(\s*'([a-zA-Z]+)'/g,
)) {
  helperIcon[m[1]] = m[2];
}

/** Icon keys the given renderer actually mounts in its toolbar. */
function iconsUsedBy(src) {
  const icons = new Set();
  // Direct: makeBtn('x', …), makeDropdown('x', …), makeCheckMenuBtn('x', …)
  for (const m of src.matchAll(/make(?:Btn|Dropdown(?:<[^>]*>)?|CheckMenuBtn)\(\s*'([a-zA-Z]+)'/g)) {
    icons.add(m[1]);
  }
  // Indirect: the shared helper builders.
  for (const [helper, icon] of Object.entries(helperIcon)) {
    if (new RegExp(`\\b${helper}\\(`).test(src)) icons.add(icon);
  }
  return icons;
}

/** Icon keys listed in one markdown table of the user guide. */
function iconsDocumentedIn(section) {
  return new Set([...section.matchAll(/images\/icons\/([a-zA-Z]+)\.svg/g)].map(m => m[1]));
}

// ── Split the guide into its two toolbar tables ─────────────────────────────

const singleHeading  = guide.indexOf('## 3. Toolbar controls');
if (singleHeading === -1) {
  console.error('check-toolbar-docs: could not find "## 3. Toolbar controls" in docs/user-guide.md');
  process.exit(1);
}
// The gallery table lives under its own heading further down; find the first
// heading after the single-map table that mentions the gallery.
const galleryHeading = guide.search(/\n#{2,4} [^\n]*[Gg]allery[^\n]*\n/);

const singleDoc  = guide.slice(singleHeading, galleryHeading === -1 ? undefined : galleryHeading);
const galleryDoc = galleryHeading === -1 ? '' : guide.slice(galleryHeading);

// ── Compare ─────────────────────────────────────────────────────────────────

// Icons that are deliberately not toolbar buttons: window/modal chrome and the
// overlay-menu rows, which the guide covers as prose inside the Overlays entry.
const NON_TOOLBAR = new Set([
  'close', 'maximize', 'minimize', 'windowMinimize', 'windowRestore',
  'rings', 'quadrants', 'labels', 'reticle', 'wafer', 'xyIndicator',
]);

const problems = [];

for (const [name, src, doc] of [
  ['single-map', single, singleDoc],
  ['gallery',    gallery, galleryDoc],
]) {
  const used = iconsUsedBy(src);
  const documented = iconsDocumentedIn(doc);

  for (const icon of used) {
    if (NON_TOOLBAR.has(icon)) continue;
    if (!documented.has(icon)) {
      problems.push(`${name}: '${icon}' is mounted in the toolbar but is not in the ${name} table`);
    }
  }
  for (const icon of documented) {
    if (!used.has(icon)) {
      problems.push(`${name}: the ${name} table documents '${icon}', which that toolbar does not mount`);
    }
  }
}

if (problems.length) {
  console.error(`toolbar docs check failed (${problems.length}):\n`);
  for (const p of problems) console.error('  • ' + p);
  console.error('\nUpdate the tables in docs/user-guide.md §3 (they are also compiled');
  console.error('into the app-embedded help modal by scripts/build-user-guide.mjs).\n');
  process.exit(1);
}

const n = iconsUsedBy(single).size + iconsUsedBy(gallery).size;
console.log(`toolbar docs OK — ${n} toolbar buttons documented across both tables`);
