export {
  buildView,
  resolveTestNumber,
  findTestDef,
  getUniqueTestNumbers,
  generateTextOverlay,
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
