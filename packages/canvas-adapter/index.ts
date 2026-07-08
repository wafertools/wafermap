export { toCanvas } from './toCanvas.js';
export type { ToCanvasOptions, ToCanvasResult, HitTarget, CanvasHitTarget, ViewportTransform } from './toCanvas.js';

export { renderWaferMap } from './renderWaferMap.js';
export type { RenderOptions, MountOptions, WaferMapController, WaferCanvasController, WaferViewOptions, WaferPreferences, WaferDisplayState } from './renderWaferMap.js';

export { renderWaferGallery } from './renderWaferGallery.js';
export type { WaferMapDisplayItem, WaferMapDisplayItemFactory, GalleryOptions, GalleryController } from './renderWaferGallery.js';

export type { SummaryPanelOptions } from './summaryPanel.js';

// setDetachWindowOpener is the one toolbar.ts export exposed publicly — hosts
// where `window.open` is blocked/unusable (e.g. Tauri) register a custom
// opener for gallery card detach windows through it. Mirrors setReportOpener
// (packages/stats/index.ts) for the same class of problem.
export { setDetachWindowOpener } from './toolbar.js';
export type { DetachWindowOpener } from './toolbar.js';
