// Clustered bin pareto — one horizontal cluster per bin, with side-by-side
// sub-bars coloured per group. Used only when the Analysis tab's "Group by"
// is active; the plain (ungrouped) pareto uses `barPanel.ts`'s generic
// panel instead — a wholly different panel swapped in, not a variant of it
// (matching tsmap's actual behavior, verified by reading `main.ts`/
// `charts/binCluster.ts`). Self-contained: owns the hard/soft bin toggle
// and redraws in place.
//
// Trimmed from tsmap's version for this port: no click-to-open-wafer, same
// deferral as the rest of this pass (see WMAP_ISSUES.md).

import { buildBinClusterData, type BinItem, type BinType } from '../../stats/binPareto.js';
import { SPACE, FONT, CLR } from '../toolbar.js';
import { cardShell, makeTooltip, makeSegmented, renderEmptyState, type SaveImageHandler } from './chartShell.js';
import { renderGroupedBarPlot, type GroupedBarPlotHandle } from './groupedBarPlot.js';

const CLUSTER_LABEL_WIDTH = 90;
const MAX_VISIBLE_BINS = 8;

export interface BinClusterPanelOptions {
  title?: string;
  groups: { key: string; items: BinItem[] }[];
  colorScheme?: string;
  onSaveImage?: SaveImageHandler;
  /** Document to build this panel's DOM into. Default `document` — pass the
   *  host's own `ownerDocument` when the container might live in a
   *  different document (e.g. a gallery card detached into its own popup
   *  window). */
  ownerDocument?: Document;
}

export interface BinClusterPanelHandle {
  card: HTMLElement;
  destroy: () => void;
}

export function renderBinClusterPanel(options: BinClusterPanelOptions): BinClusterPanelHandle {
  // `colorScheme` is deliberately no longer read — sub-bars use the fixed
  // categorical palette (palette.ts); the option stays for API compatibility.
  const { groups, onSaveImage } = options;
  let binType: BinType = 'hbin';
  let titleText = options.title ?? 'Hard bin pareto';
  const { card, heading, body, controlsRow } = cardShell(titleText, onSaveImage, options.ownerDocument);

  controlsRow.appendChild(makeSegmented(
    [['hbin', 'Hard bins'], ['sbin', 'Soft bins']],
    binType,
    v => { binType = v as BinType; titleText = `${binType === 'hbin' ? 'Hard' : 'Soft'} bin pareto`; heading.textContent = titleText; rebuildBody(); },
    card.ownerDocument,
  ));

  const hint = card.ownerDocument.createElement('div');
  hint.textContent = 'One cluster per bin · a sub-bar per group';
  Object.assign(hint.style, { color: CLR.label, fontSize: FONT.body, marginBottom: SPACE.sm } as Partial<CSSStyleDeclaration>);
  card.insertBefore(hint, body);

  const tooltip = makeTooltip(card);
  let plot: GroupedBarPlotHandle | null = null;

  function rebuildBody(): void {
    plot?.destroy();
    plot = null;
    body.innerHTML = '';
    const data = buildBinClusterData(groups, binType);

    if (data.bins.length === 0 || data.groups.length === 0) {
      renderEmptyState(body, 'No bin data available for the current grouping.');
      return;
    }

    const clusterGroups = data.groups;
    const bins = data.bins;
    const maxCount = Math.max(1, ...bins.flatMap(b => b.counts));

    // Bin counts normalise to the largest count in the chart — the question
    // here is "how do these bins compare", so the biggest one defines the axis.
    plot = renderGroupedBarPlot(card, body, tooltip, {
      rows: bins.map(bin => ({
        label: bin.label,
        bars: bin.counts.map(count => ({ fraction: count / maxCount })),
        trailing: `${bin.total}`,
      })),
      groups: clusterGroups,
      labelWidth: CLUSTER_LABEL_WIDTH,
      maxVisibleRows: MAX_VISIBLE_BINS,
      tooltipHtml: (ri, gi) => {
        const bin = bins[ri];
        const count = bin.counts[gi];
        const pct = bin.total > 0 ? (count / bin.total) * 100 : 0;
        return `<strong>${bin.label}</strong> · ${clusterGroups[gi]}<br>${count} dies (${pct.toFixed(1)}% of bin)`;
      },
    });
  }

  rebuildBody();
  return { card, destroy: () => plot?.destroy() };
}
