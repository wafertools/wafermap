// Exports deprecated in 0.30.0 and removed in 0.31.0 — TODO.md lists the removal.
//
// They live here, re-exported by index.ts, rather than in index.ts itself, so the
// declaration carrying each `@deprecated` tag is its own module: an editor strikes
// the name through wherever a host imports it from, and scripts/check-clones.mjs
// can skip this file. A column of deliberately uniform wrapper lines is repetition
// by design, not a clone to extract. Nothing in the library imports from here.

// ── Deprecated in 0.30.0, removed in 0.31.0 ─────────────────────────────────
// The low-level drawing pipeline and helpers exported by accident. core/ is otherwise
// side-effect free; this entry imports the notice helper only until 0.31.0 removes these.
// Library code imports the defining modules, so only a host call raises a notice.
import { deprecated } from '../renderer/deprecate.js';
import { createWafer as createWaferImpl } from './wafer.js';
import { generateDies as generateDiesImpl, isPositionedDie as isPositionedDieImpl } from './dies.js';
import { clipDiesToWafer as clipDiesToWaferImpl, applyOrientation as applyOrientationImpl, transformDies as transformDiesImpl, mapDataToDies as mapDataToDiesImpl, isInsideWafer as isInsideWaferImpl, affineIdentity as affineIdentityImpl, affineRotation as affineRotationImpl, affineMirror as affineMirrorImpl, affineCompose as affineComposeImpl, affineInvert as affineInvertImpl, affinePoint as affinePointImpl, affineVector as affineVectorImpl, affineSwapsAxes as affineSwapsAxesImpl } from './transforms.js';
import { applyProbeSequence as applyProbeSequenceImpl } from './probe.js';
import { generateReticleGrid as generateReticleGridImpl } from './reticle.js';
import { classifyDie as classifyDieImpl, getRingLabel as getRingLabelImpl } from './classify.js';
import { aggregateValues as aggregateValuesImpl, aggregateBinCounts as aggregateBinCountsImpl, getUniqueBins as getUniqueBinsImpl } from './aggregates.js';
import { metadataCategoricalValue as metadataCategoricalValueImpl } from './metadata.js';
import { resolveGridPitch as resolveGridPitchImpl } from './inference/pitch.js';

const DEPRECATION_ISSUES = "If you depend on it, say so at https://github.com/wafertools/wafermap/issues.";
const ADVICE_PIPELINE = "It belongs to the low-level drawing pipeline, which is being withdrawn: build with buildWaferMap and draw with renderWaferMap or renderWaferGallery.";
const ADVICE_POSITION = "Use hasPosition to test whether a die has a position.";
const ADVICE_MAP_DATA = "buildWaferMap maps results onto dies.";
const ADVICE_LOT_STACK = "Stack wafers with buildWaferMap's lotStack option.";
const ADVICE_PITCH = "buildWaferMap resolves the die pitch itself; each built die's width and height carry it.";

/** @deprecated Removed in 0.31.0. For a die layout with no test data use `buildWaferMap({ layout: true, waferConfig, dieConfig })`; otherwise build with `buildWaferMap` and draw with `renderWaferMap` or `renderWaferGallery`. */
export const createWafer = deprecated(createWaferImpl, 'createWafer', `For a die layout with no test data use buildWaferMap({ layout: true, waferConfig, dieConfig }); otherwise build with buildWaferMap and draw with renderWaferMap or renderWaferGallery. ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. For a die layout with no test data use `buildWaferMap({ layout: true, waferConfig, dieConfig })`, which keeps every site fully on the wafer. */
export const generateDies = deprecated(generateDiesImpl, 'generateDies', `For a die layout with no test data use buildWaferMap({ layout: true, waferConfig, dieConfig }), which keeps every site fully on the wafer. ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. Use `hasPosition` to test whether a die has a position. */
export const isPositionedDie = deprecated(isPositionedDieImpl, 'isPositionedDie', `${ADVICE_POSITION} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. For a die layout with no test data use `buildWaferMap({ layout: true, waferConfig, dieConfig })`, which keeps every site fully on the wafer. */
export const clipDiesToWafer = deprecated(clipDiesToWaferImpl, 'clipDiesToWafer', `For a die layout with no test data use buildWaferMap({ layout: true, waferConfig, dieConfig }), which keeps every site fully on the wafer. ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It belongs to the low-level drawing pipeline, which is being withdrawn: build with `buildWaferMap` and draw with `renderWaferMap` or `renderWaferGallery`. */
export const applyOrientation = deprecated(applyOrientationImpl, 'applyOrientation', `${ADVICE_PIPELINE} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It belongs to the low-level drawing pipeline, which is being withdrawn: build with `buildWaferMap` and draw with `renderWaferMap` or `renderWaferGallery`. */
export const transformDies = deprecated(transformDiesImpl, 'transformDies', `${ADVICE_PIPELINE} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. `buildWaferMap` maps results onto dies. */
export const mapDataToDies = deprecated(mapDataToDiesImpl, 'mapDataToDies', `${ADVICE_MAP_DATA} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It belongs to the low-level drawing pipeline, which is being withdrawn: build with `buildWaferMap` and draw with `renderWaferMap` or `renderWaferGallery`. */
export const isInsideWafer = deprecated(isInsideWaferImpl, 'isInsideWafer', `${ADVICE_PIPELINE} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It belongs to the low-level drawing pipeline, which is being withdrawn: build with `buildWaferMap` and draw with `renderWaferMap` or `renderWaferGallery`. */
export const affineIdentity = deprecated(affineIdentityImpl, 'affineIdentity', `${ADVICE_PIPELINE} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It belongs to the low-level drawing pipeline, which is being withdrawn: build with `buildWaferMap` and draw with `renderWaferMap` or `renderWaferGallery`. */
export const affineRotation = deprecated(affineRotationImpl, 'affineRotation', `${ADVICE_PIPELINE} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It belongs to the low-level drawing pipeline, which is being withdrawn: build with `buildWaferMap` and draw with `renderWaferMap` or `renderWaferGallery`. */
export const affineMirror = deprecated(affineMirrorImpl, 'affineMirror', `${ADVICE_PIPELINE} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It belongs to the low-level drawing pipeline, which is being withdrawn: build with `buildWaferMap` and draw with `renderWaferMap` or `renderWaferGallery`. */
export const affineCompose = deprecated(affineComposeImpl, 'affineCompose', `${ADVICE_PIPELINE} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It belongs to the low-level drawing pipeline, which is being withdrawn: build with `buildWaferMap` and draw with `renderWaferMap` or `renderWaferGallery`. */
export const affineInvert = deprecated(affineInvertImpl, 'affineInvert', `${ADVICE_PIPELINE} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It belongs to the low-level drawing pipeline, which is being withdrawn: build with `buildWaferMap` and draw with `renderWaferMap` or `renderWaferGallery`. */
export const affinePoint = deprecated(affinePointImpl, 'affinePoint', `${ADVICE_PIPELINE} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It belongs to the low-level drawing pipeline, which is being withdrawn: build with `buildWaferMap` and draw with `renderWaferMap` or `renderWaferGallery`. */
export const affineVector = deprecated(affineVectorImpl, 'affineVector', `${ADVICE_PIPELINE} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It belongs to the low-level drawing pipeline, which is being withdrawn: build with `buildWaferMap` and draw with `renderWaferMap` or `renderWaferGallery`. */
export const affineSwapsAxes = deprecated(affineSwapsAxesImpl, 'affineSwapsAxes', `${ADVICE_PIPELINE} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It belongs to the low-level drawing pipeline, which is being withdrawn: build with `buildWaferMap` and draw with `renderWaferMap` or `renderWaferGallery`. */
export const applyProbeSequence = deprecated(applyProbeSequenceImpl, 'applyProbeSequence', `${ADVICE_PIPELINE} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It belongs to the low-level drawing pipeline, which is being withdrawn: build with `buildWaferMap` and draw with `renderWaferMap` or `renderWaferGallery`. */
export const generateReticleGrid = deprecated(generateReticleGridImpl, 'generateReticleGrid', `${ADVICE_PIPELINE} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. A die's ring and quadrant are in the die list's CSV export (Ring and Quadrant columns); ring and quadrant yield is `stats.regionYield.` */
export const classifyDie = deprecated(classifyDieImpl, 'classifyDie', `A die's ring and quadrant are in the die list's CSV export (Ring and Quadrant columns); ring and quadrant yield is stats.regionYield. ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. Ring labels come with ring yield (`stats.regionYield.ring[].label`) and ring findings (`comparison.left`). */
export const getRingLabel = deprecated(getRingLabelImpl, 'getRingLabel', `Ring labels come with ring yield (stats.regionYield.ring[].label) and ring findings (comparison.left). ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. Stack wafers with `buildWaferMap`'s `lotStack` option. */
export const aggregateValues = deprecated(aggregateValuesImpl, 'aggregateValues', `${ADVICE_LOT_STACK} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. Stack wafers with `buildWaferMap`'s `lotStack` option. */
export const aggregateBinCounts = deprecated(aggregateBinCountsImpl, 'aggregateBinCounts', `${ADVICE_LOT_STACK} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. Stack wafers with `buildWaferMap`'s `lotStack` option. */
export const getUniqueBins = deprecated(getUniqueBinsImpl, 'getUniqueBins', `${ADVICE_LOT_STACK} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. Use `metadataDisplayValue` for a metadata value's text. */
export const metadataCategoricalValue = deprecated(metadataCategoricalValueImpl, 'metadataCategoricalValue', `Use metadataDisplayValue for a metadata value's text. ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. `buildWaferMap` resolves the die pitch itself; each built die's width and height carry it. */
export const resolveGridPitch = deprecated(resolveGridPitchImpl, 'resolveGridPitch', `${ADVICE_PITCH} ${DEPRECATION_ISSUES}`);
