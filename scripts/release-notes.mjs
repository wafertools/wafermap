#!/usr/bin/env node
/**
 * The GitHub release notes for one version: its CHANGELOG.md section, plus links.
 *
 * Run by .github/workflows/release.yml when a `v*` tag is pushed, so every
 * published version has a GitHub release — which the docs site's repository
 * widget reads ("latest release"), and which is where people look for what changed.
 *
 * Usage: node scripts/release-notes.mjs 0.31.0 > notes.md
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const version = process.argv[2]?.replace(/^v/, '');
if (!version) { console.error('usage: release-notes.mjs <version>'); process.exit(1); }

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const changelog = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8');
const heading = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\].*$`, 'm');
const m = heading.exec(changelog);
if (!m) { console.error(`CHANGELOG.md has no section for ${version}`); process.exit(1); }
const start = m.index + m[0].length;
const next = changelog.slice(start).search(/^## \[/m);
const body = (next < 0 ? changelog.slice(start) : changelog.slice(start, start + next)).replace(/^\s*---\s*$/gm, '').trim();

process.stdout.write(`${body}

---

[npm: @wafertools/wafermap@${version}](https://www.npmjs.com/package/@wafertools/wafermap/v/${version}) ·
[Upgrading](https://wafertools.github.io/wafermap/upgrading/) ·
[What's New](https://wafertools.github.io/whats-new/) ·
[Full changelog](https://github.com/wafertools/wafermap/blob/main/CHANGELOG.md)
`);
