import {
  buildWaferMap,
  classifyDie,
  getRingLabel,
  hardBinColor,
} from 'wafermap';
import { renderWaferMap } from 'wafermap/canvas-adapter';

const RING_COUNT = 4;
const PASS_BINS  = [1];

const TEST_DEFS = [
  { index: 0, name: 'testA', unit: '' },
  { index: 1, name: 'testB', unit: '' },
  { index: 2, name: 'testC', unit: '' },
];

const HBIN_DEFS = [
  { bin: 1, name: 'Pass',       color: '#2ecc71' },
  { bin: 2, name: 'Fail — B',   color: '#e74c3c' },
  { bin: 3, name: 'Fail — C',   color: '#e67e22' },
  { bin: 4, name: 'Fail — D',   color: '#9b59b6' },
  { bin: 5, name: 'Fail — E',   color: '#3498db' },
];

let ctrl        = null;
let currentResult = null;
let allRows     = [];

async function main() {
  allRows = await loadCsv('../../data/dummy-fulldata.csv');
  populateWaferSelector();
  await loadWafer('W01');
  document.getElementById('sel-wafer').addEventListener('change', e => loadWafer(e.target.value));
}

async function loadCsv(path) {
  const text    = await (await fetch(path)).text();
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const keys = header.split(',');
  return lines.filter(Boolean).map(line => Object.fromEntries(keys.map((k, i) => [k, line.split(',')[i]])));
}

function populateWaferSelector() {
  const wafers = [...new Set(allRows.map(r => r.wafer))].sort();
  document.getElementById('sel-wafer').innerHTML =
    wafers.map(w => `<option value="${w}">${w}</option>`).join('');
}

async function loadWafer(waferId) {
  const rows     = allRows.filter(r => r.wafer === waferId);
  const firstRow = rows[0] ?? {};

  currentResult = buildWaferMap({
    results: rows.map(r => ({
      x:      +r.x,
      y:      +r.y,
      values: [+r.testA, +r.testB, +r.testC],
      bins:   [+r.hbin,  +r.sbin],
    })),
    waferConfig: {
      diameter: 150,
      notch:    { type: 'bottom' },
      metadata: {
        lot:          firstRow.lot,
        waferNumber:  +waferId.replace(/\D/g, ''),
        testDate:     firstRow.testdate,
        testProgram:  'PROG-V300-1',
        temperature:  +(firstRow.temp ?? 25),
      },
    },
    dieConfig:     { width: 10, height: 10 },
    reticleConfig: { width: 3, height: 3 },
    passBins:      PASS_BINS,
    testDefs:      TEST_DEFS,
    hbinDefs:      HBIN_DEFS,
  });

  const { wafer, dies, scene, reticles } = currentResult;

  const sceneOptions = {
    plotMode:  'hardbin',
    ringCount: RING_COUNT,
    reticles,
    testDefs:  scene.testDefs,
    hbinDefs:  scene.hbinDefs,
    sbinDefs:  scene.sbinDefs,
  };

  if (!ctrl) {
    ctrl = renderWaferMap(document.getElementById('chart'), wafer, dies, {
      sceneOptions,
      onSelect: updateSelectionPanel,
    });
  } else {
    ctrl.setDies(dies);
    ctrl.setOptions({ reticles });
  }

  updateMetaPanel(wafer.metadata);
  updateStatsPanel(currentResult);
  updateBinLegend(dies);
  clearSelectionPanel();
}

// ── Sidebar panels ────────────────────────────────────────────────────────────

function updateMetaPanel(meta = {}) {
  document.getElementById('meta-lot').textContent     = meta.lot          ?? '—';
  document.getElementById('meta-wafer').textContent   = meta.waferNumber  ?? '—';
  document.getElementById('meta-date').textContent    = meta.testDate     ?? '—';
  document.getElementById('meta-program').textContent = meta.testProgram  ?? '—';
  document.getElementById('meta-temp').textContent    = meta.temperature != null ? `${meta.temperature}°C` : '—';

  const tag = document.getElementById('header-tag');
  if (meta.lot) tag.innerHTML = `<strong>${meta.lot}</strong>`;
}

function updateStatsPanel({ yield: yld, dies, wafer }) {
  document.getElementById('stat-dies').textContent    = yld.totalDies;
  document.getElementById('stat-partial').textContent = yld.partialDies;
  document.getElementById('stat-pass').textContent    =
    yld.yieldPercent != null ? `${(yld.yieldPercent * 100).toFixed(1)}%` : '—';

  const full        = dies.filter(d => !d.partial && !d.edgeExcluded);
  const ringStats   = Array.from({ length: RING_COUNT }, (_, i) => ({
    label: getRingLabel(i + 1, RING_COUNT), total: 0, pass: 0,
  }));
  const quadStats   = ['NE', 'NW', 'SW', 'SE'].map(label => ({ label, total: 0, pass: 0 }));
  const qMap        = new Map(quadStats.map(q => [q.label, q]));

  for (const die of full) {
    const { ring, quadrant } = classifyDie(die, wafer, { ringCount: RING_COUNT });
    ringStats[ring - 1].total++;
    if (die.bins?.[0] === 1) ringStats[ring - 1].pass++;
    qMap.get(quadrant).total++;
    if (die.bins?.[0] === 1) qMap.get(quadrant).pass++;
  }

  renderPctTable('ring-stats',     ringStats);
  renderPctTable('quadrant-stats', quadStats);
}

function renderPctTable(id, rows) {
  document.getElementById(id).innerHTML = rows.map(r => {
    const pct = r.total ? (100 * r.pass / r.total) : 0;
    return `<tr>
      <td>${r.label}</td>
      <td><div class="pct-bar-wrap">
        <div class="pct-bar"><div class="pct-bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
        <span class="pct-num">${pct.toFixed(0)}%</span>
      </div></td>
    </tr>`;
  }).join('');
}

function updateBinLegend(dies) {
  const counts = {};
  for (const d of dies.filter(d => !d.partial)) {
    const b = d.bins?.[0];
    if (b != null) counts[b] = (counts[b] ?? 0) + 1;
  }
  const hbinMap  = new Map(HBIN_DEFS.map(d => [d.bin, d]));
  document.getElementById('bin-legend').innerHTML = Object.keys(counts)
    .map(Number).sort((a, b) => a - b)
    .map(bin => {
      const def   = hbinMap.get(bin);
      const color = def?.color ?? hardBinColor(bin);
      const name  = def?.name  ?? `Bin ${bin}`;
      return `<div class="bin-row">
        <div class="bin-dot" style="background:${color}"></div>
        <span class="bin-name">${name}</span>
        <span class="bin-count">${counts[bin]}</span>
      </div>`;
    }).join('');
}

function updateSelectionPanel(selectedDies) {
  const section = document.getElementById('selection-section');
  const sep     = document.getElementById('selection-sep');
  if (!selectedDies.length) {
    section.classList.remove('visible');
    sep.style.display = 'none';
    return;
  }
  const pass = selectedDies.filter(d => d.bins?.[0] === 1).length;
  const pct  = (100 * pass / selectedDies.length).toFixed(1);
  document.getElementById('stat-sel-count').textContent = selectedDies.length;
  document.getElementById('stat-sel-pass').textContent  = `${pct}%`;
  section.classList.add('visible');
  sep.style.display = 'block';
}

function clearSelectionPanel() {
  ctrl?.clearSelection();
  document.getElementById('selection-section').classList.remove('visible');
  document.getElementById('selection-sep').style.display = 'none';
}

main().catch(console.error);
