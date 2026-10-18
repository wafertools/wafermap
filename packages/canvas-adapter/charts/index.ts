// Internal index for wmap's own chart panels, composed by canvas-adapter's
// Analysis tab (analysisTab.ts). Lives under canvas-adapter/ (not as a
// sibling top-level package) because every panel here depends on
// canvas-adapter's toolbar primitives (CLR, saveImageBlob, openModal, ICONS)
// and has no consumer outside canvas-adapter — a sibling package would
// create a circular package dependency. Not part of the package.json
// "exports" map.

export { renderCapabilityPanel } from './capability.js';
export type { CapabilityPanelOptions, CapabilityPanelHandle } from './capability.js';
export { renderCorrelationPanel } from './correlation.js';
export type { CorrelationPanelOptions, CorrelationPanelHandle } from './correlation.js';
export * from './chartShell.js';
