#!/usr/bin/env node
// Bundles the importmap entry points used by docs examples into single minified
// files, replacing the unbundled tsc output in site/dist/. Importmaps in example
// HTMLs stay unchanged — paths match.
//
// Every entry the examples' importmaps resolve MUST be bundled here. An unbundled
// tsc entry (a barrel re-exporting siblings) forces the browser to fetch each
// internal module over a separate request — a serial waterfall that shows as a
// blank before the maps appear, badly so on high-latency connections. wafermap/stats
// alone fans out to ~13 modules.
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = resolve(root, 'site');

await Promise.all([
  build({
    entryPoints: [resolve(root, 'dist/index.js')],
    bundle: true,
    minify: true,
    format: 'esm',
    outfile: resolve(siteDir, 'dist/index.js'),
    sourcemap: false,
  }),
  build({
    entryPoints: [resolve(root, 'dist/packages/canvas-adapter/index.js')],
    bundle: true,
    minify: true,
    format: 'esm',
    splitting: true,
    outdir: resolve(siteDir, 'dist/packages/canvas-adapter'),
    sourcemap: false,
  }),
  // wafermap/stats — bundled to one file so a stats-using demo (summary panel,
  // findings, lot-stack) makes a single request instead of walking the stats
  // module graph. No code splitting: stats has no deferred chunk.
  build({
    entryPoints: [resolve(root, 'dist/packages/stats/index.js')],
    bundle: true,
    minify: true,
    format: 'esm',
    outfile: resolve(siteDir, 'dist/packages/stats/index.js'),
    sourcemap: false,
  }),
  // wafermap/renderer — used directly by pipeline.html / showcase.html.
  build({
    entryPoints: [resolve(root, 'dist/packages/renderer/index.js')],
    bundle: true,
    minify: true,
    format: 'esm',
    outfile: resolve(siteDir, 'dist/packages/renderer/index.js'),
    sourcemap: false,
  }),
  // wafermap/worker — used by worker.html. Bundled so the worker wrapper entry is
  // a single request; the Worker script itself is loaded separately by the browser.
  build({
    entryPoints: [resolve(root, 'dist/packages/worker/index.js')],
    bundle: true,
    minify: true,
    format: 'esm',
    outfile: resolve(siteDir, 'dist/packages/worker/index.js'),
    sourcemap: false,
  }),
]);

console.log('docs bundles written to site/dist/');
