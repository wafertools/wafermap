#!/usr/bin/env node
// Converts docs/GUIDE.md and docs/API.md into the GitHub Pages site.
// Images referenced as image-N.png are copied from docs/ into the output page.

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync } from 'fs';
import { marked, Renderer } from 'marked';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, '..');
const docsDir = resolve(root, 'docs');
const siteDir = resolve(root, '_site');

const repoRootUrl = 'https://github.com/telecasterer/wafermap';

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildMarkdownPage({ sourceName, outPath, title, navLinks = [], copyImages = false, showToc = false }) {
  const sourcePath = resolve(docsDir, sourceName);
  const outDir = dirname(outPath);
  mkdirSync(outDir, { recursive: true });

  let md = readFileSync(sourcePath, 'utf8');
  md = md.replace(/(!\[[^\]]*\]\([^)]+\)\s*)\n(---+)/g, '$1\n\n$2');

  const toc = [];
  const renderer = new Renderer();
  renderer.heading = function ({ text, depth }) {
    const raw = text.replace(/<[^>]+>/g, '').replace(/`/g, '');
    const id = slugify(raw);

    if (depth === 2 || depth === 3) {
      toc.push({ level: depth, id, text: raw });
    }
    return `<h${depth} id="${id}">${raw}</h${depth}>\n`;
  };

  const body = marked.parse(md, { renderer, gfm: true, breaks: false });

  if (copyImages) {
    const imgRe = /src="([^"]+\.png)"/g;
    const copied = new Set();
    let match;

    while ((match = imgRe.exec(body)) !== null) {
      const name = match[1];
      if (copied.has(name)) continue;

      const src = resolve(docsDir, name);
      if (existsSync(src)) {
        copyFileSync(src, resolve(outDir, name));
        copied.add(name);
      } else {
        console.warn(`[build-docs] image not found: ${src}`);
      }
    }
  }

  const navHtml = navLinks.map(link => {
    const attrs = link.external ? ' target="_blank" rel="noreferrer"' : '';
    return `<a href="${link.href}"${attrs}>${escapeHtml(link.label)}</a>`;
  }).join('\n        ');

  const tocHtml = showToc && toc.length > 0
    ? `<section class="contents" aria-label="Contents">
        <h2>Contents</h2>
        <ul>
          ${toc.map(h => {
            const indent = h.level === 3 ? ' class="depth-3"' : '';
            return `<li${indent}><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`;
          }).join('\n          ')}
        </ul>
      </section>`
    : '';

  const bodyWithToc = tocHtml
    ? body.replace('<hr>', `<hr>\n      ${tocHtml}`)
    : body;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background:
        radial-gradient(circle at top left, rgba(37, 99, 235, 0.08), transparent 36%),
        linear-gradient(180deg, #f8fafc 0%, #f3f6fb 100%);
      color: #1a1d23;
      line-height: 1.7;
      min-height: 100vh;
    }

    .page {
      min-height: 100vh;
    }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 10;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
      padding: 1rem 1.5rem;
      background: rgba(248, 250, 252, 0.88);
      backdrop-filter: blur(16px);
      border-bottom: 1px solid rgba(226, 229, 234, 0.9);
    }

    .brand {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.9rem;
      font-weight: 700;
      color: #111827;
      text-decoration: none;
      white-space: nowrap;
    }

    .brand:hover { color: #2563eb; }

    .nav {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 0.75rem 1rem;
    }

    .nav a {
      color: #374151;
      text-decoration: none;
      font-size: 0.9rem;
      font-weight: 600;
    }

    .nav a:hover { color: #2563eb; }

    .content {
      max-width: 860px;
      margin: 0 auto;
      padding: 2rem 1.5rem 5rem;
      background: transparent;
    }

    .content > h1 {
      font-size: 1.9rem;
      font-weight: 700;
      line-height: 1.2;
      margin-bottom: 0.75rem;
      letter-spacing: -0.02em;
    }

    ${showToc && toc.length > 0 ? `
    .contents {
      margin: 0 0 1.5rem;
      padding: 0.25rem 0 1rem;
      border-bottom: 1px solid #e2e5ea;
    }

    .contents h2 {
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #6b7280;
      margin-bottom: 0.55rem;
    }

    .contents ul {
      list-style: none;
      display: grid;
      gap: 0.02rem;
      margin: 0;
    }

    .contents li {
      margin: 0;
      line-height: 1.2;
    }

    .contents li.depth-3 a { padding-left: 0.9rem; font-size: 0.94em; }

    .contents a {
      display: block;
      color: #374151;
      text-decoration: none;
      padding: 0.12rem 0.15rem;
      border-radius: 4px;
      line-height: 1.2;
    }

    .contents a:hover {
      color: #1d4ed8;
      text-decoration: underline;
    }
    ` : ''}

    .content h2 {
      font-size: 1.18rem;
      font-weight: 700;
      margin: 2.25rem 0 0.65rem;
      border-bottom: 1px solid #e2e5ea;
      padding-bottom: 0.4rem;
    }

    .content h3 {
      font-size: 1rem;
      font-weight: 600;
      margin: 1.55rem 0 0.45rem;
    }

    .content h4 {
      font-size: 0.92rem;
      font-weight: 600;
      margin: 1.2rem 0 0.35rem;
      color: #374151;
    }

    .content p { margin: 0.7rem 0; }
    .content ul, .content ol { margin: 0.7rem 0 0.7rem 1.5rem; }
    .content li { margin: 0.2rem 0; }
    .content a { color: #2563eb; text-decoration: none; }
    .content a:hover { text-decoration: underline; }
    .content .contents a {
      color: #374151;
      text-decoration: none;
    }
    .content .contents a:hover {
      color: #1d4ed8;
      text-decoration: underline;
    }
    .content hr { border: none; border-top: 1px solid #e2e5ea; margin: 2rem 0; }

    .content code {
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 0.85em;
      background: #eef2f7;
      border: 1px solid #dbe3ed;
      border-radius: 4px;
      padding: 0.08em 0.32em;
      color: #334155;
    }

    .content pre {
      background: #f8fafc;
      color: #243042;
      border-radius: 8px;
      padding: 1.25rem 1.5rem;
      overflow-x: auto;
      margin: 1rem 0;
      font-size: 0.86rem;
      line-height: 1.65;
      border: 1px solid #dbe3ed;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.6);
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
      margin: 0.9rem 0;
      display: block;
    }

    .content blockquote {
      border-left: 3px solid #2563eb;
      padding-left: 1rem;
      color: #6b7280;
      margin: 1rem 0;
    }

    @media (max-width: 768px) {
      .topbar {
        align-items: flex-start;
        flex-direction: column;
      }

      .nav {
        justify-content: flex-start;
      }

      .content {
        padding: 1.35rem 1rem 4rem;
      }
    }
  </style>
</head>
<body>
  <div class="page">
    <header class="topbar">
      <a class="brand" href="../">wafermap demos</a>
      <nav class="nav" aria-label="Docs navigation">
        ${navHtml}
      </nav>
    </header>
    <main class="content">
      ${bodyWithToc}
    </main>
  </div>
</body>
</html>`;

  writeFileSync(outPath, html, 'utf8');
  return body;
}

buildMarkdownPage({
  sourceName: 'GUIDE.md',
  outPath: resolve(siteDir, 'guide', 'index.html'),
  title: 'Developer Guide — wafermap',
  copyImages: true,
  showToc: true,
  navLinks: [
    { href: '../', label: 'Home' },
    { href: '../api/', label: 'API Reference' },
    { href: repoRootUrl, label: 'GitHub repo', external: true },
  ],
});
console.log('[build-docs] written _site/guide/index.html');

  buildMarkdownPage({
    sourceName: 'API.md',
    outPath: resolve(siteDir, 'api', 'index.html'),
    title: 'API Reference — wafermap',
    showToc: true,
    navLinks: [
      { href: '../', label: 'Home' },
      { href: '../guide/', label: 'Developer Guide' },
    { href: repoRootUrl, label: 'GitHub repo', external: true },
  ],
});
console.log('[build-docs] written _site/api/index.html');

// ── Copy examples/ alongside _site/ so ../examples/ links from guide resolve ─
const examplesSrc = resolve(root, 'examples');
const examplesDst = resolve(siteDir, 'examples');
if (existsSync(examplesSrc)) {
  mkdirSync(examplesDst, { recursive: true });
  for (const f of readdirSync(examplesSrc)) {
    copyFileSync(resolve(examplesSrc, f), resolve(examplesDst, f));
  }
  console.log('[build-docs] copied examples/ to _site/examples/');
}
