#!/usr/bin/env node
// Minifies every dist/**/*.js file in place (whitespace/comments/identifiers) —
// .d.ts files are left untouched so consumer IDE tooltips stay readable.
// Run only as part of `prepack`, never as part of the regular `npm run build`
// used by dev/tests, so the working dist/ stays human-readable and debuggable
// with its source maps intact. The packed tarball excludes .map files (see
// package.json's "files"), so a minified dist here loses nothing a consumer
// could have used anyway.

import { transform } from 'esbuild';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const distDir = new URL('../dist', import.meta.url).pathname;

async function walk(dir) {
  const entries = await readdir(dir);
  await Promise.all(entries.map(async (name) => {
    const path = join(dir, name);
    const s = await stat(path);
    if (s.isDirectory()) {
      await walk(path);
    } else if (path.endsWith('.js')) {
      const src = await readFile(path, 'utf8');
      const { code } = await transform(src, { minify: true, loader: 'js' });
      await writeFile(path, code, 'utf8');
    }
  }));
}

const before = await totalSize(distDir);
await walk(distDir);
const after = await totalSize(distDir);
console.log(`minify-dist: ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB`);

async function totalSize(dir) {
  let total = 0;
  for (const name of await readdir(dir)) {
    const path = join(dir, name);
    const s = await stat(path);
    total += s.isDirectory() ? await totalSize(path) : (path.endsWith('.js') ? s.size : 0);
  }
  return total;
}
