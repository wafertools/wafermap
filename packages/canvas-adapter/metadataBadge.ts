// ── Metadata badge ──────────────────────────────────────────────────────────
// Always-visible, compact wafer/lot identity overlay for `renderWaferMap`'s
// single-wafer canvas. Sits bottom-left, diagonally opposite the toolbar
// (top-right) — the toolbar has no responsive collapse and can span nearly
// the full width of a narrow canvas, so a badge sharing its corner would risk
// collision; vertical separation avoids that regardless of toolbar width.
//
// Deliberately an overlay, not a layout element: it never changes canvasWrap's
// box size, so the map never shrinks to make room for it. Collapsed by
// default to a single identifying line; click/Enter/Space expands in place
// (still an overlay, not a layout push) to the full compact field set.
//
// Mounted as a child of canvasWrap in renderWaferMap.ts, so it is
// automatically covered whenever the Insights tab's inset:0 overlay is shown
// — same coverage behaviour the toolbar already relies on, no extra wiring.

import type { WaferMetadata } from '../core/metadata.js';
import { metadataEntries, buildCompactMetadataRows } from './summaryPanel.js';
import { CLR, Z_BASE, wireExpandToggle } from './toolbar.js';

export interface MetadataBadgeLotStack {
  lotSize: number;
  aggrMethod?: string;
}

export interface MetadataBadgeOptions {
  /** Present when the host result is a lot-stack aggregation rather than a
   *  single wafer — the badge then leads with wafer count + aggregation
   *  method instead of a (nonexistent) single waferId, per this project's
   *  requirement that stacked maps always self-identify as such. */
  lotStack?: MetadataBadgeLotStack;
  /** Document to build the badge into. Default `document` — pass the render's
   *  own `ownerDocument` when the container might live in a different
   *  document (e.g. a gallery card detached into its own popup window). */
  ownerDocument?: Document;
}

export interface MetadataBadgeController {
  el: HTMLDivElement;
  /** Re-render with new metadata / lot-stack context — call from `setResult()`
   *  whenever `wafer`/`isLotStack`/`aggrMethod`/`lotSize` change, so the badge
   *  never goes stale. */
  update(metadata: WaferMetadata | null | undefined, lotStack?: MetadataBadgeLotStack): void;
  /** True when there is nothing to show (no lot-stack context and no metadata
   *  fields at all) — the caller should not mount `el` in that case, rather
   *  than show empty chrome. */
  isEmpty(): boolean;
  destroy(): void;
}

function collapsedLabel(meta: WaferMetadata, lotStack: MetadataBadgeLotStack | undefined): string | undefined {
  if (lotStack) {
    return lotStack.aggrMethod
      ? `${lotStack.lotSize} wafers · ${lotStack.aggrMethod}`
      : `${lotStack.lotSize} wafers`;
  }
  if (meta.lot && meta.waferId !== undefined && meta.waferId !== '') {
    const lot = String(meta.lot);
    const waferId = String(meta.waferId);
    // Some hosts (e.g. tsmap, for multi-lot views) embed the lot ID inside
    // waferId itself (e.g. lot "CLUST-LOT-03", waferId "CLUST-LOT-03 · W02")
    // — joining unconditionally would repeat it. If waferId already contains
    // the lot string, it's already self-identifying; don't prefix it again.
    return waferId.includes(lot) ? waferId : `${lot} · ${waferId}`;
  }
  for (const key of ['lot', 'waferId', 'product', 'testProgram'] as const) {
    const v = meta[key];
    if (v !== undefined && v !== null && v !== '') return String(v);
  }
  return undefined;
}

export function createMetadataBadge(
  metadata: WaferMetadata | null | undefined,
  opts: MetadataBadgeOptions = {},
): MetadataBadgeController {
  let meta: WaferMetadata = metadata ?? {};
  let lotStack = opts.lotStack;
  let expanded = false;
  const doc = opts.ownerDocument ?? document;

  const el = doc.createElement('div');
  Object.assign(el.style, {
    position:     'absolute',
    bottom:       '4px',
    left:         '4px',
    zIndex:       Z_BASE,
    background:   CLR.menuBg,
    border:       `1px solid ${CLR.menuBorder}`,
    borderRadius: '4px',
    boxShadow:    '0 1px 4px rgba(0,0,0,0.12)',
    padding:      '3px 8px',
    fontSize:     '11px',
    color:        CLR.value,
    cursor:       'pointer',
    maxWidth:     '260px',
    pointerEvents: 'auto',
  } as Partial<CSSStyleDeclaration>);

  const summaryRow = doc.createElement('div');
  Object.assign(summaryRow.style, {
    display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap',
  } as Partial<CSSStyleDeclaration>);
  const summaryText = doc.createElement('span');
  summaryText.style.overflow = 'hidden';
  summaryText.style.textOverflow = 'ellipsis';
  const chevron = doc.createElement('span');
  Object.assign(chevron.style, { fontSize: '12px', lineHeight: '1', color: CLR.label, flexShrink: '0' } as Partial<CSSStyleDeclaration>);
  summaryRow.appendChild(summaryText);
  summaryRow.appendChild(chevron);

  const detailWrap = doc.createElement('div');
  Object.assign(detailWrap.style, { marginTop: '5px', display: 'none' } as Partial<CSSStyleDeclaration>);

  el.appendChild(summaryRow);
  el.appendChild(detailWrap);

  function render(): void {
    const label = collapsedLabel(meta, lotStack) ?? 'Wafer info';
    summaryText.textContent = label;
    chevron.textContent = expanded ? '▴' : '▾';
    el.setAttribute('aria-expanded', String(expanded));
    el.setAttribute('aria-label', `Wafer info: ${label}. ${expanded ? 'Click to collapse.' : 'Click to expand.'}`);

    detailWrap.innerHTML = '';
    detailWrap.style.display = expanded ? 'block' : 'none';
    if (!expanded) return;

    if (lotStack) {
      const stackLine = doc.createElement('div');
      Object.assign(stackLine.style, { fontWeight: '600', marginBottom: '3px' } as Partial<CSSStyleDeclaration>);
      stackLine.textContent = lotStack.aggrMethod
        ? `${lotStack.lotSize} wafers stacked · ${lotStack.aggrMethod}`
        : `${lotStack.lotSize} wafers stacked`;
      detailWrap.appendChild(stackLine);
    }
    const rows = buildCompactMetadataRows(meta);
    if (rows) detailWrap.appendChild(rows);
  }

  const expandToggle = wireExpandToggle(el, (open) => {
    expanded = open;
    render();
  });

  render();

  return {
    el,
    update(newMetadata, newLotStack) {
      meta = newMetadata ?? {};
      lotStack = newLotStack;
      render();
    },
    isEmpty() {
      return !lotStack && metadataEntries(meta).length === 0;
    },
    destroy() {
      expandToggle.destroy();
      el.remove();
    },
  };
}
