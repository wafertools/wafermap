// `describeValues` finds the quartiles by selection instead of sorting every
// value. Selection returns the same order statistics a sort would, so the
// quartiles, min and max must be EXACTLY the sorted answer — for every length
// (the interpolation neighbours differ between odd and even sizes), with
// duplicates, and for input that is already sorted, reversed or constant.
import test from 'node:test';
import assert from 'node:assert/strict';

const { describeValues, quantile, sampleVariance } = await import('../dist/packages/stats/math.js');

function bySorting(values) {
  const s = Float64Array.from(values).sort();
  let sum = 0; for (const v of s) sum += v;
  const mean = sum / s.length;
  let sq = 0; for (const v of s) sq += (v - mean) ** 2;
  return { min: s[0], max: s[s.length - 1], q1: quantile(s, 0.25), median: quantile(s, 0.5), q3: quantile(s, 0.75), mean, stddev: s.length < 2 ? 0 : Math.sqrt(sq / (s.length - 1)), count: s.length };
}

function check(values, label) {
  const want = bySorting(values);
  const got = describeValues(Float64Array.from(values));
  for (const k of ['min', 'max', 'q1', 'median', 'q3', 'count']) assert.equal(got[k], want[k], `${label}: ${k}`);
  // Summed in a different order, so equal to within rounding, not bit for bit.
  for (const k of ['mean', 'stddev']) {
    assert.ok(Math.abs(got[k] - want[k]) <= 1e-12 * Math.max(1, Math.abs(want[k])), `${label}: ${k} ${got[k]} vs ${want[k]}`);
  }
}

test('describeValues gives the sorted quartiles exactly, at every length 1..40', () => {
  let seed = 11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let n = 1; n <= 40; n++) {
    for (let rep = 0; rep < 25; rep++) {
      check(Array.from({ length: n }, () => rnd() * 10 - 5), `random n=${n}`);
      check(Array.from({ length: n }, () => Math.floor(rnd() * 3)), `3 distinct values n=${n}`);
    }
    const ascending = Array.from({ length: n }, (_, i) => i * 0.5);
    check(ascending, `ascending n=${n}`);
    check([...ascending].reverse(), `descending n=${n}`);
    check(Array.from({ length: n }, () => 7), `constant n=${n}`);
  }
});

test('describeValues on a large population matches the sort, and survives heavy duplication', () => {
  let seed = 3;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  check(Array.from({ length: 100001 }, () => rnd()), 'uniform 100k');
  check(Array.from({ length: 100000 }, () => Math.round(rnd() * 4) / 4), 'five levels 100k');
  check(Array.from({ length: 50000 }, (_, i) => (i % 2 ? 1e-9 : -1e-9) * i), 'alternating 50k');
});

test('describeValues of nothing is NaN quartiles, not a crash', () => {
  const got = describeValues(new Float64Array(0));
  assert.equal(got.count, 0);
  assert.ok(Number.isNaN(got.median) && Number.isNaN(got.q1) && Number.isNaN(got.q3));
});

test('σ is the sample σ (n−1) everywhere: pinned on a small n', () => {
  // 2, 4, 4, 4, 5, 5, 7, 9: mean 5, Σ(x−mean)² = 32 → 32/7 sample, 32/8 population.
  const v = [2, 4, 4, 4, 5, 5, 7, 9];
  assert.equal(sampleVariance(v), 32 / 7);
  assert.equal(sampleVariance(Float64Array.from(v), 5), 32 / 7);
  assert.equal(describeValues(Float64Array.from(v)).stddev, Math.sqrt(32 / 7));
  assert.equal(sampleVariance([3]), 0);
  assert.equal(describeValues(Float64Array.of(3)).stddev, 0);
});
