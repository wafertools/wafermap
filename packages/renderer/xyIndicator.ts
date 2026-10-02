import { affineVector, type Affine } from '../core/transforms.js';
import type { ViewOverlay, ViewText } from './buildView.js';

interface Point { x: number; y: number }

/**
 * The +X/+Y axis arrows, in display space. The ONE place their direction, colours and labels
 * are decided, for the wafer view and the compact view alike; the two differ only in where the
 * arrows sit, which each supplies through `anchorAt`.
 *
 * The arrows name the DIE-GRID axes (+X = increasing `die.x`), so they take `gridToScreen`,
 * including the data-axis flip: a transform that omitted it made the arrows point opposite to
 * the way the die indices run, contradicting the axis tick labels on the same map. As
 * directions rather than positions they go through `affineVector`, which ignores translation.
 *
 * `anchorAt` is given the signs of the corner the arrows point AWAY from, so they extend into
 * the space beside that corner and never clip; the anchor itself is never transformed, so it
 * stays in its corner whatever the rotation or flip.
 */
export function buildXYIndicator(
  gridToScreen: Affine<'grid', 'screen'>,
  len: number,
  anchorAt: (signX: 1 | -1, signY: 1 | -1) => Point,
  texts: ViewText[],
): { overlays: ViewOverlay[]; signX: 1 | -1; signY: 1 | -1 } {
  const xDir = affineVector(gridToScreen, len, 0);
  const yDir = affineVector(gridToScreen, 0, len);
  const signX: 1 | -1 = (xDir.x + yDir.x) >= 0 ? -1 : 1;
  const signY: 1 | -1 = (xDir.y + yDir.y) >= 0 ? -1 : 1;
  const anchor = anchorAt(signX, signY);
  const xTip = { x: anchor.x + xDir.x, y: anchor.y + xDir.y };
  const yTip = { x: anchor.x + yDir.x, y: anchor.y + yDir.y };

  texts.push(
    { x: xTip.x + xDir.x * 0.35, y: xTip.y + xDir.y * 0.35, text: '+X', fontSize: 10, color: '#cc3300', align: 'center', role: 'indicator' },
    { x: yTip.x + yDir.x * 0.35, y: yTip.y + yDir.y * 0.35, text: '+Y', fontSize: 10, color: '#0044cc', align: 'center', role: 'indicator' },
  );

  return {
    overlays: [
      { kind: 'xy-indicator', points: [[anchor, xTip]], closed: false, lineColor: '#cc3300', lineWidth: 2 },
      { kind: 'xy-indicator', points: [[anchor, yTip]], closed: false, lineColor: '#0044cc', lineWidth: 2 },
    ],
    signX,
    signY,
  };
}
