// Text a finding is shown with, shared by the Summary panel and both HTML reports. Kept apart from
// `reportHtml.ts` (which is the report's markup and stylesheet) so the panel can read it without
// carrying the report builders: the report is loaded when it is opened, not with the map.

import type { StatsFinding } from './types.js';
import { derivedTestNote } from '../renderer/testLabel.js';

/**
 * A finding's hover text, for the Summary panel and both HTML reports alike —
 * the one rule for it. The sentence already carries the `†` for a finding about
 * a derived test; the tooltip adds the words for it and the expression, on a
 * line of their own.
 */
export function formatFindingTooltip(finding: StatsFinding): string {
  const note = derivedTestNote(finding.variable);
  return note ? `${finding.summary}\n${note}` : finding.summary;
}
