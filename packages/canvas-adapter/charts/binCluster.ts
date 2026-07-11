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

import { getColorScheme } from '../../renderer/colorSchemes.js';
import { buildBinClusterData, type BinItem, type BinType } from '../../stats/binPareto.js';
import { CLR } from '../toolbar.js';
import { cardShell, observeResize, makeTooltip, makeSegmented, renderEmptyState, growCardToFitContent, resolveChartCanvasColors, PADDING, VALUE_WIDTH, type SaveImageHandler } from './chartShell.js';

const CLUSTER_LABEL_WIDTH = 90;
const CLUSTER_GAP = 8;
const SUBBAR_GAP = 1;
const SUBBAR_HEIGHT = 14;
const MAX_VISIBLE_BINS = 8;

export interface BinClusterPanelOptions {
  title?: string;
  groups: { key: string; items: BinItem[] }[];
  colorScheme?: string;
  onSaveImage?: SaveImageHandler;
}

export interface BinClusterPanelHandle {
  card: HTMLElement;
  destroy: () => void;
}

export function renderBinClusterPanel(options: BinClusterPanelOptions): BinClusterPanelHandle {
  const { groups, colorScheme = 'default', onSaveImage } = options;
  let binType: BinType = 'hbin';
  let titleText = options.title ?? 'Hard bin pareto';
  const { card, heading, body, controlsRow } = cardShell(titleText, onSaveImage);

  controlsRow.appendChild(makeSegmented(
    [['hbin', 'Hard bins'], ['sbin', 'Soft bins']],
    binType,
    v => { binType = v as BinType; titleText = `${binType === 'hbin' ? 'Hard' : 'Soft'} bin pareto`; heading.textContent = titleText; rebuildBody(); },
  ));

  const hint = document.createElement('div');
  hint.textContent = 'One cluster per bin · a sub-bar per group';
  Object.assign(hint.style, { color: CLR.label, fontSize: '11px', marginBottom: '6px' } as Partial<CSSStyleDeclaration>);
  card.insertBefore(hint, body);

  const tooltip = makeTooltip(card);
  let resizeHandle: { disconnect: () => void } | null = null;

  function rebuildBody(): void {
    resizeHandle?.disconnect();
    resizeHandle = null;
    body.innerHTML = '';
    const data = buildBinClusterData(groups, binType);

    if (data.bins.length === 0 || data.groups.length === 0) {
      renderEmptyState(body, 'No bin data available for the current grouping.');
      return;
    }

    const clusterGroups = data.groups;
    const bins = data.bins;
    const { forValue } = getColorScheme(colorScheme);
    const colorOf = (i: number) => forValue(clusterGroups.length <= 1 ? 0.5 : i / (clusterGroups.length - 1));
    const maxCount = Math.max(1, ...bins.flatMap(b => b.counts));
    const clusterHeight = clusterGroups.length * SUBBAR_HEIGHT + (clusterGroups.length - 1) * SUBBAR_GAP;
    const rowPitch = clusterHeight + CLUSTER_GAP;

    const legend = document.createElement('div');
    Object.assign(legend.style, { display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginBottom: '4px' } as Partial<CSSStyleDeclaration>);
    clusterGroups.forEach((g, i) => {
      const item = document.createElement('span');
      Object.assign(item.style, { display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: CLR.text } as Partial<CSSStyleDeclaration>);
      const sw = document.createElement('span');
      Object.assign(sw.style, { width: '10px', height: '10px', borderRadius: '2px', background: colorOf(i) } as Partial<CSSStyleDeclaration>);
      const txt = document.createElement('span');
      txt.textContent = g;
      item.append(sw, txt);
      legend.appendChild(item);
    });
    body.appendChild(legend);

    const scrollArea = document.createElement('div');
    const visibleHeight = PADDING * 2 + Math.min(bins.length, MAX_VISIBLE_BINS) * rowPitch;
    // overflowX explicit, not left at its 'visible' default — pairing
    // 'visible' with overflowY's non-'visible' value would force it to
    // compute as 'auto' per the CSS overflow spec, adding an unintended
    // horizontal scroll axis (see chartShell.ts's cardShell() comment).
    Object.assign(scrollArea.style, { overflowX: 'hidden', overflowY: 'auto', minHeight: '0', flex: '1', maxHeight: `${visibleHeight}px`, scrollbarGutter: 'stable' } as Partial<CSSStyleDeclaration>);
    growCardToFitContent(card, body, legend.offsetHeight + visibleHeight);
    body.appendChild(scrollArea);

    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.cursor = 'default';
    scrollArea.appendChild(canvas);

    const dpr = window.devicePixelRatio || 1;
    let hovered: { bin: number; group: number } | null = null;

    function plotMetrics() {
      const barX = PADDING + CLUSTER_LABEL_WIDTH;
      const barMaxWidth = Math.max(10, canvas.clientWidth - barX - VALUE_WIDTH - PADDING);
      return { barX, barMaxWidth };
    }

    function subBarAt(offsetX: number, offsetY: number): { bin: number; group: number } | null {
      const bin = Math.floor((offsetY - PADDING) / rowPitch);
      if (bin < 0 || bin >= bins.length) return null;
      const withinCluster = (offsetY - PADDING) - bin * rowPitch;
      const group = Math.floor(withinCluster / (SUBBAR_HEIGHT + SUBBAR_GAP));
      if (group < 0 || group >= clusterGroups.length) return null;
      const { barX, barMaxWidth } = plotMetrics();
      if (offsetX < barX || offsetX > barX + barMaxWidth) return null;
      return { bin, group };
    }

    function draw() {
      const theme = resolveChartCanvasColors(card);
      // scrollArea's own width, not card's — see barPanel.ts's identical fix
      // for why (stays correct when scrollArea's own vertical scrollbar is
      // active, i.e. bins.length > MAX_VISIBLE_BINS).
      const width = scrollArea.clientWidth;
      const height = PADDING * 2 + bins.length * rowPitch;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.font = '11px system-ui, sans-serif';
      ctx.textBaseline = 'middle';

      const { barX, barMaxWidth } = plotMetrics();

      bins.forEach((bin, bi) => {
        const clusterTop = PADDING + bi * rowPitch;

        ctx.fillStyle = theme.text;
        ctx.textAlign = 'right';
        ctx.fillText(bin.label, PADDING + CLUSTER_LABEL_WIDTH - 8, clusterTop + clusterHeight / 2);

        clusterGroups.forEach((_g, gi) => {
          const y = clusterTop + gi * (SUBBAR_HEIGHT + SUBBAR_GAP);
          const count = bin.counts[gi];
          const isHover = hovered && hovered.bin === bi && hovered.group === gi;

          if (isHover) {
            ctx.fillStyle = theme.bgHover;
            ctx.fillRect(0, y - 1, width, SUBBAR_HEIGHT + 2);
          }
          ctx.fillStyle = theme.track;
          ctx.fillRect(barX, y, barMaxWidth, SUBBAR_HEIGHT);
          const w = Math.max(count > 0 ? 1 : 0, (count / maxCount) * barMaxWidth);
          ctx.fillStyle = colorOf(gi);
          ctx.fillRect(barX, y, w, SUBBAR_HEIGHT);
        });

        ctx.fillStyle = theme.text;
        ctx.textAlign = 'right';
        ctx.fillText(`${bin.total}`, barX + barMaxWidth + VALUE_WIDTH, clusterTop + clusterHeight / 2);
      });
    }

    canvas.addEventListener('mousemove', e => {
      const rect = canvas.getBoundingClientRect();
      const hit = subBarAt(e.clientX - rect.left, e.clientY - rect.top);
      const changed = (hit?.bin !== hovered?.bin) || (hit?.group !== hovered?.group);
      hovered = hit;
      if (changed) draw();
      if (hit) {
        const bin = bins[hit.bin];
        const count = bin.counts[hit.group];
        const pct = bin.total > 0 ? (count / bin.total) * 100 : 0;
        const cardRect = card.getBoundingClientRect();
        tooltip.innerHTML = `<strong>${bin.label}</strong> · ${clusterGroups[hit.group]}<br>${count} dies (${pct.toFixed(1)}% of bin)`;
        tooltip.style.display = 'block';
        tooltip.style.left = `${e.clientX - cardRect.left + 14}px`;
        tooltip.style.top = `${e.clientY - cardRect.top + 14}px`;
      } else {
        tooltip.style.display = 'none';
      }
    });
    canvas.addEventListener('mouseleave', () => { if (hovered) { hovered = null; draw(); } tooltip.style.display = 'none'; });

    resizeHandle = observeResize(card, () => draw());
    draw();
  }

  rebuildBody();
  return { card, destroy: () => resizeHandle?.disconnect() };
}
