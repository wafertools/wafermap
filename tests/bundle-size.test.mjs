// Guards against bundle size regressions and accidental static imports of heavy modules.
// Thresholds are set at ~20% above current baselines — update deliberately when the library grows.
//
// Current baselines (gzipped):
//   wafermap (root):          ~37 KB
//   wafermap/render (initial): ~88 KB  (userGuideHtml deferred — must not appear in initial chunk)
//   2026-07-10: raised from ~62 KB after capability/boxplot gained per-panel
//   grouping UI (restrict dropdown, drill-in-place, back button) — legitimate
//   library growth, not bloat; see wmap/tsmap WMAP_ISSUES.md #31.
//   2026-07-12: raised from ~75 KB after the Analysis tab chart suite, plus
//   the user-guide window and gallery card detach gaining real-window
//   support (window.open with fallback) and live --wmap-* theme resync —
//   legitimate library growth, not bloat.

import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { gzipSync } from 'zlib';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

const THRESHOLDS = {
  'wafermap (root)':            40_000,   // gzipped bytes — baseline ~37 KB
  'wafermap/render (initial)':  106_000,  // gzipped bytes — baseline ~88 KB, guide excluded
};

async function bundleGzipped(entryPoint, plugins = []) {
  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    minify: true,
    format: 'esm',
    write: false,
    plugins,
  });
  return gzipSync(result.outputFiles[0].contents).length;
}

const stubGuide = {
  name: 'stub-guide',
  setup(b) {
    b.onResolve({ filter: /userGuideHtml/ }, () => ({ path: 'stub', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'export const USER_GUIDE_HTML = "";',
      loader: 'js',
    }));
  },
};

test('wafermap (root) bundle size is within threshold', async () => {
  const gz = await bundleGzipped(resolve(dist, 'index.js'));
  assert.ok(
    gz <= THRESHOLDS['wafermap (root)'],
    `wafermap root bundle too large: ${gz} bytes gzipped (threshold ${THRESHOLDS['wafermap (root)']}). Update threshold deliberately if the library has grown.`,
  );
});

test('wafermap/render initial chunk size is within threshold', async () => {
  const gz = await bundleGzipped(resolve(dist, 'packages/canvas-adapter/index.js'), [stubGuide]);
  assert.ok(
    gz <= THRESHOLDS['wafermap/render (initial)'],
    `wafermap/render initial chunk too large: ${gz} bytes gzipped (threshold ${THRESHOLDS['wafermap/render (initial)']}). Check for new static imports of heavy modules.`,
  );
});

test('userGuideHtml is not statically imported by renderWaferMap or renderWaferGallery', async () => {
  // Checks source files directly — a static import() would add ~26 KB gzipped to the initial chunk.
  // The import must remain dynamic (import('./userGuideHtml.js')) so it is deferred until help-click.
  const { readFile } = await import('fs/promises');
  const [mapSrc, gallerySrc] = await Promise.all([
    readFile(resolve(dist, 'packages/canvas-adapter/renderWaferMap.js'), 'utf8'),
    readFile(resolve(dist, 'packages/canvas-adapter/renderWaferGallery.js'), 'utf8'),
  ]);
  const staticImportRe = /^import\s+.*userGuideHtml/m;
  assert.ok(
    !staticImportRe.test(mapSrc),
    'renderWaferMap.js has a static import of userGuideHtml — must use dynamic import() instead.',
  );
  assert.ok(
    !staticImportRe.test(gallerySrc),
    'renderWaferGallery.js has a static import of userGuideHtml — must use dynamic import() instead.',
  );
});
