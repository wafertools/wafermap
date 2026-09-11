#!/usr/bin/env node
/**
 * Keeps the Quick Start's inline example in step with the fixture it came from.
 *
 * The synthetic-lot generator existed three times: docs/quickstart.md's
 * copy-paste example, docs/examples/quickstart-live.html, and a comment-stripped
 * fourth-hand copy inlined in scripts/capture-definitions.mjs to shoot
 * quickstart-first-map.png. All three were byte-identical and nothing enforced
 * it — so editing the doc would have left the "open this in your browser" page
 * and the screenshot beneath it rendering a different wafer than the code the
 * reader had just copied, with no error anywhere.
 *
 * Two of the three are now gone: the live page and the capture both import
 * docs/examples/quickstart-data.js, so they cannot drift by construction. Only
 * the Markdown still holds a copy, and deliberately — that snippet promises
 * "copy this into an HTML file, no bundler required", which a local import would
 * break. A copy that must exist is exactly the kind a check has to cover.
 *
 * Checks:
 *   1. docs/quickstart.md's fenced example contains the fixture's marked region
 *      verbatim (re-indented to the <script> block's four spaces)
 *   2. the live page and the capture definitions do NOT reintroduce their own
 *      copy of the generator
 *
 * Run:    node scripts/check-quickstart-snippet.mjs
 * Write:  node scripts/check-quickstart-snippet.mjs --write   (rewrites the Markdown)
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const root  = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const read  = (p) => readFileSync(resolve(root, p), 'utf8');

const FIXTURE = 'docs/examples/quickstart-data.js';
const DOC     = 'docs/quickstart.md';
const LIVE    = 'docs/examples/quickstart-live.html';
const CAPTURE = 'scripts/capture-definitions.mjs';

const problems = [];

// ── The canonical snippet ───────────────────────────────────────────────────

const fixture = read(FIXTURE);
const region = /\/\/ >>> quickstart-snippet start\n([\s\S]*?)\n\/\/ <<< quickstart-snippet end/
  .exec(fixture);
if (!region) {
  console.error(`quickstart snippet check failed:\n\n  • ${FIXTURE} has no ` +
    `"// >>> quickstart-snippet start" / "// <<< quickstart-snippet end" markers\n`);
  process.exit(1);
}

// The Markdown embeds it inside a <script type="module">, indented four spaces.
// Blank lines stay blank rather than becoming four spaces of trailing whitespace.
const snippet = region[1]
  .split('\n')
  .map(l => (l.trim() === '' ? '' : '    ' + l))
  .join('\n');

// ── 1. The Markdown copy ────────────────────────────────────────────────────
//
// Delimited by the lines around it rather than by its own first/last line: if
// the delimiters were part of the snippet, editing the fixture's first line
// would leave --write unable to find the stale block it is meant to replace.
const OPEN  = "    import { renderWaferMap } from 'https://esm.sh/@wafertools/wafermap/render';\n\n";
const CLOSE = '\n\n    // buildWaferMap processes die data into a wafer model.';

let doc = read(DOC);
const start = doc.indexOf(OPEN);
const end   = start === -1 ? -1 : doc.indexOf(CLOSE, start);

if (start === -1 || end === -1) {
  problems.push(
    `${DOC}: could not locate the example's snippet region. It is delimited by the ` +
    `renderWaferMap import above and the "// buildWaferMap processes die data" comment ` +
    `below — if either was reworded, update the delimiters in this script.`,
  );
} else {
  const current = doc.slice(start + OPEN.length, end);
  if (current !== snippet) {
    if (WRITE) {
      doc = doc.slice(0, start + OPEN.length) + snippet + doc.slice(end);
      writeFileSync(resolve(root, DOC), doc);
      console.log(`quickstart snippet: rewrote the example in ${DOC} from ${FIXTURE}`);
    } else {
      problems.push(
        `${DOC}'s inline example no longer matches ${FIXTURE}. Edit the fixture, then run ` +
        `\`node scripts/check-quickstart-snippet.mjs --write\` — never edit the fenced block directly.`,
      );
    }
  }
}

// ── 2. Nobody re-inlines the generator ──────────────────────────────────────
//
// Matching on the hash line: it is the one part of the generator with no reason
// to appear anywhere else, so it is a reliable marker for a reintroduced copy.
const FINGERPRINT = 'Math.imul(x + 100, 2654435761)';

for (const [file, hint] of [
  [LIVE,    "import { quickstartResults } from './quickstart-data.js'"],
  [CAPTURE, "import the fixture in the page instead of inlining the loop"],
]) {
  if (read(file).includes(FINGERPRINT)) {
    problems.push(`${file} inlines its own copy of the generator again — ${hint}.`);
  }
}

if (!read(LIVE).includes('quickstart-data.js')) {
  problems.push(`${LIVE} no longer imports ${FIXTURE} — the live page and the doc can now drift.`);
}

// ── Report ──────────────────────────────────────────────────────────────────

if (problems.length) {
  console.error(`quickstart snippet check failed (${problems.length}):\n`);
  for (const p of problems) console.error('  • ' + p);
  console.error('');
  process.exit(1);
}

const lines = snippet.split('\n').length;
console.log(`quickstart snippet OK — ${lines} lines shared from ${FIXTURE}, no re-inlined copies`);
