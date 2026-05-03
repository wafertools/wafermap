import {
  getUniqueBins,
  getColorScheme,
  listColorSchemes,
  analyzeWaferMap,
  analyzeWaferLot,
} from 'wafermap';
import { createWafermapWorker } from 'wafermap/worker';
import { renderWaferGallery } from 'wafermap/canvas-adapter';

const workerUrl = new URL('../../dist/packages/worker/wafermap.worker.js', import.meta.url);
const wmWorker = createWafermapWorker(new Worker(workerUrl, { type: 'module' }));

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  rows: [],
  headers: [],
  cfg: {
    waferCol: '', xCol: '', yCol: '',
    hbinCol: '', sbinCol: '',
    valueCols: [],
    passBin: null,
  },
  data: {
    waferIds: [],
    wafer: null,
    diesByWafer: {},
    resultsByWafer: {},
  },
  ui: {
    selectedWafers: new Set(),
    plotMode: 'hardbin',
    valueChannel: 0,
    colorScheme: 'color',
    showRings: false,
    showQuadrants: false,
    showXY: false,
    highlightBin: undefined,
  },
};

// ── CSV parsing ───────────────────────────────────────────────────────────────

function parseCsv(text) {
  const lines   = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',').map(h => h.trim());
  const rows    = lines.slice(1).filter(Boolean).map(line => {
    const vals = line.split(',');
    return Object.fromEntries(headers.map((h, i) => [h, (vals[i] ?? '').trim()]));
  });
  return { headers, rows };
}

// ── Column auto-detection ─────────────────────────────────────────────────────

function autoDetect(headers, rows) {
  const consumed = new Set();

  // Exact case-insensitive match (prevents bare 'x' from being missed by
  // substring patterns, and avoids consuming 'wafer' as the X column).
  const findExact = (...names) =>
    headers.find(h => !consumed.has(h) && names.some(n => h.toLowerCase() === n.toLowerCase()));

  // Substring fallback for prefixed variants like 'die_x', 'HBIN', etc.
  const findSub = (...patterns) =>
    headers.find(h => !consumed.has(h) && patterns.some(p => h.toLowerCase().includes(p)));

  const nextFree = () => headers.find(h => !consumed.has(h));
  const claim = col => { if (col) consumed.add(col); return col || ''; };

  const waferCol = claim(findExact('wafer', 'wid', 'wafer_id') ?? findSub('wafer', 'wid') ?? headers[0] ?? '');
  const xCol     = claim(findExact('x', 'die_x', 'diex') ?? findSub('die_x', 'diex', '_x', 'col') ?? nextFree() ?? headers[1] ?? '');
  const yCol     = claim(findExact('y', 'die_y', 'diey') ?? findSub('die_y', 'diey', '_y', 'row') ?? nextFree() ?? headers[2] ?? '');
  const hbinCol  = claim(findExact('hbin', 'bin') ?? findSub('hbin', 'hard_bin', 'hardbin') ?? '');
  const sbinCol  = claim(findExact('sbin') ?? findSub('sbin', 'soft_bin', 'softbin') ?? '');

  for (const col of [
    findExact('lot', 'lotid')          ?? findSub('lot', 'lotid'),
    findExact('testdate', 'date')      ?? findSub('testdate', 'date'),
    findExact('temp', 'temperature')   ?? findSub('temp'),
  ]) {
    if (col) consumed.add(col);
  }

  const valueCols = headers.filter(h => {
    if (consumed.has(h)) return false;
    return rows.slice(0, 20).some(r => r[h] !== '' && !isNaN(Number(r[h])));
  });

  return { waferCol, xCol, yCol, hbinCol, sbinCol, valueCols };
}

// ── Data processing ───────────────────────────────────────────────────────────

async function processData() {
  const { rows, cfg } = state;
  const waferIds = [...new Set(rows.map(r => r[cfg.waferCol]))].sort();

  setLoading(true, `Processing ${waferIds.length} wafer${waferIds.length !== 1 ? 's' : ''}…`);

  // Build per-wafer inputs and dispatch all to the worker in parallel.
  const waferInputs = waferIds.map(waferId => {
    const waferRows = rows.filter(r => r[cfg.waferCol] === waferId);
    // x,y columns contain prober step positions (die grid indices, not mm).
    const results = waferRows.map(r => ({
      x:      Number(r[cfg.xCol]),
      y:      Number(r[cfg.yCol]),
      bins:   cfg.hbinCol           ? [Number(r[cfg.hbinCol])]                   : undefined,
      values: cfg.valueCols.length  ? cfg.valueCols.map(col => Number(r[col]))   : undefined,
    }));
    return { waferId, waferRows, results };
  });

  const workerResults = await Promise.all(
    waferInputs.map(({ results }) => wmWorker.run({ results }))
  );

  const diesByWafer = {};
  const resultsByWafer = {};
  let sharedWafer = null;

  for (let i = 0; i < waferIds.length; i++) {
    const waferId   = waferIds[i];
    const waferRows = waferInputs[i].waferRows;
    const result    = workerResults[i];

    // Post-enrich with additional channels — die.i === prober x for centred grids.
    const rowMap = new Map(waferRows.map(r => [`${r[cfg.xCol]},${r[cfg.yCol]}`, r]));
    const enrichedDies = result.dies.map(die => {
      const row = rowMap.get(`${die.i},${die.j}`);
      if (!row) return { ...die, values: [], bins: [], metadata: {} };
      return {
        ...die,
        values: cfg.valueCols.map(col => Number(row[col])),
        bins: [
          cfg.hbinCol ? Number(row[cfg.hbinCol]) : 0,
          ...(cfg.sbinCol ? [Number(row[cfg.sbinCol])] : []),
        ],
        metadata: {
          waferId,
          customFields: Object.fromEntries(state.headers.map(h => [h, row[h]])),
        },
      };
    });

    diesByWafer[waferId] = enrichedDies;
    // Store enriched result for stats engine (wafer + enriched dies).
    resultsByWafer[waferId] = { ...result, dies: enrichedDies };

    // All wafers share the same wafer geometry (use the first one).
    if (!sharedWafer) sharedWafer = result.wafer;
  }

  setLoading(false);
  state.data = { waferIds, wafer: sharedWafer, diesByWafer, resultsByWafer };
  state.ui.selectedWafers = new Set(waferIds.slice(0, Math.min(4, waferIds.length)));
}

function setLoading(visible, sub = '') {
  const overlay = document.getElementById('loading-overlay');
  const subEl   = document.getElementById('loading-sub');
  overlay.hidden = !visible;
  if (subEl) subEl.textContent = sub;
}

// ── Analytics charts ──────────────────────────────────────────────────────────

function renderPareto() {
  const { diesByWafer } = state.data;
  const counts = {};
  for (const dies of Object.values(diesByWafer)) {
    for (const die of dies) {
      if (die.partial) continue;
      const bin = die.bins?.[0];
      if (bin !== undefined) counts[bin] = (counts[bin] ?? 0) + 1;
    }
  }

  const sorted  = Object.entries(counts)
    .map(([bin, count]) => ({ bin: Number(bin), count }))
    .sort((a, b) => b.count - a.count);
  const total   = sorted.reduce((s, d) => s + d.count, 0);
  let cum = 0;
  const cumPct  = sorted.map(d => { cum += d.count; return +(100 * cum / total).toFixed(1); });

  Plotly.react('chart-pareto', [
    {
      type: 'bar',
      x: sorted.map(d => `Bin ${d.bin}`),
      y: sorted.map(d => d.count),
      marker: { color: sorted.map(d => getColorScheme(state.ui.colorScheme).forBin(d.bin)) },
      name: 'Count',
    },
    {
      type: 'scatter', mode: 'lines+markers',
      x: sorted.map(d => `Bin ${d.bin}`),
      y: cumPct,
      yaxis: 'y2', name: 'Cumulative %',
      line: { color: '#555', width: 1.5 }, marker: { size: 5, color: '#555' },
    },
  ], {
    title: { text: 'Bin Pareto (all wafers)', x: 0.02, font: { size: 13 } },
    barmode: 'group',
    xaxis: { title: '' },
    yaxis: { title: 'Die count' },
    yaxis2: { title: 'Cumulative %', overlaying: 'y', side: 'right', range: [0, 105], ticksuffix: '%' },
    legend: { orientation: 'h', y: -0.15 },
    margin: { t: 36, l: 48, r: 48, b: 60 },
    plot_bgcolor: '#f9f9f9',
    showlegend: true,
  }, { responsive: true });
}

function renderYieldChart() {
  const { waferIds, diesByWafer } = state.data;
  const { passBin } = state.cfg;
  const allBins = getUniqueBins(Object.values(diesByWafer).flat());

  const binsByWafer   = {};
  const totalsByWafer = {};
  for (const waferId of waferIds) {
    binsByWafer[waferId]   = {};
    let total = 0;
    for (const die of diesByWafer[waferId]) {
      if (die.partial) continue;
      total++;
      const bin = die.bins?.[0];
      if (bin !== undefined) binsByWafer[waferId][bin] = (binsByWafer[waferId][bin] ?? 0) + 1;
    }
    totalsByWafer[waferId] = total;
  }

  const sortedWafers = [...waferIds].sort((a, b) => {
    if (passBin === null) return a.localeCompare(b);
    const ya = totalsByWafer[a] ? (binsByWafer[a][passBin] ?? 0) / totalsByWafer[a] : 0;
    const yb = totalsByWafer[b] ? (binsByWafer[b][passBin] ?? 0) / totalsByWafer[b] : 0;
    return yb - ya;
  });

  const selectedSet = state.ui.selectedWafers;
  const traces = allBins.map(bin => ({
    type: 'bar', name: `Bin ${bin}`,
    x: sortedWafers,
    y: sortedWafers.map(w => binsByWafer[w][bin] ?? 0),
    marker: {
      color:   getColorScheme(state.ui.colorScheme).forBin(bin),
      opacity: sortedWafers.map(w => selectedSet.has(w) ? 1 : 0.35),
    },
  }));

  Plotly.react('chart-yield', traces, {
    title:    { text: passBin !== null ? `Bin Distribution (pass = Bin ${passBin})` : 'Bin Distribution per Wafer', x: 0.02, font: { size: 13 } },
    barmode:  'stack',
    xaxis:    { title: 'Wafer' },
    yaxis:    { title: 'Die count' },
    legend:   { orientation: 'h', y: -0.2 },
    margin:   { t: 36, l: 48, r: 20, b: 70 },
    plot_bgcolor: '#f9f9f9',
    clickmode: 'event',
  }, { responsive: true });

  document.getElementById('chart-yield').on('plotly_click', event => {
    const waferId = event.points[0].x;
    if (state.ui.selectedWafers.has(waferId)) state.ui.selectedWafers.delete(waferId);
    else state.ui.selectedWafers.add(waferId);
    refreshGallery();
    renderYieldChart();
  });
}

// ── Gallery controller ────────────────────────────────────────────────────────

let galleryCtrl = null;

// ── Render queue — debounced ───────────────────────────────────────────────────

const renderQueue = { timer: null };

function refreshGallery() {
  clearTimeout(renderQueue.timer);
  renderQueue.timer = setTimeout(_doRefreshGallery, 150);
}

function _doRefreshGallery() {
  updateWaferChips();
  renderWafermapGallery();
}

function buildGalleryItems(selected, diesByWafer, wafer) {
  // Always returns per-wafer items — stacked modes are handled automatically
  // by renderWaferGallery when the mode is selected from the toolbar.
  const { valueChannel } = state.ui;
  const dies4map = valueChannel > 0
    ? dies => dies.map(die => {
        const v = die.values ?? [];
        const reordered = [...v];
        reordered[0] = v[valueChannel] ?? v[0];
        return { ...die, values: reordered };
      })
    : dies => dies;

  return selected.map(waferId => ({
    wafer,
    dies:  dies4map(diesByWafer[waferId] ?? []),
    label: waferId,
  }));
}

function renderWafermapGallery() {
  const galleryEl = document.getElementById('wafermap-gallery');
  galleryEl.classList.remove('bin-gallery-grid');
  const { selectedWafers, plotMode, colorScheme, showRings, showQuadrants, showXY, highlightBin } = state.ui;
  const { diesByWafer, wafer } = state.data;
  const selected = [...selectedWafers].sort();

  // Destroy existing gallery controller and clear the container.
  if (galleryCtrl) { galleryCtrl.destroy(); galleryCtrl = null; }
  galleryEl.innerHTML = '';

  if (!selected.length) {
    galleryEl.innerHTML = '<p class="empty-msg">Click wafers in the distribution chart to display them, or use Select All.</p>';
    return;
  }

  const items = buildGalleryItems(selected, diesByWafer, wafer);

  // Attach per-wafer stats and compute lot-level stats.
  const { resultsByWafer } = state.data;
  const passBins = state.cfg.passBin !== null ? [state.cfg.passBin] : undefined;
  const selectedResults = selected.map(wId => resultsByWafer[wId]).filter(Boolean);
  const waferStats = selectedResults.map(r => analyzeWaferMap(r, { passBins }));
  items.forEach((item, i) => { item.statsSummary = waferStats[i]; });
  const lotStatsSummary = analyzeWaferLot(selectedResults, { passBins });

  const testDefs = state.cfg.valueCols.map((col, i) => ({ index: i, name: col }));
  const allBins = getUniqueBins(Object.values(diesByWafer).flat());
  const hbinDefs = allBins.map(b => ({ bin: b, name: `HBin ${b}` }));

  galleryCtrl = renderWaferGallery(galleryEl, items, {
    sceneOptions: {
      plotMode,
      colorScheme,
      showRingBoundaries:     showRings,
      showQuadrantBoundaries: showQuadrants,
      showXYIndicator:        showXY,
      highlightBin,
      testDefs,
      hbinDefs,
    },
    lotStatsSummary,
    onSceneOptionsChange(opts) {
      // Keep sidebar controls in sync when the gallery toolbar changes something.
      // Stacked mode transitions are handled internally by the gallery — no refreshGallery().
      if (opts.plotMode     !== undefined) { state.ui.plotMode    = opts.plotMode;    document.getElementById('map-mode').value        = opts.plotMode; }
      if (opts.colorScheme  !== undefined) { state.ui.colorScheme = opts.colorScheme; document.getElementById('map-color').value        = opts.colorScheme; }
      if (opts.showRingBoundaries     !== undefined) { state.ui.showRings     = opts.showRingBoundaries;     document.getElementById('btn-rings').checked     = opts.showRingBoundaries; }
      if (opts.showQuadrantBoundaries !== undefined) { state.ui.showQuadrants = opts.showQuadrantBoundaries; document.getElementById('btn-quadrants').checked = opts.showQuadrantBoundaries; }
      if (opts.showXYIndicator        !== undefined) { state.ui.showXY        = opts.showXYIndicator;        document.getElementById('btn-xy').checked        = opts.showXYIndicator; }
    },
  });

  // Append per-card bin stats — only in per-wafer modes (not stacked).
  const STACKED = new Set(['stackedValues', 'stackedBins', 'stackedSoftBins']);
  if (!STACKED.has(plotMode)) {
    const cards = galleryEl.querySelectorAll('.wmap-gallery-card');
    cards.forEach((card, i) => {
      const waferId = selected[i];
      const dies = diesByWafer[waferId];
      if (!dies) return;
      const statsEl = document.createElement('div');
      statsEl.className = 'map-stats';
      card.appendChild(statsEl);
      renderMapStats(statsEl, dies);
    });
  }
}

function renderMapStats(targetEl, dies) {
  const el       = typeof targetEl === 'string' ? document.getElementById(targetEl) : targetEl;
  if (!el) return;
  const fullDies  = dies.filter(d => !d.partial);
  const binCounts = {};
  for (const die of fullDies) {
    const bin = die.bins?.[0] ?? 0;
    binCounts[bin] = (binCounts[bin] ?? 0) + 1;
  }
  const total = fullDies.length;
  const passBin = state.cfg.passBin;
  const yieldChip = passBin !== null && total > 0
    ? `<span class="stat-chip stat-chip-yield">Yield: ${(100 * (binCounts[passBin] ?? 0) / total).toFixed(1)}%</span>`
    : '';
  el.innerHTML = yieldChip + Object.entries(binCounts)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([bin, count]) => {
      const pct = (100 * count / total).toFixed(1);
      return `<span class="stat-chip" style="border-color:${getColorScheme(state.ui.colorScheme).forBin(Number(bin))}">B${bin}: ${count} (${pct}%)</span>`;
    }).join('');
}


// ── UI helpers ────────────────────────────────────────────────────────────────

function updateWaferChips() {
  const bar = document.getElementById('wafer-chips');
  if (!bar) return;

  bar.innerHTML = [...state.ui.selectedWafers].sort().map(w =>
    `<span class="chip">${w} <button class="chip-remove" data-wafer="${w}">×</button></span>`
  ).join('');

  for (const btn of bar.querySelectorAll('.chip-remove')) {
    btn.addEventListener('click', () => {
      state.ui.selectedWafers.delete(btn.dataset.wafer);
      refreshGallery();
      renderYieldChart();
    });
  }
}

function populateConfigForm() {
  const { headers, cfg } = state;

  const colSelect = (id, value) => {
    const el = document.getElementById(id);
    el.innerHTML = ['', ...headers].map(h => `<option${h === value ? ' selected' : ''}>${h}</option>`).join('');
  };

  colSelect('cfg-wafer', cfg.waferCol);
  colSelect('cfg-x',     cfg.xCol);
  colSelect('cfg-y',     cfg.yCol);
  colSelect('cfg-hbin',  cfg.hbinCol);
  colSelect('cfg-sbin',  cfg.sbinCol);

  const vcBox = document.getElementById('cfg-valuecols');
  vcBox.innerHTML = headers.map(h => `
    <label class="check-label">
      <input type="checkbox" value="${h}"${cfg.valueCols.includes(h) ? ' checked' : ''}> ${h}
    </label>
  `).join('');

  // sidebar-config visibility is managed by handleFile
}

function readConfig() {
  state.cfg.waferCol  = document.getElementById('cfg-wafer').value;
  state.cfg.xCol      = document.getElementById('cfg-x').value;
  state.cfg.yCol      = document.getElementById('cfg-y').value;
  state.cfg.hbinCol   = document.getElementById('cfg-hbin').value;
  state.cfg.sbinCol   = document.getElementById('cfg-sbin').value;
  state.cfg.valueCols = [...document.querySelectorAll('#cfg-valuecols input:checked')].map(el => el.value);
}

function populatePassBinSelector() {
  const allDies = Object.values(state.data.diesByWafer).flat();
  const bins    = getUniqueBins(allDies);
  const sel     = document.getElementById('cfg-passbin');
  sel.innerHTML = `<option value="">None</option>` +
    bins.map(b => `<option value="${b}">Bin ${b}</option>`).join('');
  if (bins.length) sel.value = String(bins[0]);
  state.cfg.passBin = bins.length ? bins[0] : null;
}

function populateMapControls() {
  document.getElementById('map-mode').innerHTML = `
    <option value="hardbin">Hard Bin</option>
    <option value="softbin">Soft Bin</option>
    <option value="value">Test Value</option>
    <option value="stackedValues">Stacked Test Values</option>
    <option value="stackedBins">Stacked Hard Bins</option>
    <option value="stackedSoftBins">Stacked Soft Bins</option>
  `;

  const chanEl = document.getElementById('map-channel');
  chanEl.innerHTML = state.cfg.valueCols.map((col, i) =>
    `<option value="${i}">${col}</option>`
  ).join('');
  chanEl.parentElement.hidden = !state.cfg.valueCols.length;

  const colorEl = document.getElementById('map-color');
  colorEl.innerHTML = listColorSchemes()
    .map(({ name, label }) => `<option value="${name}"${name === state.ui.colorScheme ? ' selected' : ''}>${label}</option>`)
    .join('');

  const allDies = Object.values(state.data.diesByWafer).flat();
  const bins    = getUniqueBins(allDies);
  const hlEl    = document.getElementById('map-highlight');
  hlEl.innerHTML = `<option value="">None</option>` +
    bins.map(b => `<option value="${b}">Bin ${b}</option>`).join('');
}

// ── Header yield stat ─────────────────────────────────────────────────────

function updateHeaderYield() {
  const statEl  = document.getElementById('hm-yield-stat');
  const valEl   = document.getElementById('hm-yield');
  const { passBin } = state.cfg;
  if (passBin === null || !Object.keys(state.data.diesByWafer).length) {
    statEl.hidden = true;
    return;
  }
  const flatDies = Object.values(state.data.diesByWafer).flat().filter(d => !d.partial);
  const passCount = flatDies.filter(d => d.bins?.[0] === passBin).length;
  const yieldPct  = flatDies.length ? (100 * passCount / flatDies.length).toFixed(1) : '—';
  valEl.textContent = yieldPct + '%';
  statEl.hidden = false;
}

// ── Mobile menu ───────────────────────────────────────────────────────────

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.remove('open');
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('open');
}

// ── Event wiring ──────────────────────────────────────────────────────────────

function wireEvents() {
  const fileInput  = document.getElementById('file-input');
  const filePill   = document.getElementById('file-pill');
  const dropBanner = document.getElementById('drop-banner');
  const content    = document.getElementById('content');
  const hamburger  = document.getElementById('hamburger-btn');
  const sidebar    = document.getElementById('sidebar');

  // Mobile: hamburger menu toggle
  hamburger.addEventListener('click', toggleSidebar);

  // Mobile: close sidebar when content is clicked
  content.addEventListener('click', () => {
    if (window.innerWidth <= 1024) closeSidebar();
  });

  // File pill click / drag
  filePill.addEventListener('click', () => fileInput.click());

  for (const target of [filePill, dropBanner]) {
    target.addEventListener('dragover', e => { e.preventDefault(); filePill.classList.add('drag-over'); dropBanner.classList.add('drag-over'); });
    target.addEventListener('dragleave', () => { filePill.classList.remove('drag-over'); dropBanner.classList.remove('drag-over'); });
    target.addEventListener('drop', e => {
      e.preventDefault();
      filePill.classList.remove('drag-over');
      dropBanner.classList.remove('drag-over');
      handleFile(e.dataTransfer.files[0]);
    });
  }

  fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));

  document.getElementById('btn-reopen').addEventListener('click', () => fileInput.click());

  document.getElementById('btn-process').addEventListener('click', async () => {
    readConfig();
    await processData();
    populatePassBinSelector();
    populateMapControls();

    // Switch sidebar to controls view
    document.getElementById('sidebar-config').hidden   = true;
    document.getElementById('sidebar-controls').hidden = false;

    // Hide drop banner, show results
    dropBanner.hidden = true;
    document.getElementById('analytics-section').hidden = false;
    document.getElementById('map-section').hidden       = false;

    // Header meta
    const allDies    = Object.values(state.data.diesByWafer);
    const flatDies   = allDies.flat();
    const bins       = getUniqueBins(flatDies);
    document.getElementById('hm-wafers').textContent = state.data.waferIds.length;
    document.getElementById('hm-dies').textContent   = allDies[0]?.length ?? '—';
    document.getElementById('hm-bins').textContent   = bins.length;
    document.getElementById('header-meta').hidden    = false;
    updateHeaderYield();

    renderPareto();
    renderYieldChart();
    refreshGallery();
  });

  document.getElementById('cfg-passbin').addEventListener('change', e => {
    const v = e.target.value;
    state.cfg.passBin = v === '' ? null : Number(v);
    renderYieldChart();
    updateHeaderYield();
  });

  document.getElementById('btn-select-all').addEventListener('click', () => {
    state.data.waferIds.forEach(w => state.ui.selectedWafers.add(w));
    refreshGallery();
    renderYieldChart();
  });
  document.getElementById('btn-clear-selection').addEventListener('click', () => {
    state.ui.selectedWafers.clear();
    refreshGallery();
    renderYieldChart();
  });

  document.getElementById('map-mode').addEventListener('change', e => {
    state.ui.plotMode = e.target.value;
    const isStacked = e.target.value === 'stackedValues' || e.target.value === 'stackedBins' || e.target.value === 'stackedSoftBins';
    document.getElementById('map-channel-group').hidden =
      e.target.value !== 'value' || !state.cfg.valueCols.length;
    // Stacked modes change the items (aggregated vs individual) — always full rebuild.
    if (!isStacked && galleryCtrl) galleryCtrl.setOptions({ plotMode: e.target.value });
    else refreshGallery();
  });
  document.getElementById('map-channel').addEventListener('change', e => {
    state.ui.valueChannel = Number(e.target.value);
    refreshGallery();
  });
  document.getElementById('map-color').addEventListener('change', e => {
    state.ui.colorScheme = e.target.value;
    renderPareto();
    renderYieldChart();
    if (galleryCtrl) galleryCtrl.setOptions({ colorScheme: e.target.value });
    else refreshGallery();
  });
  document.getElementById('map-highlight').addEventListener('change', e => {
    state.ui.highlightBin = e.target.value === '' ? undefined : Number(e.target.value);
    if (galleryCtrl) galleryCtrl.setOptions({ highlightBin: state.ui.highlightBin });
    else refreshGallery();
  });

  for (const [id, stateKey, optsKey] of [
    ['btn-rings',     'showRings',     'showRingBoundaries'],
    ['btn-quadrants', 'showQuadrants', 'showQuadrantBoundaries'],
    ['btn-xy',        'showXY',        'showXYIndicator'],
  ]) {
    document.getElementById(id).addEventListener('change', e => {
      state.ui[stateKey] = e.target.checked;
      if (galleryCtrl) galleryCtrl.setOptions({ [optsKey]: e.target.checked });
      else refreshGallery();
    });
  }
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

function wireKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    const tagName = document.activeElement?.tagName;
    const isInput = tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA';

    // Ctrl+O: open file picker
    if (e.ctrlKey && e.key === 'o' && !isInput) {
      e.preventDefault();
      document.getElementById('file-input').click();
    }

    // Ctrl+A: select all wafers (only if data loaded)
    if (e.ctrlKey && e.key === 'a' && !isInput && state.data.waferIds.length) {
      e.preventDefault();
      state.data.waferIds.forEach(w => state.ui.selectedWafers.add(w));
      refreshGallery();
      renderYieldChart();
    }

    // Ctrl+C or Ctrl+Shift+C: clear selection
    if ((e.ctrlKey && e.key === 'c') && !isInput && state.data.waferIds.length) {
      e.preventDefault();
      state.ui.selectedWafers.clear();
      refreshGallery();
      renderYieldChart();
    }

    // Esc: close sidebar on mobile
    if (e.key === 'Escape') {
      closeSidebar();
    }
  });
}

function handleFile(file) {
  if (!file) return;
  const pill = document.getElementById('file-pill');
  document.getElementById('file-pill-name').textContent = `${file.name}  (${(file.size / 1024).toFixed(0)} KB)`;
  pill.classList.add('has-file');

  const reader = new FileReader();
  reader.onload = e => {
    const { headers, rows } = parseCsv(e.target.result);
    state.headers = headers;
    state.rows    = rows;
    state.data    = { waferIds: [], wafer: null, diesByWafer: {} };

    const detected = autoDetect(headers, rows);
    Object.assign(state.cfg, detected);

    // Reset to config view
    document.getElementById('sidebar-empty').hidden    = true;
    document.getElementById('sidebar-config').hidden   = false;
    document.getElementById('sidebar-controls').hidden = true;
    document.getElementById('analytics-section').hidden = true;
    document.getElementById('map-section').hidden       = true;
    document.getElementById('header-meta').hidden       = true;
    document.getElementById('drop-banner').hidden       = false;

    populateConfigForm();
  };
  reader.readAsText(file);
}

// ── Init ──────────────────────────────────────────────────────────────────────

wireEvents();
wireKeyboardShortcuts();
