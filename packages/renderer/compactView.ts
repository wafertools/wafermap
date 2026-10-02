import { compactDies, type CompactMap } from '../core/compact.js';
import { maxOf, minOf } from '../core/utils.js';
import { buildXYIndicator } from './xyIndicator.js';
import type { View, ViewOverlay, ViewRect, ViewText, ViewHoverPoint } from './buildView.js';

/**
 * Lay a built view's dies out on a compact grid.
 *
 * Only positions move. Every die keeps its colour, rectangle size, label and place in
 * `view.dies`, so legends, tallies, hit-testing and statistics, all of which read the same
 * dies, are unchanged. Compact cells are one die pitch apart, so the grid has the uniform
 * pitch hit-testing assumes; their placement goes through the linear part of
 * `view.gridToScreen`, so rotation and flips act on the compact grid exactly as they do on
 * the physical one, about the centre of the grid.
 *
 * The wafer outline, ring and quadrant boundaries and reticle grid describe the physical
 * wafer, which these positions no longer follow, so they are replaced by one outline per
 * group of dies. The notch marker is kept: `notchDir` is untouched and the wafer circle it
 * is measured from is replaced by the grid's own edge. The +X/+Y indicator names the
 * die-grid axes, not the wafer, so it stays, drawn in a margin beside the grid.
 */
// The one place a single die pitch is assumed (`view.dies[0]`'s size, one cell per index): mixed
// die geometry inside a reticle would give each column a width and each row a height instead.
export function compactView(view: View, map: CompactMap, options: { showXYIndicator?: boolean } = {}): View {
  const { placements } = compactDies(view.dies, map);
  const nC = map.columns.length;
  const nR = map.rows.length;
  if (placements.length === 0 || nC === 0 || nR === 0) return view;

  const pitchX = view.dies[0].width;
  const pitchY = view.dies[0].height;
  const centreColumn = (nC - 1) / 2;
  const centreRow = (nR - 1) / 2;
  const { a, b, c, d } = view.gridToScreen;
  const toScreen = (column: number, row: number): ViewHoverPoint => {
    const gx = (column - centreColumn) * pitchX;
    const gy = (row - centreRow) * pitchY;
    return { x: a * gx + c * gy, y: b * gx + d * gy };
  };

  // Rectangles and labels are keyed by the die centre they were built at.
  const moved = new Map<string, ViewHoverPoint>();
  const hoverPoints = view.hoverPoints.map((p, i) => {
    const to = toScreen(placements[i].column, placements[i].row);
    moved.set(`${p.x},${p.y}`, to);
    return to;
  });
  const rectangles: ViewRect[] = view.rectangles.map(r => {
    const to = moved.get(`${r.x},${r.y}`);
    return to ? { ...r, x: to.x, y: to.y } : r;
  });
  const texts: ViewText[] = [];
  for (const t of view.texts) {
    if (t.role === 'indicator') continue;
    const to = moved.get(`${t.x},${t.y}`);
    texts.push(to ? { ...t, x: to.x, y: to.y } : t);
  }

  // One outline per group, on the cell borders, so neighbouring groups share a line.
  const corner = (column: number, row: number): ViewHoverPoint => toScreen(column - 0.5, row - 0.5);
  const overlays: ViewOverlay[] = map.groups.map(g => ({
    kind: 'compact-group',
    points: [[
      corner(g.columns[0], g.rows[0]), corner(g.columns[1], g.rows[0]),
      corner(g.columns[1], g.rows[1]), corner(g.columns[0], g.rows[1]),
    ]],
    closed: true,
    lineColor: '#888888',
    lineWidth: 1,
  }));

  // The grid's extent: its four outer corners, in display space.
  const extent = [corner(0, 0), corner(nC, 0), corner(nC, nR), corner(0, nR)];
  const xs = extent.map(p => p.x);
  const ys = extent.map(p => p.y);
  const halfW = (maxOf(xs) - minOf(xs)) / 2;
  const halfH = (maxOf(ys) - minOf(ys)) / 2;
  // dieBounds is a box of die centres (toCanvas pads it by half a die), so inset by half a cell.
  const cellW = Math.abs(a) * pitchX + Math.abs(c) * pitchY;
  const cellH = Math.abs(b) * pitchX + Math.abs(d) * pitchY;
  // The +X/+Y arrows sit in a margin beside the grid, on the corner they point away from, so
  // they never cover a die (a wafer's own corner is outside its circle; a grid has no such
  // corner to spare). The margin is part of what the viewport fits.
  const margin = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  if (options.showXYIndicator) {
    const cell = Math.max(cellW, cellH);
    const gap = 2 * cell;
    const { overlays: arrows, signX, signY } = buildXYIndicator(
      view.gridToScreen, 0.15 * Math.max(halfW, halfH),
      (sx, sy) => ({ x: sx * (halfW + gap), y: sy * (halfH + gap) }),
      texts);
    overlays.push(...arrows);
    margin[signX < 0 ? 'minX' : 'maxX'] = gap + cell / 2;
    margin[signY < 0 ? 'minY' : 'maxY'] = gap + cell / 2;
  }
  const dieBounds = {
    minX: -halfW - margin.minX + cellW / 2, maxX: halfW + margin.maxX - cellW / 2,
    minY: -halfH - margin.minY + cellH / 2, maxY: halfH + margin.maxY - cellH / 2,
  };

  // The notch arrow is drawn `waferRadius` from `waferCenter` along `notchDir`: make that the
  // distance from the grid's centre to its edge in that direction.
  const n = view.notchDir;
  const reach = n
    ? Math.min(
      Math.abs(n.x) > 1e-9 ? halfW / Math.abs(n.x) : Infinity,
      Math.abs(n.y) > 1e-9 ? halfH / Math.abs(n.y) : Infinity,
    )
    : Math.max(halfW, halfH);

  return {
    ...view,
    rectangles,
    hoverPoints,
    texts,
    overlays,
    hasReticle: false,
    waferCenter: { x: 0, y: 0 },
    waferRadius: reach,
    dieBounds,
    compact: { columns: map.columns, rows: map.rows, columnBreaks: map.columnBreaks, rowBreaks: map.rowBreaks, centreColumn, centreRow },
  };
}
