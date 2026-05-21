// showcase.js — app scaffolding for 00-showcase.html
// CSV parsing, column detection, mapping UI, phase switching, help popout.
// Does not import from wafermap — all library calls live in 00-showcase.html.

// ── Constants ──────────────────────────────────────────────────────────────

export const MAX_BYTES = 20 * 1024 * 1024;
export const MAX_ROWS  = 500_000;

// Role options shown in the mapping dropdown
const ROLE_OPTIONS = [
  { value: 'x',         label: 'X position' },
  { value: 'y',         label: 'Y position' },
  { value: 'hbin',      label: 'Hard bin' },
  { value: 'sbin',      label: 'Soft bin' },
  { value: 'wafer',     label: 'Wafer ID' },
  { value: 'lot',       label: 'Lot ID' },
  { value: 'test',      label: 'Test value' },
  { value: 'testname',  label: 'Test name (long format)' },
  { value: 'testvalue', label: 'Test result (long format)' },
  { value: 'metadata',  label: 'Display info' },
  { value: '',          label: 'Ignore' },
];

// Auto-detection: column name patterns → role (checked in order; first match wins)
const DETECTION_RULES = [
  { role: 'x',         patterns: ['x', 'die_x', 'x_loc', 'xloc', 'col', 'column', 'step_x', 'stepx', 'diex', 'xstep', 'x_step', 'xcoord', 'x_coord', 'xpos', 'x_pos'] },
  { role: 'y',         patterns: ['y', 'die_y', 'y_loc', 'yloc', 'row', 'step_y', 'stepy', 'diey', 'ystep', 'y_step', 'ycoord', 'y_coord', 'ypos', 'y_pos'] },
  { role: 'hbin',      patterns: ['hbin', 'hard_bin', 'h_bin', 'hardbin', 'hb', 'bin', 'hard bin', 'hard_bin_num', 'hbin_num'] },
  { role: 'sbin',      patterns: ['sbin', 'soft_bin', 's_bin', 'softbin', 'sb', 'soft bin', 'soft_bin_num', 'sbin_num'] },
  { role: 'wafer',     patterns: ['wafer', 'wafer_id', 'waferid', 'wafer_num', 'wafernum', 'wid', 'wafer_no', 'waferno', 'wfr', 'wfr_id', 'wfrid', 'wnum'] },
  { role: 'lot',       patterns: ['lot', 'lot_id', 'lotid', 'lot_num', 'lotnum', 'lot_no', 'lotno', 'lid', 'lot_number'] },
  { role: 'testname',  patterns: ['test_name', 'testname', 'test_nam', 'param', 'parameter', 'param_name', 'measurement', 'item', 'test_item', 'test_id', 'test_num', 'testnum', 'tnum', 'test_number'] },
  { role: 'testvalue', patterns: ['result', 'value', 'val', 'measured', 'meas', 'reading', 'test_value', 'testvalue', 'test_result', 'testresult', 'data'] },
  // STDF MIR/WIR/SDR fields and common ATE export column names — display as metadata, not test values
  { role: 'metadata', patterns: [
    'testdate', 'test_date', 'date', 'start_t', 'setup_t', 'finish_t', 'tst_date',
    'temp', 'temperature', 'tst_temp', 'chuck_temp', 'env_temp',
    'operator', 'oper', 'oper_nam', 'operator_id', 'operatorid',
    'testprogram', 'test_program', 'job_nam', 'job_rev', 'program', 'prog',
    'node', 'node_nam', 'tester', 'tstr_typ', 'tester_id', 'testerid',
    'part_typ', 'part_type', 'parttype', 'device', 'product', 'family_id', 'famly_id',
    'package', 'pkg_typ',
    'process', 'proc_id', 'process_id',
    'flow_id', 'setup_id', 'spec_nam', 'spec_ver', 'dsgn_rev', 'eng_id',
    'facility', 'facil_id', 'floor_id', 'floor',
    'sublot', 'sblot_id', 'sub_lot', 'sublot_id',
    'site', 'site_num', 'site_grp', 'head_num',
    'handler', 'hand_typ', 'hand_id',
    'loadboard', 'load_typ', 'load_id', 'dib_typ', 'dib_id',
    'contactor', 'cont_typ', 'cont_id',
    'exec_typ', 'exec_ver', 'test_cod', 'rtst_cod',
    'serl_num', 'serial', 'serial_num', 'rom_cod',
    'burn_tim', 'supr_nam',
  ]},
];

function detectRole(colName) {
  const key = colName.toLowerCase().trim();
  for (const { role, patterns } of DETECTION_RULES) {
    if (patterns.includes(key)) return role;
  }
  return null; // unknown — will be offered as test or ignored based on value type
}

// ── Long-format detection ──────────────────────────────────────────────────

/**
 * Given a mapping (from readMapping), check whether it looks like long format.
 * Returns null if not long format, or { nameCol, valueCol, uniqueNames, dieCount }
 * if it is.
 *
 * Confirmation signals (both must be true):
 *   1. A testname column and a testvalue column are both mapped.
 *   2. Coordinates repeat — i.e. unique (x,y) pairs < total rows, meaning
 *      multiple rows share the same die position.
 */
export function detectLongFormat(mapping) {
  if (!mapping.testname || !mapping.testvalue) return null;
  if (!mapping.x || !mapping.y) return null;

  // Count unique die positions vs total rows
  const posSet = new Set();
  for (const row of parsedRows) {
    const x = row[mapping.x], y = row[mapping.y];
    if (x !== '' && y !== '') posSet.add(`${x},${y}`);
  }
  const uniqueDies  = posSet.size;
  const totalRows   = parsedRows.length;

  // If every row has a unique position it's not long format
  if (uniqueDies >= totalRows) return null;

  // Collect unique test names
  const nameSet = new Set();
  for (const row of parsedRows) {
    const n = row[mapping.testname];
    if (n !== undefined && n !== '') nameSet.add(n);
  }

  return {
    nameCol:     mapping.testname,
    valueCol:    mapping.testvalue,
    uniqueNames: [...nameSet].sort(),
    dieCount:    uniqueDies,
    rowCount:    totalRows,
  };
}

/**
 * Pivot long-format rows into wide format.
 * Returns { wideRows, testNames } where testNames is Map<name, testNumber>.
 * hbin/sbin/wafer/lot/meta values are taken from the first row seen for each die.
 */
export function pivotLongFormat(rows, mapping) {
  const dieMap = new Map(); // key → wide row
  const testNames = new Map(); // name → testNumber
  let nextTestNum = 1001;

  for (const row of rows) {
    const x = row[mapping.x], y = row[mapping.y];
    if (x === '' || y === '' || isNaN(Number(x)) || isNaN(Number(y))) continue;

    const wafer = mapping.wafer ? (row[mapping.wafer] ?? '') : '';
    const lot   = mapping.lot   ? (row[mapping.lot]   ?? '') : '';
    const key   = `${wafer}\x00${lot}\x00${x}\x00${y}`;

    if (!dieMap.has(key)) {
      const wide = { [mapping.x]: x, [mapping.y]: y };
      if (mapping.wafer) wide[mapping.wafer] = wafer;
      if (mapping.lot)   wide[mapping.lot]   = lot;
      if (mapping.hbin)  wide[mapping.hbin]  = row[mapping.hbin] ?? '';
      if (mapping.sbin)  wide[mapping.sbin]  = row[mapping.sbin] ?? '';
      for (const col of mapping.meta) wide[col] = row[col] ?? '';
      dieMap.set(key, wide);
    }

    const wide    = dieMap.get(key);
    const name    = row[mapping.testname];
    const rawVal  = row[mapping.testvalue];
    if (!name || rawVal === '' || rawVal === undefined) continue;

    if (!testNames.has(name)) testNames.set(name, nextTestNum++);
    // Store as a synthetic wide column keyed by testNumber so buildResults can read it
    wide[`__test_${testNames.get(name)}`] = rawVal;

    // If hbin/sbin appear per-row, fill them in if not already set
    if (mapping.hbin && wide[mapping.hbin] === '' && row[mapping.hbin] !== '') {
      wide[mapping.hbin] = row[mapping.hbin];
    }
    if (mapping.sbin && wide[mapping.sbin] === '' && row[mapping.sbin] !== '') {
      wide[mapping.sbin] = row[mapping.sbin];
    }
  }

  return { wideRows: [...dieMap.values()], testNames };
}

// ── CSV parser ─────────────────────────────────────────────────────────────
// Handles quoted fields, \r\n, blank lines, and # comment lines.

function parseCsv(text) {
  const rows = [];
  let i = 0;
  const n = text.length;

  let headers = null;

  while (i < n) {
    const lineStart = i;
    while (i < n && text[i] !== '\n') i++;
    const line = text.slice(lineStart, i).replace(/\r$/, '');
    if (i < n) i++;

    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (!headers) {
      headers = splitCsvLine(line);
      continue;
    }

    if (rows.length >= MAX_ROWS) break;

    const vals = splitCsvLine(line);
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = (vals[c] ?? '').trim();
    }
    rows.push(obj);
  }

  return { rows, headers: headers ?? [], truncated: rows.length >= MAX_ROWS };
}

function splitCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') { inQuote = true; }
      else if (ch === ',') { fields.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
  }
  fields.push(cur.trim());
  return fields;
}

// ── Shared state ───────────────────────────────────────────────────────────

export let parsedRows    = [];
export let fileHeaders   = [];
export let fileTruncated = false;
export let fileName      = '';
export let galleryCtrl   = null;

export function setGalleryCtrl(ctrl) { galleryCtrl = ctrl; }

// ── Phase management ───────────────────────────────────────────────────────

export function showPhase(id) {
  for (const el of document.querySelectorAll('.phase')) {
    el.classList.toggle('active', el.id === id);
  }
}

// ── Upload phase ───────────────────────────────────────────────────────────

function showUploadError(msg) {
  const uploadErr = document.getElementById('upload-error');
  uploadErr.textContent = msg;
  uploadErr.style.display = msg ? 'block' : 'none';
}

function handleFile(file) {
  showUploadError('');
  if (file.size > MAX_BYTES) {
    showUploadError(`File is ${(file.size / 1024 / 1024).toFixed(1)} MB — maximum is 20 MB. Try exporting a smaller slice.`);
    return;
  }
  const reader = new FileReader();
  reader.onload = e => processText(e.target.result, file.name);
  reader.readAsText(file);
}

function processText(text, name) {
  fileName = name;

  if (name.toLowerCase().endsWith('.json')) {
    processJson(text);
    return;
  }

  const { rows, headers, truncated } = parseCsv(text);
  if (!rows.length) { showUploadError('No data rows found in file.'); return; }

  parsedRows    = rows;
  fileHeaders   = headers;
  fileTruncated = truncated;
  buildMappingUI();
  showPhase('phase-mapping');
}

function processJson(text) {
  let data;
  try { data = JSON.parse(text); } catch { showUploadError('Invalid JSON.'); return; }

  const arr = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : null;
  if (!arr) { showUploadError('JSON must be an array of objects, or { results: [...] }.'); return; }
  if (!arr.length) { showUploadError('JSON array is empty.'); return; }

  parsedRows    = arr.slice(0, MAX_ROWS);
  fileHeaders   = Object.keys(arr[0]);
  fileTruncated = arr.length > MAX_ROWS;
  buildMappingUI();
  showPhase('phase-mapping');
}

// ── Mapping phase ──────────────────────────────────────────────────────────

function buildMappingUI() {
  const tbody = document.getElementById('mapping-rows');
  tbody.innerHTML = '';

  const assignments = fileHeaders.map(col => {
    const role = detectRole(col);
    if (role && role !== 'test') {
      return { col, role, name: col };
    }
    return { col, role: null, name: col };
  });

  const sampleRow = parsedRows[0] ?? {};
  for (const a of assignments) {
    if (a.role === null) {
      const val = sampleRow[a.col];
      const isNumeric = val !== undefined && val !== '' && !isNaN(Number(val));
      a.role = isNumeric ? 'test' : 'metadata';
    }
  }

  for (const a of assignments) {
    const tr = document.createElement('tr');
    tr.dataset.col = a.col;

    const tdName = document.createElement('td');
    tdName.innerHTML = `<span class="col-name">${escHtml(a.col)}</span>`;

    const tdArr = document.createElement('td');
    tdArr.className = 'col-arrow';
    tdArr.textContent = '→';

    const tdRole = document.createElement('td');
    const sel = document.createElement('select');
    sel.dataset.col = a.col;
    for (const opt of ROLE_OPTIONS) {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      if (opt.value === (a.role ?? '')) o.selected = true;
      sel.appendChild(o);
    }
    tdRole.appendChild(sel);

    const tdTestName = document.createElement('td');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'test-name-input';
    nameInput.value = a.col;
    nameInput.placeholder = 'Test name';
    nameInput.dataset.col = a.col;
    nameInput.style.display = a.role === 'test' ? 'inline-block' : 'none';
    tdTestName.appendChild(nameInput);

    const tdSplit = document.createElement('td');
    tdSplit.className = 'split-cell';
    const uniqueVals = [...new Set(parsedRows.map(r => r[a.col]).filter(v => v !== undefined && v !== ''))];
    const cardinality = uniqueVals.length;

    const splitLabel = document.createElement('label');
    splitLabel.className = 'split-label';
    const splitCheck = document.createElement('input');
    splitCheck.type = 'checkbox';
    splitCheck.dataset.col = a.col;
    const splitSpan = document.createElement('span');
    splitSpan.textContent = 'Split gallery';
    const cardHint = document.createElement('span');
    cardHint.className = 'cardinality-hint';
    cardHint.textContent = cardinality <= 1 ? '(same for all)' : `(${cardinality} values)`;
    splitLabel.append(splitCheck, splitSpan, cardHint);
    tdSplit.appendChild(splitLabel);

    const updateSplitVisibility = () => {
      tdSplit.style.visibility = sel.value === 'metadata' ? 'visible' : 'hidden';
      if (sel.value !== 'metadata') splitCheck.checked = false;
    };
    updateSplitVisibility();

    sel.addEventListener('change', () => {
      nameInput.style.display = sel.value === 'test' ? 'inline-block' : 'none';
      updateSplitVisibility();
    });

    tr.append(tdName, tdArr, tdRole, tdTestName, tdSplit);
    tbody.appendChild(tr);
  }

  const info = `${parsedRows.length.toLocaleString()} rows · ${fileHeaders.length} columns · ${fileName}`;
  document.getElementById('mapping-file-info').textContent = info;
}

export function readMapping() {
  const rows  = document.querySelectorAll('#mapping-rows tr');
  const mapping = {
    x: null, y: null, hbin: null, sbin: null, wafer: null, lot: null,
    testname: null, testvalue: null,
    tests: [], meta: [], splitBy: [],
  };
  const testNumbers = {};
  let nextTestNum = 1001;

  for (const tr of rows) {
    const col = tr.dataset.col;
    const sel = tr.querySelector('select');
    const role = sel.value;
    if (!role) continue;

    if (role === 'test') {
      const nameInput = tr.querySelector('input[type="text"]');
      const name = (nameInput?.value.trim() || col);
      if (!testNumbers[col]) testNumbers[col] = nextTestNum++;
      mapping.tests.push({ col, name, testNumber: testNumbers[col] });
    } else if (role === 'metadata') {
      mapping.meta.push(col);
      const splitCheck = tr.querySelector('input[type="checkbox"]');
      if (splitCheck?.checked) mapping.splitBy.push(col);
    } else if (role === 'testname' || role === 'testvalue') {
      mapping[role] = col;
    } else {
      mapping[role] = col;
    }
  }

  return mapping;
}

export function parsePassBins() {
  const raw = document.getElementById('pass-bin-input').value;
  const bins = raw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
  return bins.length ? bins : [1];
}

// ── Utility ────────────────────────────────────────────────────────────────

export function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Wire up all event listeners ────────────────────────────────────────────
// Called by 00-showcase.html after defining renderGallery.

export function initShowcase(renderGallery) {
  const dropZone  = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  document.getElementById('btn-browse').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });

  document.getElementById('btn-demo').addEventListener('click', async () => {
    showUploadError('');
    const resp = await fetch('../data/dummy-fulldata.csv');
    const text = await resp.text();
    processText(text, 'dummy-fulldata.csv');
  });

  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', ()  => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  document.getElementById('btn-back-upload').addEventListener('click', () => {
    showPhase('phase-upload');
  });

  document.getElementById('btn-render').addEventListener('click', () => {
    renderGallery();
  });

  document.getElementById('btn-back-mapping').addEventListener('click', () => {
    if (galleryCtrl) { galleryCtrl.destroy(); galleryCtrl = null; }
    const c = document.getElementById('gallery-container');
    c.innerHTML = '';
    c.style.display = '';
    const l = document.getElementById('maps-loading');
    if (l) l.style.display = 'none';
    showPhase('phase-mapping');
  });

  const helpPopout  = document.getElementById('help-popout');
  const helpOverlay = document.getElementById('help-overlay');
  document.getElementById('btn-help').addEventListener('click', () => {
    helpPopout.classList.add('open');
    helpOverlay.classList.add('open');
  });
  const closeHelp = () => {
    helpPopout.classList.remove('open');
    helpOverlay.classList.remove('open');
  };
  document.getElementById('help-close').addEventListener('click', closeHelp);
  helpOverlay.addEventListener('click', closeHelp);

  // Long-format confirmation modal
  const modal        = document.getElementById('longfmt-modal');
  const modalOverlay = document.getElementById('longfmt-overlay');
  const closeModal   = () => { modal.classList.remove('open'); modalOverlay.classList.remove('open'); };
  document.getElementById('longfmt-cancel').addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', closeModal);
  document.getElementById('longfmt-confirm').addEventListener('click', () => {
    closeModal();
    renderGallery(true); // pass flag indicating long format confirmed
  });
}

/**
 * Show the long-format confirmation modal.
 * info = { nameCol, valueCol, uniqueNames, dieCount, rowCount }
 * Returns a Promise that resolves true (confirmed) or false (cancelled).
 */
export function showLongFormatModal(info) {
  return new Promise(resolve => {
    const modal   = document.getElementById('longfmt-modal');
    const overlay = document.getElementById('longfmt-overlay');

    document.getElementById('longfmt-body').innerHTML =
      `<p>This looks like <strong>long format</strong> data — multiple rows per die, one row per test result.</p>
       <ul>
         <li><strong>${info.dieCount.toLocaleString()}</strong> unique die positions</li>
         <li><strong>${info.rowCount.toLocaleString()}</strong> total rows
             (≈ ${Math.round(info.rowCount / info.dieCount)} rows per die)</li>
         <li><strong>${info.uniqueNames.length}</strong> unique test name${info.uniqueNames.length !== 1 ? 's' : ''}:
             ${info.uniqueNames.slice(0, 8).map(n => `<code>${escHtml(n)}</code>`).join(', ')}${info.uniqueNames.length > 8 ? ` … and ${info.uniqueNames.length - 8} more` : ''}</li>
       </ul>
       <p>Pivot to wide format before rendering?</p>`;

    const confirmBtn = document.getElementById('longfmt-confirm');
    const cancelBtn  = document.getElementById('longfmt-cancel');

    const onConfirm = () => { cleanup(); resolve(true); };
    const onCancel  = () => { cleanup(); resolve(false); };
    const onOverlay = () => { cleanup(); resolve(false); };

    function cleanup() {
      modal.classList.remove('open');
      overlay.classList.remove('open');
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlay);
    }

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlay);

    modal.classList.add('open');
    overlay.classList.add('open');
  });
}
