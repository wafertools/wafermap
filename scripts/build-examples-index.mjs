#!/usr/bin/env node
// Regenerates docs/examples/index.md from docs/examples/manifest.json.
//
// The examples list used to be maintained in three places that had to agree —
// demo-nav.js, index.md, and zensical.toml. The manifest is now the source;
// this script owns index.md, demo-nav.js reads the manifest at runtime, and
// check-examples-manifest.mjs enforces zensical.toml against it.
//
// Also exports renderIndexHtml() for the offline archive, which needs the same
// list as a standalone page with no zensical chrome.
//
// Run:  node scripts/build-examples-index.mjs [--check]
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const root         = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST     = resolve(root, 'docs/examples/manifest.json');
const INDEX_MD     = resolve(root, 'docs/examples/index.md');
const SITE_URL     = 'https://wafertools.github.io/wafermap';

export function loadManifest() {
  return JSON.parse(readFileSync(MANIFEST, 'utf8'));
}

/** Ordered section names, as they first appear in the manifest. */
export function sectionsOf(manifest) {
  const seen = [];
  for (const d of manifest.demos) {
    if (d.nav === false) continue;
    if (!seen.includes(d.section)) seen.push(d.section);
  }
  return seen;
}

const href = d => d.file + (d.anchor ?? '');

function renderMarkdown(manifest) {
  const out = [];
  out.push('# Examples');
  out.push('');
  out.push('**For:** developers. Each example demonstrates live what the matching [Developer Guide](../guide.md) section explains — the guide is the narrative, these are the working code.');
  out.push('');
  out.push('Live interactive demos. Each opens a standalone page rendered in the browser.');
  out.push('');
  // Plain markdown, deliberately: the `admonition` extension is not enabled in
  // zensical.toml, so `!!! tip` blocks render as literal code blocks.
  out.push(`**Run these on your own machine.** Every example on this page ships in the [downloadable examples package](${SITE_URL}/wafermap-examples.zip) — unzip it, start the bundled server, and edit them locally. The library is included, so it works offline with nothing to install.`);
  out.push('');
  out.push('Some pages cover several related topics; those links point at the relevant section of the page.');
  out.push('');

  for (const section of sectionsOf(manifest)) {
    out.push(`## ${section}`);
    out.push('');
    for (const d of manifest.demos) {
      if (d.nav === false || d.section !== section) continue;
      const guide = d.guide ? ` · [${d.guide.label}](${d.guide.href})` : '';
      out.push(`- [${d.title}](${href(d)}) — ${d.blurb}${guide}`);
    }
    out.push('');
  }

  const unlisted = manifest.demos.filter(d => d.nav === false);
  if (unlisted.length) {
    out.push('---');
    out.push('');
    for (const d of unlisted) {
      out.push(`[**${d.title}**](${href(d)}) — ${d.blurb}`);
      out.push('');
    }
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/**
 * Standalone HTML index for the offline archive. Guide links are rewritten to
 * absolute URLs on the published site — inside the archive there is no ../guide.
 */
export function renderIndexHtml(manifest, { version } = {}) {
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  // `blurb` carries inline `code` spans from the manifest; render them.
  const md = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

  const guideHref = (h) =>
    h.replace(/^\.\.\//, `${SITE_URL}/`).replace(/\.md(#|$)/, '/$1');

  const sections = sectionsOf(manifest).map(section => {
    const rows = manifest.demos
      .filter(d => d.nav !== false && d.section === section)
      .map(d => {
        const guide = d.guide
          ? ` <a class="guide" href="${guideHref(d.guide.href)}">${esc(d.guide.label)}</a>`
          : '';
        return `      <li><a class="demo" href="${href(d)}">${esc(d.title)}</a> <span>${md(d.blurb)}</span>${guide}</li>`;
      })
      .join('\n');
    return `    <h2>${esc(section)}</h2>\n    <ul>\n${rows}\n    </ul>`;
  }).join('\n\n');

  const unlisted = manifest.demos
    .filter(d => d.nav === false)
    .map(d => `      <li><a class="demo" href="${href(d)}">${esc(d.title)}</a> <span>${md(d.blurb)}</span></li>`)
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>wafermap examples</title>
  <link rel="stylesheet" href="demo.css">
  <style>
    .index-wrap { max-width: 900px; margin: 0 auto; padding: 24px 20px 48px; }
    .index-wrap h1 { font-size: 22px; margin: 0 0 6px; }
    .index-wrap h2 {
      font-size: 12px; text-transform: uppercase; letter-spacing: .05em;
      color: var(--muted); margin: 28px 0 10px;
    }
    .index-wrap ul { list-style: none; margin: 0; padding: 0; }
    .index-wrap li {
      padding: 9px 0; border-bottom: 1px solid var(--border);
      font-size: 13px; line-height: 1.5;
    }
    .index-wrap a.demo { font-weight: 600; text-decoration: none; color: var(--accent); }
    .index-wrap a.demo:hover { text-decoration: underline; }
    .index-wrap li span { color: var(--text-2); }
    .index-wrap a.guide { color: var(--muted); font-size: 11px; text-decoration: none; }
    .index-wrap a.guide:hover { text-decoration: underline; }
    .index-note {
      font-size: 12px; color: var(--text-2); line-height: 1.6;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 8px; padding: 12px 14px; margin: 14px 0 0;
    }
  </style>
</head>
<body class="demo-page" style="display:block; overflow:auto">
  <div class="index-wrap">
    <h1>wafermap examples</h1>
    <p class="index-note">
      Offline examples package${version ? ` — wafermap v${esc(version)}` : ''}.
      The library is bundled in <code>../dist/</code>; every page here runs with no network access.
      Start with <a href="first-map.html">Your first wafer map</a>, or copy
      <a href="../starter/index.html">../starter/</a> as the seed for your own app.
      Guide links open the online documentation.
    </p>

${sections}

    <h2>Unlisted</h2>
    <ul>
${unlisted}
    </ul>
  </div>
</body>
</html>
`;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const manifest = loadManifest();
  const next     = renderMarkdown(manifest);

  if (process.argv.includes('--check')) {
    const current = readFileSync(INDEX_MD, 'utf8');
    if (current !== next) {
      console.error(
        'docs/examples/index.md is out of date with manifest.json.\n' +
        'Run: node scripts/build-examples-index.mjs'
      );
      process.exit(1);
    }
    console.log('examples index up to date');
  } else {
    writeFileSync(INDEX_MD, next);
    console.log(`wrote ${INDEX_MD}`);
  }
}
