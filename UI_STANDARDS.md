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
this set; don't introduce a new size without a reason.

**Radius** — `4px` is the default for menus, rows, buttons, cards; `6px` for
larger panel-level surfaces. `2px`/`3px` appear for small inline chips.

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

## Auditing

A one-time audit against this baseline is tracked as a separate pass (not
folded into feature work) — see conversation/PR history for its findings and
disposition. New findings from ad-hoc review should be added here as
conventions once resolved, the same way the hover-intent pattern was.
