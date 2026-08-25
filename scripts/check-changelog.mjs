#!/usr/bin/env node
// Enforces that CHANGELOG.md is internally consistent and agrees with
// package.json. This exists because of a real failure: the v0.23.1 release
// commit replaced the "## [0.23.0] — 2026-08-16" heading with its own instead
// of inserting above it, so 0.23.0's entire body — the coordinate-less dies
// release — silently became part of the 0.23.1 entry. Nothing noticed for five
// days. The published npm version had no changelog entry, and What's New linked
// a #0230--2026-08-16 anchor that no longer existed.
//
// Checks:
//   1. the newest heading matches package.json's version  (all entries)
//   2. every heading is `## [x.y.z] — YYYY-MM-DD`
//   3. versions are strictly descending, with no duplicates
//   4. no version is skipped — a gap means an entry was lost or never written
//   5. dates do not go backwards as versions ascend
//   6. a `### Breaking` section appears only under a minor or major bump,
//      as this file's own versioning policy requires. This is the check that
//      catches the 0.23.0-shaped bug: a swallowed minor's Breaking section
//      surfaces under the patch that swallowed it.
//   7. every entry has at least one `###` section of content
//
// Checks 2–7 apply from STRICT_FROM onward only. Everything below that line
// was released under the previous npm scope (@paulrobins/wafermap) and before
// this file's versioning policy existed: it has month-only dates, two entries
// sharing the version 0.14.2, patch releases carrying `### Breaking`, and gaps
// where a version was built but never published. That history is a record of
// what happened, not a mistake to be corrected, and rewriting it now would
// invent dates nobody has. Enforcing from the first version published under
// the @wafertools scope still catches every future instance of the bug this
// script exists for.
//
// Run:  node scripts/check-changelog.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const text = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8');
const pkgVersion = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;

// The first version published under the @wafertools npm scope. See the header:
// history below this line is grandfathered.
const STRICT_FROM = '0.21.1';

const problems = [];
const fail = (msg) => problems.push(msg);

// ── Parse every version heading, and the body that follows it ───────────────

const lines = text.split('\n');
const entries = [];

lines.forEach((line, i) => {
  const m = /^## \[(\d+\.\d+\.\d+)\](?: — (.+))?\s*$/.exec(line);
  if (m) entries.push({ version: m[1], date: m[2] ?? null, line: i + 1, bodyStart: i + 1 });
});

if (!entries.length) {
  console.error('changelog check failed: no `## [x.y.z]` version headings found at all');
  process.exit(1);
}

for (let i = 0; i < entries.length; i++) {
  entries[i].body = lines
    .slice(entries[i].bodyStart, entries[i + 1]?.line ? entries[i + 1].line - 1 : lines.length)
    .join('\n');
}

const parse = (v) => v.split('.').map(Number);
const cmp = (a, b) => {
  const [A, B] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (A[i] !== B[i]) return A[i] - B[i];
  return 0;
};

const strict = (v) => cmp(v, STRICT_FROM) >= 0;

// ── 1. Newest heading matches package.json ─────────────────────────────────
//
// The intended release order is: write the CHANGELOG entry for the upcoming
// version, THEN run `npm version <bump>` — which is exactly why this script
// is also wired into the `version` lifecycle script, to confirm that entry
// landed. But `npm version` runs `preversion` first (this repo's
// `preversion` is `npm run verify`, which runs `npm run check`, which ends
// in this script) — BEFORE it bumps package.json — so on a
// correctly-prepared release this exact check fails here, with package.json
// still one release behind the heading that was deliberately written in
// advance, aborting `npm version` before it does anything. Hit twice in one
// day (2026-08-25) before this carve-out existed.
//
// `npm_lifecycle_event` can't tell `preversion` apart from this: each nested
// `npm run` (preversion → verify → check) resets it to its OWN script name,
// so by the time this file runs it always reads 'check', never 'preversion'
// — confirmed empirically, not assumed. `npm_new_version`/`npm_old_version`,
// by contrast, are set once by the outermost `npm version` and demonstrably
// survive that same nesting unchanged, so they're the reliable signal: if
// `npm_new_version` is set (an `npm version` is genuinely in progress) and
// the newest heading matches it exactly, that heading is the release being
// prepared, not a stale or wrong one. Outside an active `npm version` —
// a plain `npm run check`, CI, or a stray manual edit — this variable is
// unset and the check stays exactly as strict as before.
const preparingRelease = process.env.npm_new_version === entries[0].version;

if (entries[0].version !== pkgVersion && !preparingRelease) {
  fail(
    `package.json is at ${pkgVersion} but the newest CHANGELOG heading is ` +
      `[${entries[0].version}] (line ${entries[0].line}) — add the entry for ${pkgVersion} ` +
      `above it, do not edit the existing heading`
  );
}

// ── 2. Heading shape ───────────────────────────────────────────────────────

for (const e of entries) {
  if (!strict(e.version)) continue;
  if (!e.date) {
    fail(`[${e.version}] (line ${e.line}) has no date — expected \`## [${e.version}] — YYYY-MM-DD\``);
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) {
    fail(`[${e.version}] (line ${e.line}) has date '${e.date}' — expected YYYY-MM-DD`);
  }
}

// ── 3 & 4. Strictly descending, and no skipped versions ────────────────────

for (let i = 0; i < entries.length - 1; i++) {
  const [cur, next] = [entries[i], entries[i + 1]];
  if (!strict(next.version)) break;
  const d = cmp(cur.version, next.version);
  if (d === 0) {
    fail(`[${cur.version}] appears twice (lines ${next.line} and ${cur.line})`);
    continue;
  }
  if (d < 0) {
    fail(
      `versions are out of order: [${cur.version}] (line ${cur.line}) is older than ` +
        `[${next.version}] (line ${next.line}) below it`
    );
    continue;
  }

  // A skipped version is the signature of a lost entry. Only meaningful within
  // a minor series — a minor bump legitimately resets the patch number.
  const [curMaj, curMin, curPatch] = parse(cur.version);
  const [nextMaj, nextMin, nextPatch] = parse(next.version);
  if (curMaj === nextMaj && curMin === nextMin && curPatch !== nextPatch + 1) {
    const missing = [];
    for (let p = nextPatch + 1; p < curPatch; p++) missing.push(`${curMaj}.${curMin}.${p}`);
    fail(
      `no entry for ${missing.join(', ')} — [${cur.version}] (line ${cur.line}) follows ` +
        `[${next.version}] directly. If a version was never published, say so in a stub entry`
    );
  }
  if (curMaj === nextMaj && curMin > nextMin + 1) {
    const missing = [];
    for (let m = nextMin + 1; m < curMin; m++) missing.push(`${curMaj}.${m}.0`);
    fail(
      `no entry for ${missing.join(', ')} — [${cur.version}] (line ${cur.line}) follows ` +
        `[${next.version}] directly`
    );
  }
}

// ── 5. Dates move forward with versions ────────────────────────────────────

for (let i = 0; i < entries.length - 1; i++) {
  const [cur, next] = [entries[i], entries[i + 1]];
  if (!strict(next.version)) break;
  if (!cur.date || !next.date) continue;
  if (cur.date < next.date) {
    fail(
      `[${cur.version}] is dated ${cur.date}, earlier than [${next.version}] (${next.date}) ` +
        `below it (line ${cur.line})`
    );
  }
}

// ── 6. Breaking only under a minor or major bump ───────────────────────────
//
// The versioning policy at the top of CHANGELOG.md: "Any release containing a
// `### Breaking` entry requires a minor bump (0.x.0), never a patch."

for (let i = 0; i < entries.length; i++) {
  const e = entries[i];
  if (!strict(e.version)) continue;
  if (!/^### Breaking\s*$/m.test(e.body)) continue;
  const [, , patch] = parse(e.version);
  if (patch !== 0) {
    fail(
      `[${e.version}] (line ${e.line}) has a \`### Breaking\` section, but it is a patch bump. ` +
        `The versioning policy requires a minor bump for any breaking change — or, if this ` +
        `section belongs to a minor release whose heading went missing, restore that heading`
    );
  }
}

// ── 7. No empty entries ────────────────────────────────────────────────────

for (const e of entries) {
  if (!strict(e.version)) continue;
  if (!/^### /m.test(e.body)) {
    fail(`[${e.version}] (line ${e.line}) has no \`###\` section — an entry with no content`);
  }
}

if (problems.length) {
  console.error(`changelog check failed (${problems.length}):\n`);
  for (const p of problems) console.error('  • ' + p);
  console.error('\nCHANGELOG.md is the complete technical record: What\'s New links into it by');
  console.error('anchor, and the docs-site freshness workflow reads its newest date. Add a new');
  console.error('heading above the previous one — never edit an existing heading in place.\n');
  process.exit(1);
}

const checked = entries.filter((e) => strict(e.version)).length;
console.log(
  `changelog OK — ${entries.length} entries (${checked} enforced from ${STRICT_FROM}), ` +
    `newest [${entries[0].version}] matches package.json`
);
