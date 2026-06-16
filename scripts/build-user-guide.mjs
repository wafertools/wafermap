#!/usr/bin/env node
// Converts docs/user-guide.md → packages/canvas-adapter/userGuideHtml.ts
// Run via: node scripts/build-user-guide.mjs
// Also called automatically as part of `npm run build`.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const root     = fileURLToPath(new URL('..', import.meta.url));
const mdPath   = join(root, 'docs/user-guide.md');
const outFile  = join(root, 'packages/canvas-adapter/userGuideHtml.ts');
const docsBase = 'https://telecasterer.github.io/wafermap/images/';

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
md = md.replace(
  /!\[([^\]]*)\]\(images\/icons\/([^)]+)\.svg\)/g,
  (_, alt, name) => {
    if (!iconDataUris[name]) {
      console.warn(`build-user-guide: unknown icon "${name}" — linking externally`);
      return `[icon: ${name}](${docsBase}icons/${name}.svg)`;
    }
    return `![${ alt || name }](${iconDataUris[name]})`;
  },
);

// All other local images → link to docs site (too large to inline).
md = md.replace(
  /!\[([^\]]*)\]\(images\/([^)]+)\)/g,
  (_, alt, file) => `[View image: ${alt || file}](${docsBase}${file})`,
);

// ── Convert to HTML ───────────────────────────────────────────────────────────
const bodyHtml = marked(md);

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
.wmap-guide td img{width:20px;height:20px;display:inline-block;vertical-align:middle;border:none;border-radius:0;margin:0}
.wmap-guide a{color:#0066cc;text-decoration:none}
.wmap-guide a:hover{text-decoration:underline}
</style>
${bodyHtml}</div>`;

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
