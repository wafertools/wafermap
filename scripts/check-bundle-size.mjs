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
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(root, 'dist');

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
