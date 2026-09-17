// Text from input files must never reach the page as HTML. Test names, units,
// bin names, wafer labels and metadata values come from STDF/ATDF/CSV files and
// MES fields, which are untrusted input.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { escHtml } = await import('../dist/packages/core/utils.js');
const { buildHoverText } = await import('../dist/packages/renderer/buildView.js');

const HOSTILE = '<img src=x onerror=alert(1)>';

test('escHtml escapes every character that can open markup or an attribute', () => {
  assert.equal(escHtml(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
});

test('the die tooltip escapes test, bin, unit and metadata text from the input', () => {
  const die = { x: 1, y: 2, hbin: 1, sbin: 7, testValues: { 1010: 0.5 }, metadata: { operator: HOSTILE }, partId: HOSTILE };
  const opts = {
    testDefs: [{ testNumber: 1010, name: HOSTILE, unit: '<u>' }],
    hbinDefs: [{ bin: 1, name: HOSTILE }],
    sbinDefs: [{ bin: 7, name: HOSTILE }],
    activeTest: 1010,
  };
  for (const mode of ['value', 'hardBin', 'softBin']) {
    const html = buildHoverText(die, mode, opts);
    assert.ok(!/<img|<u>/.test(html), `${mode}: raw markup reached the tooltip: ${html}`);
    assert.ok(html.includes('&lt;img'), `${mode}: the text is still shown, escaped`);
  }
  // The library's own markup survives.
  assert.match(buildHoverText(die, 'value', opts), /<b>.*<\/b>/);
});

test('the library\'s own recorded-fail note still renders as markup, not escaped text', () => {
  const die = { x: 0, y: 0, testValues: { 10: 0.5 }, testPass: { 10: false } };
  const html = buildHoverText(die, 'value', { testDefs: [{ testNumber: 10, name: HOSTILE, unit: 'V' }], activeTest: 10 });
  assert.match(html, /<i>\(recorded fail\)<\/i>/);
  assert.ok(!html.includes('&lt;i&gt;'), `the note was escaped: ${html}`);
  assert.ok(!html.includes('<img'), 'while the test name still is');
});

test('stacked-mode tooltip lines escape test and bin names too', () => {
  const die = { x: 0, y: 0, hbin: 3, testValues: { 0: 2 } };
  const values = buildHoverText(die, 'stackedValues', { testDefs: [{ testNumber: 5, name: HOSTILE }], aggrMethod: 'mean' });
  const bins = buildHoverText(die, 'stackedBins', { hbinDefs: [{ bin: 3, name: HOSTILE }], aggrMethod: 'countBin', lotSize: 4 });
  assert.ok(!values.includes('<img') && !bins.includes('<img'));
});

test('no tooltip in the render layer interpolates a data label into innerHTML unescaped', () => {
  // A source-level guard for the chart tooltips, which need a real canvas and
  // pointer to exercise: any `innerHTML` template (or a `tooltipHtml` callback's
  // returned template) that interpolates a label-like field must escape it.
  const dir = path.join(root, 'packages/canvas-adapter');
  const files = [
    ...fs.readdirSync(dir).filter(f => f.endsWith('.ts')).map(f => path.join(dir, f)),
    ...fs.readdirSync(path.join(dir, 'charts')).filter(f => f.endsWith('.ts')).map(f => path.join(dir, 'charts', f)),
  ];
  const RAW = /\$\{\s*(?:[\w.!]+\.)?(label|name|groupKey|groupLabelText|unit|xLabel|yLabel)\s*\}/;
  // Remove every escHtml(...) call (balanced parentheses) so only unescaped text is checked.
  const withoutEscaped = (line) => {
    let out = '';
    for (let i = 0; i < line.length; i++) {
      if (line.startsWith('escHtml(', i)) {
        let depth = 0, j = i + 'escHtml'.length;
        for (; j < line.length; j++) {
          if (line[j] === '(') depth++;
          else if (line[j] === ')' && --depth === 0) break;
        }
        i = j;
        continue;
      }
      out += line[i];
    }
    return out;
  };
  const offenders = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    let inHtml = false;
    lines.forEach((line, i) => {
      if (/innerHTML\s*=\s*`|return `<strong>/.test(line)) inHtml = true;
      if (inHtml && RAW.test(withoutEscaped(line))) offenders.push(`${path.relative(root, file)}:${i + 1}: ${line.trim()}`);
      if (inHtml && /;\s*$/.test(line)) inHtml = false;
    });
  }
  assert.deepEqual(offenders, [], 'escape these with escHtml (core/utils.ts)');
});
