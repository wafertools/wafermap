// resolveTestNumber / findTestDef / getUniqueTestNumbers / generateTextOverlay are
// deliberately NOT re-exported: they are internal helpers of the view pipeline with
// no documented contract, and every consumer inside this repo imports them straight
// from './buildView.js'. Keeping them off the public surface is what stops the API
// growing by accident — add them back only with docs and a reason a host needs them.
export { getDieKey } from './buildView.js';
export type {
  View,
  MapTitleParts,
  PlotMode,
  ViewRect,
  ViewText,
  ViewHoverPoint,
  ViewOverlay,
  ViewOptions,
} from './buildView.js';
export * from './buildWaferMap.js';
// WaferMetadata/DieMetadata are renderer concepts (WaferConfig.metadata,
// DieResult.metadata) — re-export them here so consumers building renderer input
// don't have to reach into /core for the types.
export type { WaferMetadata, DieMetadata } from '../core/metadata.js';
export * from './colorSchemes.js';
export type { BinColors, BinColorOptions } from './binColors.js';

// Deprecated in 0.30.0, removed in 0.31.0. Each is wrapped in ./deprecated.ts, whose
// declarations carry the `@deprecated` tags; this named re-export shadows any `export *` above.
export {
  valueToViridis, valueToGreyscale, getValueColorScheme, buildView,
  buildHoverText, buildMapTitle, resolveBinColors, getBinColorScheme,
  contrastTextColor, dieHasTestData, isParametricTest, getDieTestValue,
  STANDARD_WAFER_DIAMETERS_MM,
} from './deprecated.js';
