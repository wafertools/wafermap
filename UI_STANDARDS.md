# UI Standards

Internal engineering doc — not part of the published docs site. For contributors
(human or Claude Code) building or reviewing any DOM UI in this library:
`packages/canvas-adapter/toolbar.ts`, `charts/*.ts`, `renderWaferMap.ts`,
`renderWaferGallery.ts`, `summaryPanel.ts`, `insightsTab.ts`.

**This is also the baseline for [tsmap](../tsmap) — it is the single copy for
both projects, not a wmap-only document.** The "Baseline standards" and
"Checklist for any new custom widget" sections below are project-agnostic and
apply equally to tsmap's `menuSelect.ts`, help/recent popups, and full-screen
overlays. Only the "Existing project conventions" section is wmap-specific
(`CLR` / `--wmap-*` tokens); tsmap's counterpart vocabulary — its
`--z-modal`/`--z-tooltip` scale, theme tokens, and cross-platform CSS rules —
lives in [`../tsmap/CLAUDE.md`](../tsmap/CLAUDE.md) §Styling. Keep both sides
cross-referenced when either changes.

This does not cover semiconductor-domain display correctness (labelling,
aggregation, terminology) — that's in [CLAUDE.md](CLAUDE.md)'s own Design
Principles section. This is about the UI being a *correctly-behaved* piece of
software regardless of domain: accessible, keyboard-operable, visually
consistent, and free of the class of interaction bug a hand-rolled widget can
introduce that a native one wouldn't.

Scope note: everywhere this doc says "widget" it means any new menu, dropdown,
combobox, tooltip, popup, **modal, or floating window** — the modal/overlay
conventions below exist because those were shipped without a checklist to
catch them, the same gap the hover-intent bug closed for menus.

## Baseline standards

Adopted wholesale rather than inventing project-specific rules from scratch:

- **[WCAG 2.1 level AA](https://www.w3.org/TR/WCAG21/)** — colour contrast, text
  alternatives, keyboard operability, focus visibility, no keyboard traps.
- **[WAI-ARIA Authoring Practices Guide (APG)](https://www.w3.org/WAI/ARIA/apg/patterns/)**
  — every hand-rolled widget in this codebase (menu, listbox, combobox) is
  standing in for a native control that already has these behaviours for
  free. When building or reviewing one, open the matching APG pattern page
  and check against it directly rather than guessing.

Rationale for adopting existing standards instead of writing our own: the
gap this doc exists to close (the plot-mode cascade submenu's hover-intent
bug — see git history) is exactly the kind of thing these standards already
enumerate as a known failure mode. Re-deriving that checklist from first
principles for every new widget is how it gets missed again.

## Existing project conventions

Already established in code; document so new work matches instead of
drifting:

**Colour** — every chrome colour is a themeable `--wmap-*` custom property via
the `CLR` token map (`toolbar.ts`). Canonical list: `WMAP_TOKEN_NAMES`. Never
hardcode a colour that has a `CLR.*` equivalent — it breaks host theming and
dark mode. Known gap: canvas-drawn content (axis text, grid lines, halos)
draws hardcoded colours because a stylesheet can't reach into a `<canvas>` —
tracked separately (tsmap `WMAP_ISSUES` #25), not solved by this doc.

**Type scale** — de facto sizes in use: `10px`/`11px`/`12px`/`13px` for chrome
text (menus, labels, controls), `14px`–`20px` for headings/emphasis. Pick from
this set; don't introduce a new size without a reason. `9px` is an accepted
floor *only* for compact decorative/auxiliary text that isn't itself the
content being read — a disclosure-triangle glyph, a count badge on a section
toggle, a stat card's secondary sub-label, an axis-limit tick label on a
chart — never for a primary label, button, or menu row (those stay ≥10px).

**Radius** — `4px` is the default for menus, rows, buttons, cards; `6px` for
larger panel-level surfaces (e.g. the Summary panel). `2px`/`3px` appear for
small inline chips. A third tier, `8px`–`10px`, is accepted for two specific
shapes: a full pill/capsule badge or filter chip (where the radius *is* the
shape, not decoration — going to 4px would flatten it into a rounded
rectangle), and full dialog-box chrome at page-dialog scale (matches tsmap's
own `modal.ts`, `10px`). Don't introduce a fourth radius value without a
reason as concrete as one of these two.

**Interaction patterns** — the ones every new widget should reuse rather than
reimplement:
- *Click-triggered dropdowns/menus* (`makeDropdown`, `buildCheckMenuEl`,
  `makeSearchableTestCombo`): open on click, close on outside click or
  Escape, single level.
- *Hover-triggered flyouts* (the plot-mode "Test Value ▶" cascade — the only
  one in the codebase): must use a hover-intent grace period
  (`cancelClose`/`scheduleClose`, ~300ms) rather than closing immediately on
  `mouseleave`, because the flyout is rendered with a gap the pointer has to
  cross. Closing immediately on leaving the trigger reads a normal diagonal
  approach to the submenu as "user left" and withdraws it mid-move.
- *Keyboard nav*: `wireMenuKeyboard` / public `wireMenuA11y` — arrow
  up/down, Home/End, Enter/Space activates, Escape/Tab closes and returns
  focus to the trigger. Any new menu-shaped widget should call this rather
  than hand-rolling key handling.
- *ARIA*: `role="menu"` + `menuitemradio` for single-select menus,
  `role="listbox"` + `option`/`aria-selected` for the searchable combo,
  `aria-haspopup`/`aria-expanded` on triggers (`markMenuTrigger`). Match the
  existing role vocabulary rather than picking a different one for a new
  widget that behaves the same way.
- *Filter boxes* on long lists (`makeMenuSearchBox`): appears once a list
  passes `MENU_SEARCH_THRESHOLD` (8) rows; sticky at the top of the
  scrollable container; autofocused; stops click/keydown propagation so
  typing doesn't trigger the host menu's own keyboard nav.

**Modal/overlay content padding** — `openModal`/`openFloatingWindow`'s
`contentWrap` (`toolbar.ts`'s `openOverlay`) carries **zero padding by
design**, because some content wants to fill it edge-to-edge (a reparented
map canvas, `openReparentedModal`). That means every *other* piece of content
appended into `contentWrap` is responsible for its own gutter — either by
setting `contentWrap.style.padding` itself (the die-list modal does this) or
by padding its own root element (the Findings Summary modal's paragraphs and
list wrap do this). There is no default: skip this and the content sits flush
against the box edge, invisible until someone screenshots it. See the die-list
modal fix (CHANGELOG, "View die list" padding) for the shape of this bug.

**Cross-document DOM/style safety** — any content that might render inside a
gallery card detached into its own popup window (see `renderWaferGallery.ts`'s
detach feature) must build its elements with that popup's own `Document`, not
the bare global `document`. Two established patterns:

- Elements: thread an `ownerDocument`/`doc` parameter down to every
  `document.createElement` call (see `dieList.ts`'s `el(doc, tag, …)`, or
  `renderWaferMap.ts`'s module-level `ownerDocument = container.ownerDocument`).
- Injected `<style>` blocks: inject into `doc.head`, and track "have I already
  injected this" **per-document** (`WeakSet<Document>`), never as a single
  module-level boolean — a boolean set true for the opener's document leaves
  every popup's `<head>` without the rule forever. See `dieList.ts`'s
  `stylesInjectedInto`.

The whole codebase currently has exactly two `<style>`-injection sites
(`dieList.ts`, `toolbar.ts`'s print stylesheet) — both doc-aware as of this
writing. Keep it that way: a third one that hardcodes `document.head` silently
reintroduces the same bug the die-list font-size fix closed. **Build-enforced**
— `scripts/check-overlay-conventions.mjs` (wired into `npm run check`) fails
on any bare `document.head.appendChild`, so a regression here is a build
failure, not something a reviewer has to remember to look for.

**Every `openModal`/`openFloatingWindow` call site must pass `anchor` (and,
when the caller's own container might live in a different document,
`ownerDocument`)** — see `OverlayOptions.anchor`'s own doc comment in
`toolbar.ts`. Both are typed optional (a genuine no-natural-anchor call site,
e.g. a bare click handler, legitimately omits them), which is exactly why
omitting them by accident compiles cleanly and ships: nothing forces the
question to be asked. Skipping `anchor` doesn't fail loudly — the modal
still opens, just on bare `doc.body`, landing **behind** a host's own native
`<dialog>` (`.showModal()`, browser top layer) regardless of z-index, no
matter how high `--wmap-z`/`Z_ABOVE2` is set. This is a *different* failure
from the `--wmap-z` stacking-value problem solved by the `zIndex` render
option (see `docs/api.md` §5.4, and tsmap's `WMAP_ISSUES.md` #5/#22/#23) —
that mechanism controls the stacking *value* once an overlay is a body-level
sibling; `anchor` controls whether it lands inside the right subtree at all,
which no `--wmap-z` value can fix. The die-list modal shipped in v0.24.0
having skipped `anchor` (fixed the same day, in v0.24.1) — a new overlay
call site is exactly where this recurs, since the fix for the *last* one
gives no compiler signal on the *next*. Check this explicitly, don't rely on
remembering it from last time. **Build-enforced** — the same
`check-overlay-conventions.mjs` fails on any `openModal(...)`/
`openFloatingWindow(...)` call whose argument list has no `anchor`, so this
is caught by `npm run check`, not only by review.

## Checklist for any new custom widget

Before shipping a new menu, dropdown, combobox, tooltip, or popup:

- [ ] Reuses an existing helper (`makeDropdown`, `buildCheckMenuEl`,
      `makeMenuSearchBox`, `wireMenuA11y`, `markMenuTrigger`) rather than
      rebuilding open/close/keyboard/ARIA from scratch.
- [ ] Fully keyboard-operable: reachable via Tab, arrow keys move through
      options, Enter/Space activates, Escape closes and returns focus.
- [ ] If it opens on hover, uses the grace-period pattern above — not a bare
      `mouseleave` close.
- [ ] Has the correct ARIA role + `aria-expanded`/`aria-selected` as
      applicable, and an accessible label (visible text or `aria-label`).
- [ ] Colour comes from `CLR.*`, not a hardcoded hex, and reads correctly in
      both the light default and a dark `--wmap-*` override.
- [ ] Closes on outside click and doesn't leave orphaned document-level
      listeners behind after the element it belonged to is removed.

Before shipping a new `openModal`/`openFloatingWindow` call site, additionally:

- [ ] Passes `anchor` — a still-attached element from the triggering render
      (a panel, a button, the canvas). Only omit it when there is genuinely no
      such element (a bare global click handler). Verify by embedding the
      render inside a host page's own native `<dialog>` (`.showModal()`) and
      confirming the new overlay still appears on top — the failure mode is
      silent otherwise (see `overlayRootFor` above).
- [ ] Passes `ownerDocument` when the anchor's container could plausibly be a
      detached popup window (any content reachable from a gallery card) —
      not needed for content that only ever renders on the main page.
- [ ] Every element and injected `<style>` this content creates uses that
      same document (a `doc`/`ownerDocument` parameter threaded through),
      never the bare global `document`.
- [ ] `contentWrap` has an explicit gutter — either `contentWrap.style.padding`
      set directly, or every child the content appends pads itself. Confirm
      by actually opening it and looking at the edges, not by reading the code.

## Auditing

A one-time audit against this baseline is tracked as a separate pass (not
folded into feature work) — see conversation/PR history for its findings and
disposition. New findings from ad-hoc review should be added here as
conventions once resolved, the same way the hover-intent pattern was.
