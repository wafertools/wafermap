#!/usr/bin/env node
// Assemble the GitHub Pages site from built assets and generated docs pages.

import { cpSync, mkdirSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, '..');
const siteDir = resolve(root, '_site');

function copyDir(src, dest) {
  cpSync(src, dest, { recursive: true });
}

rmSync(siteDir, { recursive: true, force: true });
mkdirSync(siteDir, { recursive: true });

execFileSync(process.execPath, [resolve(root, 'scripts', 'build-guide.mjs')], {
  stdio: 'inherit',
});

copyDir(resolve(root, 'dist'), resolve(siteDir, 'dist'));
copyDir(resolve(root, 'examples'), resolve(siteDir, 'examples'));
copyDir(resolve(root, 'data'), resolve(siteDir, 'data'));
copyDir(resolve(root, 'index.html'), resolve(siteDir, 'index.html'));
