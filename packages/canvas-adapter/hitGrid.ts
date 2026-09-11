// Sizing for toCanvas's hit-test grid — internal, not re-exported from
// canvas-adapter/index.ts (tests import it from dist directly).

/** Fewest cells the grid is ever capped at, however few dies there are. */
const HIT_GRID_MIN_CAP = 4096;

/**
 * Dimensions of the uniform grid toCanvas indexes die centres into for O(1)
 * hit-testing. Cells are nominally `cellW`×`cellH` (1.5 dies across), but the
 * grid only accelerates hit-testing, so its size must never depend on the
 * geometry being sane. A die size wrong by orders of magnitude — a misread
 * WCR record gave dies ~1e-8 mm wide against a normal die-index span — once
 * asked for more cells than an array can hold: every render threw `Invalid
 * array length`, the map never appeared, and a host waiting for it stayed busy
 * forever.
 *
 * So: a non-finite or non-positive cell size falls back to the span, and cells
 * grow until the grid holds at most max(4096, 4 × pointCount) of them. A
 * coarser grid only means a hit test inspects a few more dies; correctness is
 * unaffected, because the caller clamps every die into range.
 */
export function hitGridDims(
  spanX: number,
  spanY: number,
  cellW: number,
  cellH: number,
  pointCount: number,
): { cellW: number; cellH: number; nCols: number; nRows: number } {
  const sx = Number.isFinite(spanX) && spanX > 0 ? spanX : 0;
  const sy = Number.isFinite(spanY) && spanY > 0 ? spanY : 0;
  let w = Number.isFinite(cellW) && cellW > 0 ? cellW : Math.max(sx, 1);
  let h = Number.isFinite(cellH) && cellH > 0 ? cellH : Math.max(sy, 1);
  const cap = Math.max(HIT_GRID_MIN_CAP, pointCount * 4);
  const dims = (): [number, number] => [
    Math.max(1, Math.ceil(sx / w) + 1),
    Math.max(1, Math.ceil(sy / h) + 1),
  ];
  let [nCols, nRows] = dims();
  if (nCols * nRows > cap) {
    const k = Math.sqrt((nCols * nRows) / cap);
    w *= k;
    h *= k;
    [nCols, nRows] = dims();
    // The ceil(+1) per axis can still land just over the cap.
    while (nCols * nRows > cap) {
      w *= 1.1;
      h *= 1.1;
      [nCols, nRows] = dims();
    }
  }
  return { cellW: w, cellH: h, nCols, nRows };
}
