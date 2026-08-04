export { toCanvas } from './toCanvas.js';
export type { ToCanvasOptions, ToCanvasResult, HitTarget, ViewportTransform } from './toCanvas.js';

export { renderWaferMap } from './renderWaferMap.js';
export type { RenderOptions, WaferMapController, WaferViewOptions, WaferPreferences, WaferDisplayState } from './renderWaferMap.js';

export { renderWaferGallery } from './renderWaferGallery.js';
export type { WaferMapDisplayItem, WaferMapDisplayItemFactory, GalleryOptions, GalleryController } from './renderWaferGallery.js';

export type { SummaryPanelOptions } from './summaryPanel.js';
// Warning surfacing — `WarningsOptions` configures the built-in indicator and
// the `onWarning` stream; `collectWarnings` is exported so a host that turns the
// UI off can reproduce exactly the set the library would have shown.
export { collectWarnings, severityOf } from './warnings.js';
export type { WarningsOptions } from './warnings.js';
export type { InsightsOptions, InsightsView } from './insightsTab.js';

// setDetachWindowOpener is one of two toolbar.ts exports exposed publicly —
// hosts where `window.open` is blocked/unusable (e.g. Tauri) register a
// custom opener for gallery card detach windows through it. Mirrors
// setReportOpener (packages/stats/index.ts) for the same class of problem.
export { setDetachWindowOpener } from './toolbar.js';
export type { DetachWindowOpener } from './toolbar.js';

// UserGuideExtension is the type for RenderOptions/GalleryOptions'
// userGuideExtension option — a host's own documentation inserted into
// wmap's built-in end-user guide window, so there's one help button instead
// of two.
export type { UserGuideExtension } from './toolbar.js';
