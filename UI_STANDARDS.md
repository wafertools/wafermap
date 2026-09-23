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

**Edge gutters — any bordered surface against a container edge.** The rule
above is about modal content; this is its general form, and it was written
after six separate surfaces were found sitting flush in the main view. A card,
panel, toolbar or bar that carries a border and a corner radius must not touch
the edge of the region it lives in: you see three of its borders and the screen
edge standing in for the fourth, which reads as clipped rather than deliberate,
and a radius pressed against the edge looks flattened. Use `EDGE_GUTTER`
(`toolbar.ts`, 12px) — never a locally chosen number.

- **It belongs to the container, not the surface.** Grids already space their
  children with `gap`; a margin on the card would add to that between
  neighbours while leaving a single gap at the outside, making the middle worse
  to fix the edge. Pad the container instead. The exception is a surface with no
  container of its own to pad — a docked panel, an absolutely-positioned
  toolbar — which carries the gutter on the edge it docks against.
- **Two gutters must never stack.** A container gutter plus a sibling `gap`
  plus a panel margin is how a 12px gutter becomes a 24px trench. Pick one
  owner per edge; where a grid's padding can serve as both the window gutter on
  its free side and the separation from a docked panel on the other, let it,
  and drop the row's `gap`.
- **Full-bleed is a deliberate exception, not an oversight.** The wafer map
  canvas keeps its edges — map area is the priority and a margin only shrinks
  it. So does a sticky header's background, which is what hides content
  scrolling underneath: pad the sticky *wrapper* so its children inset while
  its background still spans.
- **A rule drawn as an element's own `borderBottom` spans exactly as wide as
  that element.** Inset it with `margin`, not `padding` — padding moves the
  content in and leaves the line running to both edges, which is the defect,
  not the fix.
- **Equal spacing everywhere cannot express hierarchy.** Once every gap is the
  gutter value, nothing says which things belong together and controls stop
  reading as attached to the content they act on. Group deliberately: keep
  related bands tight (a header strip and its tab bar) and make the break to
  the content several times larger. The contrast carries the grouping — no
  single value can.

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

**Any new `position: sticky` or `position: fixed` element must append its
menus through `menuLayerFor(anchor)` (`toolbar.ts`), never build its own
z-index tier.** This is the bug class behind the other two above, and it shipped
three times in one day before this was written down: `renderWaferGallery.ts`'s
sticky gallery header needed to sit above a scrolled-under card's own toolbar
(`Z_BASE`) while staying *below* that same toolbar's own popped-out dropdown
(also `Z_BASE`) — no single z-index value can be simultaneously greater than
and less than another instance of itself, so every fix that "just raised the
number" solved one side and broke the other:

1. A bare `zIndex: '1'` lost to the per-card toolbar's `Z_BASE` — cards
   floated over the header.
2. Raising it to `Z_ABOVE` fixed that, but now beat the header's *own*
   dropdown menus (also rendering at `Z_BASE` at the time) — menus vanished
   behind the header that spawned them.
3. The actual fix needed two parts, not one number: contain the scrolling
   grid's `Z_BASE` content with `isolation: isolate` (so it can no longer be
   compared against anything outside the grid at all), *and* stop menus from
   sharing a tier with arbitrary persistent chrome in the first place —
   `menuLayerFor` gives every menu/dropdown/cascade-submenu in the library one
   dedicated layer (the shared hover tooltip is positioned into it too, above
   the menus, so a menu row's hint is never drawn under its own menu) (`Z_MENU`, between `Z_ABOVE` and `Z_ABOVE2`) that no sticky
   or fixed element can ever accidentally outrank, because menus no longer
   compete on the general scale.

The lesson that generalises: **a bare z-index number only means what you
think it means if you can also show what stacking context contains it** — CSS
compares a positioned descendant's z-index against *whatever the nearest
element with position + an explicit (non-`auto`) z-index has already grouped
it under*, not against "everything else on the page" and not against "its own
parent's box." `position: relative` with no z-index of its own does **not**
create that boundary — it looks like it should, and doesn't. Reasoning about
"is my number big enough" without first identifying that boundary is how all
three of the above shipped. Before setting a literal z-index (rather than
`Z_BASE`/`Z_ABOVE`/`Z_MENU`/`Z_ABOVE2`) on anything `sticky` or `fixed`, write
down in a comment what contains it and why nothing outside that container can
ever be compared against it — if you can't, the element needs
`isolation: isolate` (or equivalent) on a real ancestor first, or it needs to
go through `menuLayerFor` instead. **Build-enforced, partially** —
`check-overlay-conventions.mjs` fails on a new `position: sticky`/`fixed`
assignment in `canvas-adapter` with no comment nearby; it cannot verify the
reasoning is *correct*, only that the question was actually asked at the
point the code was written, not skipped under time pressure.

### One tooltip look, and it is dark

A hover tip is a floating label over arbitrary content — a chart, a wafer map, a
table. It reads as a label at any theme only if it stays dark, so it does **not**
take the surface tokens: `rgba(30, 32, 40, 0.93)` on `#f0f0f2`, everywhere, in
both repos.

wmap had two: the toolbar's dark tip and a light one on chart-card controls, so
the same gesture produced a different-looking tip depending on which control the
pointer was over. tsmap's `tooltip.ts` already mirrored the dark one.

**A tip must be dismissed by anything that removes its trigger**, not only by
`mouseleave`. A control that hides itself — the chart expand button, hidden
while its card sits in the modal — never fires `mouseleave`, so its tip stays on
screen with nothing under it. Hide on click as well, and hide any visible tip
before reparenting the element that owns it.

### Controls come in four shapes, not nineteen

Nineteen sites in wmap set `cursor: pointer` with their own padding, border,
radius and hover handling. They were not nineteen different controls — they were
four shapes restated by hand, and that restatement is the mechanism behind most
of the drift the scales above exist to stop.

| Shape | Looks like | Used for |
| --- | --- | --- |
| `outlined` | bordered, transparent ground | the default button — Summary report, Export CSV, Back |
| `bare` | no border, no ground | icon buttons, inline text actions |
| `toggle` | bordered, tinted when on | segmented options, filter pills |
| menu row | full-width, tint on select | option lists (see the option-list contract below) |

**A control must react to the pointer.** A bordered element with no hover
feedback is indistinguishable from a bordered label — it has the shape of a
button and does nothing when you point at it. wmap's toolbar icon buttons wired
hover from the start; its outlined *text* buttons (Summary report, View die
list, the CSV exports, Back) wired none, so the two halves of one library
disagreed about whether a button reacts. Pair every `controlStyle` with
`wireControlHover`; tsmap's `.tb-btn` gets the same from CSS.

wmap's `controlStyle(kind, on?)` (toolbar.ts) returns the shape as **style, not
an element**, so a call site keeps its own markup and event wiring and merely
stops deciding what a button looks like:

```ts
Object.assign(btn.style, { ...controlStyle('outlined'), marginLeft: 'auto' });
```

It deliberately sets no `outline`: the browser ring is the focus indicator and a
control must not suppress it. Adding a fifth shape is a real decision — make it
deliberately and add it here; restating an existing one inline is the drift.

### Elevation, motion, leading, opacity, tracking

One scale each, for the same reason as spacing and radius — and found the same
way: by counting distinct literal values rather than by reading files.

| Property | Scale | Was |
| --- | --- | --- |
| elevation | `SHADOW` / `--shadow-*`: panel, menu, modal | 14 distinct shadows |
| motion | `MOTION` / `--motion-*`: fast (0.12s), base (0.2s) | 10 distinct transitions |
| leading | `LEADING` / `--leading-*`: none, tight, base | 8 distinct line-heights |
| opacity | `ALPHA` / `--alpha-*`: muted, disabled | 7 distinct values |
| tracking | `TRACKING` / `--tracking` | 4 values for one job |
| typeface | `FONT.family` — **inherits the host** | 3 stacks, none matching the host |

**`check-style-scales.mjs` enforces this**, in both repos, by counting distinct
literals per property against a budget. It asks a different question from the
other checks: not "is this value on the scale?" but "how many distinct values of
this kind exist, and should there be that many?"

That distinction matters because this class of defect is invisible to the
methods that normally catch things. Each declaration is defensible in isolation,
so reading one file never finds it; and when the offending lines are
pre-existing and untouched, a **diff** review cannot see them either — which is
how three different font stacks survived two code reviews and a full design
audit on the same day. A count finds them in one command.

Raising a budget is a deliberate act: add the value to a scale, or record here
why a genuinely new role exists.

### Spacing and radius: scales, not per-element choices

**Spacing** is one of `2 · 4 · 6 · 8 · 10 · 12 · 16 · 24`px — wmap's `SPACE`
(toolbar.ts), tsmap's `--space-*`. The scale was derived from what the code
already did, not imposed: values clustered hard on those steps with a thin tail
of one-off 3, 5, 7, 9, 11, 14, 15, 20, 23 and 32px. The clusters are the scale;
the tail is drift.

**Radius** is one of three roles — wmap's `RADIUS`, tsmap's `--radius-*`:

| Role | Value | Used for |
| --- | --- | --- |
| control | 4px | buttons, inputs, menu rows, segmented toggles, swatches |
| container | 6px | cards, panels, menus, modals |
| pill | full | badges, count pills, status chips |

wmap had eight different radii and tsmap five, most within a pixel or two of
each other, so the variation read as sloppiness rather than intent. The shape of
the data showed the system already existed — it had just never been written
down, so outliers accumulated.

**Not every off-scale value is a mistake.** An indent that lines up with a 7px
status dot plus its gap is an optical alignment, not a rhythm value. Snap
deliberately and leave a comment where a value is optical — the same rule as
"a duplicate token may not be one".

### Disabled: dim the whole control, never just the text

A disabled control keeps its shape and loses its emphasis: reduce the **whole
element's** opacity rather than swapping the text to a lighter colour, so the
control still reads as a control and the label keeps its contrast ratio against
the surface behind it. `opacity: 0.4` with `cursor: default` is the house value.

Never express disabled through colour alone (WCAG 1.4.1), and never rely on a
lighter text token — a disabled label at `--text-faint` on a light surface can
fall below 3:1 while looking merely "greyed", and there is no way to tell by eye.

### Where component styling lives

**One place per component, and the same place across a repo.** tsmap runs two
parallel systems: CSS classes in `index.html` (`.btn-primary`, `.btn-secondary`,
`.tb-btn`) and about thirty buttons built in JavaScript with inline styles. A
change to button styling has to be made in both, and nothing says which is
canonical.

The rule: a component with a CSS class uses that class and adds only layout
inline. A component built entirely in JS takes its values from the token objects
(`CLR`, `FONT`, `SPACE`, `RADIUS`) — never literals. Adding a second way to
style an existing component is the drift, not the styling itself.

### Data visualisation

This is what both projects are for, and it had no rules at all. The plot's own
figure type, marks and series colour are dataviz decisions; what follows is the
part that must agree with the rest of the UI.

- **Figures line up in columns.** Anything showing numbers a reader compares —
  tables, stat tiles, value lists, bar labels — sets
  `font-variant-numeric: tabular-nums`. Proportional digits jitter, and columns
  of yields are read by scanning. The exported HTML report set this while the
  live UI did not, so the same figures aligned on paper and not on screen.
- **Colour is never the only encoding.** A state shown in colour also carries a
  shape, a label, a pattern or a position (WCAG 1.4.1). wmap's `markFailingDies`
  hatch and the "low outlier" row text are the pattern to follow; a below-median
  bar greyed with nothing on screen saying so is the anti-pattern that was
  removed.
- **Series colour comes from the categorical palette** (`charts/palette.ts`,
  Okabe-Ito, colourblind-safe) — deliberately literal hex, because canvas cannot
  resolve a CSS variable. Do not draw series colour from the chrome tokens: the
  data palette and the UI accent are independent, and a host retinting its chrome
  must not silently recolour the data.
- **Every chart states its population.** A percentage with no `N` beside it, or a
  chart over a filtered subset that does not say so, is a correctness problem
  rather than a styling one.
- **Canvas text follows `--wmap-font-size`** via `fontPx`, resolved at paint
  time — the host moves the whole scale, the relative sizes stay fixed. The map
  canvas keeps three tiers: the title at body, its subtitle and the scale note
  one step below, and the colorbar tick labels and axis ticks two steps below.
  Do not collapse these onto one size. It was tried, and the title ended up
  separated from its own subtitle only by weight, while the colorbar labels
  outgrew the band reserved for them and were clipped at the canvas edge.

### Colour roles: name the meaning, not the shade

A token's name must say what it MEANS, so a later author can tell which one to
reach for. Two roles that look alike are still two roles.

| Role | Meaning | tsmap | wmap |
| --- | --- | --- | --- |
| surface | the ground a panel sits on | `--bg-app` | `--wmap-canvas-bg` |
| raised | a card, menu or dialog above it | `--bg-overlay` | `--wmap-surface` |
| hover | transient, pointer is over it | `--bg-hover-row` | `--wmap-menu-hover` |
| **selected** | **persistent, this is the current choice** | `--bg-selected` | `--wmap-menu-active` |
| focus | keyboard position — the browser ring | `--accent` | inherited from host |

**Hover and selected are different roles and must never share a value.** tsmap
mapped all four of wmap's state tokens to one token, so inside tsmap every wmap
menu row drew hover and selected identically — you could not see what was
selected while pointing at something else. Even after splitting them, the two
values were within a perceptual distance of 8 in six themes, because nothing had
ever forced them apart.

**Derive a tint, don't pick one per theme.** `--bg-selected` is each theme's own
`--accent` blended 26% into its own `--bg-overlay`. One rule, sixteen themes, no
hand-picked hexes to drift — and every theme lands 33+ apart from its hover row
instead of 8.

**A tint carries selection; the text stays primary.** Accent text ON an accent
tint is redundant and dark-on-dark: measured across all sixteen themes it failed
WCAG AA in fourteen, as low as 2.54:1 on Solarized. `--text-primary` on the same
tint measures 5.4:1 at worst. Use weight, not hue, if selection needs more
emphasis.

**`--bg-accent-hover` is a button-hover ground, not a selection.** It is a
separate role that happened to be used for both; that collision is what made the
selection tint impossible to tune without also changing button hover.

**A "duplicate" token may not be one.** tsmap's `--border-mid` and
`--border-muted` are identical in the light theme and differ in fourteen of the
other fifteen. Check every theme before collapsing two tokens into one.

### Type scale: three tiers, not a floor

| Tier | Size | What belongs |
| --- | --- | --- |
| Heading | 13px+ | card and panel headings, identity titles; stat values sit higher still (16–20px) |
| Body and controls | **12px** | prose, table cells, hints, and **every interactive control** — buttons, segmented toggles, pills, selects, menu rows |
| Secondary meta | 11px | uppercase micro-labels (which carry `letterSpacing`, so they read larger than 11px suggests) and ornaments — disclosure arrows, count badges |

**In wmap the tiers are derived from one token, not hardcoded.** `--wmap-font-size`
(default 12px) is the single lever; `FONT.*` and `fontPx()` in `toolbar.ts` derive
every tier from it, so a host can match its own type scale. wmap is meant to
disappear into its host — it carries no visual identity of its own, and anything
a host might reasonably want to match should be a token, not a literal. It has 36
colour tokens and, until this was added, none for type.

**Nothing in the DOM goes below 11px.** Chart chrome on canvas holds that line
too. The exception is plot-coupled annotation — text that labels the data rather
than the interface — where the map canvas's colorbar ticks and axis ticks sit at
`fontPx(-2)` (10px at the default base). These are read against a dense grid at a
glance, not read as prose, and enlarging them costs wafer area directly: the bin
legend's reserve is sized from this text, so every extra pixel of type takes
width off the map.

**One body size across both apps, not one per app.** tsmap's dialogs sat at 13px
while wmap's panels sat at 12px — a difference invisible in either app alone and
obvious once they share a window. Settled at 12px (already tsmap's own majority:
46 sites to 22). The lone documented exception is the hover tooltip, 13px in both
because wmap's `getTooltip` sets it and tsmap's `tooltip.ts` deliberately
mirrors that element.

**Every control in one view is the same size.** This is the rule that gets
broken, because controls are built in different places: a segmented toggle had a
`compact` variant at 10px for the summary panel's narrow column, so Ring/Quadrant
rendered visibly smaller than the buttons directly beside it. Density belongs in
padding, not type size. If a panel cannot fit its controls at 12px, widen the
panel — the summary panel went 260px → 300px for exactly this.

**A floor is the wrong instrument.** The first attempt at this pushed everything
below 12px up to 12px, which flattened the hierarchy (button labels ended up
louder than the data they sat above), blew the panel's width budget so the
per-test table clipped, and still missed the actual defect because the offending
size was inside a ternary rather than a literal. Size by role, then check the
roles against each other in a real screenshot.

**Why this is in the shared file:** tsmap had a documented 12px minimum and wmap
had none, so wmap's DOM text drifted to 9px while tsmap's stayed at 12px — and
because tsmap embeds wmap, a user sees both at once. If a rule governs what the
*combined* UI looks like, it belongs here.

**Zoom is not a substitute.** tsmap enables `zoomHotkeysEnabled`, so a user can
scale the whole app. That is an escape hatch for personal preference, not a
licence to ship a default that needs it.

### Option lists and menus: one visual contract

Both repos render lists the user picks from: wmap's toolbar dropdowns
(`makeDropdown`) and Insights pickers, tsmap's theme picker (`menuSelect.ts`),
Lot ▾ / Recent / Help (`anchoredMenu.ts`). They are separate implementations by
design — wmap is a wafermap and analysis library, not a UI library, and does not
export general widgets — so what keeps them coherent is this written contract,
not a shared component. A user moving between a tsmap dialog and an embedded
wmap toolbar sees one application; four implementations that each invented their
own highlight is what made it look like three.

**Two widget classes, decided by what the items are:**

| Class | Items are | Role | Example |
| --- | --- | --- | --- |
| Value picker | values that stay selected | `listbox` + `option` | theme, Plot mode, Colour scheme, Group by |
| Command menu | actions that fire and are done | `menu` + `menuitem` | Lot ▾, Recent, Help |

**Three visual states, and only three:**

- **Selected** (pickers only) — a persistent accent tint plus accent text.
  tsmap uses `--bg-accent-hover`, wmap `CLR.menuActive`.
- **Hover** — a transient neutral background (`--bg-hover-row` / `CLR.menuHover`),
  cleared on `mouseleave`. Decorative only; it carries no contrast requirement.
- **Focus** — **the browser's own `:focus-visible` ring. Never draw your own.**
  The single permitted suppression is where the ring *cannot render*: an input
  inside a container whose `border-radius`/overflow clips the outline. There,
  suppress it, supply a compliant replacement (a border-colour swap), and say so
  in a comment at the site. wmap's menu search box is the only such case — four
  other `outline: 'none'` sites had no such reason and substituted a background
  swap that was identical to their own hover state, so a keyboard user could not
  tell the focused row from one under the pointer.

**Rows take real DOM focus (roving `tabIndex = -1`).** This is what makes the
rule above possible: the engine draws the ring, it matches every other control
in the app for free, and no widget has to invent a focus indicator. Use
`aria-activedescendant` **only** where focus must stay in a text input — a true
editable combobox. That is the single exception, and it carries a cost: rows
that never take focus get no ring, so such a widget must draw a compliant
indicator itself (3:1, WCAG 1.4.11) and will look unlike everything else.

**The trigger takes the host's own button styling, not its own.** A dropdown is
a *button plus a list*, and the button half has to sit in a toolbar, a card
header or a form row that already has a button style. A widget that hardcodes
its own background and border renders as the one control in the row that
doesn't match — which is how tsmap's theme picker ended up a filled
`--bg-input` pill in a toolbar of transparent `--border-dim` outlined buttons.
Accept a class from the caller (tsmap's `makeMenuSelect` takes `opts.className`
and is passed `tb-btn`; wmap's `makeListSelect` is styled from `CLR.*`, which is
the host-overridable layer there) and set **only layout** locally — flex, gap,
whatever the caret arrangement needs. Anything inside the trigger inherits too:
a caret pinned to `--text-muted` stays grey while the label turns accent on
hover, so use `color: inherit` rather than naming a token again.

**Hover must not move focus.** Wiring `mouseenter` to the same
"set active option" path as the arrow keys drags the focus treatment around
under the mouse, which is how tsmap's theme picker ended up as the only list in
either app with an accent bar on its rows — the marker existed to replace the
missing ring, then followed the cursor. Hover sets a background; arrow keys move
focus; `Enter` acts on the focused row, as a native `<select>` does.

*History: tsmap's `menuSelect` was the only `aria-activedescendant` widget in
either repo and the only one with a hand-drawn marker; wmap's `makeDropdown`
uses roving tabindex and had no marker, but labels value pickers as `menu` +
`menuitemradio`. Each repo held one half of this rule. Converged 2026-08-31.
The trigger-styling rule was added a day later, after the same widget turned
out to be the only control in tsmap's toolbar that didn't match its neighbours
— the identical mistake one level up from the rows. Both failures are a widget
deciding its own colours instead of taking the host's; that is the thing this
section exists to prevent, at every level of the control.*

### Multi-row selection: pick a model, then follow it exactly

Any list or table where more than one row can be selected uses **one** of two
models, and mixing them is the usual reason selection "feels wrong":

| | **Selection list** (Finder/Explorer) | **Checkbox list** (Gmail/GitHub) |
| --- | --- | --- |
| Plain click | selects one, **clears** the rest | **toggles** one, selection accumulates |
| Shift+Click | replaces the selection with the range | applies the **anchor's resulting state** across the range |
| Ctrl/Cmd+Click | toggles one, keeps the rest | redundant — plain click already does this |
| Checkboxes | absent, or indicators only | the control itself |

**Both repos use the checkbox list** — one model everywhere, even where a
surface draws no checkbox. tsmap's file filter table has none: the row tint is
the indicator, `aria-selected` on focusable (roving `tabIndex`) rows in a
`role="grid"` carries it to assistive tech, and Space toggles the focused row.
It still follows the checkbox-list rules below, because selection there is built
up across several searches — a Finder-style click that clears the selection
would silently deselect rows the current filter hides. So:

- **Shift+Click applies the anchor's own current state to the whole range.**
  Shift-clicking after *un*ticking the anchor therefore **deselects** the range.
  This is what lets one gesture serve both directions, and it is the half that
  gets forgotten.
- **The anchor is the last row toggled WITHOUT Shift, and Shift never moves it.**
  Repeated Shift+Clicks re-extend from the same origin rather than chaining off
  the previous target. This is the single most commonly mis-implemented detail.
- **Store the anchor as a row ID, never as an index into the visible array.**
  Filtering, searching and sorting all rewrite that array. An index survives as
  a number and silently addresses a different row; an ID either still resolves
  or it doesn't, and "doesn't" is a clean no-anchor case.
- **Range operations are scoped to what is currently shown**, matching Select
  all / the header checkbox, which are too. A header checkbox selects all shown
  and carries an `indeterminate` state when only some are.
- **State the selection numerically**, and distinguish selected-from-shown-from-
  total (`N selected / M shown / T total`). A selected row hidden by a filter
  that still gets acted on is a data-loss bug, not a display detail.

**Keyboard parity is not optional** (WCAG 2.1.1): every mouse gesture needs a
keyboard path. Arrow keys move focus **without** changing selection — focus and
selection are separate in the WAI-ARIA APG grid/listbox patterns — while
Shift+Arrow moves focus *and* extends, Shift+Space extends to the focused row
without moving focus, and Ctrl/Cmd+A selects all shown. Scope the handler to the
row control so Ctrl+A never steals select-all from a text field in the same row.

In tsmap this lives in one place, `src/listSelection.ts`
(`createRangeSelection`), used by the file filter table, the test selector and
the splits dialog. **Do not hand-roll a fourth.**

*History: the test selector and the splits dialog each grew their own copy of
this and the file filter table never got one, so shift-clicking there just
toggled the row under the pointer — reported from the user's side as "select
isn't intuitive". Both existing copies also anchored on a visible-array index
with nothing resetting it on a filter change, so searching and then
shift-clicking extended from whatever row had moved into that slot. Nothing in
this document covered selection at the time, which is exactly why the third case
was missed. Converged 2026-09-02.*

## Checklist for any new custom widget

Before shipping a new menu, dropdown, combobox, tooltip, or popup:

- [ ] Reuses an existing helper (`makeDropdown`, `buildCheckMenuEl`,
      `makeMenuSearchBox`, `wireMenuA11y`, `markMenuTrigger`) rather than
      rebuilding open/close/keyboard/ARIA from scratch.
- [ ] Fully keyboard-operable: reachable via Tab, arrow keys move through
      options, Enter/Space activates, Escape closes and returns focus.
- [ ] If it is an option list or a menu, follows "Option lists and menus: one
      visual contract" above — the right class and role for what the items are,
      the three visual states and no fourth, rows on roving `tabIndex = -1`,
      hover that doesn't move focus, and **no hand-drawn focus indicator**.
- [ ] Its trigger takes the host's button class / `CLR.*` styling and sets only
      layout of its own. Check it against the controls beside it, not on its
      own: a widget that looks fine in isolation is exactly how both of this
      section's regressions shipped.
- [ ] If it opens on hover, uses the grace-period pattern above — not a bare
      `mouseleave` close.
- [ ] Has the correct ARIA role + `aria-expanded`/`aria-selected` as
      applicable, and an accessible label (visible text or `aria-label`).
- [ ] Colour comes from `CLR.*`, not a hardcoded hex, and reads correctly in
      both the light default and a dark `--wmap-*` override.
- [ ] Any hover hint uses `wireTooltip` (the shared themed tooltip), **never a
      native `title` attribute**. `title` is the browser's own tooltip: it appears
      only after an OS hover delay, renders in an unthemed system font and colour,
      ignores the app's overlay stacking, and is invisible to touch. A `title` is
      acceptable only as a fallback for text truncated by CSS, where the browser's
      copy-of-the-full-string behaviour is the point. This has been missed twice —
      `maplessSummary.ts` converted away from `title`, then `summaryPanel.ts` and
      two hand-built expand buttons were written with it anyway.
- [ ] If more than one row can be selected, it uses `createRangeSelection`
      rather than its own anchor bookkeeping — checkbox-list semantics, an
      anchor held as an ID that Shift never moves, and the keyboard equivalents
      (Shift+Arrow, Shift+Space, Ctrl/Cmd+A). See "Multi-row selection" above.
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
- [ ] Any bordered/radiused surface this adds is inset from its container edge
      by `EDGE_GUTTER`, on the top edge as well as the sides, and no two
      gutters stack into a double gap. Check it with a screenshot at more than
      one width — this class of defect measures fine and only looks wrong.

## What is enforced, and what is only written here

`check-style-scales.mjs` (both repos, wired into `npm run check` / `check:docs`)
is the only thing that *verifies* any of this. It enforces:

| Rule | How |
| --- | --- |
| Type floor | no `font-size` below the repo's floor (11px wmap, 12px tsmap) |
| One value, many places | distinct-literal budgets for `box-shadow`, `transition`, `line-height`, `letter-spacing`, `font-family` |
| Spacing scale | a budget on distinct OFF-scale spacing literals — a ratchet, lowered as they are resolved, never raised |
| Focus ring | `outline: none` must carry a stated reason about the focus indicator in an adjacent comment |
| Radius roles | a budget on `border-radius` literals — if the value IS a role, use `RADIUS.*` |
| Hover on every interactive | a budget on `cursor: pointer` sites with no hover affordance nearby |
| Buttons use a shared class | `check-button-styles.mjs` (tsmap) |

Everything else on this page is prose, and prose is not verification. Three
things follow from that, each learned the hard way:

- **Each repo's budget is its own current count, never the other's.** wmap
  carries 18 pointer-without-hover sites and tsmap 10; giving both the larger
  number would quietly license nine new ones in tsmap.
- **A budget is a ceiling on distinct values, not a target.** Raising one to
  admit a new value defeats the point; add the value to a scale, or argue for a
  new role out loud.
- **A named constant is invisible to the spacing check, a literal is not.**
  That asymmetry is deliberate: naming an off-scale value once, with its
  derivation, is exactly what `TOOLBAR_BAND_CSS` and `EDGE_GUTTER` are, and what
  a bare `44px` repeated at four call sites was not.
- **A check must be proven against a defect it should catch.** Both new rules
  above passed a planted violation on first writing — the focus rule could not
  fire at all, because its justification window included the offending line,
  which necessarily contains the word "outline". A check that reports clean on a
  known bug is worse than no check: it converts an unknown problem into a false
  assurance.

Not checkable, and staying prose: whether a grey is a label or an icon, whether
a distinction is semantic or arbitrary, whether a gutter *looks* right, and
anything needing the rendered result. Those need a person or a screenshot pass.

## Auditing

A one-time audit against this baseline is tracked as a separate pass (not
folded into feature work) — see conversation/PR history for its findings and
disposition. New findings from ad-hoc review should be added here as
conventions once resolved, the same way the hover-intent pattern was.
