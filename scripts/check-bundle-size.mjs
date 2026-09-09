#!/usr/bin/env node
// Enforces that the "library size" figures quoted in the wafermap-vs-Plotly
// comparison demo (docs/examples/comparison.html) are not stale.
//
// This exists because of a real failure: the demo claimed "~85 KB gzip (full
// stack)" from the day it was written — a hand-typed guess, never measured —
// and the number was never revisited as the library grew (stats package,
// insights/charts tab, the embedded user guide, toolbar expansion). By the
// time it was checked against an actual minified+gzipped build of the
// published npm package, the real core bundle was ~105 KB gzip, ~25% over
// the claim, with a further ~34 KB lazy-loaded the moment a user opens the
// in-app help guide.
//
// This bundles the same entry points a real consumer imports
// (buildWaferMap + renderWaferMap) straight from dist/, minified and
// code-split exactly as a bundler would for a real app, then gzips each
// output chunk. The user-guide chunk is lazy (dynamic import in
// renderWaferMap.ts) so it's reported separately from the core, eagerly
// loaded chunk.
//
// Run:  node scripts/check-bundle-size.mjs   (requires a fresh `npm run build`)
import esbuild from 'esbuild';
import { gzipSync } from 'zlib';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(root, 'dist');

// `--write` regenerates every quoted figure instead of asserting on it — used by
// the `version` script so a release can never ship a stale badge.
const WRITE = process.argv.includes('--write');
const written = [];

const result = await esbuild.build({
  stdin: {
    contents: `
      export { renderWaferMap } from './packages/canvas-adapter/renderWaferMap.js';
      export { buildWaferMap } from './packages/renderer/buildWaferMap.js';
    `,
    resolveDir: distDir,
    loader: 'js',
  },
  bundle: true,
  format: 'esm',
  minify: true,
  splitting: true,
  outdir: 'out',
  write: false,
  logLevel: 'silent',
});

// Two chunks are LAZY and must not be counted as what a consumer downloads to
// render a wafer map: the in-app user guide, and the Insights chart suite
// (opt-in, off by default, fetched on first open — see `ensureInsightsTab`).
// Both are split out for real here (`splitting: true`), so this is attribution,
// not estimation.
// The DOM-free root entry, quoted separately from the renderer because they are
// different products to a consumer: a Node build-and-analyse pipeline pays this
// and never loads the renderer. Bundled on its own (no splitting — nothing here
// is lazy) rather than derived from the chunks above.
const rootResult = await esbuild.build({
  entryPoints: [resolve(distDir, 'index.js')],
  bundle: true, format: 'esm', minify: true, write: false, logLevel: 'silent',
});
const rootKB = Math.round(gzipSync(Buffer.from(rootResult.outputFiles[0].contents)).length / 1024);

let coreGzip = 0;
let guideGzip = 0;
let insightsGzip = 0;
for (const file of result.outputFiles) {
  const gzip = gzipSync(Buffer.from(file.contents)).length;
  if (file.path.includes('userGuideHtml')) guideGzip += gzip;
  else if (file.path.includes('insightsTab')) insightsGzip += gzip;
  else coreGzip += gzip;
}
// `WMAP_CHUNKS=1 node scripts/check-bundle-size.mjs` prints the per-chunk
// breakdown — the quickest way to see what a size change actually landed in.
if (process.env.WMAP_CHUNKS) {
  for (const f of result.outputFiles) {
    console.log(`  ${(gzipSync(Buffer.from(f.contents)).length / 1024).toFixed(1).padStart(7)} KB  ${f.path.split('/').pop()}`);
  }
}

const coreKB = Math.round(coreGzip / 1024);
const insightsKB = Math.round(insightsGzip / 1024);
const totalKB = Math.round((coreGzip + guideGzip + insightsGzip) / 1024);

const docPath = resolve(root, 'docs/examples/comparison.html');
const doc = readFileSync(docPath, 'utf8');

const panelMatch = doc.match(/~(\d+)\s*KB gzip \(core[^)]*\)/);
const tableMatch = doc.match(/~(\d+)\s*KB \(core[^)]*\)/);

const problems = [];
if (!panelMatch) {
  problems.push('could not find the "~NN KB gzip (core…)" panel label in comparison.html — has the markup changed?');
} else {
  checkDrift('panel label', Number(panelMatch[1]));
}
if (!tableMatch) {
  problems.push('could not find the "~NN KB (core…)" table cell in comparison.html — has the markup changed?');
} else {
  checkDrift('table cell', Number(tableMatch[1]));
}

/**
 * Every figure in the docs, checked against what was just measured.
 *
 * docs/performance.md's "Download size" table is the CANONICAL statement — it is
 * the one place all four numbers appear, and everything else in the docs links
 * to it rather than restating them. That rule exists because the previous
 * arrangement (figures scattered across the README, api.md, the comparison demo
 * and the org site) produced two different numbers both labelled "core": the
 * README's ~40 kB meant the root entry, the demo's ~104 KB meant the renderer.
 * Consolidating is what makes this check cheap enough to be exhaustive.
 */
function checkQuotedFigures() {
  const check = (file, re, expectedKB, what) => {
    const path = resolve(root, file);
    const text = readFileSync(path, 'utf8');
    const m = text.match(re);
    if (!m) {
      problems.push(`${file}: could not find ${what} — has the wording changed? ` +
                    `This check pins it so the docs cannot drift from the build.`);
      return;
    }
    const quoted = Number(m[1]);
    // `--write` REGENERATES instead of asserting. A figure nobody has to
    // remember to update beats a figure a script nags about, so a release
    // regenerates (the `version` script) and everything else checks.
    if (WRITE) {
      if (quoted !== expectedKB) {
        writeFileSync(path, text.replace(m[0], m[0].replace(String(quoted), String(expectedKB))));
        written.push(`${file}: ${what} ~${quoted} -> ~${expectedKB} KB`);
      }
      return;
    }
    // Tolerance is 1 KB or 3%, whichever is larger — NOT the 10% used for the
    // comparison demo's prose. 10% is too loose here and provably so: the README
    // badge sat at ~40 kB against a real 44 KB, a 9% error that a 10% tolerance
    // waves through. The allowance exists only to absorb KB rounding, so it
    // should be about a kilobyte, not about a tenth of the bundle.
    const slack = Math.max(1, expectedKB * 0.03);
    if (Math.abs(quoted - expectedKB) > slack) {
      problems.push(`${file}: says ~${quoted} KB for ${what}, measured ~${expectedKB} KB.`);
    }
  };

  // The canonical table (docs/performance.md § Download size).
  check('docs/performance.md', /\*\*~(\d+) KB\*\*\s*\| Always, if you import it/, rootKB, 'the data-layer');
  check('docs/performance.md', /\*\*~(\d+) KB\*\*\s*\| Always, if you render/, coreKB, 'the renderer');
  check('docs/performance.md', /\+~(\d+) KB\s*\| On first open, only if/, insightsKB, 'the Insights chunk');
  check('docs/performance.md', /\+~(\d+) KB\s*\| On first open of the guide/, Math.round(guideGzip / 1024), 'the guide chunk');

  // The README badge and its prose line — the only figures outside the table,
  // kept because a badge is what a reader actually scans on npm and GitHub.
  check('README.md', /data%20layer%20min%2Bgz-~(\d+)%20kB/, rootKB, "the badge's data layer");
  check('README.md', /data-and-stats layer is ~(\d+) kB/, rootKB, "the prose data layer");
}

function checkDrift(label, quotedKB) {
  const driftPct = Math.abs(quotedKB - coreKB) / coreKB;
  if (driftPct > 0.1) {
    problems.push(
      `${label} says ~${quotedKB} KB but the measured core bundle (buildWaferMap + ` +
      `renderWaferMap, minified + gzipped, from dist/) is ~${coreKB} KB — ` +
      `${Math.round(driftPct * 100)}% off. Update docs/examples/comparison.html.`
    );
  }
}

checkQuotedFigures();

if (WRITE) {
  console.log(written.length
    ? `bundle figures regenerated:\n${written.map(w => `  ${w}`).join('\n')}\n\nStage these with the release commit.`
    : 'bundle figures already current — nothing to regenerate');
  process.exit(problems.length ? 1 : 0);
}

if (problems.length) {
  console.error(`bundle size check failed (${problems.length}):\n`);
  for (const p of problems) console.error('  • ' + p);
  console.error(
    `\nMeasured just now: core ~${coreKB} KB gzip, +~${insightsKB} KB if Insights is ` +
    `opened, +~${Math.round(guideGzip / 1024)} KB if the in-app user guide is opened ` +
    `(~${totalKB} KB total). Requires a fresh ` +
    `'npm run build' — this script bundles from dist/.\n`
  );
  process.exit(1);
}

console.log(
  `bundle size OK — core ~${coreKB} KB gzip (+~${insightsKB} KB Insights, +~${Math.round(guideGzip / 1024)} KB guide; ~${totalKB} KB all in)`
);
