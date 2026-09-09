#!/usr/bin/env node
// Enforces two UI_STANDARDS.md conventions that shipped as bugs before this
// script existed — both had the same shape: a parameter that's typed
// optional so a missing one compiles cleanly, with no visible failure until
// a specific embedding context (a host's own native <dialog>, a gallery card
// detached into its own popup window) hits it.
//
//   1. Every `openModal(...)`/`openFloatingWindow(...)` call site must pass
//      `anchor` — omitting it silently builds the overlay on bare
//      `doc.body`, which lands BEHIND a host's own native <dialog>
//      (`.showModal()`, browser top layer) regardless of z-index. This is
//      exactly the die-list modal bug fixed in v0.24.1 (see
//      UI_STANDARDS.md's "Every openModal/openFloatingWindow call site..."
//      section) — it shipped once already because nothing forced the
//      question.
//   2. No new `document.head.appendChild(...)` (the bare global, not a
//      threaded `doc`/`ownerDocument` variable) — a `<style>` block injected
//      into the wrong document silently has no effect in whichever document
//      the content actually renders in (the die-list font-size bug fixed the
//      same day). The codebase currently has zero occurrences of the bare
//      form; both real injection sites (dieList.ts, toolbar.ts's print
//      style) already thread a `doc` variable. Keep it that way — this check
//      has no allowlist to maintain because there is nothing on it.
//
//   3. A `position: 'sticky'` or `position: 'fixed'` element that also sets a
//      bare numeric `zIndex` literal (not one of the named Z_BASE/Z_ABOVE/
//      Z_MENU/Z_ABOVE2 tiers) must have a comment nearby explaining what
//      stacking context contains it. This is the bug class behind
//      renderWaferGallery.ts's sticky header, which shipped THREE wrong fixes
//      in one day before anyone wrote down why: a bare literal only means
//      what you think it means if something between it and whatever it's
//      being compared against already established a stacking-context
//      boundary — `position: relative` with no z-index of its own does NOT
//      do that, and it looks like it should. This check cannot verify the
//      reasoning is *correct* (that's semantic, not syntactic) — only that
//      the question was actually asked in writing at the point the code was
//      added, not skipped under time pressure. See UI_STANDARDS.md's
//      "position: sticky or fixed" entry for the full incident and the
//      `menuLayerFor` alternative that avoids needing this reasoning at all
//      for ordinary menus/dropdowns.
//
//   4. The chrome-row invariants (below). These are not a style rule but a set
//      of WIRING facts that each regressed within an hour of being fixed,
//      because each is a value whose correctness depends on context that the
//      site itself cannot see. They are asserted by name rather than by
//      pattern: the point is not that some file mentions a token, it is that
//      THIS decision was made HERE and is still made here.
//
// Run:  node scripts/check-overlay-conventions.mjs
import { readFileSync, readdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, extname, join, relative, resolve } from 'path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scanDir = resolve(root, 'packages/canvas-adapter');

/** All .ts files under `dir`, recursively — this package has no build output
 *  or node_modules nested inside it, so no exclusion list is needed. */
function listTsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...listTsFiles(p));
    else if (extname(name) === '.ts') out.push(p);
  }
  return out;
}

const files = listTsFiles(scanDir);
const problems = [];

// ── Check 1: every openModal/openFloatingWindow CALL passes `anchor` ────────
//
// Matches a call (not the `export function openModal(...)`/
// `export function openFloatingWindow(...)` definitions themselves, and not
// the OverlayOptions/interface declarations) by requiring the call not be
// immediately preceded by `function `. Extracts the full argument list via
// balanced-brace/paren matching, since a real call site's options object
// commonly spans many lines.
const CALL_RE = /\b(openModal|openFloatingWindow)\s*\(/g;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const rel = relative(root, file);

  for (const m of src.matchAll(CALL_RE)) {
    const name = m[1];
    const callStart = m.index;
    // Skip the function's own declaration: `function openModal(` /
    // `export function openModal(`.
    const before = src.slice(Math.max(0, callStart - 20), callStart);
    if (/function\s+$/.test(before)) continue;

    // Extract the parenthesised argument list by balanced-paren scanning
    // from the `(` this match ended on.
    const parenStart = callStart + m[0].length - 1;
    let depth = 0, i = parenStart, end = -1;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) continue; // unbalanced — shouldn't happen in valid TS, skip rather than false-positive

    const args = src.slice(parenStart + 1, end);
    const line = src.slice(0, callStart).split('\n').length;

    if (!/\banchor\b/.test(args)) {
      problems.push(
        `${rel}:${line}: ${name}(...) call has no 'anchor' — omitting it builds the overlay on ` +
        `bare doc.body, landing behind a host's own native <dialog> regardless of z-index. ` +
        `Pass an anchor (or, if there is genuinely no natural one — e.g. a bare click handler ` +
        `with nothing else live in the render — leave a comment saying so explicitly).`,
      );
    }
  }
}

// ── Check 2: no bare `document.head.appendChild` (style-injection safety) ──

const BARE_HEAD_APPEND_RE = /\bdocument\.head\.appendChild\b/g;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const rel = relative(root, file);
  for (const m of src.matchAll(BARE_HEAD_APPEND_RE)) {
    const line = src.slice(0, m.index).split('\n').length;
    problems.push(
      `${rel}:${line}: bare 'document.head.appendChild' — a <style> block injected into the ` +
      `wrong document silently has no effect wherever the content actually renders (e.g. a ` +
      `gallery card detached into its own popup window). Thread a 'doc'/'ownerDocument' ` +
      `parameter through instead, the same way dieList.ts and toolbar.ts's print-style ` +
      `injection already do.`,
    );
  }
}

// ── Check 2b: no bare `window.devicePixelRatio` ───────────────────────────
//
// Same family as Check 2, same cause. A chart card can be reparented into a
// detached popup, and that popup can sit on a display with a different pixel
// ratio — reading the OPENER's global there sizes the canvas backing store for
// the wrong screen, which shows up only on a multi-monitor setup as a blurry or
// mis-scaled plot. Eight of the ten chart panels did this; `trend` and
// `testPassRate` had independently worked out that they should not, which is
// the usual sign the knowledge belongs in one place. It now lives in
// `chartShell.ts`'s `chartDpr(el)`.

const BARE_DPR_RE = /\bwindow\.devicePixelRatio\b/g;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const rel = relative(root, file);
  const dprLines = src.split('\n');
  for (const m of src.matchAll(BARE_DPR_RE)) {
    const line = src.slice(0, m.index).split('\n').length;
    // The helper itself, and any `?? window` fallback chain, are the point.
    const ctx = src.slice(Math.max(0, m.index - 60), m.index);
    if (/defaultView\s*\?\?\s*$/.test(ctx)) continue;
    // Not a comment. `chartDpr`'s own docblock names the thing it exists to
    // replace, and a scanner that cannot tell an explanation from an offence
    // reports the documentation — exactly the bug the old button checker had.
    if (/^\s*(\/\/|\*|\/\*)/.test(dprLines[line - 1] ?? '')) continue;
    problems.push(
      `${rel}:${line}: bare 'window.devicePixelRatio' — reads the OPENER's ratio, which is ` +
      `wrong for content reparented into a popup on a different-DPI display. Use ` +
      `chartDpr(el) from chartShell.ts, which resolves the element's own view.`,
    );
  }
}

// ── Check 3: `position: sticky`/`fixed` + a bare-literal zIndex needs a ────
// nearby comment explaining what contains it.
//
// Deliberately line-based and approximate, matching Check 1/2's own
// philosophy: this cannot verify the containment reasoning is correct — only
// a human (or a careful re-read) can — it exists purely to make sure the
// question was actually asked in writing, not skipped. A named tier
// (Z_BASE/Z_ABOVE/Z_MENU/Z_ABOVE2) is exempt: using the shared scale IS the
// answer to the question, no separate comment needed.

const STICKY_OR_FIXED_RE = /position:\s*['"](?:sticky|fixed)['"]/;
const BARE_ZINDEX_RE = /zIndex:\s*['"]\d+['"]/;
// Any of these, case-insensitive, within the preceding lines counts as
// "the question was asked" — deliberately generous keyword list so a real
// explanatory comment in different words isn't a false positive.
const JUSTIFICATION_RE = /contain|isolat|menuLayerFor|stacking context|z-index/i;
const LOOKBACK_LINES = 12;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const rel = relative(root, file);
  const lines = src.split('\n');

  for (let i = 0; i < lines.length; i++) {
    // A style object commonly spans a few lines — check this line and the
    // next couple for the position/zIndex pairing, in either order.
    const window = lines.slice(i, i + 3).join('\n');
    if (!STICKY_OR_FIXED_RE.test(window) || !BARE_ZINDEX_RE.test(window)) continue;

    const lookback = lines.slice(Math.max(0, i - LOOKBACK_LINES), i + 1).join('\n');
    if (JUSTIFICATION_RE.test(lookback)) continue;

    problems.push(
      `${rel}:${i + 1}: 'position: sticky'/'fixed' with a bare-literal zIndex and no nearby ` +
      `comment explaining what stacking context contains it. See UI_STANDARDS.md's ` +
      `"position: sticky or fixed" entry — this exact shape shipped three wrong fixes in one ` +
      `day before it was written down. Either add that comment, or route through ` +
      `menuLayerFor(anchor) instead if this is a menu/dropdown.`,
    );
  }
}

// ── 4. Chrome-row invariants ───────────────────────────────────────────────
//
// Each entry is a fact that must remain true in one named file, with the
// incident that made it a rule. A missing one is not a style nit — every one of
// these shipped a visible defect, twice in two cases.
const CHROME_RULES = [
  { file: 'packages/canvas-adapter/renderWaferMap.ts',
    must: /background:\s*CLR\.canvasBg/,
    why: "the single map's chrome row must paint the MAP AREA's background (CLR.canvasBg), " +
         'not inherit the host surface. Inside a gallery card it sits directly above the ' +
         "canvas, and inheriting the card's white left a pale band across the top of every card." },
  { file: 'packages/canvas-adapter/renderWaferGallery.ts',
    must: /background:\s*CLR\.canvasBg/,
    why: 'the gallery chrome row must paint the same background as the single map\'s, or the ' +
         'two views sit on different grounds on any host whose page is not already the map colour.' },
  { file: 'packages/canvas-adapter/renderWaferMap.ts',
    must: /paddingBottom:\s*SPACE\.lg/,
    why: 'the chrome row\'s gap below it must be PADDING, not margin. The row paints a ' +
         'background and a margin falls outside that paint — as a margin it showed 10px of the ' +
         "card's white between the slate chrome row and the slate canvas." },
  { file: 'packages/canvas-adapter/renderWaferGallery.ts',
    must: /chromeInset:\s*MAP_CHROME_INSET/,
    why: 'gallery CARDS must state their chrome inset. A card already supplies the outer inset, ' +
         'so a map inside one takes the small MAP_CHROME_INSET; giving every map the default ' +
         'EDGE_GUTTER stacks two gutters inside the card. This regressed twice — once when ' +
         'MAP_CHROME_INSET was deleted as apparently unused, once when the chrome row took ' +
         'EDGE_GUTTER unconditionally to align with the Insights content.' },
  { file: 'packages/canvas-adapter/renderWaferMap.ts',
    must: /contentInset:\s*chromeInset/,
    why: "the Insights tab must be given the SAME inset the chrome row uses, or the tab bar sits " +
         'a gutter further in than the identity above it and the two step apart on every switch.' },
];
for (const { file, must, why } of CHROME_RULES) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { problems.push(`${file}: missing (chrome-row rule)`); continue; }
  if (!must.test(text)) problems.push(`${file}: ${why}`);
}

if (problems.length) {
  console.error(`overlay conventions check failed (${problems.length}):\n`);
  for (const p of problems) console.error('  • ' + p);
  console.error('\nSee UI_STANDARDS.md — "Modal/overlay content padding" / "Cross-document');
  console.error('DOM/style safety" / "position: sticky or fixed" / the anchor convention.\n');
  process.exit(1);
}

console.log(`overlay conventions OK — checked ${files.length} files`);
