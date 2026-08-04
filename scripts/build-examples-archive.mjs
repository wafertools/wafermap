#!/usr/bin/env node
// Assembles site/wafermap-examples.zip — the downloadable, fully offline
// examples package.
//
// Runs LAST in `npm run build:site`: zensical's `build --clean` wipes site/, and
// bundle-docs.mjs then overwrites site/dist with the esbuild bundles. Reading
// from the finished site/ means the archive contains byte-for-byte what the live
// documentation serves, rather than a separately-built near-copy.
//
// Layout mirrors the docs site exactly, so every example's importmap
// ("wafermap": "../dist/index.js") resolves unchanged and no HTML is rewritten:
//
//   wafermap-examples/
//     README.md  serve.py  serve.sh  serve.cmd
//     dist/       bundled library
//     examples/   the demo pages + a standalone index.html
//     data/       the CSVs the examples and guide reference
//     starter/    minimal skeleton to copy
//
// Run:  node scripts/build-examples-archive.mjs
import {
  cpSync, existsSync, mkdirSync, readFileSync, readdirSync,
  rmSync, statSync, writeFileSync,
} from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve, join, relative } from 'path';
import { loadManifest, renderIndexHtml } from './build-examples-index.mjs';

const root     = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE     = resolve(root, 'site');
const ASSETS   = resolve(root, 'scripts/archive-assets');
const NAME     = 'wafermap-examples';
const STAGE    = resolve(SITE, `.${NAME}-stage`);
const OUT_ZIP  = resolve(SITE, `${NAME}.zip`);

const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;

// Large fixtures that no example fetches. They are regenerable and add ~3.7 MB.
const SKIP_DATA = /^showcase-.*\.csv$/;

const die = (msg) => { console.error(`build-examples-archive: ${msg}`); process.exit(1); };

// ── Preconditions ───────────────────────────────────────────────────────────

if (!existsSync(SITE))                     die('site/ not found — run `npm run build:site` first.');
if (!existsSync(resolve(SITE, 'dist')))    die('site/dist not found — bundle-docs.mjs must run before this script.');
if (!existsSync(resolve(SITE, 'examples'))) die('site/examples not found — the zensical build did not produce it.');

if (spawnSync('zip', ['-v'], { stdio: 'ignore' }).status !== 0) {
  die('the `zip` command is not available.\n' +
      '  Install it (Debian/Ubuntu: apt-get install zip) and re-run.\n' +
      '  Refusing to emit a partial artifact.');
}

// ── Stage ───────────────────────────────────────────────────────────────────

rmSync(STAGE, { recursive: true, force: true });
const pkgDir = resolve(STAGE, NAME);
mkdirSync(pkgDir, { recursive: true });

// dist/ — copied whole. The five esbuild bundles sit on top of the unbundled
// tsc tree, and the tree must stay: wafermap.worker.js is loaded raw by the
// browser (worker.html) and walks its own module graph, unbundled.
cpSync(resolve(SITE, 'dist'), resolve(pkgDir, 'dist'), { recursive: true });

// examples/
cpSync(resolve(SITE, 'examples'), resolve(pkgDir, 'examples'), { recursive: true });

// data/ — everything the examples and the guide reference, minus the unused bulk.
const dataSrc = resolve(SITE, 'data');
const dataOut = resolve(pkgDir, 'data');
mkdirSync(dataOut, { recursive: true });
let skipped = 0;
for (const f of readdirSync(dataSrc)) {
  const src = resolve(dataSrc, f);
  if (statSync(src).isDirectory()) continue;
  if (SKIP_DATA.test(f)) { skipped++; continue; }
  cpSync(src, resolve(dataOut, f));
}

// images/ — only what the example pages actually reference. site/images is
// ~9 MB, almost all of it documentation screenshots that nothing here loads;
// the toolbar icon set (showcase.html's legend) is a few KB of SVG. The
// link self-check below is what keeps this list honest.
const imgOut = resolve(pkgDir, 'images');
mkdirSync(imgOut, { recursive: true });
cpSync(resolve(SITE, 'images/icons'), resolve(imgOut, 'icons'), { recursive: true });
for (const f of ['wafermap-favicon.ico', 'wafermap-readme-header-256.png']) {
  const src = resolve(SITE, 'images', f);
  if (existsSync(src)) cpSync(src, resolve(imgOut, f));
}

// Browsers request /favicon.ico unprompted on every page. Without it, every
// single page in the package logs a 404 — harmless, but this archive is often
// someone's first impression of the library, viewed with devtools open.
if (existsSync(resolve(SITE, 'images/wafermap-favicon.ico'))) {
  cpSync(resolve(SITE, 'images/wafermap-favicon.ico'), resolve(pkgDir, 'favicon.ico'));
}

// starter/ and the launchers.
cpSync(resolve(ASSETS, 'starter'), resolve(pkgDir, 'starter'), { recursive: true });
cpSync(resolve(ASSETS, 'serve.py'), resolve(pkgDir, 'serve.py'));
cpSync(resolve(ASSETS, 'serve.sh'), resolve(pkgDir, 'serve.sh'));

// serve.cmd needs CRLF: this archive is built on Linux, and cmd.exe is
// unreliable with LF-only batch files. zip preserves bytes, so whatever is
// written here is exactly what Windows gets.
writeFileSync(
  resolve(pkgDir, 'serve.cmd'),
  readFileSync(resolve(ASSETS, 'serve.cmd'), 'utf8').replace(/\r?\n/g, '\r\n'),
);

// ── Generated pages ─────────────────────────────────────────────────────────

const manifest = loadManifest();

// zensical's examples/index.html is a themed 39 KB site page whose ../guide/
// links are dead outside the site. Replace it with a standalone index whose
// Guide links are absolute.
writeFileSync(resolve(pkgDir, 'examples/index.html'), renderIndexHtml(manifest, { version }));

writeFileSync(resolve(pkgDir, 'README.md'), readme(version, manifest));

// Opening an AI agent inside this folder to adapt an example is a realistic way
// to start, so the usage rules travel with it rather than living only on the site.
cpSync(resolve(root, 'AGENTS.md'), resolve(pkgDir, 'AGENTS.md'));
cpSync(resolve(root, 'llms.txt'),  resolve(pkgDir, 'llms.txt'));

// ── Self-check ──────────────────────────────────────────────────────────────
//
// A broken download is worse than no download: it fails on the user's machine,
// silently, after they have already formed an impression. Everything cheap
// enough to verify here is verified here.

const problems = [];

// Every dataFile the manifest declares resolves inside the staged tree.
for (const d of manifest.demos) {
  if (!existsSync(resolve(pkgDir, 'examples', d.file))) {
    problems.push(`missing examples/${d.file}`);
  }
  for (const df of d.dataFiles) {
    if (!existsSync(resolve(pkgDir, 'examples', df))) {
      problems.push(`entry '${d.id}': missing data file examples/${df}`);
    }
  }
}

// Importmap targets and local assets referenced by staged HTML actually exist.
// Case matters: the archive is assembled on Linux, so a wrong-case href that
// Windows would tolerate must be caught before it ships.
const htmlFiles = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.html')) htmlFiles.push(p);
  }
})(pkgDir);

const REF = /(?:src|href)="([^"#?:]+)"|"(\.\.?\/[^"#?]*\.(?:js|css|json|csv))"/g;
for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  for (const m of html.matchAll(REF)) {
    const ref = m[1] ?? m[2];
    if (!ref || /^(https?:|data:|mailto:|#)/.test(ref)) continue;

    const target = resolve(dirname(file), ref);
    const rel    = relative(pkgDir, target);
    if (rel.startsWith('..')) {
      problems.push(`${relative(pkgDir, file)}: link escapes the archive root — ${ref}`);
    } else if (!existsSync(target)) {
      problems.push(`${relative(pkgDir, file)}: broken link — ${ref}`);
    }
  }
}

// External dependencies break the offline promise, so they are reported rather
// than silently shipped. Not fatal — comparison.html deliberately loads Plotly
// from a CDN (it is the thing being compared against) and degrades with an
// explanation when the script does not arrive. A NEW entry here means a page
// stopped working offline and nobody noticed.
const EXPECTED_EXTERNAL = new Set(['examples/comparison.html']);
const external = new Map();
for (const file of htmlFiles) {
  const rel = relative(pkgDir, file);
  for (const m of readFileSync(file, 'utf8').matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)) {
    // Links a user clicks are fine; only fetched subresources matter.
    if (!/\.(js|css)(\?|$)/.test(m[1])) continue;
    if (!external.has(rel)) external.set(rel, []);
    external.get(rel).push(m[1]);
  }
}
for (const [file, urls] of external) {
  if (EXPECTED_EXTERNAL.has(file)) continue;
  problems.push(`${file}: loads from the network, so it will not work offline — ${urls[0]}`);
}

if (problems.length) {
  console.error(`build-examples-archive: ${problems.length} problem(s) in the staged package:\n`);
  for (const p of [...new Set(problems)]) console.error('  • ' + p);
  console.error('\nRefusing to publish a broken archive.');
  process.exit(1);
}

// ── Zip ─────────────────────────────────────────────────────────────────────

rmSync(OUT_ZIP, { force: true });
const zip = spawnSync('zip', ['-r', '-q', OUT_ZIP, NAME], { cwd: STAGE, encoding: 'utf8' });
if (zip.status !== 0) die(`zip failed:\n${zip.stderr || zip.stdout}`);

rmSync(STAGE, { recursive: true, force: true });

const mb = (statSync(OUT_ZIP).size / 1024 / 1024).toFixed(1);
console.log(`wrote site/${NAME}.zip — ${mb} MB (${htmlFiles.length} pages, ${skipped} unused data files omitted)`);

// ── README ──────────────────────────────────────────────────────────────────

function readme(version, manifest) {
  const count = new Set(manifest.demos.map(d => d.file)).size;
  return `# wafermap examples

Offline examples package for [@wafertools/wafermap](https://wafertools.github.io/wafermap/)
**v${version}**.

The library is bundled in \`dist/\`. Nothing to install, no network needed —
unzip, start the server, and every page works.

## Start it

The pages **must be served over HTTP**. Opening \`index.html\` from your file
manager will not work: browsers block ES modules and \`fetch\` on \`file://\`
URLs, so you will get a blank page and a console full of CORS errors.

| Platform | Command |
|---|---|
| Windows | \`serve.cmd\` (double-click, or run it from a terminal) |
| macOS / Linux | \`sh serve.sh\` |

Both take an optional port: \`sh serve.sh 9000\`. Then open:

- **<http://localhost:8080/examples/index.html>** — the ${count} examples
- **<http://localhost:8080/starter/>** — a minimal skeleton to copy

Requires Python 3, which ships with macOS and most Linux distributions. On
Windows, install it from [python.org](https://python.org) if \`serve.cmd\`
reports it missing.

### No Python?

\`\`\`
npx http-server -p 8080 .
\`\`\`

Do **not** use \`npx serve\` — it returns 404 for the \`.js\` files under
\`dist/\`, which breaks every page.

> The bundled \`serve.py\` is not just a convenience wrapper: it pins the MIME
> type for \`.js\`. Python's built-in server reads MIME types from the Windows
> registry, and on machines where that mapping has been altered it serves
> JavaScript as \`text/plain\`, which browsers refuse to execute as a module.
> Any substitute server needs to get \`text/javascript\` right.

## What's inside

| Path | |
|---|---|
| \`examples/\` | ${count} worked examples, one topic each. Start at \`examples/index.html\`. |
| \`starter/\` | Minimal app skeleton — copy this folder to begin your own. See \`starter/README.md\`. |
| \`dist/\` | The bundled library. Do not edit. |
| \`data/\` | Sample CSVs used by the examples and the Developer Guide. |
| \`AGENTS.md\` | Usage rules to paste into your AI coding agent's config before it writes wafer map code. |
| \`llms.txt\` | Machine-readable map of the docs and package entry points. |

Edit any example in place and reload — there is no build step.

**One exception to "works offline":** \`examples/comparison.html\` benchmarks
wafermap against Plotly.js, which it fetches from a CDN. Without a connection
that page explains itself and stops; everything else is unaffected.

The larger synthetic datasets (\`showcase-*.csv\`) are omitted to keep the
download small; regenerate them with \`scripts/gen-showcase-csvs.mjs\` from the
[repository](https://github.com/wafertools/wafermap) if you want them.

## Using it in a real project

The examples resolve the library through an importmap in each page's \`<head>\`:

\`\`\`html
<script type="importmap">{ "imports": {
  "wafermap":        "../dist/index.js",
  "wafermap/render": "../dist/packages/canvas-adapter/index.js"
} }</script>
\`\`\`

When you move to a bundler (Vite, webpack, esbuild), delete that block and:

\`\`\`
npm install @wafertools/wafermap
\`\`\`

The \`import\` statements themselves do not change.

## Documentation

- [Quick start](https://wafertools.github.io/wafermap/quickstart/)
- [Developer guide](https://wafertools.github.io/wafermap/guide/)
- [API reference](https://wafertools.github.io/wafermap/api/)

MIT licensed.
`;
}
