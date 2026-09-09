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
import { prettyKey } from '../stats/facets.js';
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
  // True while the metadata is shown inline on the row instead of behind the
  // chevron — recomputed by render(), read by the toggle and by collapse().
  let inline = false;
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

  /**
   * Hard ceiling on how many fields may be shown inline, whatever the width.
   * Fit alone is not a sufficient test: a wafer carrying twenty short fields
   * would "fit" on a wide monitor and turn the identity row into a dense strip
   * of text that is harder to read than the label it replaced. Past this many,
   * the panel is the right surface and the chevron stays.
   */
  const MAX_INLINE_FIELDS = 4;

  // The fields rendered beside the label when they fit. Muted and lighter than
  // the label, which stays the identity anchor — this is supporting detail, not
  // a second heading.
  const inlineEl = doc.createElement('span');
  Object.assign(inlineEl.style, {
    fontSize: FONT.body, color: CLR.label, whiteSpace: 'nowrap',
    overflow: 'hidden', flexShrink: '0', display: 'none', marginLeft: SPACE.sm,
  } as Partial<CSSStyleDeclaration>);
  wrap.appendChild(inlineEl);

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

  /**
   * The fields worth showing beside the label — those whose value the label is
   * not already stating. The collapsed label is `lot · waferId`, so without
   * this filter the inline row would read "LOT-DEMO · W01  Lot: LOT-DEMO ·
   * Wafer Id: W01", restating the identity it sits next to and spending the
   * width that decides whether anything fits at all.
   */
  function inlineEntries(): Array<[string, string]> {
    if (lotStack) return [];   // a stack's context is a sentence, not a field list
    return metadataEntries(meta).filter(([, v]) => !currentLabel.includes(v));
  }

  /**
   * With the fields already rendered inline, did anything have to clip?
   *
   * This asks the layout rather than predicting it. The first version summed
   * the two elements' natural widths plus a gap and compared that to the row's
   * width — and got it wrong at the boundary, reporting a fit at exactly the
   * available width while the label was visibly truncated, because the real
   * spacing is the flex container's own `gap` AND the inline element's
   * `marginLeft`, and only one of the two was in the sum. Every such formula
   * has to re-derive spacing the stylesheet already applied, and is wrong the
   * moment either value changes.
   *
   * `scrollWidth > clientWidth` is the browser telling us directly that the
   * content did not fit its box — no spacing arithmetic, and automatically
   * correct if the gap, margin or font ever change. Both children are `nowrap`
   * with `overflow: hidden`, so clipping is exactly how not-fitting shows up.
   *
   * Returns true (treated as "does not fit") when the row has no width yet —
   * before mount, or while an ancestor is `display: none`. The ResizeObserver
   * re-tests once there is a real width, so the only cost is starting
   * collapsed.
   */
  function inlineOverflows(): boolean {
    if (!wrap.clientWidth) return true;
    return labelEl.scrollWidth > labelEl.clientWidth
        || inlineEl.scrollWidth > inlineEl.clientWidth
        || wrap.scrollWidth > wrap.clientWidth;
  }

  function render(): void {
    // No placeholder text when there's nothing to show — a made-up label like
    // "Wafer info" reads as real content until a reader notices it never
    // changes. Blank is honest; the row still exists to host the Expand
    // button (see showExpandButton) and the chevron/expand affordance when
    // there is expandable content despite no collapsed label.
    labelEl.textContent = currentLabel;

    // Inline mode: show the fields outright rather than behind a chevron, when
    // there are few enough of them AND they fit the width this row has. A
    // chevron that hides one short field costs a click to learn something the
    // row had room to say — but the same control is right when the fields are
    // many or the row is narrow, so the test is fit, not taste.
    //
    // Measured by rendering the candidate and asking whether it fits: laying it
    // out is the only honest way to know a string's width, and predicting it
    // from character counts is how a "fits" rule ends up wrong on the first
    // font it did not expect.
    const candidates = inlineEntries();
    inlineEl.textContent = candidates.map(([k, v]) => `${prettyKey(k)}: ${v}`).join(' · ');
    inlineEl.style.display = candidates.length > 0 ? '' : 'none';
    // Rendered visible for the measurement, then hidden again if it did not
    // fit. Both happen inside this call with no paint between, so the reader
    // never sees the rejected state.
    inline = candidates.length > 0
      && candidates.length <= MAX_INLINE_FIELDS
      && !inlineOverflows();
    inlineEl.style.display = inline ? '' : 'none';

    // Inline and expanded are alternatives, never both: the panel exists to
    // reveal what the row could not show, so leaving it reachable once the row
    // is showing everything offers a second copy of the same fields.
    const expandable = hasExpandableContent() && !inline;
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
    // `inline` guards this as well as the chevron: wireExpandToggle listens on
    // the whole `wrap`, so while the fields are inline a click anywhere along
    // the row would still open a panel that has nothing left to add.
    if (!hasExpandableContent() || inline) return;
    expanded = open;
    render();
  });

  render();

  // Re-test on resize: the inline decision is a function of the row's width, so
  // it has to be revisited when that changes — a window narrowed past the fit
  // must fall back to the chevron rather than clip the fields against the
  // controls beside them, and widening again should give them back.
  //
  // A single render settles it: render() makes the inline candidate visible and
  // then reads `scrollWidth`, which forces a synchronous layout, so the fit is
  // measured against real geometry within the same pass. `wrap` takes its width
  // from a `flex: 1` parent and so does not resize in response to its own
  // content, which is what keeps this observer from feeding itself.
  const resizeObs = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => render());
  resizeObs?.observe(wrap);

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
      resizeObs?.disconnect();
      expandToggle.destroy();
      wrap.remove();
      metaPanel.remove();
    },
  };
}
