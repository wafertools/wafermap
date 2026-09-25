// STDF V4's legal value ranges — the one copy of each limit.
//
// Every value wmap holds must be storable in STDF V4 (PRR HARD_BIN/SOFT_BIN and
// X_COORD/Y_COORD are I*2 with 0–32767 for bins, TEST_NUM is U*4, SITE_NUM U*1),
// so a value outside these is treated as missing rather than carried.

export const STDF_BIN_MAX = 32_767;
export const STDF_COORD_MAX = 32_767;
export const STDF_TEST_NUM_MAX = 4_294_967_295;
export const STDF_SITE_MAX = 255;

export const isStdfBin = (v: number): boolean => Number.isInteger(v) && v >= 0 && v <= STDF_BIN_MAX;
export const isStdfCoord = (v: number): boolean => Number.isInteger(v) && Math.abs(v) <= STDF_COORD_MAX;
export const isStdfTestNumber = (v: number): boolean => Number.isInteger(v) && v >= 0 && v <= STDF_TEST_NUM_MAX;
export const isStdfSite = (v: number): boolean => Number.isInteger(v) && v >= 0 && v <= STDF_SITE_MAX;
