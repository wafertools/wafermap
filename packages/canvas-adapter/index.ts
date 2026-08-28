export { toCanvas } from './toCanvas.js';
export type { ToCanvasOptions, ToCanvasResult, HitTarget, ViewportTransform } from './toCanvas.js';

export { renderWaferMap } from './renderWaferMap.js';
export type { RenderOptions, WaferMapController, WaferViewOptions, WaferPreferences, WaferDisplayState } from './renderWaferMap.js';

export { renderWaferGallery } from './renderWaferGallery.js';
export type { WaferMapDisplayItem, WaferMapDisplayItemFactory, GalleryOptions, GalleryController } from './renderWaferGallery.js';

export type { SummaryPanelOptions } from './summaryPanel.js';

// The general-purpose die-list table + CSV export — used internally for a
// fully coordinate-less wafer's map replacement and a mixed wafer's "+N
// unpositioned" footer, and exported here so a host can also build its own
// lot-level combined view (concatenating every wafer's `dies` with its own
// wafer-id column) rather than reimplementing the same table/CSV logic.
export { buildDieListSection } from './dieList.js';
export type { DieListOptions, DieListDisplayOptions } from './dieList.js';
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

// Opens the same guide window WaferMapController/GalleryController's own
// openUserGuide() opens, but with no live render required — for a host whose
// help entry point must also work in an empty state (nothing loaded yet).
export { openWaferMapGuide } from './toolbar.js';

// The toolbar's own icon set — a host rendering its own chrome (buttons,
// overlays) alongside wmap's can import ICONS to match wmap's iconography
// instead of copy-pasting SVGs that silently drift on the next redesign.
export { ICONS } from './icons.js';

// The Summary panel's "Summary report" button opens report HTML through this
// by default now — no setReportOpener wiring required just to view a report.
// Exported so a host wanting the same in-app modal for its own report-shaped
// content (or a custom "View report" entry point outside the panel) doesn't
// have to rebuild it. See packages/stats/renderFindingsReport.ts's
// setReportOpener/openHtmlReport for the "open as a real separate page"
// fallback this modal's own header button and toolbar link both route through.
export { openReportModal } from './toolbar.js';
export type { OverlayHandle } from './toolbar.js';
