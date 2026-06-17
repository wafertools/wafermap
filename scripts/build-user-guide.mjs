#!/usr/bin/env node
// Converts docs/user-guide.md → packages/canvas-adapter/userGuideHtml.ts
// Run via: node scripts/build-user-guide.mjs
// Also called automatically as part of `npm run build`.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked, Renderer } from 'marked';

function slugify(text) {
  return text.toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')   // strip non-word chars (except spaces and hyphens)
    .replace(/[\s_]+/g, '-')    // spaces/underscores → hyphens
    .replace(/-+/g, '-')        // collapse multiple hyphens
    .replace(/^-|-$/g, '');     // trim leading/trailing hyphens
}

const root          = fileURLToPath(new URL('..', import.meta.url));
const mdPath        = join(root, 'docs/user-guide.md');
const outFile       = join(root, 'packages/canvas-adapter/userGuideHtml.ts');
const demosScript   = readFileSync(join(root, 'docs/guide-demos.js'), 'utf8');

// ── Load all SVG icons as base64 data URIs ───────────────────────────────────
const iconDir = join(root, 'docs/images/icons');
const iconDataUris = {};
for (const file of readdirSync(iconDir).filter(f => f.endsWith('.svg'))) {
  const key = basename(file, '.svg');
  iconDataUris[key] = `data:image/svg+xml;base64,${readFileSync(join(iconDir, file)).toString('base64')}`;
}

// ── Inline the toolbar-single image as base64 ────────────────────────────────
const toolbarB64 = readFileSync(join(root, 'docs/images/toolbar-single.png')).toString('base64');
const toolbarDataUri = `data:image/png;base64,${toolbarB64}`;

// ── Read and pre-process Markdown ────────────────────────────────────────────
let md = readFileSync(mdPath, 'utf8');

// Inline toolbar-single as base64 (already inlined for offline use).
md = md.replace(
  /!\[([^\]]*)\]\(images\/toolbar-single\.png\)/g,
  `![$1](${toolbarDataUri})`,
);

// Inline icon SVGs as base64 data URIs so they work without any external files.
// Handles both markdown ![alt](images/icons/name.svg) and HTML <img src="images/icons/name.svg">.
md = md.replace(
  /!\[([^\]]*)\]\(images\/icons\/([^)]+)\.svg\)/g,
  (_, alt, name) => {
    if (!iconDataUris[name]) {
      console.warn(`build-user-guide: unknown icon "${name}" — removing from output`);
      return '';
    }
    return `![${ alt || name }](${iconDataUris[name]})`;
  },
);
md = md.replace(
  /<img\s+src="images\/icons\/([^"]+)\.svg"([^>]*)>/g,
  (_, name, rest) => {
    if (!iconDataUris[name]) {
      console.warn(`build-user-guide: unknown icon "${name}" — removing from output`);
      return '';
    }
    return `<img src="${iconDataUris[name]}"${rest}>`;
  },
);

// Screenshot PNGs are too large to inline and must not depend on external URLs.
// Remove image embeds, plain links to images, and any *caption* paragraph immediately
// following (captions may span two lines) — so edits to user-guide.md stay self-contained.
md = md.replace(/!?\[([^\]]*)\]\(images\/(?!icons\/)[^)]+\)\n(\n\*[^\n]*\n?[^\n]*\*)?/g, '');

// ── Configure marked: add id attributes to headings ──────────────────────────
// marked does not emit id= by default. We need them so internal anchor links
// (#2-plot-modes etc.) can be resolved via querySelector inside the modal.
// slugify() matches the slug format user-guide.md's internal links use.
const renderer = new Renderer();
renderer.heading = ({ text, depth, tokens }) => {
  const rawText = tokens.map(t => t.raw ?? '').join('');
  const id = slugify(rawText);
  const inner = marked.parseInline(text);
  return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
};

// ── Convert to HTML ───────────────────────────────────────────────────────────
let bodyHtml = marked(md, { renderer });

// Inject online docs link after the <h1>. Opens in new tab in browsers;
// silently does nothing in Tauri/Electron (WebView blocks external navigation)
// but the URL remains visible so users can copy it.
bodyHtml = bodyHtml.replace(
  /(<h1[^>]*>.*?<\/h1>)/s,
  `$1\n<p class="wmap-guide-online-link">` +
  `This is a quick reference. ` +
  `<a href="https://telecasterer.github.io/wafermap/user-guide/" target="_blank" rel="noopener">` +
  `View the full illustrated guide online ↗</a></p>`,
);

// Rewrite internal anchor links (#section-id) so they scroll within the modal
// instead of navigating the parent page URL. Works in all contexts (third-party
// app toolbar modal, standalone HTML, Tauri/Electron WebView) because:
//   - preventDefault() always fires, so the URL never changes
//   - querySelector searches within .wmap-guide, not the whole document
//   - headings have matching id attributes (added by the renderer above)
bodyHtml = bodyHtml.replace(
  /href="#([^"]+)"/g,
  (_, id) => `href="#${id}" onclick="(function(e){e.preventDefault();var g=e.target.closest('.wmap-guide');var el=g&&g.querySelector('[id=\\'${id}\\']');if(el)el.scrollIntoView({behavior:'smooth'});})(event)"`,
);

// ── Wrap with scoped inline styles ───────────────────────────────────────────
// Icons in headings and table cells need specific sizing; block images (toolbar
// strip) keep their natural width but are capped. The td:has rule centres the
// narrow icon-only cells in overlay/orientation tables.
const wrappedHtml = `<div class="wmap-guide">
<style>
.wmap-guide{font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.65;color:#1a1a1a;padding:24px 32px;max-width:720px;margin:0 auto;overflow-y:auto;height:100%;box-sizing:border-box}
.wmap-guide h1{font-size:1.35em;font-weight:700;margin:0 0 18px;padding-bottom:10px;border-bottom:2px solid #e2e5ea;color:#111}
.wmap-guide h2{font-size:1.1em;font-weight:700;margin:28px 0 10px;padding-bottom:6px;border-bottom:1px solid #e9eaec;color:#1a1a1a}
.wmap-guide h3{font-size:1em;font-weight:700;margin:20px 0 6px;color:#222;display:flex;align-items:center;gap:6px}
.wmap-guide h3 img{width:20px;height:20px;display:inline;vertical-align:middle;border:none;border-radius:0;margin:0}
.wmap-guide p{margin:0 0 12px}
.wmap-guide ul,.wmap-guide ol{margin:0 0 12px;padding-left:22px}
.wmap-guide li{margin-bottom:4px}
.wmap-guide table{border-collapse:collapse;width:100%;margin:0 0 16px;font-size:13px}
.wmap-guide th{background:#f4f5f7;text-align:left;padding:7px 10px;font-weight:600;border:1px solid #d8dce2}
.wmap-guide td{padding:6px 10px;border:1px solid #e2e5ea;vertical-align:middle}
.wmap-guide tr:nth-child(even) td{background:#fafbfc}
.wmap-guide strong{font-weight:600}
.wmap-guide code{font-family:monospace;font-size:12px;background:#f0f2f5;padding:1px 4px;border-radius:3px}
.wmap-guide hr{border:none;border-top:1px solid #e9eaec;margin:24px 0}
.wmap-guide img{max-width:100%;height:auto;border:1px solid #e2e5ea;border-radius:6px;margin:8px 0;display:block}
.wmap-guide td img{width:20px;height:20px;max-width:none;display:inline-block;vertical-align:middle;border:none;border-radius:0;margin:0}
.wmap-guide a{color:#0066cc;text-decoration:none}
.wmap-guide a:hover{text-decoration:underline}
.wmap-guide-online-link{font-size:12px;color:#555;margin:-8px 0 18px;padding:8px 12px;background:#f4f5f7;border-radius:4px;border-left:3px solid #c0c4cc}
.wmap-guide-online-link a{color:#0066cc}
.wmap-demo{width:100%;height:220px;margin:12px 0;border:1px solid #e2e5ea;border-radius:6px;overflow:hidden;background:#f8f9fa}
.wmap-demo[data-wmap-demo="gallery"]{height:380px}
.wmap-demo[data-wmap-demo="findings"]{height:280px}
</style>
${bodyHtml}<script>${demosScript}</script></div>`;

// ── Escape for TypeScript template literal ────────────────────────────────────
const escaped = wrappedHtml
  .replace(/\\/g, '\\\\')
  .replace(/`/g, '\\`')
  .replace(/\$\{/g, '\\${');

// ── Write output ──────────────────────────────────────────────────────────────
const output = `// @generated — do not edit directly.
// Source: docs/user-guide.md
// Regenerate with: npm run build:guide
// Auto-regenerated on every: npm run build

export const USER_GUIDE_HTML = \`${escaped}\`;
`;

writeFileSync(outFile, output, 'utf8');
console.log('build-user-guide: wrote packages/canvas-adapter/userGuideHtml.ts');
