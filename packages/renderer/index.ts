// resolveTestNumber / findTestDef / getUniqueTestNumbers / generateTextOverlay are
// deliberately NOT re-exported: they are internal helpers of the view pipeline with
// no documented contract, and every consumer inside this repo imports them straight
// from './buildView.js'. Keeping them off the public surface is what stops the API
// growing by accident — add them back only with docs and a reason a host needs them.
export { getDieKey } from './buildView.js';
export type { PlotMode } from './buildView.js';
export { buildWaferMap, getTestPassStatus } from './buildWaferMap.js';
export type {
  DerivedTestDef, DieResult, WaferConfig, DieConfig, ReticleConfig, LotStackConfig, TestDef, BinDef,
  MetadataFieldDef, WaferMapInputBase, WaferMapInputSingle, WaferMapInputLotStack, WaferMapInputLayout,
  WaferMapInput, YieldSummary, WaferWarning, WaferMapResult,
} from './buildWaferMap.js';
// WaferMetadata/DieMetadata are renderer concepts (WaferConfig.metadata,
// DieResult.metadata) — re-export them here so consumers building renderer input
// don't have to reach into /core for the types.
export type { WaferMetadata, DieMetadata } from '../core/metadata.js';
export { registerValueColorScheme, listValueColorSchemes, resolveValueColorFn, registerBinColorScheme, listBinColorSchemes } from './colorSchemes.js';
export type { ValueColorScheme, BinColorScheme } from './colorSchemes.js';
export type { BinColors, BinColorSource, MapBinColorOptions } from './binColors.js';
export { binColorsForMaps } from './binColors.js';
// The derived-test mark and its key, for a host that lists tests in its own UI
// (tsmap's test selector) — so it marks them exactly as the library does,
// rather than keeping a copy of the glyph and the words that can drift.
export { DERIVED_MARK, DERIVED_KEY } from './testLabel.js';
