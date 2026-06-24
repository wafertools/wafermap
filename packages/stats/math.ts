// Shared statistical math primitives. Single home for functions that were
// previously duplicated across analyzeWaferMap.ts and clusterDetection.ts.

/**
 * Abramowitz & Stegun 7.1.26 rational approximation of the error function.
 * Max absolute error ~1.5e-7 — ample for p-value gating.
 */
export function errorFunction(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

/** Standard normal cumulative distribution function Φ(value). */
export function normalCdf(value: number): number {
  return 0.5 * (1 + errorFunction(value / Math.sqrt(2)));
}
