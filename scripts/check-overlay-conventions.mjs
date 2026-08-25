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

if (problems.length) {
  console.error(`overlay conventions check failed (${problems.length}):\n`);
  for (const p of problems) console.error('  • ' + p);
  console.error('\nSee UI_STANDARDS.md — "Modal/overlay content padding" / "Cross-document');
  console.error('DOM/style safety" / the anchor convention below them.\n');
  process.exit(1);
}

console.log(`overlay conventions OK — checked ${files.length} files`);
