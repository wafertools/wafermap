#!/usr/bin/env node
// Bundles the importmap entry points used by docs examples into minified files,
// replacing the unbundled tsc output in site/dist/. Importmaps in example HTMLs
// stay unchanged — paths match.
//
// Every entry the examples' importmaps resolve MUST be bundled here. An unbundled
// tsc entry (a barrel re-exporting siblings) forces the browser to fetch each
// internal module over a separate request — a serial waterfall that shows as a
// blank before the maps appear, badly so on high-latency connections. wafermap/stats
// alone fans out to ~13 modules.
//
// ALL entry points are built in ONE esbuild invocation with `splitting: true`.
// This is load-bearing, not a tidiness preference. Built separately, each bundle
// inlines its own private copy of every shared module — including the
// colour-scheme registry. `registerColorScheme` imported from 'wafermap' then
// writes into a registry that 'wafermap/render' cannot see, so a custom scheme
// silently renders with the default palette. It only reproduces in the bundled
// site build; under `npm run dev` the unbundled modules resolve to one shared
// file, which is why it survived unnoticed. Code splitting emits the shared
// modules as common chunks that every entry imports, restoring one registry.
//
// The same trap applies to any module-level state the library keeps.
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const root    = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = resolve(root, 'site');
const distDir = resolve(root, 'dist');

await build({
  entryPoints: [
    resolve(distDir, 'index.js'),
    resolve(distDir, 'packages/canvas-adapter/index.js'),
    resolve(distDir, 'packages/stats/index.js'),
    resolve(distDir, 'packages/renderer/index.js'),
    resolve(distDir, 'packages/worker/index.js'),
  ],
  bundle:    true,
  minify:    true,
  format:    'esm',
  splitting: true,
  // outbase keeps each entry at the same path under site/dist that the
  // importmaps already point at.
  outbase:    distDir,
  outdir:     resolve(siteDir, 'dist'),
  chunkNames: 'chunks/[name]-[hash]',
  sourcemap:  false,
});

console.log('docs bundles written to site/dist/ (shared chunks in site/dist/chunks/)');
