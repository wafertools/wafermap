// Deprecated public exports: they must keep working unchanged until removal,
// tell a plain-JavaScript caller once what replaces them, and be struck through
// in a TypeScript caller's editor. The library's own code must never go through
// the wrappers, or every host would see a notice it did not cause. And the
// removal they announce must actually happen, in the release they name.
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
const { DEPRECATED_EXPORTS, DEPRECATED_REMOVAL_VERSION: REMOVAL } = await import('../dist/packages/renderer/deprecate.js');

const exportedFrom = (name) => ENTRIES.filter(entry => name in entry);

// ── What is deprecated ───────────────────────────────────────────────────────

const GRADIENT_HELPERS = ['valueToViridis', 'valueToGreyscale', 'getValueColorScheme'];
const CHART_BUILDERS_NAMES = [
  'buildYieldData', 'buildYieldDataCombined', 'buildBinParetoData', 'buildBinClusterData', 'buildCapabilityData',
  'buildTestBoxplotData', 'buildTestTrendData', 'trendCentre', 'buildTestPassRateData', 'hasJudgeableTests',
  'buildTestHistogramData', 'buildTestHistogramSeries', 'buildCorrelationMatrix', 'filterCorrelationMatrix',
  'buildScatterData', 'buildScatterDataGrouped',
];
const PIPELINE = [
  'buildView', 'toCanvas', 'createWafer', 'generateDies', 'clipDiesToWafer', 'applyOrientation', 'transformDies',
  'applyProbeSequence', 'generateReticleGrid', 'mapDataToDies', 'isInsideWafer', 'resolveGridPitch',
  'classifyDie', 'getRingLabel', 'aggregateValues', 'aggregateBinCounts', 'getUniqueBins', 'buildHoverText', 'buildMapTitle',
  'affineIdentity', 'affineRotation', 'affineMirror', 'affineCompose', 'affineInvert', 'affinePoint', 'affineVector', 'affineSwapsAxes',
];
const ACCIDENTAL = [
  'buildRingRegions', 'buildQuadrantRegions', 'buildSectorRegions', 'buildReticlePositionRegions', 'buildTestSiteRegions',
  'buildRegionYieldData', 'areQuadrantsAdjacent', 'parseRegionKey', 'sectorCompassNames',
  'classifyPattern', 'computeFunctionalYield', 'resolveMetadataColumns', 'discoverDieMetadataKeys',
  'renderSummaryReportHtml', 'renderLotSummaryReportHtml', 'openHtmlReport',
  'resolveBinColors', 'getBinColorScheme', 'contrastTextColor',
  'getDieTestValue', 'dieHasTestData', 'isParametricTest', 'isPositionedDie', 'metadataCategoricalValue',
  'buildDieListSection', 'DEFAULT_FACET_CURATION', 'STANDARD_WAFER_DIAMETERS_MM',
];
const EXPECTED = [...GRADIENT_HELPERS, ...CHART_BUILDERS_NAMES, ...PIPELINE, ...ACCIDENTAL];
const VALUES = ['DEFAULT_FACET_CURATION', 'STANDARD_WAFER_DIAMETERS_MM'];

// Exports a host needs, which must NOT be swept up by a deprecation.
const KEPT = [
  'buildWaferMap', 'analyzeWaferMap', 'analyzeWaferLot', 'renderWaferMap', 'renderWaferGallery',
  'getDieKey', 'getTestPassStatus', 'diePassStatus', 'isYieldEligibleDie', 'hasPosition', 'filterFindings',
  'resolveValueColorFn', 'FACET_NONE_VALUE', 'setReportOpener', 'setDetachWindowOpener',
  'buildFacetTable', 'facetValueOf', 'mergeTestDefs', 'collectWarnings', 'severityOf',
  'registerBinColorScheme', 'registerValueColorScheme', 'listBinColorSchemes', 'listValueColorSchemes',
  // Deprecated in 0.30.0, withdrawn in 0.30.1 on review (API_REMOVALS.md, Part 2).
  'visibleFindings', 'openReportModal', 'metadataDisplayValue', 'getReticleCell', 'renderFindingsReportHtml',
];

test('the registry holds exactly the names announced for removal', () => {
  assert.deepEqual([...DEPRECATED_EXPORTS.keys()].sort(), [...EXPECTED].sort());
  for (const name of VALUES) assert.equal(DEPRECATED_EXPORTS.get(name), 'value', `${name} is a constant`);
});

test('every deprecated name is still exported, and nothing a host needs was swept up', () => {
  for (const name of EXPECTED) assert.ok(exportedFrom(name).length > 0, `${name} must stay exported until ${REMOVAL}`);
  for (const name of KEPT) {
    assert.ok(exportedFrom(name).length > 0, `${name} is exported`);
    assert.ok(!DEPRECATED_EXPORTS.has(name), `${name} is not deprecated`);
  }
});

// ── Wrappers are pass-throughs ───────────────────────────────────────────────

const SAMPLES = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];

test('the deprecated gradient helpers return exactly what their replacement does', () => {
  for (const [name, scheme] of [['valueToViridis', 'default'], ['valueToGreyscale', 'greyscale']]) {
    const fn = api.resolveValueColorFn(scheme);
    for (const t of SAMPLES) assert.equal(api[name](t), fn(t), `${name}(${t})`);
  }
  assert.equal(api.getValueColorScheme('greyscale').forValue(0.5), api.resolveValueColorFn('greyscale')(0.5));
  assert.equal(api.getValueColorScheme('no-such-scheme').label, api.getValueColorScheme('default').label);
});

const testDefs = [
  { testNumber: 1, name: 'Idsat', limitLow: 0.2, limitHigh: 0.8 },
  { testNumber: 2, name: 'Vth' },
];
const results = [];
for (let x = -3; x <= 3; x++) {
  for (let y = -3; y <= 3; y++) {
    const i = results.length;
    results.push({ x, y, hbin: i % 5 === 0 ? 3 : 1, sbin: i % 7 === 0 ? 12 : 10,
      testValues: { 1: (i % 10) / 10, 2: 1 + ((i * 7) % 13) / 13 } });
  }
}
const map = api.buildWaferMap({ results, testDefs });
const item = { dies: map.dies, label: 'W01', key: 'W01' };
const groups = [{ key: 'lot', items: [item, { ...item, label: 'W02', key: 'W02' }] }];

const impls = {
  ...await import('../dist/packages/stats/yield.js'),
  ...await import('../dist/packages/stats/binPareto.js'),
  ...await import('../dist/packages/stats/capability.js'),
  ...await import('../dist/packages/stats/boxplot.js'),
  ...await import('../dist/packages/stats/trend.js'),
  ...await import('../dist/packages/stats/testPassRate.js'),
  ...await import('../dist/packages/stats/histogram.js'),
  ...await import('../dist/packages/stats/correlation.js'),
  ...await import('../dist/packages/stats/scatter.js'),
  ...await import('../dist/packages/core/transforms.js'),
};

/** Deprecated functions with arguments that produce real output from the fixture. */
const WITH_ARGS = {
  buildYieldData:           () => [[item], map.passBins],
  buildYieldDataCombined:   () => [groups, map.passBins],
  buildBinParetoData:       () => [[item], 'hbin'],
  buildBinClusterData:      () => [groups, 'sbin'],
  buildCapabilityData:      () => [[item], testDefs],
  buildTestBoxplotData:     () => [[item], 1],
  buildTestTrendData:       () => [[item], 1],
  trendCentre:              () => [impls.buildTestTrendData([item], 1)],
  buildTestPassRateData:    () => [groups, testDefs, 'spec'],
  hasJudgeableTests:        () => [testDefs, 'spec', map.dies],
  buildTestHistogramData:   () => [[item], 1],
  buildTestHistogramSeries: () => [groups, 2],
  buildCorrelationMatrix:   () => [map.dies, testDefs],
  filterCorrelationMatrix:  () => [impls.buildCorrelationMatrix(map.dies, testDefs), { minTests: 2 }],
  buildScatterData:         () => [[item], 1, 2],
  buildScatterDataGrouped:  () => [groups, 1, 2],
  // A generic one: the wrapper must keep affineCompose's frame-typed signature and behaviour.
  affineCompose:            () => [impls.affineRotation(90), impls.affineMirror(true, false)],
};

test('a deprecated function returns exactly what its implementation does', () => {
  for (const [name, argsOf] of Object.entries(WITH_ARGS)) {
    const [wrapper] = exportedFrom(name).map(entry => entry[name]);
    assert.notEqual(wrapper, impls[name], `${name} is exported through its deprecation wrapper`);
    const args = argsOf();
    assert.deepEqual(wrapper(...args), impls[name](...args), name);
  }
  assert.ok(impls.buildBinParetoData([item], 'hbin').length >= 2, 'the fixture is not trivially empty');
});

// ── Notices, declarations, and the library's own imports ─────────────────────

test('each deprecated function gives one notice, naming the release that removes it', () => {
  const functions = EXPECTED.filter(name => !VALUES.includes(name));
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
    assert.ok(mine[0].includes(`will be removed in ${REMOVAL}.`), `${name} names ${REMOVAL}: ${mine[0]}`);
  }
  for (const name of GRADIENT_HELPERS) {
    assert.match(notices.find(n => n.includes(`] ${name} is deprecated`)), /resolveValueColorFn/, `${name} names its replacement`);
  }
  for (const name of [...CHART_BUILDERS_NAMES, ...PIPELINE, ...ACCIDENTAL.filter(n => !VALUES.includes(n))]) {
    assert.match(notices.find(n => n.includes(`] ${name} is deprecated`)), /github\.com\/wafertools\/wafermap\/issues/,
      `${name}'s notice says where to object`);
  }
});

test('an editor strikes deprecated names through at a host import, and nothing else', async () => {
  // The claim the @deprecated tags exist for, checked the way an editor makes it:
  // TypeScript's language service, on a consumer importing from the published entries.
  const ts = (await import('typescript')).default;
  const consumer = path.join(root, 'tests', '__deprecation_probe__.ts');
  const source = [
    "import { buildView, createWafer, buildYieldData, valueToViridis, STANDARD_WAFER_DIAMETERS_MM, getDieKey, analyzeWaferMap } from '../dist/index.js';",
    "import { toCanvas, renderWaferMap } from '../dist/packages/canvas-adapter/index.js';",
    'export const used = [buildView, createWafer, buildYieldData, valueToViridis, STANDARD_WAFER_DIAMETERS_MM, getDieKey, analyzeWaferMap, toCanvas, renderWaferMap];',
  ].join('\n');
  const options = { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2022, strict: true, skipLibCheck: true, types: [] };
  const host = {
    getScriptFileNames: () => [consumer], getScriptVersion: () => '0',
    getScriptSnapshot: (f) => f === consumer ? ts.ScriptSnapshot.fromString(source) : fs.existsSync(f) ? ts.ScriptSnapshot.fromString(fs.readFileSync(f, 'utf8')) : undefined,
    getCurrentDirectory: () => root, getCompilationSettings: () => options, getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: (f) => f === consumer || ts.sys.fileExists(f), readFile: (f) => f === consumer ? source : ts.sys.readFile(f),
    readDirectory: ts.sys.readDirectory, directoryExists: ts.sys.directoryExists, getDirectories: ts.sys.getDirectories,
  };
  const ls = ts.createLanguageService(host);
  const errors = ls.getSemanticDiagnostics(consumer).map(d => ts.flattenDiagnosticMessageText(d.messageText, ' '));
  assert.deepEqual(errors, [], 'the probe type-checks against the published declarations');
  const flagged = new Set(ls.getSuggestionDiagnostics(consumer).filter(d => d.reportsDeprecated)
    .map(d => /'(\w+)' is deprecated/.exec(ts.flattenDiagnosticMessageText(d.messageText, ' '))?.[1]));
  assert.deepEqual([...flagged].sort(), ['STANDARD_WAFER_DIAMETERS_MM', 'buildView', 'buildYieldData', 'createWafer', 'toCanvas', 'valueToViridis']);
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
    .map(dir => fs.readFileSync(path.join(root, 'dist', dir, 'deprecated.d.ts'), 'utf8')).join('\n');
  const version = REMOVAL.replace(/\./g, '\\.');
  for (const name of EXPECTED) {
    const decl = new RegExp(`/\\*\\*(?:(?!\\*/)[\\s\\S])*@deprecated Removed in ${version}\\.(?:(?!\\*/)[\\s\\S])*\\*/\\s*export declare const ${name}\\b`);
    assert.match(dts, decl, `${name} must carry "@deprecated Removed in ${REMOVAL}." on its own declaration`);
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
        for (const name of EXPECTED) {
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
  const reached = released.filter(v => minorOf(v) >= minorOf(REMOVAL));
  const stillExported = EXPECTED.filter(name => exportedFrom(name).length > 0);
  assert.ok(reached.length === 0 || stillExported.length === 0,
    `${reached[0]} is being released, but ${stillExported.length} exports deprecated for removal in ${REMOVAL} ` +
    `are still exported (${stillExported.slice(0, 4).join(', ')}…). Remove them — TODO.md lists the steps.`);
});
