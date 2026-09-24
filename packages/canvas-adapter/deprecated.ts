// Exports deprecated in 0.30.0, to be removed in 0.31.0.
//
// They live here, re-exported by index.ts, rather than in index.ts itself, so the
// declaration carrying each `@deprecated` tag is its own module: an editor strikes
// the name through wherever a host imports it from, and scripts/check-clones.mjs
// can skip this file. A column of deliberately uniform wrapper lines is repetition
// by design, not a clone to extract. Nothing in the library imports from here.

// ── Deprecated in 0.30.0, removed in 0.31.0 ─────────────────────────────────
// The low-level drawing entry and helpers exported by accident.
// Library code imports the defining modules, so only a host call raises a notice.
import { deprecated } from '../renderer/deprecate.js';
import { toCanvas as toCanvasImpl } from './toCanvas.js';
import { buildDieListSection as buildDieListSectionImpl } from './dieList.js';

const DEPRECATION_ISSUES = "If you depend on it, say so at https://github.com/wafertools/wafermap/issues.";
const ADVICE_PIPELINE = "It belongs to the low-level drawing pipeline, which is being withdrawn: build with buildWaferMap and draw with renderWaferMap or renderWaferGallery.";
const ADVICE_DIE_LIST = "renderWaferMap and renderWaferGallery show the die list themselves (the dieList option).";

/** @deprecated Removed in 0.31.0. It belongs to the low-level drawing pipeline, which is being withdrawn: build with `buildWaferMap` and draw with `renderWaferMap` or `renderWaferGallery`. */
export const toCanvas = deprecated(toCanvasImpl, 'toCanvas', `${ADVICE_PIPELINE} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. `renderWaferMap` and `renderWaferGallery` show the die list themselves (the `dieList` option). */
export const buildDieListSection = deprecated(buildDieListSectionImpl, 'buildDieListSection', `${ADVICE_DIE_LIST} ${DEPRECATION_ISSUES}`);
