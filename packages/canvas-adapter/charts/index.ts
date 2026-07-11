// Internal index for wmap's own chart panels, composed by canvas-adapter's
// Analysis tab (analysisTab.ts). Lives under canvas-adapter/ (not as a
// sibling top-level package) because every panel here depends on
// canvas-adapter's toolbar primitives (CLR, saveImageBlob, openModal, ICONS)
// and has no consumer outside canvas-adapter — a sibling package would
// create a circular package dependency. Not part of the package.json
// "exports" map yet — see WMAP_ISSUES.md tracked follow-up on whether/how to
// publish this as its own subpath once more panels land.

export { renderCapabilityPanel } from './capability.js';
export type { CapabilityPanelOptions, CapabilityPanelHandle } from './capability.js';
export { renderBoxplotPanel } from './boxplot.js';
export type { BoxplotPanelOptions, BoxplotPanelHandle } from './boxplot.js';
export { renderHistogramPanel } from './histogram.js';
export type { HistogramPanelOptions, HistogramPanelHandle } from './histogram.js';
export { renderCorrelationPanel } from './correlation.js';
export type { CorrelationPanelOptions, CorrelationPanelHandle } from './correlation.js';
export { renderScatterPanel } from './scatter.js';
export type { ScatterPanelOptions, ScatterPanelHandle } from './scatter.js';
export { renderBarPanel } from './barPanel.js';
export type { ChartPanel, BarPanelHandle } from './barPanel.js';
export { renderBinClusterPanel } from './binCluster.js';
export type { BinClusterPanelOptions, BinClusterPanelHandle } from './binCluster.js';
export * from './chartShell.js';
