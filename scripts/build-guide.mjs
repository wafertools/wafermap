#!/usr/bin/env node
// Converts docs/GUIDE.md → _site/guide/index.html
// Images referenced as image-N.png are copied from docs/ to _site/guide/

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync } from 'fs';
import { marked, Renderer } from 'marked';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const root  = resolve(__dir, '..');

const docsDir = resolve(root, 'docs');
const outDir  = resolve(root, '_site', 'guide');
const mdPath  = resolve(docsDir, 'GUIDE.md');

mkdirSync(outDir, { recursive: true });

// ── Slug helper ─────────────────────────────────────────────────────────────
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')  // strip html tags from text
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

// ── Custom renderer: inject id on headings ───────────────────────────────────
const toc = [];
const renderer = new Renderer();

renderer.heading = function ({ text, depth }) {
  const raw = text.replace(/<[^>]+>/g, '');
  const id  = slugify(raw);
  if (depth === 2 || depth === 3) {
    toc.push({ level: depth, id, text: raw });
  }
  return `<h${depth} id="${id}">${text}</h${depth}>\n`;
};

// ── Convert markdown ─────────────────────────────────────────────────────────
let md = readFileSync(mdPath, 'utf8');

// Prevent image lines followed by "---" being parsed as setext headings.
// Insert a blank line between an image line and the following hr.
md = md.replace(/(!\[[^\]]*\]\([^)]+\)\s*)\n(---+)/g, '$1\n\n$2');

marked.use({ renderer, gfm: true, breaks: false });
const body = marked.parse(md);

// ── Build sidebar ToC ────────────────────────────────────────────────────────
const tocHtml = toc.map(h => {
  const indent = h.level === 3 ? ' style="padding-left:1.25rem;font-size:0.8rem;"' : '';
  return `<li${indent}><a href="#${h.id}">${h.text}</a></li>`;
}).join('\n');

// ── Copy images ──────────────────────────────────────────────────────────────
const imgRe = /src="([^"]+\.png)"/g;
const copied = new Set();
let im;
while ((im = imgRe.exec(body)) !== null) {
  const name = im[1];
  if (copied.has(name)) continue;
  const src = resolve(docsDir, name);
  if (existsSync(src)) {
    copyFileSync(src, resolve(outDir, name));
    copied.add(name);
  } else {
    console.warn(`[build-guide] image not found: ${src}`);
  }
}

// ── HTML shell ───────────────────────────────────────────────────────────────
const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Developer Guide — wafermap</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f8f9fb;
      color: #1a1d23;
      line-height: 1.7;
    }

    .layout {
      display: flex;
      min-height: 100vh;
    }

    /* sidebar */
    .sidebar {
      width: 260px;
      flex-shrink: 0;
      background: #fff;
      border-right: 1px solid #e2e5ea;
      padding: 2rem 1rem 4rem;
      position: sticky;
      top: 0;
      height: 100vh;
      overflow-y: auto;
    }
    .sidebar .home-link {
      display: block;
      font-size: 0.8rem;
      color: #6b7280;
      text-decoration: none;
      margin-bottom: 1.25rem;
    }
    .sidebar .home-link:hover { color: #2563eb; }
    .sidebar h2 {
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #9ca3af;
      margin-bottom: 0.75rem;
    }
    .sidebar ul { list-style: none; }
    .sidebar li { margin: 0.2rem 0; }
    .sidebar a {
      display: block;
      font-size: 0.85rem;
      color: #374151;
      text-decoration: none;
      padding: 0.18rem 0.4rem;
      border-radius: 4px;
    }
    .sidebar a:hover { background: #f3f4f6; color: #2563eb; }

    /* content */
    .content {
      flex: 1;
      min-width: 0;
      padding: 3rem 4rem 6rem;
      max-width: 860px;
    }

    /* prose */
    .content h1 { font-size: 2rem; font-weight: 700; margin-bottom: 0.5rem; }
    .content h2 { font-size: 1.35rem; font-weight: 700; margin: 2.5rem 0 0.75rem; border-bottom: 1px solid #e2e5ea; padding-bottom: 0.4rem; }
    .content h3 { font-size: 1.05rem; font-weight: 600; margin: 1.8rem 0 0.5rem; }
    .content h4 { font-size: 0.95rem; font-weight: 600; margin: 1.4rem 0 0.4rem; color: #374151; }

    .content p  { margin: 0.75rem 0; }
    .content ul, .content ol { margin: 0.75rem 0 0.75rem 1.5rem; }
    .content li { margin: 0.25rem 0; }

    .content a { color: #2563eb; text-decoration: none; }
    .content a:hover { text-decoration: underline; }

    .content hr { border: none; border-top: 1px solid #e2e5ea; margin: 2rem 0; }

    .content code {
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 0.85em;
      background: #f3f4f6;
      border: 1px solid #e2e5ea;
      border-radius: 3px;
      padding: 0.1em 0.35em;
    }
    .content pre {
      background: #1e2128;
      color: #abb2bf;
      border-radius: 8px;
      padding: 1.25rem 1.5rem;
      overflow-x: auto;
      margin: 1rem 0;
      font-size: 0.875rem;
      line-height: 1.6;
    }
    .content pre code {
      background: none;
      border: none;
      padding: 0;
      font-size: inherit;
      color: inherit;
    }

    .content table {
      border-collapse: collapse;
      width: 100%;
      margin: 1rem 0;
      font-size: 0.875rem;
    }
    .content th, .content td {
      border: 1px solid #e2e5ea;
      padding: 0.5rem 0.75rem;
      text-align: left;
    }
    .content th { background: #f3f4f6; font-weight: 600; }

    .content img {
      max-width: 100%;
      border-radius: 6px;
      border: 1px solid #e2e5ea;
      margin: 1rem 0;
      display: block;
    }

    .content blockquote {
      border-left: 3px solid #2563eb;
      padding-left: 1rem;
      color: #6b7280;
      margin: 1rem 0;
    }

    @media (max-width: 768px) {
      .sidebar { display: none; }
      .content { padding: 2rem 1.25rem 4rem; }
    }
  </style>
</head>
<body>
  <div class="layout">
    <nav class="sidebar">
      <a class="home-link" href="../">← wafermap demos</a>
      <h2>Contents</h2>
      <ul>
        ${tocHtml}
      </ul>
    </nav>
    <main class="content">
      ${body}
    </main>
  </div>
</body>
</html>`;

writeFileSync(resolve(outDir, 'index.html'), html, 'utf8');
console.log(`[build-guide] written _site/guide/index.html (${copied.size} images copied)`);

// ── Copy guide-demos alongside _site/guide/ so ../guide-demos/ links resolve ─
const guideDemosSrc = resolve(root, 'guide-demos');
const guideDemosDst = resolve(root, '_site', 'guide-demos');
if (existsSync(guideDemosSrc)) {
  mkdirSync(guideDemosDst, { recursive: true });
  for (const f of readdirSync(guideDemosSrc)) {
    copyFileSync(resolve(guideDemosSrc, f), resolve(guideDemosDst, f));
  }
  console.log(`[build-guide] copied guide-demos/ to _site/guide-demos/`);
}
