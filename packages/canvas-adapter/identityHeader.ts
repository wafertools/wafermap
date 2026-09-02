// ── Identity header ─────────────────────────────────────────────────────────
// "Label + click-to-expand full metadata" component behind `renderWaferMap`'s
// single-wafer header row (this file used to be `metadataBadge.ts`, a corner
// overlay unique to renderWaferMap, before becoming this real layout row).
// `renderWaferGallery` does NOT use this module — it has its own separate
// `buildIdentityHeaderRow`, sharing only the low-level `wireExpandToggle`
// helper with this file. That's a known remaining duplication, not yet
// unified — see docs/architecture.md's `identityHeader` section.

import type { WaferMetadata } from '../core/metadata.js';
import { metadataEntries, buildCompactMetadataRows } from './summaryPanel.js';
import { SHADOW, LEADING, SPACE, FONT, CLR, Z_ABOVE, wireExpandToggle, type ExpandToggleHandle } from './toolbar.js';

export interface IdentityHeaderLotStack {
  lotSize: number;
  aggrMethod?: string;
}

export interface IdentityHeaderOptions {
  /** Present when the host result is a lot-stack aggregation rather than a
   *  single wafer — the metadata panel then leads with wafer count + method
   *  instead of a (nonexistent) single waferId. */
  lotStack?: IdentityHeaderLotStack;
  /** Document to build into. Default `document` — pass the render's own
   *  `ownerDocument` when the container might live in a different document
   *  (e.g. a gallery card detached into its own popup window). */
  ownerDocument?: Document;
}

export interface IdentityHeaderController {
  /** The header row itself: label + chevron (chevron only appears once
   *  there's something to expand). Mount wherever the header belongs —
   *  normal in-flow layout, its own height never changes. */
  wrap: HTMLDivElement;
  /**
   * The expandable metadata panel. Always created (so callers have a stable
   * element to place), but only ever visible once there's lot-stack context
   * or a metadata field to show. Absolutely positioned (`top:0;left:0;
   * right:0`) — mount it into a `position: relative` ancestor that should be
   * covered while expanded (e.g. the canvas area below the header). Never
   * changes `wrap`'s own height, so expanding never triggers a reflow/resize
   * of anything else.
   */
  metaPanel: HTMLDivElement;
  /** Re-render with a new label / metadata / lot-stack context. */
  update(label: string, metadata: WaferMetadata | null | undefined, lotStack?: IdentityHeaderLotStack): void;
  /** True when there is nothing at all to show (no label text, no metadata,
   *  no lot-stack) — the caller should not mount `wrap`/`metaPanel`. */
  isEmpty(): boolean;
  /** Force the metadata panel closed (chevron back to ▾) — for a caller that
   *  needs to cover `metaPanel` with something else (e.g. the Insights tab)
   *  and must not leave it expanded-but-hidden, which would desync the
   *  chevron/aria state from `metaPanel`'s own visibility. No-op if already
   *  collapsed. */
  collapse(): void;
  destroy(): void;
}

export function collapsedLabel(meta: WaferMetadata, lotStack: IdentityHeaderLotStack | undefined): string | undefined {
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

export function createIdentityHeader(
  label: string,
  metadata: WaferMetadata | null | undefined,
  opts: IdentityHeaderOptions = {},
): IdentityHeaderController {
  let currentLabel = label;
  let meta: WaferMetadata = metadata ?? {};
  let lotStack = opts.lotStack;
  let expanded = false;
  const doc = opts.ownerDocument ?? document;

  const wrap = doc.createElement('div');
  Object.assign(wrap.style, {
    display: 'flex', alignItems: 'center', gap: SPACE.xs, minWidth: '0',
  } as Partial<CSSStyleDeclaration>);

  // No flex/minWidth of its own — matches renderWaferGallery's own
  // identity label exactly, so the chevron sits right after the text in
  // both places, not pushed to the far edge of a stretched label.
  const labelEl = doc.createElement('span');
  Object.assign(labelEl.style, {
    fontWeight: '700', fontSize: FONT.sub, overflow: 'hidden', textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as Partial<CSSStyleDeclaration>);
  wrap.appendChild(labelEl);

  const chevron = doc.createElement('span');
  Object.assign(chevron.style, {
    fontSize: FONT.body, lineHeight: LEADING.none, color: CLR.label, flexShrink: '0', display: 'none',
  } as Partial<CSSStyleDeclaration>);
  wrap.appendChild(chevron);

  const metaPanel = doc.createElement('div');
  metaPanel.dataset.wmapMetaPanel = '1';
  Object.assign(metaPanel.style, {
    position:     'absolute',
    top:          '0', left: '0', right: '0',
    zIndex:       Z_ABOVE,
    background:   CLR.menuBg,
    borderBottom: `1px solid ${CLR.menuBorder}`,
    boxShadow:    SHADOW.menu,
    padding: `${SPACE.md} ${SPACE.lg}`,
    fontSize:     FONT.body,
    display:      'none',
  } as Partial<CSSStyleDeclaration>);

  function hasExpandableContent(): boolean {
    return metadataEntries(meta).length > 0 || !!lotStack;
  }

  function render(): void {
    // No placeholder text when there's nothing to show — a made-up label like
    // "Wafer info" reads as real content until a reader notices it never
    // changes. Blank is honest; the row still exists to host the Expand
    // button (see showExpandButton) and the chevron/expand affordance when
    // there is expandable content despite no collapsed label.
    labelEl.textContent = currentLabel;

    const expandable = hasExpandableContent();
    chevron.style.display = expandable ? '' : 'none';
    wrap.style.cursor = expandable ? 'pointer' : '';
    if (!expandable) expanded = false;
    chevron.textContent = expanded ? '▴' : '▾';
    metaPanel.style.display = expanded ? 'block' : 'none';

    if (expandable) {
      wrap.setAttribute('aria-expanded', String(expanded));
      wrap.setAttribute('aria-label', `Wafer info: ${currentLabel || 'this wafer'}. ${expanded ? 'Click to collapse.' : 'Click to expand.'}`);
    } else {
      wrap.removeAttribute('aria-expanded');
      wrap.removeAttribute('aria-label');
    }

    metaPanel.innerHTML = '';
    if (expanded) {
      if (lotStack) {
        const stackLine = doc.createElement('div');
        Object.assign(stackLine.style, { fontWeight: '600', marginBottom: '3px' } as Partial<CSSStyleDeclaration>);
        stackLine.textContent = lotStack.aggrMethod
          ? `${lotStack.lotSize} wafers stacked · ${lotStack.aggrMethod}`
          : `${lotStack.lotSize} wafers stacked`;
        metaPanel.appendChild(stackLine);
      }
      const rows = buildCompactMetadataRows(meta);
      if (rows) metaPanel.appendChild(rows);
    }
  }

  const expandToggle: ExpandToggleHandle = wireExpandToggle(wrap, (open) => {
    if (!hasExpandableContent()) return;
    expanded = open;
    render();
  });

  render();

  return {
    wrap,
    metaPanel,
    update(newLabel, newMetadata, newLotStack) {
      currentLabel = newLabel;
      meta = newMetadata ?? {};
      lotStack = newLotStack;
      render();
    },
    isEmpty() {
      return !currentLabel && !hasExpandableContent();
    },
    collapse() {
      if (!expanded) return;
      expanded = false;
      render();
    },
    destroy() {
      expandToggle.destroy();
      wrap.remove();
      metaPanel.remove();
    },
  };
}
