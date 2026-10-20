// The user-guide sections the app cites ("How to read this: …"). Internal.
//
// Cited by title, never by number: the guide window shows no section numbers (a host's own guide comes first and
// numbers from 1 too), and a title still reads on a saved image or on paper. `id` is the heading's id in the guide
// window (scripts/build-user-guide.mjs: `wmap-` and the title's slug), so a link opens the guide at it.
// tests/guideSections.test.mjs checks every entry against the built guide.

export interface GuideSection { id: string; title: string }

export const GUIDE_SECTIONS = {
  groups: { id: 'wmap-comparing-groups-of-wafers', title: 'Comparing groups of wafers' },
  dividesYield: { id: 'wmap-what-divides-yield', title: 'What divides yield' },
  probability: { id: 'wmap-the-cumulative-probability-plot', title: 'The cumulative probability plot' },
  control: { id: 'wmap-control-charts', title: 'Control charts' },
  goal: { id: 'wmap-capability-ppk-and-the-goal-plot', title: 'Capability, Ppk and the goal plot' },
  heatmap: { id: 'wmap-heatmaps-and-the-difference-map', title: 'Heatmaps and the difference map' },
  pat: { id: 'wmap-part-average-testing-pat', title: 'Part average testing (PAT)' },
  fit: { id: 'wmap-fit-lines-r-and-y-x', title: 'Fit lines, R² and y = x' },
  bands: { id: 'wmap-bands-on-a-line', title: 'Bands on a line' },
  rescaling: { id: 'wmap-rescaling-values', title: 'Rescaling values' },
  ranges: { id: 'wmap-ranges-panels-and-what-if-limits', title: 'Ranges, panels and what-if limits' },
} as const satisfies Record<string, GuideSection>;

/** Several cites as plain text, one sentence: `How to read this: “Control charts” and “Bands on a line” in the user guide.` */
export function guideCitesText(sections: readonly GuideSection[]): string[] {
  if (sections.length === 0) return [];
  return [`How to read this: ${sections.map(s => `“${s.title}”`).join(sections.length === 2 ? ' and ' : ', ')} in the user guide.`];
}

/** A cite as plain text, for a saved image or print: `How to read this: “Control charts” in the user guide` (no full stop). */
export function guideCiteText(section: GuideSection, lead = 'How to read this'): string {
  return `${lead}: “${section.title}” in the user guide`;
}
