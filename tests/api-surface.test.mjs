// The half of the public API that export-surface.test.mjs cannot see.
//
// That test snapshots the RUNTIME exports — values. Two other ways the surface
// grows passed through unguarded until 0.30.4:
//
//  - exported TYPES, which vanish at runtime, and arrive by `export *` from a
//    module as easily as by an index file edit;
//  - FIELDS on the option and input types a host writes — RenderOptions,
//    InsightsOptions, TestDef, … — which is where an option matrix grows.
//
// Both are read from the built .d.ts files with TypeScript's own checker, so
// what is snapshotted is exactly what a consumer's compiler sees.
//
// When this fails: apply CLAUDE.md's "Export what a host app needs" rule to each
// added name — name the host use, and why renderWaferMap / renderWaferGallery /
// analyzeWaferMap cannot meet it. Only then regenerate the snapshot:
//
//   UPDATE_API_SURFACE=1 node --test tests/api-surface.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = resolve(root, 'tests/api-surface.json');

const ENTRIES = {
  '.'          : 'dist/index.d.ts',
  './core'     : 'dist/packages/core/index.d.ts',
  './renderer' : 'dist/packages/renderer/index.d.ts',
  './stats'    : 'dist/packages/stats/index.d.ts',
  './render'   : 'dist/packages/canvas-adapter/index.d.ts',
  './worker'   : 'dist/packages/worker/index.d.ts',
};

// The types a host writes into or calls. A path after the name reaches a type
// that is only public through a field (SweepSpec is InsightsOptions['sweeps']).
const FIELD_TYPES = [
  'WaferMapInput', 'WaferMapInputLayout', 'WaferConfig', 'DieConfig', 'TestDef', 'DerivedTestDef',
  'DieResult', 'BinDef', 'LotStackConfig', 'ReticleConfig', 'WaferMetadata',
  'WaferMapResult',
  'AnalyzeWaferMapOptions',
  'RenderOptions', 'GalleryOptions', 'InsightsOptions', 'SummaryPanelOptions', 'FindingsNotice',
  'WaferMapDisplayItem', 'WaferMapController', 'GalleryController',
  'InsightsOptions.sweeps[]', 'InsightsOptions.sweeps[].series[]',
];

const program = ts.createProgram(Object.values(ENTRIES).map(f => resolve(root, f)), { noEmit: true });
const checker = program.getTypeChecker();
const resolveAlias = s => (s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s);

function exportsOf(file) {
  const sf = program.getSourceFile(resolve(root, file));
  assert.ok(sf, `${file} not built — run npm run build`);
  return checker.getExportsOfModule(checker.getSymbolAtLocation(sf));
}

function typeOnlyExports(file) {
  return exportsOf(file)
    .filter(s => !(resolveAlias(s).flags & ts.SymbolFlags.Value))
    .map(s => s.name)
    .sort();
}

const allExports = new Map();
for (const file of Object.values(ENTRIES)) for (const s of exportsOf(file)) allExports.set(s.name, s);

function fieldsOf(path) {
  const [name, ...steps] = path.split('.');
  const sym = allExports.get(name);
  assert.ok(sym, `${name} is not exported from any entry point`);
  const decl = resolveAlias(sym).declarations?.[0];
  let type = checker.getDeclaredTypeOfSymbol(resolveAlias(sym));
  for (const step of steps) {
    const array = step.endsWith('[]');
    const prop = type.getProperty(array ? step.slice(0, -2) : step);
    assert.ok(prop, `${path}: no field ${step}`);
    type = checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(prop, decl));
    if (array) type = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
  }
  return type.getProperties().map(p => p.name).sort();
}

const actual = {
  types: Object.fromEntries(Object.entries(ENTRIES).map(([k, f]) => [k, typeOnlyExports(f)])),
  fields: Object.fromEntries(FIELD_TYPES.map(p => [p, fieldsOf(p)])),
};

if (process.env.UPDATE_API_SURFACE) {
  writeFileSync(SNAPSHOT, JSON.stringify(actual, null, 2) + '\n');
}
const expected = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));

const RULE = 'Apply CLAUDE.md "Export what a host app needs" to each addition, then '
  + 'regenerate with UPDATE_API_SURFACE=1 node --test tests/api-surface.test.mjs';

function diff(was, now) {
  return { added: now.filter(n => !was.includes(n)), removed: was.filter(n => !now.includes(n)) };
}

for (const entry of Object.keys(ENTRIES)) {
  test(`${entry} exported types are stable`, () => {
    const d = diff(expected.types[entry] ?? [], actual.types[entry]);
    assert.deepEqual(d, { added: [], removed: [] },
      `${entry} exported types changed.\n  Added:   ${d.added.join(', ') || 'none'}\n  Removed: ${d.removed.join(', ') || 'none'}\n${RULE}`);
  });
}

for (const path of FIELD_TYPES) {
  test(`${path} fields are stable`, () => {
    const d = diff(expected.fields[path] ?? [], actual.fields[path]);
    assert.deepEqual(d, { added: [], removed: [] },
      `${path} fields changed.\n  Added:   ${d.added.join(', ') || 'none'}\n  Removed: ${d.removed.join(', ') || 'none'}\n${RULE}`);
  });
}
