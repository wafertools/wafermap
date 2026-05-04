import {
  buildWaferMap,
  classifyDie,
  getRingLabel,
  buildScene,
  toPlotly,
  getDieAtPoint,
} from 'wafermap';
import { renderWaferMap } from 'wafermap/canvas-adapter';

const PITCH = 10;
const WAFER_DIAMETER = 150;

// Plotly-side display state — mirrors whatever the canvas toolbar sets.
const plotlyState = {
  plotMode:               'hardbin',
  colorScheme:            'color',
  showRingBoundaries:     false,
  showQuadrantBoundaries: false,
  showText:               false,
  ringCount:              4,
  rotation:               0,
  flipX:                  false,
  flipY:                  false,
};

let wafer = null;
let dies  = [];
let canvasCtrl = null;

// ── Boot ───────────────────────────────────────────────────────────────────────
async function main() {
  const rows      = await loadCsv('../../data/dummy-fulldata.csv');
  const waferRows = rows.filter(r => r.wafer === 'W01');
  const firstRow  = waferRows[0] ?? {};

  const result = buildWaferMap({
    results: waferRows.map(r => ({
      x: Number(r.x), y: Number(r.y),
      hbin:   Number(r.hbin),
      values: [Number(r.testA)],
    })),
    waferConfig: {
      diameter: WAFER_DIAMETER,
      notch:    { type: 'bottom' },
      metadata: {
        lot:         firstRow.lot      ?? 'LOT456',
        waferNumber: 1,
        testDate:    firstRow.testdate ?? '—',
        testProgram: 'PROG-V300-1',
        temperature: Number(firstRow.temp ?? 25),
      },
    },
    dieConfig: { width: PITCH, height: PITCH },
  });

  wafer = result.wafer;

  // Post-enrich with all tests.
  const rowMap = new Map(waferRows.map(r => [`${r.x},${r.y}`, r]));
  dies = result.dies.map(die => {
    const r = rowMap.get(`${die.i},${die.j}`);
    if (!r) return die;
    return {
      ...die,
      values: [Number(r.testA), Number(r.testB), Number(r.testC)],
      hbin:   Number(r.hbin),
      sbin:   Number(r.sbin),
      metadata: {
        lotId:       r.lot,
        waferId:     `${r.lot}-${r.wafer}`,
        testDate:    r.testdate,
        temperature: r.temp,
        customFields: { hbin: r.hbin, sbin: r.sbin, testA: r.testA, testB: r.testB, testC: r.testC },
      },
    };
  });

  // ── Mount canvas (owns scene + toolbar) ────────────────────────────────────
  const canvas = document.getElementById('canvas-chart');
  canvasCtrl = renderWaferMap(canvas, wafer, dies, {
    sceneOptions: plotlyState,

    onSceneOptionsChange(opts) {
      // Mirror toolbar changes → Plotly.
      Object.assign(plotlyState, opts);
      renderPlotly();
      renderStats();
    },

    onClick(die) { showDieDetail(die, 'Canvas'); },

    onSelect(dies) {
      showSelection(dies);
    },
  });

  // ── Clear selection button ─────────────────────────────────────────────────
  document.getElementById('btn-clear-selection').addEventListener('click', () => {
    canvasCtrl.clearSelection();
  });

  // ── Plotly — initial render ────────────────────────────────────────────────
  renderPlotly();
  renderStats();

  // ── Plotly click handler ───────────────────────────────────────────────────
  document.getElementById('plotly-chart').on('plotly_click', ev => {
    const scene = currentPlotlyScene();
    const die   = getDieAtPoint(scene, ev);
    if (die) showDieDetail(die, 'Plotly');
  });
}

// ── Plotly renderer ────────────────────────────────────────────────────────────
// Builds a scene from the mirrored plotlyState and passes it to toPlotly.
function currentPlotlyScene() {
  return buildScene(wafer, dies, {
    plotMode:               plotlyState.plotMode,
    colorScheme:            plotlyState.colorScheme,
    showText:               plotlyState.showText,
    showRingBoundaries:     plotlyState.showRingBoundaries,
    showQuadrantBoundaries: plotlyState.showQuadrantBoundaries,
    ringCount:              plotlyState.ringCount,
    interactiveTransform: {
      rotation: plotlyState.rotation,
      flipX:    plotlyState.flipX,
      flipY:    plotlyState.flipY,
    },
  });
}

function renderPlotly() {
  if (!wafer) return;
  const scene = currentPlotlyScene();
  const { data, layout } = toPlotly(scene, {
    diePitchMm: { x: PITCH, y: PITCH },
  });
  Plotly.react('plotly-chart', data, {
    ...layout,
    margin: { t: 10, l: 10, r: 10, b: 10 },
  }, { responsive: true });
}

// ── Stats panels ───────────────────────────────────────────────────────────────
function renderStats() {
  if (!wafer) return;
  renderMetadata(wafer.metadata);
  renderSummaryStats(dies);
  renderSpatialStats(dies, wafer, plotlyState.ringCount);
}

// ── Info panel helpers ─────────────────────────────────────────────────────────
function showDieDetail(die, source) {
  const cf = die.metadata?.customFields ?? {};
  document.getElementById('die-detail-panel').innerHTML = `
    <h2>Clicked Die <em style="font-size:10px;opacity:.6">(${source})</em></h2>
    <div class="die-detail">
      <em>Position</em> (${die.i}, ${die.j})<br>
      <em>Physical</em> (${die.x?.toFixed(1)}, ${die.y?.toFixed(1)}) mm<br>
      ${cf.hbin  !== undefined ? `<em>Hard bin</em> ${cf.hbin}<br>`                      : ''}
      ${cf.sbin  !== undefined ? `<em>Soft bin</em> ${cf.sbin}<br>`                      : ''}
      ${cf.testA !== undefined ? `<em>Test A</em> ${Number(cf.testA).toFixed(4)}<br>`   : ''}
      ${cf.testB !== undefined ? `<em>Test B</em> ${Number(cf.testB).toFixed(4)}<br>`   : ''}
      ${cf.testC !== undefined ? `<em>Test C</em> ${Number(cf.testC).toFixed(4)}`       : ''}
    </div>
  `;
}

function showSelection(dies) {
  const placeholder = document.getElementById('selection-placeholder');
  const content     = document.getElementById('selection-content');
  const hasSelection = dies.length > 0;
  placeholder.style.display = hasSelection ? 'none' : '';
  content.classList.toggle('visible', hasSelection);

  if (!hasSelection) {
    document.getElementById('selected-count').textContent   = '';
    document.getElementById('selected-stats').innerHTML     = '';
    document.getElementById('selected-list').innerHTML      = '';
    return;
  }

  document.getElementById('selected-count').textContent =
    `${dies.length} die${dies.length !== 1 ? 's' : ''} selected`;

  // ── Aggregate stats over selected dies ──────────────────────────────────
  const statsRows = [];

  // Bin distribution.
  const binCounts = {};
  for (const d of dies) {
    const b = d.hbin;
    if (b !== undefined) binCounts[b] = (binCounts[b] ?? 0) + 1;
  }
  const binEntries = Object.entries(binCounts).sort(([a],[b]) => Number(a)-Number(b));
  for (const [bin, n] of binEntries) {
    statsRows.push([`Bin ${bin}`, `${n} (${(100*n/dies.length).toFixed(0)}%)`]);
  }

  // Value stats (test 0).
  const vals = dies.map(d => d.values?.[0]).filter(v => v !== undefined);
  if (vals.length) {
    const mean   = vals.reduce((s,v) => s+v, 0) / vals.length;
    const stddev = Math.sqrt(vals.reduce((s,v) => s+(v-mean)**2, 0) / vals.length);
    const vmin   = Math.min(...vals);
    const vmax   = Math.max(...vals);
    statsRows.push(['Mean',   mean.toFixed(4)]);
    statsRows.push(['Std dev', stddev.toFixed(4)]);
    statsRows.push(['Min',    vmin.toFixed(4)]);
    statsRows.push(['Max',    vmax.toFixed(4)]);
  }

  document.getElementById('selected-stats').innerHTML = statsRows.map(([k,v]) => `
    <div class="stats-row">
      <span class="stats-key">${k}</span>
      <span class="stats-value">${v}</span>
    </div>`).join('');

  // ── Die coordinate chips ─────────────────────────────────────────────────
  const MAX_CHIPS = 80;
  document.getElementById('selected-list').innerHTML =
    dies.slice(0, MAX_CHIPS).map(d => `<span>(${d.i},${d.j})</span>`).join('') +
    (dies.length > MAX_CHIPS ? `<span style="opacity:.6">+${dies.length - MAX_CHIPS} more</span>` : '');
}

function renderMetadata(metadata) {
  document.getElementById('wafer-meta').innerHTML =
    Object.entries(metadata ?? {}).map(([key, val]) => `
      <div class="stats-row">
        <span class="stats-key">${formatKey(key)}</span>
        <span class="stats-value">${val}</span>
      </div>`).join('');
}

function renderSummaryStats(dies) {
  const full = dies.filter(d => !d.partial);
  const bins = {};
  for (const d of full) { const b = d.hbin ?? 0; bins[b] = (bins[b] ?? 0) + 1; }
  const rows = [
    ['Total Dies',   full.length],
    ['Partial Dies', dies.filter(d => d.partial).length],
    ...Object.entries(bins).sort(([a],[b]) => Number(a)-Number(b))
      .map(([b, n]) => [`Bin ${b}`, `${n} (${(100*n/full.length).toFixed(1)}%)`]),
  ];
  document.getElementById('summary-stats').innerHTML =
    rows.map(([k,v]) => `
      <div class="stats-row">
        <span class="stats-key">${k}</span>
        <span class="stats-value">${v}</span>
      </div>`).join('');
}

function renderSpatialStats(dies, wafer, ringCount) {
  const full      = dies.filter(d => !d.partial);
  const ringStats = Array.from({ length: ringCount }, (_, i) =>
    ({ label: getRingLabel(i + 1, ringCount), total: 0 }));
  const quadStats = ['NE','NW','SW','SE'].map(l => ({ label: l, total: 0 }));
  const quadMap   = new Map(quadStats.map(e => [e.label, e]));
  for (const d of full) {
    const { ring, quadrant } = classifyDie(d, wafer, { ringCount });
    ringStats[ring - 1].total++;
    quadMap.get(quadrant).total++;
  }
  const toHtml = rows => rows.map(r => `
    <div class="stats-row">
      <span class="stats-key">${r.label}</span>
      <span class="stats-value">${r.total} dies</span>
    </div>`).join('');
  document.getElementById('ring-stats').innerHTML     = toHtml(ringStats);
  document.getElementById('quadrant-stats').innerHTML = toHtml(quadStats);
}

// ── Helpers ────────────────────────────────────────────────────────────────────
async function loadCsv(path) {
  const text = await fetch(path).then(r => r.text());
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(',');
  return lines.filter(Boolean).map(line => {
    const vals = line.split(',');
    return Object.fromEntries(headers.map((h, i) => [h, vals[i]]));
  });
}

function formatKey(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
}

main().catch(err => {
  console.error(err);
  document.getElementById('plotly-chart').textContent = `Failed to load: ${err.message}`;
});
