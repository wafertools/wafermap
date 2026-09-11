// Canonical source of the Quick Start's synthetic wafer lot.
//
// This block used to exist three times — in docs/quickstart.md's copy-paste
// example, in quickstart-live.html, and inlined again inside
// scripts/capture-definitions.mjs to produce quickstart-first-map.png. Nothing
// held them together, so editing the doc would silently leave the live page and
// the screenshot showing a different wafer than the code the reader just copied.
//
// The live page and the screenshot now IMPORT this file, so those two can no
// longer drift at all. The Markdown keeps an inline copy on purpose — that
// snippet's whole promise is "copy this into an HTML file, no bundler required",
// which a local import would break — so it is kept honest by
// scripts/check-quickstart-snippet.mjs, which compares it against the marked
// region below and can rewrite it (`--write`).
//
// Therefore: edit the snippet region here, then run
//   node scripts/check-quickstart-snippet.mjs --write
// Never edit the fenced block in docs/quickstart.md directly.

// >>> quickstart-snippet start
// x, y are integer die grid positions output by the prober — NOT millimetres.
// hbin is the hard bin: the pass/fail category assigned by the test equipment.
//
// Build a synthetic lot with ~640 dies and an edge-ring failure pattern.
// In production you would load these rows from a CSV or your test data API.
const results = [];
for (let x = -14; x <= 14; x++) {
  for (let y = -14; y <= 14; y++) {
    const r = Math.sqrt(x * x + y * y);
    if (r > 14.3) continue;                        // outside wafer boundary
    const h = ((Math.imul(x + 100, 2654435761) ^ Math.imul(y + 100, 2246822519)) >>> 0);
    const edgeFail = r > 11 && (h % 100) < 55;    // edge-ring yield loss
    results.push({ x, y, hbin: edgeFail ? 2 : 1 });
  }
}
// results is now an array of objects like:
//   { x:  0, y:  0, hbin: 1 }   // centre die — pass
//   { x:  4, y:  3, hbin: 1 }   // mid-wafer  — pass
//   { x: -14, y:  1, hbin: 2 }  // outer ring — fail
// <<< quickstart-snippet end

export { results as quickstartResults };
