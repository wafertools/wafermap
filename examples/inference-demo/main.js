import { buildWaferMap } from 'wafermap';
import { renderWaferMap } from 'wafermap/canvas-adapter';

async function loadCsv(path) {
  const text = await (await fetch(path)).text();
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const cols = header.split(',');
  return lines.filter(Boolean).map(line => {
    const vals = line.split(',');
    return Object.fromEntries(cols.map((c, i) => [c, vals[i]]));
  });
}

// ── Render a single panel ─────────────────────────────────────────────────────

function renderPanel(canvasId, bodyId, result, provided) {
  const { wafer, dies, inference, units } = result;

  renderWaferMap(document.getElementById(canvasId), wafer, dies, {
    sceneOptions: { plotMode: 'value', showRingBoundaries: true },
  });

  const dieW  = dies[0]?.width  ?? '—';
  const dieH  = dies[0]?.height ?? '—';
  const total = dies.length;
  const withData = dies.filter(d => d.testValues && Object.keys(d.testValues).length > 0).length;

  const unitsBadge = units === 'mm'
    ? '<span class="tag tag-provided">mm</span>'
    : '<span class="tag tag-inferred">normalized</span>';

  const tag = field => provided.has(field)
    ? '<span class="tag tag-provided">given</span>'
    : '<span class="tag tag-inferred">inferred</span>';

  const confBar = (conf, label) => `
    <div class="conf-bar-wrap">
      <div class="conf-bar">
        <div class="conf-bar-fill" style="width:${(conf * 100).toFixed(0)}%;background:${confColor(conf)}"></div>
      </div>
      <span class="conf-label">${(conf * 100).toFixed(0)}% · ${label}</span>
    </div>`;

  const inputCode = buildInputCode(provided, dieW, dieH, wafer.diameter);

  document.getElementById(bodyId).innerHTML = `
    <div>
      <div class="section-label">Call</div>
      <code style="font-size:10px;font-family:monospace;word-break:break-all;line-height:1.5;display:block;background:#f6f6f6;padding:6px 8px;border-radius:5px;">${inputCode}</code>
    </div>

    <hr class="divider" />

    <div>
      <div class="section-label">Resolved geometry</div>
      <table class="kv-table">
        <tr><td>Units</td><td>${unitsBadge}</td></tr>
        <tr><td>Diameter</td><td>${wafer.diameter.toFixed(units === 'mm' ? 0 : 1)} ${units === 'mm' ? 'mm' : 'u'} &nbsp;${tag('diameter')}</td></tr>
        <tr><td>Die size</td><td>${typeof dieW === 'number' ? dieW.toFixed(2) : dieW} × ${typeof dieH === 'number' ? dieH.toFixed(2) : dieH} ${units === 'mm' ? 'mm' : 'u'} &nbsp;${tag('die')}</td></tr>
        <tr><td>Total dies</td><td>${total}</td></tr>
        <tr><td>Dies with data</td><td>${withData} / ${total}</td></tr>
      </table>
    </div>

    <hr class="divider" />

    <div>
      <div class="section-label">Inference confidence</div>
      ${!provided.has('diameter') ? confBar(inference.wafer.confidence,
          `wafer · ${inference.wafer.method}`) : '<span style="font-size:11px;color:#888">diameter provided — skipped</span>'}
      ${!provided.has('die') ? confBar(inference.diePitch.confidence, `die pitch · ${inference.diePitch.units}`) : ''}
      ${provided.has('diameter') && provided.has('die') ? '<span style="font-size:11px;color:#2a8c4a">All geometry provided — no inference needed</span>' : ''}
    </div>
  `;
}

function confColor(c) {
  if (c >= 0.85) return '#2a8c4a';
  if (c >= 0.60) return '#e6a817';
  return '#c0392b';
}

function buildInputCode(provided, dieW, dieH, diameter) {
  if (provided.size === 0) return 'buildWaferMap(data)';
  const parts = ['results: data'];
  if (provided.has('die'))      parts.push(`dieConfig: { width: ${dieW}, height: ${dieH} }`);
  if (provided.has('diameter')) parts.push(`waferConfig: { diameter: ${diameter} }`);
  return `buildWaferMap({\n  ${parts.join(',\n  ')}\n})`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const rows = await loadCsv('../../data/inference-demo.csv');

  // x,y are prober step positions (integers), value is the test result.
  const data = rows.map(r => ({ x: Number(r.x), y: Number(r.y), testValues: { 1010: Number(r.value) } }));

  document.getElementById('data-summary').textContent =
    `${data.length} points · columns: x (grid), y (grid), value · no geometry context`;

  // Level 1: grid positions only — all geometry inferred, normalized units.
  const r1 = buildWaferMap(data);
  renderPanel('chart-1', 'body-1', r1, new Set());

  // Level 2: die size provided — mm coordinates, infer wafer diameter.
  const r2 = buildWaferMap({ results: data, dieConfig: { width: 10, height: 10 } });
  renderPanel('chart-2', 'body-2', r2, new Set(['die']));

  // Level 3: wafer diameter provided — mm coordinates, infer die size.
  const r3 = buildWaferMap({ results: data, waferConfig: { diameter: 300 } });
  renderPanel('chart-3', 'body-3', r3, new Set(['diameter']));

  // Level 4: fully specified — no inference needed.
  const r4 = buildWaferMap({
    results:     data,
    waferConfig: { diameter: 300 },
    dieConfig:   { width: 10, height: 10 },
  });
  renderPanel('chart-4', 'body-4', r4, new Set(['diameter', 'die']));
}

main().catch(err => {
  console.error(err);
  document.body.innerHTML += `<pre style="color:red">${err.stack}</pre>`;
});
