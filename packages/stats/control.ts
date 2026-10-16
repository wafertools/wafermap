// Individuals (I) control chart: one value per wafer, in order, judged against limits set by the process's own
// short-term variation, and the Western Electric rules that say a run of points is not random.
//
// σ is the average moving range (the difference between each value and the one before it) divided by d2 = 1.128, the
// standard I-chart estimate: it measures point-to-point noise, so a slow drift does not widen the limits it is judged
// against, as the plain standard deviation of the points would. The centre and σ come from the baseline (the first
// `baseline` points, or all of them), and every point is judged against them.
//
// The rules, each flagged at the point that completes it:
//   1  one point beyond 3σ from the centre;
//   2  two of three in a row beyond 2σ, on the same side;
//   3  four of five in a row beyond 1σ, on the same side;
//   4  eight in a row on the same side of the centre.
//
// Pure, no DOM.

/** d2 for subgroups of two: the expected range of two normal values in standard deviations. */
export const MR_D2 = 1.128;

export interface ControlLimits {
  centre: number;
  /** σ from the average moving range of the baseline. */
  sigma: number;
  ucl: number;
  lcl: number;
  /** Points the centre and σ were set from. */
  baseline: number;
}

export interface ControlViolation { index: number; rules: number[] }

export const CONTROL_RULE_TEXT: Readonly<Record<number, string>> = {
  1: 'beyond 3σ',
  2: '2 of 3 beyond 2σ on one side',
  3: '4 of 5 beyond 1σ on one side',
  4: '8 in a row on one side',
};

/** The centre and ±3σ limits of `values` from its first `baseline` points (all when absent); undefined below three points. */
export function individualsLimits(values: readonly number[], baseline?: number): ControlLimits | undefined {
  const base = values.slice(0, baseline && baseline >= 3 ? baseline : values.length).filter(Number.isFinite);
  if (base.length < 3) return undefined;
  const centre = base.reduce((a, b) => a + b, 0) / base.length;
  let mr = 0;
  for (let i = 1; i < base.length; i++) mr += Math.abs(base[i] - base[i - 1]);
  const sigma = mr / (base.length - 1) / MR_D2;
  return { centre, sigma, ucl: centre + 3 * sigma, lcl: centre - 3 * sigma, baseline: base.length };
}

/** The points of `values` that complete a Western Electric rule against `lim`, each with the rules it completes. */
export function westernElectric(values: readonly number[], lim: ControlLimits): ControlViolation[] {
  const { centre: c, sigma: s } = lim;
  const out: ControlViolation[] = [];
  if (!(s > 0)) return out;
  const z = values.map(v => (v - c) / s);
  const side = (k: number) => Math.sign(z[k]);
  const beyondSameSide = (end: number, len: number, need: number, at: number): boolean => {
    if (end - len + 1 < 0) return false;
    for (const sgn of [1, -1]) {
      let k = 0;
      for (let i = end - len + 1; i <= end; i++) if (Number.isFinite(z[i]) && sgn * z[i] > at) k++;
      // The point completing the run must itself be one of the points beyond.
      if (k >= need && sgn * z[end] > at) return true;
    }
    return false;
  };
  for (let i = 0; i < z.length; i++) {
    if (!Number.isFinite(z[i])) continue;
    const rules: number[] = [];
    if (Math.abs(z[i]) > 3) rules.push(1);
    if (beyondSameSide(i, 3, 2, 2)) rules.push(2);
    if (beyondSameSide(i, 5, 4, 1)) rules.push(3);
    if (i >= 7) {
      const sg = side(i);
      let run = sg !== 0;
      for (let k = i - 7; k <= i && run; k++) if (!Number.isFinite(z[k]) || side(k) !== sg) run = false;
      if (run) rules.push(4);
    }
    if (rules.length) out.push({ index: i, rules });
  }
  return out;
}
