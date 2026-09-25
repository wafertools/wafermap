// Deprecated public exports: they must keep working unchanged until removal,
// tell a plain-JavaScript caller once what replaces them, and be struck through
// in a TypeScript caller's editor. The library's own code must never go through
// the wrappers, or every host would see a notice it did not cause. And the
// removal they announce must actually happen, in the release they name.
//
// Nothing is deprecated at present: 0.31.0 removed everything deprecated in
// 0.30.0 and 0.30.3. The generic checks below hold the next deprecation to the
// same rules; REMOVED keeps the removed names from coming back unnoticed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// The /render entry needs a DOM to load.
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'HTMLCanvasElement', 'HTMLDivElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent']) {
  if (dom.window[k]) globalThis[k] = dom.window[k];
}
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
const mm = () => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
dom.window.matchMedia = mm; globalThis.matchMedia = mm;
class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }
dom.window.ResizeObserver = FakeResizeObserver; globalThis.ResizeObserver = FakeResizeObserver;

// Capture notices before anything calls a wrapper: they fire once per process.
const notices = [];
const realWarn = console.warn;
console.warn = (...args) => { notices.push(args.join(' ')); };

const api         = await import('../dist/index.js');
const coreApi     = await import('../dist/packages/core/index.js');
const rendererApi = await import('../dist/packages/renderer/index.js');
const statsApi    = await import('../dist/packages/stats/index.js');
const renderApi   = await import('../dist/packages/canvas-adapter/index.js');
const ENTRIES = [api, coreApi, rendererApi, statsApi, renderApi];
const { DEPRECATED_EXPORTS, DEPRECATED_REMOVALS, DEPRECATED_REMOVAL_VERSION: REMOVAL } = await import('../dist/packages/renderer/deprecate.js');

const exportedFrom = (name) => ENTRIES.filter(entry => name in entry);

// ── What is deprecated ───────────────────────────────────────────────────────

// Names deprecated now, each removed in DEPRECATED_REMOVAL_VERSION. Empty since 0.31.0.
const EXPECTED = [];
// A name deprecated after REMOVAL was scheduled goes here with its own later
// removal version: a removal must follow a release in which the name shipped
// deprecated.
const LATER = {};
const ALL = [...EXPECTED, ...Object.keys(LATER)];
const removalOf = (name) => LATER[name] ?? REMOVAL;
const VALUES = [];

// Removed in 0.31.0 (API_REMOVALS.md, Part 2). Restoring one is a decision to
// record there first, with the reason a host needs it — not a snapshot refresh.
const REMOVED = [
  // Value-gradient helpers
  'valueToViridis', 'valueToGreyscale', 'getValueColorScheme',
  // Chart-drawing preparation
  'buildYieldData', 'buildYieldDataCombined', 'buildBinParetoData', 'buildBinClusterData', 'buildCapabilityData',
  'buildTestBoxplotData', 'buildTestTrendData', 'trendCentre', 'buildTestPassRateData', 'hasJudgeableTests',
  'buildTestHistogramData', 'buildTestHistogramSeries', 'buildCorrelationMatrix', 'filterCorrelationMatrix',
  'buildScatterData', 'buildScatterDataGrouped',
  // The low-level drawing pipeline
  'buildView', 'toCanvas', 'createWafer', 'generateDies', 'clipDiesToWafer', 'applyOrientation', 'transformDies',
  'applyProbeSequence', 'generateReticleGrid', 'mapDataToDies', 'isInsideWafer', 'resolveGridPitch',
  'classifyDie', 'getRingLabel', 'aggregateValues', 'aggregateBinCounts', 'getUniqueBins', 'buildHoverText', 'buildMapTitle',
  'affineIdentity', 'affineRotation', 'affineMirror', 'affineCompose', 'affineInvert', 'affinePoint', 'affineVector', 'affineSwapsAxes',
  // Exported by accident
  'buildRingRegions', 'buildQuadrantRegions', 'buildSectorRegions', 'buildReticlePositionRegions', 'buildTestSiteRegions',
  'buildRegionYieldData', 'areQuadrantsAdjacent', 'parseRegionKey', 'sectorCompassNames',
  'classifyPattern', 'computeFunctionalYield', 'resolveMetadataColumns', 'discoverDieMetadataKeys',
  'renderSummaryReportHtml', 'renderLotSummaryReportHtml', 'openHtmlReport',
  'resolveBinColors', 'getBinColorScheme', 'contrastTextColor',
  'getDieTestValue', 'dieHasTestData', 'isParametricTest', 'isPositionedDie', 'metadataCategoricalValue',
  'buildDieListSection', 'DEFAULT_FACET_CURATION', 'STANDARD_WAFER_DIAMETERS_MM',
  'renderFindingsReportHtml',
];

// Exports a host needs, which must NOT be swept up by a deprecation.
const KEPT = [
  'buildWaferMap', 'analyzeWaferMap', 'analyzeWaferLot', 'renderWaferMap', 'renderWaferGallery',
  'getDieKey', 'getTestPassStatus', 'diePassStatus', 'isYieldEligibleDie', 'hasPosition', 'filterFindings',
  'resolveValueColorFn', 'FACET_NONE_VALUE', 'setReportOpener', 'setDetachWindowOpener',
  'buildFacetTable', 'facetValueOf', 'mergeTestDefs', 'collectWarnings', 'severityOf',
  'registerBinColorScheme', 'registerValueColorScheme', 'listBinColorSchemes', 'listValueColorSchemes',
  'binColorsForMaps', 'renderWaferReportHtml', 'renderLotReportHtml',
  // Deprecated in 0.30.0, withdrawn in 0.30.1 on review (API_REMOVALS.md, Part 2).
  'visibleFindings', 'openReportModal', 'metadataDisplayValue', 'getReticleCell',
];

test('the registry holds exactly the names announced for removal', () => {
  assert.deepEqual([...DEPRECATED_EXPORTS.keys()].sort(), [...ALL].sort());
  for (const name of ALL) assert.equal(DEPRECATED_REMOVALS.get(name), removalOf(name), `${name} is removed in ${removalOf(name)}`);
  for (const name of VALUES) assert.equal(DEPRECATED_EXPORTS.get(name), 'value', `${name} is a constant`);
});

test('every deprecated name is still exported, and nothing a host needs was swept up', () => {
  for (const name of ALL) assert.ok(exportedFrom(name).length > 0, `${name} must stay exported until ${removalOf(name)}`);
  for (const name of KEPT) {
    assert.ok(exportedFrom(name).length > 0, `${name} is exported`);
    assert.ok(!DEPRECATED_EXPORTS.has(name), `${name} is not deprecated`);
  }
});

test('the names removed in 0.31.0 stay removed', () => {
  assert.equal(REMOVED.length, 74);
  const back = REMOVED.filter(name => exportedFrom(name).length > 0);
  assert.deepEqual(back, [], 'record a restoration in API_REMOVALS.md, with the host need, before exporting one again');
});

// ── Notices, declarations, and the library's own imports ─────────────────────

test('each deprecated function gives one notice, naming the release that removes it', () => {
  const functions = ALL.filter(name => !VALUES.includes(name));
  for (let i = 0; i < 3; i++) {
    for (const name of functions) {
      for (const entry of exportedFrom(name)) {
        try { entry[name](); } catch { /* called with no arguments: only the notice matters here */ }
      }
    }
  }
  console.warn = realWarn;
  for (const name of functions) {
    const mine = notices.filter(n => n.includes(`] ${name} is deprecated`));
    assert.equal(mine.length, 1, `${name}: ${mine.length} notices`);
    assert.ok(mine[0].includes(`will be removed in ${removalOf(name)}.`), `${name} names ${removalOf(name)}: ${mine[0]}`);
  }
  for (const name of functions) {
    assert.match(notices.find(n => n.includes(`] ${name} is deprecated`)), /github\.com\/wafertools\/wafermap\/issues/,
      `${name}'s notice says where to object`);
  }
});

test('no library module imports from a deprecated.ts — only each index re-exports it', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!p.endsWith('.ts') || e.name === 'index.ts') continue;
      if (/from\s*'[^']*deprecated\.js'/.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(root, p));
    }
  };
  walk(path.join(root, 'packages'));
  assert.deepEqual(offenders, []);
});

test('the published declarations tag each one "@deprecated Removed in <version>."', () => {
  const dts = ['packages/core', 'packages/renderer', 'packages/stats', 'packages/canvas-adapter']
    .map(dir => path.join(root, 'dist', dir, 'deprecated.d.ts'))
    .filter(file => fs.existsSync(file))
    .map(file => fs.readFileSync(file, 'utf8')).join('\n');
  for (const name of ALL) {
    const version = removalOf(name).replace(/\./g, '\\.');
    const decl = new RegExp(`/\\*\\*(?:(?!\\*/)[\\s\\S])*@deprecated Removed in ${version}\\.(?:(?!\\*/)[\\s\\S])*\\*/\\s*export declare const ${name}\\b`);
    assert.match(dts, decl, `${name} must carry "@deprecated Removed in ${removalOf(name)}." on its own declaration`);
  }
});

test('no library module imports a deprecated name through an index file', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!p.endsWith('.ts') || e.name === 'index.ts') continue;
      const src = fs.readFileSync(p, 'utf8');
      for (const m of src.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'([^']*index\.js)'/g)) {
        for (const name of ALL) {
          if (new RegExp(`\\b${name}\\b`).test(m[1])) offenders.push(`${path.relative(root, p)}: ${name} from ${m[2]}`);
        }
      }
    }
  };
  walk(path.join(root, 'packages'));
  assert.deepEqual(offenders, [], 'import the defining module instead, or every host sees a notice it did not cause');
});

// ── The removal is scheduled, and the schedule is enforced ──────────────────

const minorOf = (v) => { const [major, minor] = v.split('.').map(Number); return major * 1000 + minor; };

test(`the deprecated exports are gone before ${REMOVAL} is prepared`, () => {
  assert.match(REMOVAL, /^\d+\.\d+\.0$/, 'a removal lands in a minor release');
  // Checked against the changelog as well as package.json because `npm version`
  // runs the tests BEFORE it bumps the version — but after the release's heading
  // has been written, which check-changelog requires. So this fails while the
  // removal release is being prepared, not after it has been tagged.
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const released = [pkg.version, ...[...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map(m => m[1])];
  // One check per removal release: each name is held to its own.
  for (const version of new Set(ALL.map(removalOf))) {
    assert.match(version, /^\d+\.\d+\.0$/, 'a removal lands in a minor release');
    const reached = released.filter(v => minorOf(v) >= minorOf(version));
    const stillExported = ALL.filter(name => removalOf(name) === version && exportedFrom(name).length > 0);
    assert.ok(reached.length === 0 || stillExported.length === 0,
      `${reached[0]} is being released, but ${stillExported.length} exports deprecated for removal in ${version} ` +
      `are still exported (${stillExported.slice(0, 4).join(', ')}…). Remove them before releasing.`);
  }
});
