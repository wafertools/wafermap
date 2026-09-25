// Regenerates docs/data/dummy-fulldata.csv — the fixture behind
// docs/examples/csv-data.html.
//
// It must be a REAL circular wafer map. The previous fixture was a 25 x 17
// rectangle, which looked round only because the demo supplied a diameter and
// no die pitch: wmap then inferred a non-square pitch (300/25 across, 300/17
// down) that stretched the grid to fill the circle. Once the demo declared the
// true 10 x 10 mm pitch, the data's real shape showed through as an ellipse.
// Geometry here is therefore derived from the same numbers the demo declares:
// a 300 mm wafer at a 10 mm pitch is 15 die radii.
//
// Deterministic (seeded) so re-running produces an identical file.
import { writeFileSync } from 'node:fs';

const DIAMETER_MM = 300, DIE_MM = 10;
const R = DIAMETER_MM / DIE_MM / 2;          // 15 dies
// Half the die DIAGONAL, not half its width. The clip below tests a die's
// CENTRE against the wafer radius, but the part of a die that leaves the wafer
// first is its outer CORNER — √2/2 of a die away from the centre at 45°, not
// 0.5. With 0.5 here, eight dies had a corner outside the 300 mm edge (worst:
// grid (-12,-8), corner at 151.2 mm against a 150 mm radius) and wmap correctly
// raised `geometry-conflict` on the demo's own shipped fixture.
const EDGE = Math.SQRT1_2;                    // keep whole dies inside the edge
const WAFERS = ['W01', 'W02', 'W03'];
const DATE = { W01: '2026-04-22', W02: '2026-04-22', W03: '2026-04-23' };

let seed = 20260901;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const gauss = (mu, sd) => mu + sd * Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());

const rows = [['lot','wafer','x','y','probeSeq','hbin','sbin','testdate','temp','testA','testB','testC']];
for (const wafer of WAFERS) {
  let site = 0;
  for (let y = -Math.ceil(R); y <= Math.ceil(R); y++) {
    for (let x = -Math.ceil(R); x <= Math.ceil(R); x++) {
      // Die centre inside the wafer, whole die within the edge.
      if (Math.hypot(x, y) > R - EDGE) continue;
      const edgeness = Math.hypot(x, y) / R;            // 0 centre .. 1 edge
      // Realistic yield loss: mostly clean, worse towards the edge.
      const r = rnd();
      let hbin = 1, sbin = 10;
      if (r < 0.02 + 0.18 * edgeness ** 3)      { hbin = 2; sbin = 20; }   // edge ring
      else if (r < 0.05 + 0.20 * edgeness ** 3) { hbin = 3; sbin = 40; }
      else if (r < 0.07 + 0.21 * edgeness ** 3) { hbin = 4; sbin = 45; }
      rows.push([
        'LOT123', wafer, x, y, site++, hbin, sbin, DATE[wafer], 25,
        gauss(1.05, 0.10).toFixed(3),
        gauss(0.49, 0.02).toFixed(3),
        gauss(55, 12).toFixed(3),
      ]);
    }
  }
}
writeFileSync('docs/data/dummy-fulldata.csv', rows.map(r => r.join(',')).join('\n') + '\n');

// Geometry + definitions sidecar. The CSV carries step indices only, so without
// this a demo loading it built a dimensionless map — an inferred "29.83 across"
// wafer with 1×1 dies — even though this file is generated from an exact
// 300 mm / 10 mm grid. See writeMeta in gen-showcase-csvs.mjs for the full note.
//
// Limits are set against the distributions above (testA ~N(1.05, 0.10),
// testB ~N(0.49, 0.02), testC ~N(55, 12)) at roughly ±2.5σ, so a small,
// realistic fraction of dies falls out of spec on each test rather than none or
// half — which is what makes spec-limit colouring and the pass-rate pareto worth
// looking at.
writeFileSync('docs/data/dummy-fulldata.meta.json', JSON.stringify({
  waferConfig: {
    diameter: 300,
    notch: { type: 'bottom' },
    metadata: { lot: 'LOT123', product: 'DEMO-LOGIC' },
  },
  dieConfig: { width: 10, height: 10 },
  passBins: [1],
  hbinDefs: [
    { bin: 1, name: 'Pass' },
    { bin: 2, name: 'Edge Ring' },
    { bin: 3, name: 'Vth Shift' },
    { bin: 4, name: 'Leakage' },
  ],
  sbinDefs: [
    { bin: 10, name: 'Pass' },
    { bin: 20, name: 'Edge Ring' },
    { bin: 40, name: 'Vth - Hi' },
    { bin: 45, name: 'Leakage - Gate' },
  ],
  // testNumber mirrors the CSV column index, which is how a positional loader
  // keys testValues.
  testDefs: [
    { testNumber: 9,  name: 'testA', unit: 'A', limitLow: 0.80, limitHigh: 1.30 },
    { testNumber: 10, name: 'testB', unit: 'V', limitLow: 0.44, limitHigh: 0.54 },
    { testNumber: 11, name: 'testC', unit: 'Hz', limitLow: 25, limitHigh: 85 },
  ],
}, null, 2) + '\n');
const dies = rows.length - 1;
console.log(`wrote docs/data/dummy-fulldata.csv — ${dies} dies across ${WAFERS.length} wafers (${dies / WAFERS.length}/wafer)`);
