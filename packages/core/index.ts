export * from './aggregates.js';
export * from './classify.js';
export * from './dies.js';
export * from './metadata.js';
export * from './probe.js';
export * from './reticle.js';
export type { DataRow, MapOptions, TransformOptions, Affine, CoordFrame } from './transforms.js';
export { isInsideWafer, clipDiesToWafer, applyOrientation, transformDies, mapDataToDies } from './transforms.js';
// Affine display-transform primitives. Public because `View.gridToScreen` exposes a
// matrix, and a custom toCanvas pipeline placing its own overlays needs these to use
// it — that is precisely the case where hand-rolled rotate/flip maths goes wrong.
export {
  affineIdentity, affineRotation, affineMirror, affineCompose,
  affineInvert, affinePoint, affineVector, affineSwapsAxes,
} from './transforms.js';
export * from './wafer.js';
