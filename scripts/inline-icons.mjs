#!/usr/bin/env node
// Rewrites <img src="images/icons/NAME.svg" ...> in the built site HTML to use
// inline base64 data URIs, so the icons load regardless of proxy/auth setup.
// Reads from docs/images/icons/, patches site/GUIDE/index.html in place.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root    = fileURLToPath(new URL('..', import.meta.url));
const iconDir = join(root, 'docs/images/icons');
const target  = join(root, 'site/GUIDE/index.html');

// Build name → data URI map
const dataUris = {};
for (const file of readdirSync(iconDir).filter(f => f.endsWith('.svg'))) {
  const name = basename(file, '.svg');
  const svg  = readFileSync(join(iconDir, file));
  dataUris[name] = `data:image/svg+xml;base64,${svg.toString('base64')}`;
}

let html = readFileSync(target, 'utf8');

// Replace src="../images/icons/NAME.svg" with the data URI
html = html.replace(/src="\.\.\/images\/icons\/([^"]+)\.svg"/g, (_, name) => {
  const uri = dataUris[name];
  if (!uri) { console.warn(`inline-icons: no data URI for icon "${name}"`); return _; }
  return `src="${uri}"`;
});

writeFileSync(target, html, 'utf8');
console.log(`inline-icons: inlined ${Object.keys(dataUris).length} icons into site/GUIDE/index.html`);
