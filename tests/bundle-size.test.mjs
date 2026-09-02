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
//   2026-07-28: root raised from 41 KB after the affine display-transform
//   primitives, the shared core/utils helpers, and the wafer-geometry
//   contradiction warning — legitimate library growth, not bloat.
//   2026-08-16: render threshold raised 106 KB -> 130 KB (measured ~106 KB at
//   the time) after the coordinate-less die/wafer support — buildDieListSection,
//   the mapless-summary panel (bin breakdown / histogram), and the map's "no
//   position data" footer — legitimate library growth, not bloat.
//   2026-08-30: root raised 44 KB -> 48 KB (measured ~43 KB at the time) after
//   the stats package gained the wafer-to-wafer trend builder (trend.ts) and the
//   per-test pass-rate-by-group builder (testPassRate.ts), plus the shared
//   pearson helpers correlation.ts now exports — legitimate library growth, not
//   bloat. The chart panels themselves are in /render, not the root.
//   2026-09-02: render BASELINE dropped ~128 KB -> ~104 KB (threshold unchanged
//   at 130 KB) by deferring the Insights chart suite the same way the user guide
//   was already deferred — dynamic import in renderWaferMap/renderWaferGallery's
//   `ensureInsightsTab`. `insights` is opt-in and off by default, so ~25 KB
//   gzipped of chart code was being downloaded by every consumer to render a
//   wafer map they might never chart. This is the first entry here that moves
//   the baseline DOWN; the threshold's headroom went from ~2% to ~25%.
//   Note the measurement had to change with it: this file bundles to one file,
//   so a dynamic import is inlined unless the module is stubbed — `stubInsights`
//   models the split the same way `stubGuide` always has, and
//   'insightsTab is not statically imported' is what actually holds it in place.
//   Each line above states the THRESHOLD move; the inline comment on each entry
//   states what was actually measured when it was set. Keep both — reading only
//   one of them is how "raised from ~88 KB" ended up next to a 130_000 value.

import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { gzipSync } from 'zlib';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

const THRESHOLDS = {
  'wafermap (root)':            48_000,   // gzipped bytes — baseline ~43 KB
  'wafermap/render (initial)':  130_000,  // gzipped bytes — baseline ~104 KB, guide AND Insights excluded
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

/**
 * The Insights chart suite, modelled as the separate chunk it is.
 *
 * These measurements bundle to ONE file, so a dynamic `import()` is inlined
 * rather than split out — which is exactly why the guide is stubbed below
 * rather than trusted to disappear on its own. The suite is loaded on first
 * open (renderWaferMap/renderWaferGallery's `ensureInsightsTab`), and Insights
 * is opt-in and off by default, so a consumer who never enables it never
 * fetches any of it. `insightsTab is not statically imported` below is what
 * actually holds the deferral in place; this stub only keeps the threshold
 * measuring the chunk consumers really download.
 */
const stubInsights = {
  name: 'stub-insights',
  setup(b) {
    b.onResolve({ filter: /insightsTab/ }, () => ({ path: 'insights', namespace: 'insights' }));
    b.onLoad({ filter: /.*/, namespace: 'insights' }, () => ({
      contents: 'export const createInsightsTab = () => ({});',
      loader: 'js',
    }));
  },
};

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
  const gz = await bundleGzipped(resolve(dist, 'packages/canvas-adapter/index.js'), [stubGuide, stubInsights]);
  assert.ok(
    gz <= THRESHOLDS['wafermap/render (initial)'],
    `wafermap/render initial chunk too large: ${gz} bytes gzipped (threshold ${THRESHOLDS['wafermap/render (initial)']}). Check for new static imports of heavy modules.`,
  );
});

test('insightsTab is not statically imported by renderWaferMap or renderWaferGallery', async () => {
  // The chart suite (chartShell, histogram, correlation, boxplot, scatter,
  // capability, trend, testPassRate + insightsTab) is ~28 KB gzipped — 22% of
  // the initial chunk — and `insights` is opt-in, off by default. A static
  // import would make every consumer pay for a feature most never turn on.
  const { readFile } = await import('fs/promises');
  const [mapSrc, gallerySrc] = await Promise.all([
    readFile(resolve(dist, 'packages/canvas-adapter/renderWaferMap.js'), 'utf8'),
    readFile(resolve(dist, 'packages/canvas-adapter/renderWaferGallery.js'), 'utf8'),
  ]);
  const staticImportRe = /^import\s+.*insightsTab/m;
  assert.ok(
    !staticImportRe.test(mapSrc),
    'renderWaferMap.js has a static import of insightsTab — must use dynamic import() instead.',
  );
  assert.ok(
    !staticImportRe.test(gallerySrc),
    'renderWaferGallery.js has a static import of insightsTab — must use dynamic import() instead.',
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
