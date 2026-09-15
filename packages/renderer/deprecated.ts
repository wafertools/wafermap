// Exports deprecated in 0.30.0 and removed in 0.31.0 — TODO.md lists the removal.
//
// They live here, re-exported by index.ts, rather than in index.ts itself, so the
// declaration carrying each `@deprecated` tag is its own module: an editor strikes
// the name through wherever a host imports it from, and scripts/check-clones.mjs
// can skip this file. A column of deliberately uniform wrapper lines is repetition
// by design, not a clone to extract. Nothing in the library imports from here.

// ── Deprecated ──────────────────────────────────────────────────────────────
// The library's own imports of the defining modules never raise the notice.
import { valueToViridis as valueToViridisImpl, valueToGreyscale as valueToGreyscaleImpl } from './colorMap.js';
import { getValueColorScheme as getValueColorSchemeImpl } from './colorSchemes.js';
import { deprecated } from './deprecate.js';

/**
 * @deprecated Removed in 0.31.0. Use `resolveValueColorFn('default')`, which returns the same
 * colours through the read-path that also applies `reverseValueScheme`.
 */
export const valueToViridis = deprecated(valueToViridisImpl, 'valueToViridis',
  "Use resolveValueColorFn('default'), which returns the same colours.");

/**
 * @deprecated Removed in 0.31.0. Use `resolveValueColorFn('greyscale')`, which returns the same
 * colours through the read-path that also applies `reverseValueScheme`.
 */
export const valueToGreyscale = deprecated(valueToGreyscaleImpl, 'valueToGreyscale',
  "Use resolveValueColorFn('greyscale'), which returns the same colours.");

/**
 * @deprecated Removed in 0.31.0. Colour by value with `resolveValueColorFn(name, reversed)`, and list
 * names and labels with `listValueColorSchemes()`. `forValue` ignores
 * `reverseValueScheme`, so a surface built on it can show a reading in a
 * different colour from the map.
 */
export const getValueColorScheme = deprecated(getValueColorSchemeImpl, 'getValueColorScheme',
  'Colour by value with resolveValueColorFn(name, reversed) — forValue ignores reverseValueScheme — '
  + 'and list names and labels with listValueColorSchemes().');

// ── Deprecated in 0.30.0, removed in 0.31.0 ─────────────────────────────────
// The low-level drawing pipeline and helpers exported by accident.
// Library code imports the defining modules, so only a host call raises a notice.
import { deprecatedValue } from './deprecate.js';
import { buildView as buildViewImpl, buildHoverText as buildHoverTextImpl, buildMapTitle as buildMapTitleImpl } from './buildView.js';
import { resolveBinColors as resolveBinColorsImpl } from './binColors.js';
import { getBinColorScheme as getBinColorSchemeImpl } from './colorSchemes.js';
import { contrastTextColor as contrastTextColorImpl } from './colorMap.js';
import { dieHasTestData as dieHasTestDataImpl, isParametricTest as isParametricTestImpl, getDieTestValue as getDieTestValueImpl, STANDARD_WAFER_DIAMETERS_MM as STANDARD_WAFER_DIAMETERS_MMImpl } from './buildWaferMap.js';

const DEPRECATION_ISSUES = "If you depend on it, say so at https://github.com/wafertools/wafermap/issues.";
const ADVICE_PIPELINE = "It belongs to the low-level drawing pipeline, which is being withdrawn: build with buildWaferMap and draw with renderWaferMap or renderWaferGallery.";
const ADVICE_BIN_COLORS = "The maps resolve bin colours themselves: set a colour with BinDef.color, or register a palette with registerBinColorScheme.";
const ADVICE_INTERNAL = "It is an internal helper that was exported by accident; buildWaferMap, analyzeWaferMap and the renderers already apply it.";
const ADVICE_TEST_VALUE = "Read die.testValues[testNumber].";

/** @deprecated Removed in 0.31.0. It belongs to the low-level drawing pipeline, which is being withdrawn: build with `buildWaferMap` and draw with `renderWaferMap` or `renderWaferGallery`. */
export const buildView = deprecated(buildViewImpl, 'buildView', `${ADVICE_PIPELINE} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It belongs to the low-level drawing pipeline, which is being withdrawn: build with `buildWaferMap` and draw with `renderWaferMap` or `renderWaferGallery`. */
export const buildHoverText = deprecated(buildHoverTextImpl, 'buildHoverText', `${ADVICE_PIPELINE} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It belongs to the low-level drawing pipeline, which is being withdrawn: build with `buildWaferMap` and draw with `renderWaferMap` or `renderWaferGallery`. */
export const buildMapTitle = deprecated(buildMapTitleImpl, 'buildMapTitle', `${ADVICE_PIPELINE} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. The maps resolve bin colours themselves: set a colour with `BinDef.color`, or register a palette with `registerBinColorScheme`. */
export const resolveBinColors = deprecated(resolveBinColorsImpl, 'resolveBinColors', `${ADVICE_BIN_COLORS} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. The maps resolve bin colours themselves: set a colour with `BinDef.color`, or register a palette with `registerBinColorScheme`. */
export const getBinColorScheme = deprecated(getBinColorSchemeImpl, 'getBinColorScheme', `${ADVICE_BIN_COLORS} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It is an internal helper that was exported by accident; `buildWaferMap`, `analyzeWaferMap` and the renderers already apply it. */
export const contrastTextColor = deprecated(contrastTextColorImpl, 'contrastTextColor', `${ADVICE_INTERNAL} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It is an internal helper that was exported by accident; `buildWaferMap`, `analyzeWaferMap` and the renderers already apply it. */
export const dieHasTestData = deprecated(dieHasTestDataImpl, 'dieHasTestData', `${ADVICE_INTERNAL} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It is an internal helper that was exported by accident; `buildWaferMap`, `analyzeWaferMap` and the renderers already apply it. */
export const isParametricTest = deprecated(isParametricTestImpl, 'isParametricTest', `${ADVICE_INTERNAL} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. Read die.testValues[testNumber]. */
export const getDieTestValue = deprecated(getDieTestValueImpl, 'getDieTestValue', `${ADVICE_TEST_VALUE} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. Pass the sizes you want as buildWaferMap's `standardDiameters`; the default ladder is [100, 125, 150, 200, 300]. */
export const STANDARD_WAFER_DIAMETERS_MM = deprecatedValue(STANDARD_WAFER_DIAMETERS_MMImpl, 'STANDARD_WAFER_DIAMETERS_MM');
