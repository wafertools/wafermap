import {
  createWafer,
  generateDies,
  clipDiesToWafer,
  applyOrientation,
  transformDies,
  applyProbeSequence,
  generateReticleGrid,
  classifyDie,
  getRingLabel,
  getColorScheme,
  listColorSchemes,
  buildScene,
} from 'wafermap';
import { toCanvas } from 'wafermap/canvas-adapter';

const DIE_SIZE = { width: 10, height: 10 };
const WAFER_DIAMETER = 150;

const TEST_DEFS = [
  { testNumber: 1010, name: 'testA' },
  { testNumber: 1020, name: 'testB' },
  { testNumber: 1030, name: 'testC' },
];

const appState = {
  wafer: null,
  baseDies: [],
  currentDies: [],
  reticles: [],
  allRows: [],
  selectedWafer: 'W01',
  rotation: 0,
  flipX: false,
  flipY: false,
  plotMode: 'value',
  testIndex: 1010,
  showText: false,
  showReticle: false,
  showProbePath: false,
  showRingBoundaries: false,
  showQuadrantBoundaries: false,
  showXYIndicator: false,
  ringCount: 4,
  colorScheme: 'color',
  highlightBin: undefined,
};

async function main() {
  appState.allRows = await loadCsv('../../data/dummy-fulldata.csv');
  populateWaferSelector(appState.allRows);
  loadWafer(appState.selectedWafer);
  wireControls();
}

async function loadCsv(path) {
  const response = await fetch(path);
  const text = await response.text();
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(',');
  return lines.filter(Boolean).map((line) => {
    const values = line.split(',');
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
}

function populateWaferSelector(rows) {
  const wafers = [...new Set(rows.map((row) => row.wafer))].sort();
  const sel = document.getElementById('sel-wafer');
  sel.innerHTML = wafers.map((w) => `<option value="${w}"${w === appState.selectedWafer ? ' selected' : ''}>${w}</option>`).join('');
}

function loadWafer(waferId) {
  const rows = appState.allRows.filter((row) => row.wafer === waferId);
  const firstRow = rows[0] ?? {};

  const waferMeta = {
    lot: firstRow.lot ?? '—',
    waferNumber: Number(waferId.replace(/\D/g, '')),
    testDate: firstRow.testdate ?? '—',
    testProgram: 'PROG-V300-1',
    temperature: Number(firstRow.temp ?? 25),
  };

  const wafer = createWafer({
    diameter: WAFER_DIAMETER,
    notch: { type: 'bottom' },
    orientation: 0,
    metadata: waferMeta,
  });

  const allDies = generateDies(wafer, DIE_SIZE);
  const clipped = clipDiesToWafer(allDies, wafer, DIE_SIZE);
  const enriched = enrichDiesFromRows(clipped, rows);
  const sequenced = applyProbeSequence(enriched, { type: 'snake' });
  const oriented = applyOrientation(sequenced, wafer);

  appState.wafer = wafer;
  appState.baseDies = oriented;
  appState.reticles = generateReticleGrid(wafer, { width: 3, height: 3, diePitchX: DIE_SIZE.width, diePitchY: DIE_SIZE.height });

  updateMetaPanel(waferMeta);
  redraw();
}

function enrichDiesFromRows(dies, rows) {
  const rowMap = new Map(rows.map((row) => [`${Number(row.x)},${Number(row.y)}`, row]));

  return dies.map((die) => {
    const row = rowMap.get(`${die.i},${die.j}`);
    if (!row) {
      return {
        ...die,
        testValues: {},
        hbin: 0,
        metadata: {},
      };
    }

    return {
      ...die,
      testValues: { 1010: Number(row.testA), 1020: Number(row.testB), 1030: Number(row.testC) },
      hbin: Number(row.hbin),
      sbin: Number(row.sbin),
      metadata: {
        lotId: row.lot,
        waferId: `${row.lot}-${row.wafer}`,
        testDate: row.testdate,
        temperature: row.temp,
        customFields: {
          hbin: row.hbin,
          sbin: row.sbin,
          testA: row.testA,
          testB: row.testB,
          testC: row.testC,
        },
      },
    };
  });
}

function redraw() {
  const interactiveTransform = {
    rotation: appState.rotation,
    flipX: appState.flipX,
    flipY: appState.flipY,
  };

  appState.currentDies = transformDies(appState.baseDies, interactiveTransform, appState.wafer.center);

  const scene = buildScene(appState.wafer, appState.currentDies, {
    reticles: appState.reticles,
    plotMode: appState.plotMode,
    testIndex: appState.testIndex,
    testDefs: TEST_DEFS,
    showText: appState.showText,
    showReticle: appState.showReticle,
    showProbePath: appState.showProbePath,
    showRingBoundaries: appState.showRingBoundaries,
    showQuadrantBoundaries: appState.showQuadrantBoundaries,
    showXYIndicator: appState.showXYIndicator,
    ringCount: appState.ringCount,
    colorScheme: appState.colorScheme,
    highlightBin: appState.highlightBin,
    interactiveTransform,
  });

  toCanvas(document.getElementById('chart'), scene);
  updateUI();
}

function renderBinLegend() {
  const scheme = getColorScheme(appState.colorScheme);
  const dies = appState.currentDies;
  const binCounts = {};
  for (const d of dies.filter(d => !d.partial)) {
    const b = d.hbin;
    if (b !== undefined) binCounts[b] = (binCounts[b] ?? 0) + 1;
  }
  const bins = Object.keys(binCounts).map(Number).sort((a, b) => a - b);
  document.getElementById('bin-legend').innerHTML = bins.map((bin) =>
    `<div class="bin-row">
      <div class="bin-dot" style="background:${scheme.forBin(bin)}"></div>
      <span class="bin-name">Bin ${bin}</span>
      <span class="bin-count">${binCounts[bin]}</span>
    </div>`
  ).join('');
}

function updateUI() {
  document.getElementById('rot-badge').textContent = `${appState.rotation}°`;
  document.getElementById('flipx-btn').classList.toggle('active', appState.flipX);
  document.getElementById('flipy-btn').classList.toggle('active', appState.flipY);

  const dies = appState.currentDies;
  const fullDies = dies.filter((die) => !die.partial);
  const pass = fullDies.filter((die) => die.hbin === 1).length;
  const total = fullDies.length;
  const pct = total ? (100 * pass / total).toFixed(1) : '0.0';

  document.getElementById('stat-dies').textContent    = total;
  document.getElementById('stat-pass').textContent    = `${pct}%`;
  document.getElementById('stat-partial').textContent = dies.filter((die) => die.partial).length;

  const spatial = summarizeSpatialStats(dies, appState.wafer, appState.ringCount);
  renderSpatialTable('ring-stats', spatial.ringStats);
  renderSpatialTable('quadrant-stats', spatial.quadrantStats);
  renderBinLegend();
}

function updateMetaPanel(meta) {
  if (!meta) return;
  document.getElementById('meta-lot').textContent     = meta.lot;
  document.getElementById('meta-wafer').textContent   = meta.waferNumber;
  document.getElementById('meta-date').textContent    = meta.testDate;
  document.getElementById('meta-program').textContent = meta.testProgram;
  document.getElementById('meta-temp').textContent    = `${meta.temperature}°C`;
}

function summarizeSpatialStats(dies, wafer, ringCount) {
  const fullDies = dies.filter((die) => !die.partial);
  const ringStats = Array.from({ length: ringCount }, (_, index) => ({
    label: getRingLabel(index + 1, ringCount),
    total: 0,
    pass: 0,
  }));
  const quadrantStats = ['NE', 'NW', 'SW', 'SE'].map((label) => ({
    label,
    total: 0,
    pass: 0,
  }));
  const quadrantMap = new Map(quadrantStats.map((entry) => [entry.label, entry]));

  for (const die of fullDies) {
    const { ring, quadrant } = classifyDie(die, wafer, { ringCount });
    ringStats[ring - 1].total += 1;
    if (die.hbin === 1) ringStats[ring - 1].pass += 1;
    quadrantMap.get(quadrant).total += 1;
    if (die.hbin === 1) quadrantMap.get(quadrant).pass += 1;
  }

  return { ringStats, quadrantStats };
}

function renderSpatialTable(targetId, rows) {
  const target = document.getElementById(targetId);
  target.innerHTML = rows.map((row) => {
    const pct = row.total ? (100 * row.pass / row.total) : 0;
    return `<tr>
      <td>${row.label}</td>
      <td>
        <div class="pct-bar-wrap">
          <div class="pct-bar"><div class="pct-bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
          <span class="pct-num">${pct.toFixed(0)}%</span>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function wireControls() {
  document.getElementById('sel-wafer').addEventListener('change', (event) => {
    appState.selectedWafer = event.target.value;
    loadWafer(appState.selectedWafer);
  });

  document.getElementById('sel-mode').addEventListener('change', (event) => {
    appState.plotMode = event.target.value;
    redraw();
  });

  document.getElementById('sel-test').addEventListener('change', (event) => {
    appState.testIndex = Number(event.target.value);
    redraw();
  });

  for (const [id, key] of [
    ['chk-text', 'showText'],
    ['chk-reticle', 'showReticle'],
    ['chk-probe', 'showProbePath'],
    ['chk-rings', 'showRingBoundaries'],
    ['chk-quadrants', 'showQuadrantBoundaries'],
    ['chk-xy', 'showXYIndicator'],
  ]) {
    document.getElementById(id).addEventListener('change', (event) => {
      appState[key] = event.target.checked;
      redraw();
    });
  }

  document.getElementById('sel-rings').addEventListener('change', (event) => {
    appState.ringCount = Number(event.target.value) || 4;
    redraw();
  });

  const colorSel = document.getElementById('sel-color');
  colorSel.innerHTML = listColorSchemes()
    .filter(({ name }) => name !== 'color') // hide the 'color' alias
    .map(({ name, label }) => `<option value="${name}"${name === appState.colorScheme ? ' selected' : ''}>${label}</option>`)
    .join('');
  colorSel.addEventListener('change', (event) => {
    appState.colorScheme = event.target.value;
    redraw();
  });

  document.getElementById('sel-highlight').addEventListener('change', (event) => {
    const v = Number(event.target.value);
    appState.highlightBin = v === 0 ? undefined : v;
    redraw();
  });

  document.getElementById('rot-left-btn').addEventListener('click', () => {
    appState.rotation = (appState.rotation + 90) % 360;
    redraw();
  });

  document.getElementById('rot-right-btn').addEventListener('click', () => {
    appState.rotation = (appState.rotation - 90 + 360) % 360;
    redraw();
  });

  document.getElementById('flipx-btn').addEventListener('click', () => {
    appState.flipX = !appState.flipX;
    redraw();
  });

  document.getElementById('flipy-btn').addEventListener('click', () => {
    appState.flipY = !appState.flipY;
    redraw();
  });
}

main().catch(console.error);
