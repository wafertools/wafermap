export { toCanvas } from './toCanvas.js';
export type { ToCanvasOptions, ToCanvasResult, CanvasHitTarget, ViewportTransform } from './toCanvas.js';

export { renderWaferMap } from './renderWaferMap.js';
/** @deprecated Use renderWaferMap instead. */
export { renderWaferMap as mountWaferCanvas } from './renderWaferMap.js';
export type { MountOptions, WaferCanvasController, WaferSceneOptions } from './renderWaferMap.js';

export { renderWaferGallery } from './renderWaferGallery.js';
export type { GalleryItem, GalleryItemFactory, GalleryOptions, GalleryController } from './renderWaferGallery.js';

export type { SummaryPanelOptions } from './summaryPanel.js';
