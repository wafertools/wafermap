// resolveTestNumber / findTestDef / getUniqueTestNumbers / generateTextOverlay are
// deliberately NOT re-exported: they are internal helpers of the view pipeline with
// no documented contract, and every consumer inside this repo imports them straight
// from './buildView.js'. Keeping them off the public surface is what stops the API
// growing by accident — add them back only with docs and a reason a host needs them.
export {
  buildView,
  getDieKey,
  buildHoverText,
  buildMapTitle,
} from './buildView.js';
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
export {
  hardBinColor,
  hardBinGreyscale,
  valueToViridis,
  valueToGreyscale,
  softBinColor,
  contrastTextColor,
} from './colorMap.js';
export * from './colorSchemes.js';
