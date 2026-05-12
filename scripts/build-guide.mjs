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

const searchIndex = [];

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
  let currentEntry = null;
  const renderer = new Renderer();

  const strip = (text) => text.replace(/<[^>]+>/g, '').replace(/`/g, '').trim();

  renderer.heading = function ({ text, depth }) {
    const raw = strip(text);
    const id = slugify(raw);

    if (depth >= 1 && depth <= 4) {
      if (depth === 2 || depth === 3) {
        toc.push({ level: depth, id, text: raw });
      }
      const pathBase = sourceName === 'GUIDE.md' ? 'guide' : 'api';
      currentEntry = {
        t: raw,
        u: `${pathBase}/#${id}`,
        p: sourceName === 'GUIDE.md' ? 'Guide' : 'API',
        c: ''
      };
      searchIndex.push(currentEntry);
    }
    return `<h${depth} id="${id}">${raw}</h${depth}>\n`;
  };

  renderer.paragraph = function ({ text }) {
    return `<p>${text}</p>\n`;
  };

  renderer.listitem = function ({ text }) {
    return `<li>${text}</li>\n`;
  };

  renderer.code = function ({ text }) {
    if (currentEntry) currentEntry.c += ' ' + text;
    return `<pre><code>${text}</code></pre>\n`;
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
    ? `<details class="toc-details">
        <summary>Table of Contents</summary>
        <section class="contents" aria-label="Contents">
          <ul>
            ${toc.map(h => {
              const indent = h.level === 3 ? ' class="depth-3"' : '';
              return `<li${indent}><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`;
            }).join('\n            ')}
          </ul>
        </section>
      </details>
      <hr>`
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
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root { --primary: #2563eb; --text: #1a1d23; --text-light: #64748b; --bg: #f8fafc; --border: #e2e8f0; }

    body {
      font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      font-size: 15px;
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
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
      border-bottom: 1px solid var(--border);
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

    .brand:hover { color: var(--primary); }

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

    .nav a:hover { color: var(--primary); }

    .search-container { position: relative; flex: 1; max-width: 320px; }
    .search-input {
      width: 100%;
      padding: 0.45rem 2.2rem 0.45rem 0.75rem;
      background: #fff;
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: 0.85rem;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .search-input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1); }
    .search-results {
      position: absolute;
      top: calc(100% + 8px);
      left: 0;
      right: 0;
      background: white;
      border: 1px solid var(--border);
      border-radius: 8px;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
      display: none;
      max-height: 400px;
      overflow-y: auto;
      z-index: 100;
    }
    .search-results.active { display: block; }
    .search-item {
      padding: 0.75rem 1rem;
      text-decoration: none;
      display: block;
      border-bottom: 1px solid var(--border);
    }
    .search-item:last-child { border-bottom: none; }
    .search-item:hover { background: #f8fafc; }
    .search-item-title { display: block; font-weight: 600; color: #1e293b; font-size: 0.85rem; margin-bottom: 2px; }
    .search-item-meta { font-size: 0.7rem; color: var(--text-light); text-transform: uppercase; letter-spacing: 0.025em; }
    .search-shortcut {
      position: absolute;
      right: 0.75rem;
      top: 50%;
      transform: translateY(-50%);
      font-size: 0.7rem;
      color: var(--text-light);
      pointer-events: none;
      background: #f1f5f9;
      padding: 2px 4px;
      border-radius: 4px;
      border: 1px solid var(--border);
    }

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
      scroll-margin-top: 80px;
    }

    ${showToc && toc.length > 0 ? `
    .toc-details {
      margin: 1rem 0 2rem;
      padding: 0;
      background: white;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }

    .toc-details summary {
      cursor: pointer;
      padding: 0.6rem 1rem;
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #475569;
      outline: none;
      user-select: none;
      background: #fcfdfe;
    }
    .toc-details[open] summary {
      border-bottom: 1px solid var(--border);
    }

    .search-widen {
      display: block;
      width: 100%;
      padding: 0.6rem 1rem;
      background: #f8fafc;
      border: none;
      border-top: 1px solid var(--border);
      color: var(--primary);
      font-size: 0.75rem;
      font-weight: 600;
      text-align: left;
      cursor: pointer;
    }
    .search-widen:hover { background: #f1f5f9; }

    .contents {
      padding: 1rem 1.25rem;
      color: var(--text-light);
    }

    .contents ul {
      list-style: none;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 0.25rem 1.5rem;
    }

    .contents li {
      margin: 0;
      line-height: 1.2;
    }

    .contents li.depth-3 a { padding-left: 0.9rem; font-size: 0.94em; }

    .contents a {
      display: block;
      color: #475569;
      text-decoration: none;
      padding: 0.12rem 0.15rem;
      border-radius: 4px;
      line-height: 1.2;
    }

    .contents a:hover {
      color: var(--primary);
      text-decoration: underline;
    }
    ` : ''}

    .content h2 {
      font-size: 1.18rem;
      font-weight: 700;
      margin: 2.25rem 0 0.65rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 0.4rem;
      color: #0f172a;
      scroll-margin-top: 80px;
    }

    .content h3 {
      font-size: 1rem;
      font-weight: 700;
      margin: 1.55rem 0 0.45rem;
      scroll-margin-top: 80px;
    }

    .content h4 {
      font-size: 0.92rem;
      font-weight: 600;
      margin: 1.2rem 0 0.35rem;
      color: #374151;
      scroll-margin-top: 80px;
    }

    .content p { margin: 1rem 0; }
    .content ul, .content ol { margin: 1rem 0 1rem 1.5rem; }
    .content li { margin: 0.2rem 0; }
    .content a { color: var(--primary); text-decoration: none; font-weight: 500; }
    .content a:hover { text-decoration: underline; }
    .content .contents a {
      color: #374151;
      text-decoration: none;
      font-weight: 400;
    }
    .content .contents a:hover {
      color: var(--primary);
      text-decoration: underline;
    }
    .content hr { border: none; border-top: 1px solid var(--border); margin: 3rem 0; }

    .content code {
      font-family: ui-monospace, 'SFMono-Regular', 'SF Mono', Menlo, Monaco, Consolas, monospace;
      font-size: 0.9em;
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      padding: 0.1em 0.3em;
      color: #475569;
    }

    .content pre {
      position: relative;
      background: #f6f8fa;
      color: #1f2328;
      border-radius: 8px;
      padding: 1rem 1.25rem;
      overflow-x: auto;
      margin: 1rem 0;
      font-size: 13px;
      line-height: 1.65;
      border: 1px solid var(--border);
    }

    .copy-button {
      position: absolute;
      top: 0.6rem;
      right: 0.6rem;
      padding: 0.2rem 0.5rem;
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-light);
      background: rgba(255, 255, 255, 0.8);
      border: 1px solid var(--border);
      border-radius: 4px;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.2s, background 0.2s, color 0.2s;
    }

    .content pre:hover .copy-button {
      opacity: 1;
    }

    .copy-button:hover {
      background: #fff;
      color: var(--primary);
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
      margin: 1.5rem 0;
      font-size: 0.84rem;
    }

    .content th, .content td {
      border: 1px solid var(--border);
      padding: 0.75rem 1rem;
      text-align: left;
    }

    .content th { background: #f8fafc; font-weight: 700; color: #475569; }

    .content img {
      max-width: 100%;
      border-radius: 8px;
      border: 1px solid var(--border);
      margin: 1.5rem 0;
      display: block;
    }

    .content blockquote {
      border-left: 4px solid var(--primary);
      padding-left: 1rem;
      color: var(--text-light);
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
      <div class="search-container">
        <input type="text" class="search-input" placeholder="Search docs..." aria-label="Search documentation">
        <span class="search-shortcut">/</span>
        <div class="search-results"></div>
      </div>
      <nav class="nav" aria-label="Docs navigation">
        ${navHtml}
      </nav>
    </header>
    <main class="content">
      ${bodyWithToc}
    </main>
  </div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
  <script>
    hljs.highlightAll();

    document.querySelectorAll('.content pre').forEach(pre => {
      const button = document.createElement('button');
      button.className = 'copy-button';
      button.innerText = 'Copy';
      button.addEventListener('click', () => {
        const code = pre.querySelector('code').innerText;
        navigator.clipboard.writeText(code).then(() => {
          button.innerText = 'Copied!';
          setTimeout(() => { button.innerText = 'Copy'; }, 2000);
        });
      });
      pre.appendChild(button);
    });

    // Search Logic
    const searchInput = document.querySelector('.search-input');
    const searchResults = document.querySelector('.search-results');
    let searchData = null;
    let searchAll = false;
    const currentCategory = "${sourceName === 'GUIDE.md' ? 'Guide' : 'API'}";

    async function initSearch() {
      try {
        const resp = await fetch('../search-index.json');
        searchData = await resp.json();
      } catch (e) { console.error('Failed to load search index', e); }
    }

    function performSearch() {
      const query = searchInput.value.toLowerCase().trim();
      if (!query || !searchData) {
        searchResults.classList.remove('active');
        return;
      }

      const matches = searchData.filter(item => 
        item.t.toLowerCase().includes(query) ||
        (item.c && item.c.toLowerCase().includes(query)) ||
        item.p.toLowerCase().includes(query)
      );

      const localMatches = matches.filter(m => m.p === currentCategory);
      const hasExternal = matches.some(m => m.p !== currentCategory);
      const displayMatches = searchAll ? matches.slice(0, 15) : localMatches.slice(0, 10);

      if (displayMatches.length > 0 || (!searchAll && hasExternal)) {
        let html = displayMatches.map(m => \`
          <a href="../\${m.u}" class="search-item">
            <span class="search-item-title">\${m.t}</span>
            <span class="search-item-meta">\${m.p}</span>
          </a>
        \`).join('');

        if (!searchAll && hasExternal) {
          html += \`<button class="search-widen">Show results from all sections...</button>\`;
        }

        searchResults.innerHTML = html;
        searchResults.classList.add('active');

        const widenBtn = searchResults.querySelector('.search-widen');
        if (widenBtn) {
          widenBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            searchAll = true;
            performSearch();
          });
        }
      } else {
        searchResults.classList.remove('active');
      }
    }

    searchInput.addEventListener('input', () => {
      searchAll = false;
      performSearch();
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-container')) searchResults.classList.remove('active');
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== searchInput) {
        e.preventDefault(); searchInput.focus();
      }
    });

    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    document.querySelector('.search-shortcut').innerText = isMac ? '⌘K' : 'Ctrl+K';
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault(); searchInput.focus();
      }
    });

    initSearch();
  </script>
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

writeFileSync(resolve(siteDir, 'search-index.json'), JSON.stringify(searchIndex), 'utf8');

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
