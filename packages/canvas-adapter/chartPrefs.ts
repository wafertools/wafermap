// The Insights charts' axis settings as view-option preferences (`chartAxisIncludesLimits`, `chartClipOutliers`,
// `chartLimitLines`), so they are reported and kept like every other preference. Its own small module: the
// renderers read it at mount, and the Insights tab itself is loaded only when it is first opened.

import type { AxisPrefs } from './charts/chartShell.js';

/** The charts' axis settings from a renderer's view options (the `chart*` preferences). */
export function axisPrefsFromOptions(o: {
  chartAxisIncludesLimits?: boolean; chartClipOutliers?: boolean; chartLimitLines?: AxisPrefs['limits'];
}): AxisPrefs {
  return { includeLimits: o.chartAxisIncludesLimits, clipOutliers: o.chartClipOutliers ?? false, limits: o.chartLimitLines ?? 'both' };
}

/** The `chart*` preferences an axis-settings change sets. */
export function optionsFromAxisPrefs(p: AxisPrefs) {
  return { chartAxisIncludesLimits: p.includeLimits, chartClipOutliers: p.clipOutliers, chartLimitLines: p.limits ?? 'both' };
}

/** The view-option keys that are the charts' axis settings: a change to them redraws no map. */
export const CHART_PREF_KEYS = ['chartAxisIncludesLimits', 'chartClipOutliers', 'chartLimitLines'] as const;
