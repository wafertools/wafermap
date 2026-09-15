export * from './aggregates.js';
export * from './classify.js';
export * from './dies.js';
export * from './metadata.js';
export * from './probe.js';
export * from './reticle.js';
export type { DataRow, MapOptions, TransformOptions, Affine, CoordFrame } from './transforms.js';
// Affine display-transform primitives. Public because `View.gridToScreen` exposes a
// matrix, and a custom toCanvas pipeline placing its own overlays needs these to use
// it — that is precisely the case where hand-rolled rotate/flip maths goes wrong.
export * from './wafer.js';
// The one deliberate exception to "inference/ is internal": callers doing their own
// pre-flight on prober coordinates need the same pitch derivation buildWaferMap uses,
// and re-deriving it host-side is how grid geometry silently diverges. Nothing else
// from inference/ is public.
export type { PitchResult } from './inference/pitch.js';

// Deprecated in 0.30.0, removed in 0.31.0. Each is wrapped in ./deprecated.ts, whose
// declarations carry the `@deprecated` tags; this named re-export shadows any `export *` above.
export {
  createWafer, generateDies, isPositionedDie, clipDiesToWafer,
  applyOrientation, transformDies, mapDataToDies, isInsideWafer,
  affineIdentity, affineRotation, affineMirror, affineCompose,
  affineInvert, affinePoint, affineVector, affineSwapsAxes,
  applyProbeSequence, generateReticleGrid, getReticleCell, classifyDie,
  getRingLabel, aggregateValues, aggregateBinCounts, getUniqueBins,
  metadataDisplayValue, metadataCategoricalValue, resolveGridPitch,
} from './deprecated.js';
