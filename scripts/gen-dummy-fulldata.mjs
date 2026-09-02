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
const EDGE = 0.5;                             // keep whole dies inside the edge
const WAFERS = ['W01', 'W02', 'W03'];
const DATE = { W01: '2026-04-22', W02: '2026-04-22', W03: '2026-04-23' };

let seed = 20260901;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const gauss = (mu, sd) => mu + sd * Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());

const rows = [['lot','wafer','x','y','siteId','hbin','sbin','testdate','temp','testA','testB','testC']];
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
const dies = rows.length - 1;
console.log(`wrote docs/data/dummy-fulldata.csv — ${dies} dies across ${WAFERS.length} wafers (${dies / WAFERS.length}/wafer)`);
