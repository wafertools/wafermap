// ── User guide window and report modal ─────────────────────────────────────────
// Internal module (the public pieces are re-exported from index.ts). Split out of
// toolbar.ts, which keeps the shared tokens, menus, tooltip and overlay primitive.

import { openHtmlReport } from '../stats/renderFindingsReport.js';
import { buildWaferMap } from '../renderer/buildWaferMap.js';
import { analyzeWaferMap } from '../stats/analyzeWaferMap.js';
import { CLR, FONT, RADIUS, MOTION, wireControlHover, copyWmapThemeTokens, syncWmapPopupTheme, openModal, openFloatingWindow, wireExpandToggle, type OverlayHandle } from './toolbar.js';

// ── User guide window ───────────────────────────────────────────────────────────
//
// Non-modal: the guide has no reparented content (it's freshly built HTML,
// destroyed on close) and a user plausibly wants to keep it open while trying a
// feature on the live page behind it — unlike the gallery/single-map expand,
// there's no "hole left behind" risk here. At most one guide window is allowed
// open at a time (enforced below); this keeps window.__wmapDemoApi safe as a
// single global without needing to make it instance-scoped, since the guide's
// demo widgets only ever call the library's own stateless factory functions
// (buildWaferMap/renderWaferMap/renderWaferGallery/analyzeWaferMap) — never
// host-app state — so it doesn't matter which map's help button opened it.

/** Only `.close()` is ever called on this — deliberately narrower than
 *  `OverlayHandle` so both the floating-window branch (which returns a real
 *  `OverlayHandle`, a structural superset) and the popup branch (which has
 *  no backdrop/box/contentWrap to speak of) can satisfy it without a cast. */
interface GuideHandle { close: () => void; }
let openGuideHandle: GuideHandle | null = null;

type GuideApi = { buildWaferMap: unknown; renderWaferMap: unknown; renderWaferGallery: unknown; analyzeWaferMap: unknown };

/**
 * Host-supplied content inserted into wmap's own embedded user-guide window,
 * so a host app's own documentation and wmap's reference live behind one
 * help button instead of two separate ones.
 */
export interface UserGuideExtension {
  /**
   * Host-provided HTML, inserted before wmap's own guide content. Static
   * content only — must not contain `<script>` tags. wmap re-executes
   * exactly one inline script (its own live-demo bootstrap, always the
   * last element in `html`) by finding the content div's first
   * `<script>` in document order; a `<script>` in this HTML would be
   * found instead, silently breaking wmap's own live demos.
   */
  html: string;
  /**
   * Overrides the window's title text (default `'Wafer Map — User Guide'`).
   * Use this when the host's own content should frame the whole document —
   * wmap's own `<h1>` stays as-is further down the page, so the result
   * reads as one combined guide with the host's section first, not a title
   * rewrite.
   */
  title?: string;
}

// `--wmap-guide-reading-width` — the shared CSS custom property wmap's own
// `.wmap-guide` reading column reads via `max-width: var(--wmap-guide-
// reading-width, 720px)`, and widens to 1000px when the guide window is
// maximised (see openGuideInFloatingWindow's onMaximizeChange below, which
// sets it on the shared content wrapper rather than toggling a class scoped
// to `.wmap-guide` itself). A host's own `UserGuideExtension.html` can use
// the SAME `max-width: var(--wmap-guide-reading-width, <yourDefault>)` on
// its own top-level content block to keep its own reading measure in step
// with wmap's as the window resizes/maximises, with no dependency on any
// wmap-internal class name.

// Fixed, not measured: `buildGuideToc` runs before `content` is attached to a
// laid-out document (see `buildGuideContent`'s own doc comment), so
// `getBoundingClientRect()` would read 0 here. The bar's own height below is
// set to this same literal (`height: '40px'`), not just padding, specifically
// so this stays accurate regardless of font metrics/rendering — SCROLL_MARGIN
// is the bar height plus a little breathing room, applied to every heading so
// a jump target never lands hidden under the sticky bar.
const GUIDE_TOC_BAR_HEIGHT = 40;
const GUIDE_TOC_SCROLL_MARGIN = GUIDE_TOC_BAR_HEIGHT + 8;

/**
 * Builds a single combined "Contents" nav for the guide window — covering
 * every `<h2 id>` in `content` regardless of whether it came from a host's
 * `UserGuideExtension.html` or wmap's own guide, in document order. This is
 * what makes the combined document read as ONE guide rather than two stacked
 * ones: a host's guide content and wmap's own are otherwise just two blocks
 * of prose with no shared navigation between them, and nothing to jump back
 * to once a reader scrolls into either one. Runs unconditionally (there is no
 * "extension-only" mode) — wmap's own guide alone already has enough
 * sections to benefit from this, so every host gets it, not just one passing
 * an extension.
 *
 * A sticky bar (`position: sticky; top: 0`) pinned to the top of the guide's
 * own scroll container (`content` itself — both callers below give it
 * `overflow: auto`) holds a "Contents" disclosure toggle (`wireExpandToggle`,
 * the same click/Enter/Space-toggle, Escape/outside-click-closes primitive
 * used elsewhere in this file, e.g. the gallery card metadata reveal) and a
 * "Top" shortcut — together these are the answer to "how do I get back" once
 * a reader has jumped into a section, without resorting to a per-section
 * "back to top" link after every heading. Skipped entirely when there are
 * fewer than two sections to list (not worth the chrome).
 */
/**
 * In-page find-in-page for the guide's own content — text search + highlight
 * + prev/next, the same job a browser's native Ctrl+F does. Built **only**
 * for the in-page floating-window fallback (`showSearch` at the `buildGuideToc`
 * call site below): a real popup window (the common case) is an actual OS
 * window with nothing else on the page, so native find already searches it
 * with no gap to fill — adding a redundant custom box there would just be
 * one more thing sitting in the bar unused. The fallback only runs where
 * `window.open` is blocked/unavailable (Tauri/Electron/WebView2), which is
 * exactly where native find may not be reachable from inside the embedded
 * WebView at all.
 *
 * Matches are wrapped in plain `<mark>` elements with no custom background —
 * every browser already renders `<mark>` as a highlighted (typically yellow)
 * span with no CSS needed, the same look a native find highlight has, so
 * this never needs to invent its own highlight colour. The current match
 * additionally gets an outline in `CLR.iconActive` to stand out from the
 * rest. Matching is a plain case-insensitive substring search — no regex, no
 * fuzzy matching — which is what "search this page" means to a reader who
 * knows the word they're looking for.
 */
function buildGuideSearch(doc: Document, content: HTMLElement): HTMLElement {
  const wrap = doc.createElement('div');
  wrap.classList.add('wmap-guide-search');
  wrap.style.cssText = 'display:flex;align-items:center;gap:2px;margin-left:10px;flex:1;min-width:80px;max-width:260px;';

  const input = doc.createElement('input');
  input.type = 'text';
  input.placeholder = 'Search guide…';
  input.setAttribute('aria-label', 'Search guide');
  input.style.cssText = `flex:1;min-width:0;padding:4px 8px;font-size:12px;background:${CLR.menuBg};color:${CLR.text};border:1px solid ${CLR.menuBorder};border-radius:${RADIUS.control};outline:none;`;
  // Native outline suppressed above and replaced with a border-colour swap —
  // the same convention makeMenuSearchBox uses, kept here for one consistent
  // "this text input is focused" look across the library.
  input.addEventListener('focus', () => { input.style.borderColor = CLR.iconActive; });
  input.addEventListener('blur', () => { input.style.borderColor = CLR.menuBorder; });

  const countLabel = doc.createElement('span');
  countLabel.setAttribute('role', 'status');
  countLabel.setAttribute('aria-live', 'polite');
  countLabel.style.cssText = `font-size:12px;color:${CLR.label};min-width:44px;text-align:center;flex-shrink:0;white-space:nowrap;`;

  function navButton(glyph: string, ariaLabel: string): HTMLButtonElement {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.textContent = glyph;
    btn.setAttribute('aria-label', ariaLabel);
    btn.disabled = true;
    btn.style.cssText = `border:none;background:none;cursor:pointer;padding:4px 6px;border-radius:${RADIUS.control};font-size:12px;color:${CLR.label};flex-shrink:0;opacity:0.4;`;
    btn.addEventListener('mouseenter', () => { if (!btn.disabled) btn.style.background = CLR.bgHover; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'none'; });
    return btn;
  }
  const prevBtn = navButton('▲', 'Previous match');
  const nextBtn = navButton('▼', 'Next match');

  let marks: HTMLElement[] = [];
  let activeIndex = -1;

  function updateNavEnabled(): void {
    const disabled = marks.length === 0;
    prevBtn.disabled = disabled;
    nextBtn.disabled = disabled;
    prevBtn.style.opacity = disabled ? '0.4' : '';
    nextBtn.style.opacity = disabled ? '0.4' : '';
  }

  function clearMarks(): void {
    for (const m of marks) {
      m.parentNode?.replaceChild(doc.createTextNode(m.textContent ?? ''), m);
    }
    content.normalize();
    marks = [];
    activeIndex = -1;
  }

  function setActive(index: number): void {
    if (marks.length === 0) return;
    if (activeIndex >= 0) marks[activeIndex].style.outline = 'none';
    activeIndex = ((index % marks.length) + marks.length) % marks.length;
    const activeMark = marks[activeIndex];
    activeMark.style.outline = `2px solid ${CLR.iconActive}`;
    activeMark.style.outlineOffset = '1px';
    activeMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    countLabel.textContent = `${activeIndex + 1}/${marks.length}`;
  }

  function runSearch(query: string): void {
    clearMarks();
    const q = query.trim();
    if (!q) { countLabel.textContent = ''; updateNavEnabled(); return; }
    const qLower = q.toLowerCase();
    // Walk plain text nodes under `content` — excludes this search bar's own
    // subtree (the TOC's re-statement of every heading title would otherwise
    // double-match alongside the real heading) and the live-demo script tag.
    const walker = doc.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const el = node.parentElement;
        if (!el || el.closest('script,style,.wmap-guide-toc')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const textNodes: Text[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) textNodes.push(n as Text);

    for (const node of textNodes) {
      const text = node.textContent ?? '';
      const textLower = text.toLowerCase();
      if (!textLower.includes(qLower)) continue;
      const frag = doc.createDocumentFragment();
      let last = 0;
      let idx = textLower.indexOf(qLower);
      while (idx !== -1) {
        if (idx > last) frag.appendChild(doc.createTextNode(text.slice(last, idx)));
        const mark = doc.createElement('mark');
        mark.textContent = text.slice(idx, idx + q.length);
        frag.appendChild(mark);
        marks.push(mark);
        last = idx + q.length;
        idx = textLower.indexOf(qLower, last);
      }
      if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)));
      node.parentNode?.replaceChild(frag, node);
    }

    updateNavEnabled();
    if (marks.length === 0) countLabel.textContent = 'No matches';
    else setActive(0);
  }

  input.addEventListener('input', () => runSearch(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      setActive(activeIndex + (e.shiftKey ? -1 : 1));
    } else if (e.key === 'Escape') {
      if (input.value) { input.value = ''; runSearch(''); }
      else input.blur();
    }
  });
  prevBtn.addEventListener('click', () => setActive(activeIndex - 1));
  nextBtn.addEventListener('click', () => setActive(activeIndex + 1));

  wrap.append(input, countLabel, prevBtn, nextBtn);
  return wrap;
}

function buildGuideToc(doc: Document, content: HTMLElement, showSearch: boolean): void {
  const headings = [...content.querySelectorAll<HTMLElement>('h2[id]')];
  if (headings.length < 2) return;

  // Every heading (not just the h2s listed below) gets a scroll offset, since
  // a guide's OWN internal cross-references (both wmap's and a host
  // extension's — each already rewrites its internal links to scrollIntoView,
  // independently of this TOC) can target h3/h4 ids too, and those would now
  // land under the sticky bar exactly like an h2 would without this.
  for (const h of content.querySelectorAll<HTMLElement>('h1[id],h2[id],h3[id],h4[id]')) {
    h.style.scrollMarginTop = `${GUIDE_TOC_SCROLL_MARGIN}px`;
  }

  const wrap = doc.createElement('div');
  wrap.classList.add('wmap-guide-toc');
  wrap.style.cssText = `position:sticky;top:0;z-index:2;background:${CLR.menuBg};border-bottom:1px solid ${CLR.menuBorder};font-family:system-ui,-apple-system,"Segoe UI",sans-serif;`;

  const bar = doc.createElement('div');
  bar.style.cssText = `display:flex;align-items:center;gap:4px;height:${GUIDE_TOC_BAR_HEIGHT}px;padding:0 12px;box-sizing:border-box;`;

  const chevron = doc.createElement('span');
  chevron.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  chevron.style.cssText = `display:inline-flex;transition:transform ${MOTION.base};flex-shrink:0;`;

  const toggleBtn = doc.createElement('button');
  toggleBtn.type = 'button';
  const panelId = 'wmap-guide-toc-panel';
  toggleBtn.setAttribute('aria-expanded', 'false');
  toggleBtn.setAttribute('aria-controls', panelId);
  toggleBtn.style.cssText = `display:flex;align-items:center;gap:6px;border:none;background:none;cursor:pointer;padding:6px 8px;margin:0 -8px 0 -8px;border-radius:${RADIUS.control};font-size:13px;font-weight:600;color:${CLR.text};`;
  const label = doc.createElement('span');
  label.textContent = `Contents (${headings.length})`;
  toggleBtn.append(chevron, label);
  toggleBtn.addEventListener('mouseenter', () => { toggleBtn.style.background = CLR.bgHover; });
  toggleBtn.addEventListener('mouseleave', () => { toggleBtn.style.background = 'none'; });

  const topBtn = doc.createElement('button');
  topBtn.type = 'button';
  topBtn.textContent = '↑ Top';
  topBtn.style.cssText = `margin-left:auto;border:none;background:none;cursor:pointer;padding:6px 8px;border-radius:${RADIUS.control};font-size:12px;color:${CLR.label};`;
  topBtn.addEventListener('mouseenter', () => { topBtn.style.background = CLR.bgHover; });
  topBtn.addEventListener('mouseleave', () => { topBtn.style.background = 'none'; });
  topBtn.addEventListener('click', () => {
    toggle.close();
    content.scrollTo({ top: 0, behavior: 'smooth' });
  });

  if (showSearch) bar.append(toggleBtn, buildGuideSearch(doc, content), topBtn);
  else bar.append(toggleBtn, topBtn);

  const panel = doc.createElement('div');
  panel.id = panelId;
  panel.hidden = true;
  panel.style.cssText = 'padding:2px 12px 12px;max-height:min(60vh,440px);overflow-y:auto;';

  // A host's own guide and wmap's own each number their h2/h3/h4 headings
  // from 1 in their own source markdown — correct when either is read as its
  // own standalone document, but combined into one window the reader has no
  // reason to know there even *are* two source documents (a host's help
  // button is one button, opening what reads as one guide — see
  // UserGuideExtension's doc). Carrying both numbering runs straight into
  // this single document reads as broken and duplicated — not just in this
  // TOC list, but in the actual body headings too ("1. …", "2. …" … then
  // "1. …", "2. …" again once the second guide's content starts). So this
  // strips any leading "N." / "N.M" prefix a heading's own text supplies —
  // from the real heading in the body, not just its TOC copy — and lets
  // position/nesting in the one combined document carry the order instead.
  // Only the heading's first text node is touched, so any inline markup
  // inside it (a link, code span, etc.) is left alone.
  const NUMBER_PREFIX = /^\s*\d+(?:\.\d+)*\.\s+/;
  for (const h of content.querySelectorAll<HTMLElement>('h2[id],h3[id],h4[id]')) {
    const first = h.firstChild;
    if (first?.nodeType === Node.TEXT_NODE) {
      first.textContent = (first.textContent ?? '').replace(NUMBER_PREFIX, '');
    }
  }

  const list = doc.createElement('ul');
  list.setAttribute('role', 'list');
  // Multi-column, not a row-major grid: browsers fill a CSS multi-column box
  // top-to-bottom within each column before starting the next one, so
  // adjacent entries read top-down like an ordinary printed TOC — a
  // left-to-right grid reads adjacent entries as unrelated instead.
  list.style.cssText = 'list-style:none;margin:0;padding:0;columns:200px;column-gap:24px;';
  for (const h of headings) {
    const li = doc.createElement('li');
    li.style.cssText = 'break-inside:avoid;';
    const a = doc.createElement('a');
    a.href = `#${h.id}`;
    // No number stripping needed here any more — the heading itself was
    // already stripped above, so its text is clean.
    a.textContent = h.textContent ?? '';
    a.style.cssText = `display:block;padding:4px 6px;margin:0 -6px;border-radius:${RADIUS.control};font-size:12.5px;color:${CLR.iconActive};text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
    a.addEventListener('mouseenter', () => { a.style.background = CLR.bgHover; });
    a.addEventListener('mouseleave', () => { a.style.background = 'none'; });
    a.addEventListener('click', (e) => {
      e.preventDefault();
      toggle.close();
      h.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    li.appendChild(a);
    list.appendChild(li);
  }
  panel.appendChild(list);

  const toggle = wireExpandToggle(toggleBtn, (open) => {
    panel.hidden = !open;
    toggleBtn.setAttribute('aria-expanded', String(open));
    chevron.style.transform = open ? 'rotate(180deg)' : 'none';
  });

  wrap.append(bar, panel);
  content.prepend(wrap);
}

/**
 * Builds the guide's content div in `doc` (its own document — the floating
 * window shares the host's; a popup has its own) and inserts `contentHtml`.
 * Does **not** activate the inline live-demo script yet — see
 * `activateGuideScripts`, which the caller must run only after this `content`
 * element is connected to `doc`. `targetWindow.__wmapDemoApi` is set here (for
 * that script to read once it runs) and restored (not just cleared) on close —
 * guards a race where a second `openUserGuideWindow` call already overwrote it
 * with a newer api before this older instance's own close handler runs.
 *
 * `showSearch` opts into the in-page find-in-page box (`buildGuideSearch`) —
 * true only from the in-page floating-window fallback, where there's no
 * native Ctrl+F equivalent to fall back on; a real popup window needs none.
 */
function buildGuideContent(doc: Document, targetWindow: Window, contentHtml: string, api: GuideApi, showSearch: boolean): { content: HTMLElement; restoreApi: () => void } {
  const w = targetWindow as any;
  const prevApi = w.__wmapDemoApi;
  w.__wmapDemoApi = api;
  const content = doc.createElement('div');
  // Stable hook for print CSS (scripts/build-user-guide.mjs) to target
  // regardless of which of the two structures this content ends up in — a
  // real popup's body (openGuideInPopup) has content as body's only child;
  // the in-page floating-window fallback nests it inside .wmap-window-box.
  content.classList.add('wmap-guide-content');
  content.innerHTML = contentHtml;
  buildGuideToc(doc, content, showSearch);
  return { content, restoreApi: () => { if (w.__wmapDemoApi === api) w.__wmapDemoApi = prevApi; } };
}

/**
 * Re-executes the guide's one inline live-demo script and mounts the demos.
 * `innerHTML` never runs scripts, so the inert one `content` already has (from
 * `buildGuideContent`) is found and cloned into a fresh `<script>` element,
 * which *does* execute — but only once inserted into a **connected** document;
 * a `<script>` appended to a still-detached element does not run (verified
 * directly: Chromium only performs a script element's insertion steps once it
 * becomes part of the document tree). So this must be called strictly *after*
 * `content` has been appended into `doc` (`contentWrap`/`body`) — calling it
 * before, as an earlier version of this code did, leaves
 * `window.__wmapPopulateGuideDemos` undefined at the time it's read here,
 * silently no-opping every demo mount (found via a live guide window showing
 * empty `data-wmap-demo` divs — the exact regression this split fixes).
 *
 * Returns the demo teardown function the script exposes as
 * `window.__wmapDestroyGuideDemos` (guide-demos.js), captured immediately —
 * not looked up again later — so the caller can destroy() exactly the demo
 * instances *this* activation created, regardless of what a later reopen
 * does to that global. `undefined` if the guide has no live-demo widgets
 * (e.g. a host-extension-only guide with no `data-wmap-demo` divs).
 */
function activateGuideScripts(content: HTMLElement, targetWindow: Window): (() => void) | undefined {
  const w = targetWindow as any;
  const inert = content.querySelector('script');
  if (inert) {
    const s = content.ownerDocument.createElement('script');
    s.textContent = inert.textContent;
    content.appendChild(s);
    const guideEl = content.querySelector<HTMLElement>('.wmap-guide');
    if (guideEl) w.__wmapPopulateGuideDemos?.(guideEl);
    return w.__wmapDestroyGuideDemos;
  }
  return undefined;
}

/** In-page fallback — unchanged from before `window.open` support was added. */
function openGuideInFloatingWindow(title: string, contentHtml: string, api: GuideApi, anchor?: Element): OverlayHandle {
  // Derive from `anchor`, not the bare global — `anchor` (the help button) can
  // live inside a gallery card detached into its own popup window, and without
  // this the guide content builds into the OPENER's document while the floating
  // window itself lands in the popup's DOM (via openFloatingWindow's own
  // anchor-based root resolution), leaving the popup's window empty.
  const ownerDocument = anchor?.ownerDocument ?? document;
  const ownerWindow = ownerDocument.defaultView ?? window;
  const { content, restoreApi } = buildGuideContent(ownerDocument, ownerWindow, contentHtml, api, true);
  // minWidth:0 alongside minHeight:0 — contentWrap is a ROW-direction flex
  // container, so a child's default `min-width: auto` refuses to shrink below
  // its widest unbreakable content and stretches the whole panel past the box
  // (clipped by its overflow:hidden), dragging the scrollbars out of reach.
  // That is exactly the die-list bug fixed in 0.24.2; the guide's own content
  // happens to wrap and fit today, so this is hardening, not a live fix.
  Object.assign(content.style, { flex: '1', overflow: 'auto', minHeight: '0', minWidth: '0' });
  // Assigned below, after activateGuideScripts runs — but onClose only ever
  // fires later, from real user interaction, well after that assignment.
  let destroyDemos: (() => void) | undefined;
  const handle = openFloatingWindow({
    title,
    anchor,
    ownerDocument,
    // This in-page fallback is what runs in Tauri/Electron/WebView2 (window.open
    // returns null there) — the exact host where a real, separate printable
    // window isn't available, so the guide's Ctrl+P/Cmd+P discoverability lives
    // entirely in this button. The real-popup path (openGuideInPopup) needs no
    // equivalent: it's an actual OS window with nothing else on the page to
    // exclude, so native print already captures just the guide.
    printable: true,
    // Maximising widens the reading measure (720px → 1000px) so the guide uses
    // the extra space without lines growing uncomfortably long. Set as a CSS
    // custom property on `content` (inherits to every descendant) rather than
    // a class on wmap's own `.wmap-guide` specifically — a host's own
    // UserGuideExtension content can opt into the same `max-width:
    // var(--wmap-guide-reading-width, ...)` convention and widen in step,
    // without this file needing to know that host's class names.
    onMaximizeChange: (isMaximized) => {
      content.style.setProperty('--wmap-guide-reading-width', isMaximized ? '1000px' : '720px');
    },
    onClose: () => {
      if (openGuideHandle === handle) openGuideHandle = null;
      // The 13 live demo widgets are never reachable any other way once this
      // closes — this is an in-page overlay, not a real popup, so closing it
      // is just box.remove(): the host page's JS realm (and every demo's
      // ResizeObserver/matchMedia listener) keeps running against a now
      // detached subtree unless explicitly torn down here.
      destroyDemos?.();
      restoreApi();
    },
  });
  handle.contentWrap.appendChild(content);
  destroyDemos = activateGuideScripts(content, ownerWindow);
  return handle;
}

/** Real, separate OS window — draggable outside the host window's own
 *  bounds, the same upgrade gallery card detach already has. Mirrors
 *  `renderWaferGallery.ts`'s `openWindowForCard` real-popup branch: bare
 *  DOM APIs (no `document.write`, which risks silently breaking later
 *  `ResizeObserver` callbacks in some engines), an explicit font stack
 *  (a popup never inherits the host page's own CSS reset), and a themed,
 *  synced `--wmap-*` copy (see `syncWmapPopupTheme`'s doc comment). */
function openGuideInPopup(popupWin: Window, title: string, contentHtml: string, api: GuideApi): GuideHandle {
  const doc = popupWin.document;
  doc.title = title;
  Object.assign(doc.documentElement.style, { height: '100%' });
  Object.assign(doc.body.style, {
    margin: '0', height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
    fontFamily: FONT.family,
  });
  // Not tied to any one render container (the guide can be opened from a
  // single map, a gallery, or programmatically via a controller's own
  // openUserGuide()) — document.documentElement is the only sensible,
  // always-available theme source here.
  copyWmapThemeTokens(document.documentElement, doc.documentElement);
  const stopThemeSync = syncWmapPopupTheme(document.documentElement, doc.documentElement);

  const { content, restoreApi } = buildGuideContent(doc, popupWin, contentHtml, api, false);
  // minWidth:0 alongside minHeight:0 — contentWrap is a ROW-direction flex
  // container, so a child's default `min-width: auto` refuses to shrink below
  // its widest unbreakable content and stretches the whole panel past the box
  // (clipped by its overflow:hidden), dragging the scrollbars out of reach.
  // That is exactly the die-list bug fixed in 0.24.2; the guide's own content
  // happens to wrap and fit today, so this is hardening, not a live fix.
  Object.assign(content.style, { flex: '1', overflow: 'auto', minHeight: '0', minWidth: '0' });
  doc.body.appendChild(content);
  const destroyDemos = activateGuideScripts(content, popupWin);

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(closePollId);
    stopThemeSync();
    // Closing the popup window already tears down its whole realm (every
    // demo's ResizeObserver/matchMedia listener along with it) — this call is
    // redundant on that path, but kept for symmetry with the floating-window
    // fallback and defence against a future change to the popup teardown.
    try { destroyDemos?.(); } catch { /* popup may already be gone */ }
    restoreApi();
    if (openGuideHandle === handle) openGuideHandle = null;
  };
  const closePollId = setInterval(() => { if (popupWin.closed) cleanup(); }, 400);
  popupWin.addEventListener('pagehide', cleanup);
  const handle: GuideHandle = { close: () => { if (!popupWin.closed) popupWin.close(); cleanup(); } };
  return handle;
}

/**
 * Open the embedded user-guide window and populate its live demos. Closes any
 * previously open guide window first (at most one may be open at a time).
 * `api` must contain the four library functions the guide demos call at runtime.
 * `html` is USER_GUIDE_HTML — passed in so toolbar.ts has no dependency on userGuideHtml.ts.
 * `extension`, when provided, prepends host content and/or overrides the window title — see `UserGuideExtension`.
 *
 * Opens a real, separate window when available (draggable outside the host
 * window's own bounds), falling back to the in-page floating window when
 * `window.open` is blocked/unavailable — silently returns `null` in some
 * embedded WebViews (Tauri, Electron, WebView2), same gap `openDetachWindow`
 * exists for. Unlike gallery card detach, this doesn't go through
 * `setDetachWindowOpener` — that opener's contract is scoped to per-wafer
 * detach windows a host may have built specifically for that shape of
 * content, and reusing it silently for the guide would broaden it without
 * documentation.
 */
export function openUserGuideWindow(
  api: GuideApi,
  html: string,
  extension?: UserGuideExtension,
  // Only used by the in-page fallback below — a real popup (the common case)
  // is a separate OS window, unaffected by the host page's own stacking.
  anchor?: Element,
): void {
  if (openGuideHandle) { openGuideHandle.close(); openGuideHandle = null; }

  const title = extension?.title ?? 'Wafer Map — User Guide';
  const contentHtml = (extension?.html ?? '') + html;
  // Open from the anchor's own window, not the bare global — the help button
  // may live inside a gallery card detached into its own popup window, and
  // `window.open` called from the wrong window can be flagged by that
  // window's own popup-blocking heuristics (no user-activation link to a
  // click that happened in a different window) or open positioned relative
  // to the wrong screen.
  const ownerWindow = anchor?.ownerDocument.defaultView ?? window;
  const popupWin = ownerWindow.open('', '_blank', 'width=800,height=820');
  openGuideHandle = popupWin
    ? openGuideInPopup(popupWin, title, contentHtml, api)
    : openGuideInFloatingWindow(title, contentHtml, api, anchor);
}

/**
 * Opens wmap's own guide window with no live `WaferMapController`/
 * `GalleryController` required — `WaferMapController.openUserGuide()`/
 * `GalleryController.openUserGuide()` are thin wrappers around this exact
 * same call (see their own `openGuideWindow` closures in `renderWaferMap.ts`/
 * `renderWaferGallery.ts`), built from the library's own top-level functions
 * rather than anything derived from a specific render — so a host with
 * nothing rendered yet (e.g. an empty-state "Help" menu, before any file is
 * loaded) can reach the same guide, with the same `extension` content, the
 * same way. Prefer the controller method when one exists — this is for the
 * gap it can't cover.
 *
 * `renderWaferMap`/`renderWaferGallery` are dynamically imported (like
 * `USER_GUIDE_HTML` below) since `toolbar.ts` is itself imported BY both of
 * them — a static import here would cycle back.
 */
export function openWaferMapGuide(extension?: UserGuideExtension, anchor?: Element): void {
  Promise.all([
    import('./userGuideHtml.js'),
    import('./renderWaferMap.js'),
    import('./renderWaferGallery.js'),
  ]).then(([guide, wm, gal]) => {
    openUserGuideWindow(
      { buildWaferMap, renderWaferMap: wm.renderWaferMap, renderWaferGallery: gal.renderWaferGallery, analyzeWaferMap },
      guide.USER_GUIDE_HTML,
      extension,
      anchor,
    );
  });
}

/**
 * Opens report HTML (from `renderSummaryReportHtml`/`renderLotSummaryReportHtml`)
 * in an in-app modal — no host-registered `setReportOpener` required just to
 * *view* a report. `setReportOpener`/`openHtmlReport` remain available as an
 * "Open as full page" action inside this modal (its header's print button, plus
 * a link in the toolbar strip below it), for a host that wants the report as a
 * real separate page — to keep it open outside this modal, or as a fallback if
 * in-app printing misbehaves on a given platform.
 *
 * The report HTML is a complete standalone document (its own `<style>`, its own
 * `<!DOCTYPE html>`) — rendered via `<iframe srcdoc>` rather than parsed apart
 * and inserted into the modal's own DOM (the way the guide's `buildGuideContent`
 * does it). This keeps the report's stylesheet naturally isolated from the host
 * page with no parsing, and lets `iframe.contentWindow.print()` scope printing
 * to just the report — `openOverlay`'s sibling-hiding print stylesheet (built
 * for content that lives directly in the host document, like the guide) isn't
 * needed here and wouldn't reach into the iframe's own document anyway.
 */
export function openReportModal(
  html: string,
  opts?: {
    anchor?: Element;
    ownerDocument?: Document;
    /**
     * A report built with `live` tells this page which finding a click on its row meant. Called with that
     * finding's id and the modal's handle, so the host can close the modal and show the finding on the map.
     * Only messages from this report's own frame are heeded.
     */
    onFinding?: (findingId: string, handle: OverlayHandle) => void;
  },
): OverlayHandle {
  const doc = opts?.ownerDocument ?? document;
  const iframe = doc.createElement('iframe');
  iframe.srcdoc = html;
  iframe.title = 'Summary report';
  Object.assign(iframe.style, { border: '0', width: '100%', flex: '1', minHeight: '0', background: '#fff' });

  const toolbarStrip = doc.createElement('div');
  Object.assign(toolbarStrip.style, {
    display:      'flex',
    justifyContent: 'flex-end',
    padding:      '6px 14px',
    borderBottom: `1px solid ${CLR.menuBorder}`,
    flexShrink:   '0',
  });
  const openFullPageBtn = doc.createElement('button');
  openFullPageBtn.type = 'button';
  wireControlHover(openFullPageBtn, 'bare');
  openFullPageBtn.textContent = 'Open as full page ↗';
  Object.assign(openFullPageBtn.style, {
    border: 'none', background: 'none', color: CLR.iconActive, cursor: 'pointer',
    fontSize: FONT.body, textDecoration: 'underline', padding: '0',
  });
  openFullPageBtn.addEventListener('click', () => openHtmlReport(html));
  toolbarStrip.appendChild(openFullPageBtn);

  const win = doc.defaultView ?? window;
  const onMessage = (ev: MessageEvent): void => {
    if (ev.source !== iframe.contentWindow) return;
    const id = (ev.data as { wmapFinding?: unknown } | null)?.wmapFinding;
    if (typeof id === 'string') opts?.onFinding?.(id, handle);
  };
  if (opts?.onFinding) win.addEventListener('message', onMessage);

  const handle = openModal({
    title: 'Summary report',
    anchor: opts?.anchor,
    ownerDocument: doc,
    printable: () => iframe.contentWindow?.print(),
    onClose: () => win.removeEventListener('message', onMessage),
  });
  handle.contentWrap.style.flexDirection = 'column';
  handle.contentWrap.appendChild(toolbarStrip);
  handle.contentWrap.appendChild(iframe);
  return handle;
}
