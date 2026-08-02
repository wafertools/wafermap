/**
 * Captures fresh screenshots of all demo pages for use in docs and the presentation.
 *
 * FORKED — ../tsmap/scripts/capture-screenshots.mjs is the same harness (static
 * server + headless Chromium + a setup-step vocabulary) pointed at a different
 * app. This is the one pair of scripts here that is genuinely duplicated rather
 * than coincidentally same-named, and extracting the shared harness is a real
 * (unstarted) job — see TODO.md. Until then, a fix to the harness half of one
 * usually belongs in the other too; the capture *definitions* never do.
 *
 * Usage:
 *   node scripts/capture-screenshots.mjs
 *   node scripts/capture-screenshots.mjs --only toolbar      # run a named group
 *   node scripts/capture-screenshots.mjs --only image-9      # run a single image by file name
 *   node scripts/capture-screenshots.mjs --list              # print all capture targets
 *
 * The script:
 *   1. Starts a local static file server on an available port
 *   2. Opens each demo page in headless Chromium
 *   3. Waits for the canvas / gallery to finish rendering
 *   4. Runs the setup step sequence
 *   5. Screenshots the target element (or full viewport)
 *   6. Saves to docs/images/<name>.png
 *   7. Stops the server
 *
 * Add new entries to CAPTURES to register additional screenshots.
 *
 * ─── Setup step reference ────────────────────────────────────────────────────
 *
 * setup is an array of steps. Each step is an array: [stepName, ...args].
 * The optional second element on most steps is a containerSel CSS selector
 * (defaults to '#map' when omitted).
 *
 *   ['hover']                               hover canvas centre, pin toolbar
 *   ['hover', '#my-map']
 *
 *   ['openPanel']                           open the summary/findings panel
 *   ['openPanel', '#my-map']
 *
 *   ['clickFinding']                        click the first finding row
 *   ['clickFinding', '#my-map']
 *
 *   ['clickFindingByText', 'Failure cluster']   click the first finding whose text contains string
 *   ['clickFindingByText', 'Failure cluster', '#my-map']
 *
 *   ['clickButton', 'Insights']             click a button by aria-label
 *   ['clickButton', 'Insights', '#gallery-container']
 *
 *   ['clickTab', 'Distributions']           click a button (e.g. Insights sub-tab) by exact text
 *   ['clickTab', 'Distributions', '#gallery-container']
 *
 *   ['boxSelect']                           activate box-select, drag rect, leave mouse held
 *   ['boxSelect', '#my-map']                (release mouse with ['mouseUp'] to commit selection)
 *
 *   ['mouseUp']                             release the mouse button (after boxSelect)
 *
 *   ['selectMode', 'Soft Bin']              pick a plot-mode item (menu closes after)
 *   ['selectMode', 'Soft Bin', '#my-map']
 *
 *   ['toggleOverlay', 'Ring boundaries']    toggle a check-menu overlay item (menu stays open)
 *   ['toggleOverlay', 'Ring boundaries', 'Overlays']          custom button aria-label
 *   ['toggleOverlay', 'Flip horizontal',   'Orientation']
 *
 *   ['selectColumns', '3 columns']          pick a column count in gallery toolbar
 *
 *   ['openDropdown', 'Plot mode']           open a dropdown and leave it open (for UI shots)
 *   ['openDropdown', 'Plot mode', 'Soft Bin']        …with an item highlighted
 *   ['openDropdown', 'Plot mode', 'Soft Bin', '#my-map']
 *
 *   ['closeDropdown']                       dismiss any open dropdown (Escape + edge click)
 *   ['closeDropdown', '#my-map']
 *
 *   ['showCursorOn', 'Legend style']        inject fake cursor centred on element by aria-label or CSS selector
 *   ['showCursorOn', 'Legend style', -60, 0]   …with optional pixel nudge (offsetX, offsetY)
 *   ['showCursorOn', '.my-btn']            …by CSS selector
 *   ['hideCursor']                          remove the fake cursor
 *
 *   ['hoverFirstCard', '#gallery-container']  hover the first gallery card canvas
 *
 *   ['wait', 400]                           extra delay in ms
 *   ['scroll', 0, 0]                        window.scrollTo(x, y)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { extname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { CAPTURES } from './capture-definitions.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../');
const DOCS = join(ROOT, 'docs');
const OUT = join(DOCS, 'images');

// ─── MIME types for the static server ────────────────────────────────────────
const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// ─── Low-level helpers (called by runSetup and screenshotFn) ─────────────────

// Hover near the canvas centre and pin the toolbar visible.
async function hoverMapCentre(page, containerSel = '#map') {
  const canvas = await page.$(`${containerSel} canvas`);
  if (!canvas) return;
  const box = await canvas.boundingBox();
  if (!box) return;
  // Slightly left of centre so the tooltip doesn't obscure the toolbar
  await page.mouse.move(box.x + box.width * 0.38, box.y + box.height * 0.35);
  await page.waitForTimeout(400);
  await page.evaluate((sel) => {
    const tb = document.querySelector(`${sel} [data-wmap-toolbar]`);
    if (tb) { tb.style.opacity = '1'; tb.style.visibility = 'visible'; }
  }, containerSel);
}

// Open the summary/findings panel if it is not already open.
async function openSummaryPanel(page, containerSel = '#map') {
  await page.evaluate((sel) => {
    const root = document.querySelector(sel) ?? document;
    const btn = [...root.querySelectorAll('button')]
      .find(b => b.ariaLabel === 'Summary panel');
    if (btn && !btn.dataset.active) btn.click();
  }, containerSel);
  await page.waitForTimeout(600);
  await hoverMapCentre(page, containerSel);
}

// Click the first finding row in the visible summary panel.
async function clickFirstFinding(page, containerSel = '#map') {
  await clickFindingMatching(page, containerSel, null);
}

// Click the first finding whose summary text contains the given substring.
async function clickFindingByText(page, containerSel = '#map', textFragment = '') {
  await clickFindingMatching(page, containerSel, textFragment);
}

// Internal: click the first visible [data-wmap-finding] row.
// If textFilter is a non-empty string, only rows whose textContent includes it qualify.
// Uses page.click() so the browser event loop settles before returning.
async function clickFindingMatching(page, containerSel, textFilter) {
  // Scroll the target row into view and mark it with a temp id so page.click can target it.
  const found = await page.evaluate(([sel, filter]) => {
    const root = document.querySelector(sel) ?? document;
    const allRows = [...root.querySelectorAll('[data-wmap-finding]')];
    const row = allRows.find(r => {
      if (filter && !(r.textContent?.includes(filter))) return false;
      let el = r.parentElement;
      while (el && el !== root) {
        if (el.style.display === 'none') return false;
        el = el.parentElement;
      }
      return true;
    });
    if (!row) return false;
    let panel = row.parentElement;
    while (panel) {
      const oy = getComputedStyle(panel).overflowY;
      if (oy === 'auto' || oy === 'scroll') break;
      panel = panel.parentElement;
    }
    if (panel) panel.scrollTop = Math.max(0, row.offsetTop - 40);
    row.dataset.wmapFindingTarget = 'pending';
    return true;
  }, [containerSel, textFilter ?? null]);

  if (!found) return;
  await page.click('[data-wmap-finding-target="pending"]');
  await page.evaluate(() => {
    const row = document.querySelector('[data-wmap-finding-target="pending"]');
    if (row) delete row.dataset.wmapFindingTarget;
  });
  await page.waitForTimeout(400);
  // Stamp the active finding after the panel has re-rendered.
  await page.evaluate(([sel]) => {
    const root = document.querySelector(sel) ?? document;
    const rows = [...root.querySelectorAll('[data-wmap-finding]')];
    const active = rows.find(r => r.style.fontWeight === '600' || r.style.background.includes('rgb'));
    if (active) active.dataset.wmapFindingActive = '1';
  }, [containerSel]);
}

// Activate box-select mode and drag a rectangle across the wafer centre.
// Leaves the mouse button held — use mouseUp step (or page.mouse.up()) to commit.
async function drawBoxSelect(page, containerSel = '#map') {
  const canvas = await page.$(`${containerSel} canvas`);
  if (!canvas) return;
  const box = await canvas.boundingBox();
  if (!box) return;

  await page.evaluate((sel) => {
    const root = document.querySelector(sel) ?? document;
    const btn = [...root.querySelectorAll('button')]
      .find(b => b.ariaLabel === 'Select (drag to select dies)');
    if (btn) btn.click();
  }, containerSel);
  await page.waitForTimeout(200);

  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.45);
  await page.waitForTimeout(200);

  const x1 = box.x + box.width * 0.38;
  const y1 = box.y + box.height * 0.20;
  const x2 = box.x + box.width * 0.66;
  const y2 = box.y + box.height * 0.60;

  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + (x2 - x1) * 0.33, y1 + (y2 - y1) * 0.33, { steps: 4 });
  await page.mouse.move(x1 + (x2 - x1) * 0.66, y1 + (y2 - y1) * 0.66, { steps: 4 });
  await page.mouse.move(x2, y2, { steps: 4 });
  await page.waitForTimeout(200);

  await page.evaluate((sel) => {
    const tb = document.querySelector(`${sel} [data-wmap-toolbar]`);
    if (tb) { tb.style.opacity = '1'; tb.style.visibility = 'visible'; }
  }, containerSel);
}

// Click a single-select dropdown item (menu closes automatically after pick).
async function selectToolbarDropdownItem(page, btnAriaLabel, itemLabel) {
  // Ensure the button is visible so Playwright can click it
  await page.evaluate((label) => {
    const btn = [...document.querySelectorAll('button')]
      .find(b => b.ariaLabel === label);
    if (!btn) return;
    let el = btn.parentElement;
    while (el) {
      if (el.hasAttribute('data-wmap-toolbar')) {
        el.style.opacity = '1'; el.style.visibility = 'visible'; break;
      }
      el = el.parentElement;
    }
  }, btnAriaLabel);

  await page.click(`button[aria-label="${btnAriaLabel}"]`);
  await page.waitForTimeout(300);

  const clicked = await page.evaluate((label) => {
    const menus = [...document.body.children].filter(el =>
      el.tagName === 'DIV' && el.style.position === 'fixed'
    );
    for (const menu of menus) {
      const row = [...menu.querySelectorAll('div')]
        .find(d => d.textContent?.trim() === label);
      if (row) { row.click(); return true; }
    }
    return false;
  }, itemLabel);

  if (!clicked) throw new Error(`Dropdown item not found: "${itemLabel}" in "${btnAriaLabel}"`);
  await page.waitForTimeout(200);
}

// Toggle a check-menu item (menu stays open). btnAriaLabel defaults to 'Overlays'.
async function toggleToolbarCheckItem(page, itemLabel, btnAriaLabel = 'Overlays') {
  // Use a real Playwright click on the button so the browser event loop fully
  // processes the click before we look for the menu. The button may be invisible
  // (toolbar opacity:0) so we force it visible first.
  await page.evaluate((label) => {
    const btn = [...document.querySelectorAll('button')]
      .find(b => b.ariaLabel === label);
    if (!btn) return;
    // Ensure the toolbar is visible so Playwright can click the button
    let el = btn.parentElement;
    while (el) {
      if (el.dataset?.wmapToolbar !== undefined || el.hasAttribute('data-wmap-toolbar')) {
        el.style.opacity = '1';
        el.style.visibility = 'visible';
        break;
      }
      el = el.parentElement;
    }
  }, btnAriaLabel);

  // Real click so the browser event loop fully settles before continuing
  await page.click(`button[aria-label="${btnAriaLabel}"]`);
  await page.waitForTimeout(300);

  // Now click the item inside the open menu
  const clicked = await page.evaluate((label) => {
    const menus = [...document.body.children].filter(el =>
      el.tagName === 'DIV' && el.style.position === 'fixed'
    );
    for (const menu of menus) {
      const span = [...menu.querySelectorAll('span')]
        .find(s => s.textContent?.trim() === label);
      if (span) {
        const row = span.closest('div');
        if (row) { row.click(); return true; }
      }
    }
    return false;
  }, itemLabel);

  if (!clicked) throw new Error(`Overlay item not found: "${itemLabel}"`);
  await page.waitForTimeout(200);
}

// Open a dropdown and leave it open (for UI screenshots). Optionally bolds one item.
async function openToolbarDropdown(page, btnAriaLabel, highlightItemLabel = null, containerSel = '#map') {
  await page.evaluate(([sel, label]) => {
    const scope = document.querySelector(sel) ?? document;
    const btn = [...scope.querySelectorAll('button')]
      .find(b => b.ariaLabel === label);
    if (btn) btn.click();
  }, [containerSel, btnAriaLabel]);
  await page.waitForTimeout(150);

  if (highlightItemLabel) {
    await page.evaluate((label) => {
      const menus = [...document.body.children].filter(el => {
        if (el.tagName !== 'DIV') return false;
        const s = el.style;
        return s.position === 'fixed' && el.offsetParent !== null;
      });
      for (const menu of menus) {
        const divRow = [...menu.querySelectorAll('div')]
          .find(d => d.textContent?.trim() === label);
        if (divRow) { divRow.style.fontWeight = 'bold'; return; }
        const span = [...menu.querySelectorAll('span')]
          .find(s => s.textContent?.trim() === label);
        if (span) {
          const row = span.closest('div');
          if (row) row.style.fontWeight = 'bold';
          return;
        }
      }
    }, highlightItemLabel);
  }

  await page.evaluate((sel) => {
    const tb = document.querySelector(`${sel} [data-wmap-toolbar]`);
    if (tb) { tb.style.opacity = '1'; tb.style.visibility = 'visible'; }
  }, containerSel);
  await page.waitForTimeout(100);
}

// Dismiss any open dropdown menu.
async function closeToolbarDropdown(page, containerSel = '#map') {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  const canvas = await page.$(`${containerSel} canvas`);
  if (canvas) {
    const box = await canvas.boundingBox();
    if (box) await page.mouse.click(box.x + 4, box.y + 4);
  }
  await page.waitForTimeout(150);
}

// ─── Step runner ─────────────────────────────────────────────────────────────
//
// Executes a declarative setup step sequence. Each step is an array:
//   [stepName, ...args]
// See the step reference in the file header for the full list.

// Arrow cursor SVG — matches the default OS pointer cursor shape.
const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="22" viewBox="0 0 18 22"><path d="M1 1 L1 18 L5.2 13.8 L8.6 21 L11 19.8 L7.6 12.5 L14 12.5 Z" fill="white" stroke="#333" stroke-width="1.2" stroke-linejoin="round"/></svg>`;

async function injectCursor(page, x, y) {
  await page.evaluate(([svgSrc, cx, cy]) => {
    const existing = document.getElementById('__fake-cursor__');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.id = '__fake-cursor__';
    Object.assign(el.style, {
      position:      'fixed',
      left:          `${cx}px`,
      top:           `${cy}px`,
      width:         '18px',
      height:        '22px',
      pointerEvents: 'none',
      zIndex:        '999999',
    });
    el.innerHTML = svgSrc;
    document.body.appendChild(el);
  }, [CURSOR_SVG, x, y]);
}

async function removeCursor(page) {
  await page.evaluate(() => {
    const el = document.getElementById('__fake-cursor__');
    if (el) el.remove();
  });
}

async function runSetup(page, steps) {
  const mousePos = { x: 0, y: 0 };
  for (const step of steps) {
    const [name, ...args] = step;
    switch (name) {

      case 'hover': {
        const sel = args[0] ?? '#map';
        await hoverMapCentre(page, sel);
        const hc = await page.$(`${sel} canvas`);
        if (hc) { const b = await hc.boundingBox(); if (b) { mousePos.x = b.x + b.width * 0.38; mousePos.y = b.y + b.height * 0.35; } }
        break;
      }

      // Hover any element by aria-label or CSS selector, and pin the toolbar.
      // args[0]: aria-label string or CSS selector
      // args[1]: container selector for toolbar pin (default '#map')
      case 'hoverEl': {
        const target   = args[0];
        const contSel  = args[1] ?? '#map';
        const isSel = /^[.#\[a-z]/i.test(target) && !/\s/.test(target.split('[')[0]);
        const el = isSel ? await page.$(target) : (await page.$(`[aria-label="${target}"]`) ?? await page.$(target));
        if (el) {
          const box = await el.boundingBox();
          if (box) {
            mousePos.x = box.x + box.width / 2;
            mousePos.y = box.y + box.height / 2;
            await page.mouse.move(mousePos.x, mousePos.y);
            await page.waitForTimeout(300);
          }
        }
        await page.evaluate((sel) => {
          const tb = document.querySelector(`${sel} [data-wmap-toolbar]`);
          if (tb) { tb.style.opacity = '1'; tb.style.visibility = 'visible'; }
        }, contSel);
        break;
      }

      case 'openPanel':
        await openSummaryPanel(page, args[0] ?? '#map');
        break;

      case 'closePanel':
        await page.evaluate((sel) => {
          const root = document.querySelector(sel) ?? document;
          const btn  = [...root.querySelectorAll('button')]
            .find(b => b.ariaLabel === 'Summary panel');
          if (btn && btn.dataset.active) btn.click();
        }, args[0] ?? '#map');
        await page.waitForTimeout(300);
        break;

      case 'clickFinding':
        await clickFirstFinding(page, args[0] ?? '#map');
        break;

      // Click the first finding whose text contains the given string.
      // args: [textFragment, containerSel?]
      case 'clickFindingByText':
        await clickFindingByText(page, args[1] ?? '#map', args[0]);
        break;

      // Click a button by aria-label (e.g. the Insights toolbar button).
      // args: [ariaLabel, containerSel?]
      case 'clickButton':
        await page.evaluate(({ label, sel }) => {
          const root = document.querySelector(sel) ?? document;
          const btn = [...root.querySelectorAll('button')].find(b => b.ariaLabel === label);
          if (btn) btn.click();
        }, { label: args[0], sel: args[1] ?? '#map' });
        await page.waitForTimeout(600);
        break;

      // Click an Insights sub-tab (or any button) by its exact text.
      // args: [buttonText, containerSel?]
      case 'clickTab':
        await page.evaluate(({ text, sel }) => {
          const root = document.querySelector(sel) ?? document;
          const btn = [...root.querySelectorAll('button')].find(b => (b.textContent ?? '').trim() === text);
          if (btn) btn.click();
        }, { text: args[0], sel: args[1] ?? '#map' });
        await page.waitForTimeout(600);
        break;

      case 'boxSelect':
        await drawBoxSelect(page, args[0] ?? '#map');
        break;

      case 'mouseUp':
        await page.mouse.up();
        await page.waitForTimeout(200);
        break;

      // Pick an item from any single-select dropdown by button aria-label.
      // args: [btnAriaLabel, itemLabel]
      case 'selectDropdown':
        await selectToolbarDropdownItem(page, args[0], args[1]);
        break;

      // Shorthand aliases for common dropdowns
      case 'selectMode':
        await selectToolbarDropdownItem(page, 'Plot mode', args[0]);
        break;
      case 'selectColumns':
        await selectToolbarDropdownItem(page, 'Columns', args[0]);
        break;

      // Toggle a check-menu overlay item.
      // args: [itemLabel, btnAriaLabel?]  (btnAriaLabel defaults to 'Overlays')
      case 'toggleOverlay':
        await toggleToolbarCheckItem(page, args[0], args[1] ?? 'Overlays');
        break;

      // Open a dropdown and leave it open for the screenshot.
      // args: [btnAriaLabel, highlightItemLabel?, containerSel?]
      case 'openDropdown':
        await openToolbarDropdown(page, args[0], args[1] ?? null, args[2] ?? '#map');
        break;

      case 'closeDropdown':
        await closeToolbarDropdown(page, args[0] ?? '#map');
        break;

      // Click a row in the right-side bin legend to toggle highlightBin.
      // args: [rowIndex (1-based), totalRows, containerSel?]
      // Geometry: default legend is right-aligned, vertically centred, 17px per row, 110px wide.
      case 'clickLegendRow': {
        const rowIndex  = (args[0] ?? 1) - 1;  // 0-based
        const totalRows = args[1] ?? 4;
        const sel       = args[2] ?? '#map';
        const canvas    = await page.$(`${sel} canvas`);
        if (canvas) {
          const box = await canvas.boundingBox();
          if (box) {
            const ROW_H      = 17;
            const LEGEND_W   = 110;
            const legendH    = totalRows * ROW_H;
            const legendTopY = box.y + (box.height - legendH) / 2;
            const x = box.x + box.width - LEGEND_W / 2;
            const y = legendTopY + rowIndex * ROW_H + ROW_H / 2;
            await page.mouse.click(x, y);
            mousePos.x = x; mousePos.y = y;
            await page.waitForTimeout(300);
          }
        }
        break;
      }

      // Hover the first canvas in a gallery container.
      // args: [containerSel?]
      case 'hoverFirstCard': {
        const sel = args[0] ?? '#gallery-container';
        const cards = await page.$$(`${sel} canvas`);
        if (cards[0]) {
          const box = await cards[0].boundingBox();
          if (box) {
            mousePos.x = box.x + box.width * 0.4;
            mousePos.y = box.y + box.height * 0.4;
            await page.mouse.move(mousePos.x, mousePos.y);
          }
        }
        await page.waitForTimeout(400);
        break;
      }

      // Inject a fake cursor SVG centred on an element.
      // args[0]: aria-label string (tries [aria-label="…"] first) or CSS selector
      // args[1], args[2]: optional pixel nudge offsetX, offsetY (default 0)
      case 'showCursorOn': {
        const target = args[0];
        const ox = args[1] ?? 0;
        const oy = args[2] ?? 0;
        const isSel = /^[.#\[a-z]/i.test(target) && !/\s/.test(target.split('[')[0]);
        const el = isSel ? await page.$(target) : (await page.$(`[aria-label="${target}"]`) ?? await page.$(target));
        if (el) {
          const box = await el.boundingBox();
          if (box) await injectCursor(page, box.x + box.width / 2 + ox, box.y + box.height / 2 + oy);
        }
        break;
      }

      case 'hideCursor':
        await removeCursor(page);
        break;

      case 'wait':
        await page.waitForTimeout(args[0] ?? 300);
        break;

      case 'scroll':
        await page.evaluate(([x, y]) => window.scrollTo(x, y), [args[0] ?? 0, args[1] ?? 0]);
        break;

      default:
        throw new Error(`Unknown setup step: "${name}"`);
    }
  }
}

// ─── Static file server ───────────────────────────────────────────────────────

function startServer(root) {
  return new Promise((res) => {
    const server = createServer((req, url) => {
      let path = req.url.split('?')[0];
      if (path === '/') path = '/index.html';

      let fsPath;
      if (path.startsWith('/dist/')) {
        fsPath = join(ROOT, path);
      } else {
        fsPath = join(DOCS, path);
      }

      if (!existsSync(fsPath)) {
        url.writeHead(404); url.end('Not found: ' + fsPath); return;
      }
      const ext = extname(fsPath);
      const mime = MIME[ext] ?? 'application/octet-stream';
      url.writeHead(200, { 'Content-Type': mime });
      url.end(readFileSync(fsPath));
    });

    server.listen(0, '127.0.0.1', () => {
      res({ server, port: server.address().port });
    });
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const listOnly = args.includes('--list');
  const onlyIdx = args.indexOf('--only');
  const onlyVal = onlyIdx !== -1 ? args[onlyIdx + 1] : null;

  // --only matches group name OR file name (without extension)
  const targets = onlyVal
    ? CAPTURES.filter(c => c.group === onlyVal || c.file === onlyVal)
    : CAPTURES;

  if (listOnly) {
    console.log('\nCapture targets:\n');
    for (const c of CAPTURES) {
      console.log(`  [${c.group.padEnd(10)}]  ${(c.file + '.png').padEnd(22)}  ${c.page}`);
    }
    console.log(`\n${CAPTURES.length} total\n`);
    return;
  }

  if (targets.length === 0) {
    console.error(`No targets matched "${onlyVal}". Use --list to see groups and file names.`);
    process.exit(1);
  }

  console.log(`\n▸ Capturing ${targets.length} screenshot(s)${onlyVal ? ` (--only ${onlyVal})` : ''}…\n`);

  const { server, port } = await startServer(ROOT);
  const base = `http://127.0.0.1:${port}`;

  // Playwright's bundled Chromium isn't available on every OS release; fall
  // back to the system Chrome install when the download is missing/unsupported.
  const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));

  let ok = 0, fail = 0;

  for (const cap of targets) {
    const outFile = join(OUT, cap.file + '.png');
    const url = base + cap.page;
    const label = cap.file + '.png';

    process.stdout.write(`  ${label.padEnd(24)} `);

    try {
      const ctx = await browser.newContext({
        viewport: cap.viewport ?? { width: 1280, height: 800 },
        deviceScaleFactor: 2,
      });
      const page = await ctx.newPage();

      page.on('console', () => { });
      page.on('pageerror', () => { });

      await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });

      if (cap.wait) await page.waitForTimeout(cap.wait);
      if (cap.setup) await runSetup(page, cap.setup);

      if (cap.screenshotFn) {
        await cap.screenshotFn(page, outFile);
      } else if (cap.selector) {
        const el = await page.$(cap.selector);
        if (!el) throw new Error(`selector not found: ${cap.selector}`);
        await el.screenshot({ path: outFile });
      } else {
        await page.screenshot({ path: outFile, fullPage: false });
      }

      await ctx.close();
      console.log('✓');
      ok++;
    } catch (err) {
      console.log(`✗  ${err.message}`);
      fail++;
    }
  }

  await browser.close();
  server.close();

  console.log(`\n${ok} captured, ${fail} failed — saved to docs/images/\n`);
  if (fail > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
