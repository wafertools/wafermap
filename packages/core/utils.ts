/**
 * Return the most-frequent (mode) value from an array of numbers.
 * For pitch estimation, values should be pre-rounded to absorb noise.
 */
export function modeOf(values: number[]): number | null {
  if (!values.length) return null;
  const counts = new Map<number, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let maxCount = 0;
  let result = values[0];
  for (const [v, count] of counts) {
    if (count > maxCount) { maxCount = count; result = v; }
  }
  return result;
}