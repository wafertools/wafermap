import { buildWaferMap } from 'wafermap';
import { renderWaferMap } from 'wafermap/canvas-adapter';
import './style.css';

const waferMeta = {
  lot: 'LOT-VITE',
  waferNumber: 12,
  testDate: '2026-04-21',
  testProgram: 'E2E-VITE',
  temperature: 25,
};

document.querySelector('#app').innerHTML = `
  <main class="shell">
    <section class="hero">
      <span class="eyebrow">Bundler Setup</span>
      <h1>wafermap + Vite</h1>
      <p>
        Consumes <code>wafermap</code> as a local npm package via Vite.
        The starting point for any bundler-based project (React, Vue, Svelte…).
      </p>
    </section>

    <section class="layout">
      <div class="card chart-card">
        <canvas id="map"></canvas>
      </div>
      <aside class="card meta-card">
        <h2>Wafer Metadata</h2>
        <div id="meta"></div>
      </aside>
    </section>
  </main>
`;

// ── Synthetic wafer data ──────────────────────────────────────────────────────
// x,y are die grid positions (prober step coordinates); die size and wafer
// diameter are passed to buildWaferMap — no mm conversion needed.

const rawData = [];
for (let y = -15; y <= 15; y++) {
  for (let x = -15; x <= 15; x++) {
    if (Math.sqrt(x * x + y * y) > 15) continue;
    const r     = Math.sqrt(x * x + y * y);
    const v     = Math.max(0.05, 0.97 - r * 0.055 + Math.sin(x * 0.8 + y * 0.5) * 0.03);
    const bin   = v >= 0.75 ? 1 : v >= 0.5 ? 2 : 3;
    rawData.push({
      x, y,
      testValues: { 1010: v, 1020: Math.max(0.05, v - 0.08), 1030: Math.max(0.05, v - 0.14) },
      hbin:       bin,
    });
  }
}

const { wafer, dies } = buildWaferMap({
  results: rawData,
  waferConfig: {
    diameter: 300,
    notch: { type: 'bottom' },
    metadata: waferMeta,
  },
  dieConfig: { width: 10, height: 10 },
});

renderWaferMap(document.getElementById('map'), wafer, dies, {
  sceneOptions: { plotMode: 'value', showRingBoundaries: true },
});

document.querySelector('#meta').innerHTML = Object.entries(waferMeta).map(([key, val]) => `
  <div class="meta-row">
    <span>${formatKey(key)}</span>
    <strong>${val}</strong>
  </div>
`).join('');

function formatKey(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
}
