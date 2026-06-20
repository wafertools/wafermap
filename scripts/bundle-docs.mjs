#!/usr/bin/env node
// Bundles the two importmap entry points used by docs examples into single
// minified files, replacing the unbundled tsc output in site/dist/.
// Importmaps in example HTMLs stay unchanged — paths match.
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
]);

console.log('docs bundles written to site/dist/');
