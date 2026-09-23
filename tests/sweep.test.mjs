// Parametric sweep maths: the curve, its crossing, and the separation at a level.
//
// The correctness that matters here is not the arithmetic but what the numbers
// are allowed to claim:
//
//  - x is the ORDINAL position unless the caller supplies real swept values,
//    because test numbers are identifiers and interpolating along them assumes
//    an even spacing the data never asserted
//  - a test with no data keeps its place in the sequence with count 0, so the
//    curve's shape is not silently closed up
//  - a crossing is only reported where the two series share an x
//  - a multiple crossing says so, instead of reporting the first as if it were
//    the only one
//  - a level neither curve reaches is null with a reason, not 0

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSweepData } from '../dist/packages/stats/sweep.js';

const defs = (numbers, extra = {}) =>
  numbers.map(n => ({ testNumber: n, name: `T${n}`, unit: 'V', ...extra }));

/** One die per row of `rows`; each row maps testNumber → value. */
const dies = (rows) => rows.map((testValues, i) => ({ x: i, y: 0, hbin: 1, testValues }));

const RISING  = [1010, 1011, 1012];
const FALLING = [1020, 1021, 1022];

/** Two dies whose medians rise 1→3 and fall 3→1, crossing in the middle. */
const CROSSING_DIES = dies([
  { 1010: 1, 1011: 2, 1012: 3, 1020: 3, 1021: 2, 1022: 1 },
  { 1010: 1, 1011: 2, 1012: 3, 1020: 3, 1021: 2, 1022: 1 },
]);

const SPEC = {
  id: 'sweep', title: 'Power Sweep',
  series: [
    { label: 'Rising',  tests: RISING },
    { label: 'Falling', tests: FALLING },
  ],
};

test('x is the ordinal position when no swept values are supplied', () => {
  const d = buildSweepData(CROSSING_DIES, defs([...RISING, ...FALLING]), SPEC);
  assert.deepEqual(d.series[0].points.map(p => p.x), [0, 1, 2]);
  assert.deepEqual(d.series[0].points.map(p => p.testNumber), RISING);
  assert.equal(d.xLabel, 'Test');
});

test('supplied xValues become the axis and are used for interpolation', () => {
  const d = buildSweepData(CROSSING_DIES, defs([...RISING, ...FALLING]), {
    ...SPEC,
    series: [
      { label: 'Rising',  tests: RISING,  xValues: [10, 20, 30] },
      { label: 'Falling', tests: FALLING, xValues: [10, 20, 30] },
    ],
  });
  assert.deepEqual(d.series[0].points.map(p => p.x), [10, 20, 30]);
  assert.equal(d.crossing.x, 20, 'the crossing is reported in swept units, not ordinals');
  assert.equal(d.xLabel, 'Sweep value');
});

test('mismatched xValues fall back to position and say so', () => {
  const d = buildSweepData(CROSSING_DIES, defs([...RISING, ...FALLING]), {
    ...SPEC,
    series: [
      { label: 'Rising',  tests: RISING, xValues: [10, 20] },   // one short
      { label: 'Falling', tests: FALLING },
    ],
  });
  assert.deepEqual(d.series[0].points.map(p => p.x), [0, 1, 2]);
  assert.match(d.warnings[0], /2 x values for 3 tests/);
});

test('median and spread band come from the population', () => {
  const d = buildSweepData(
    dies([{ 1010: 1 }, { 1010: 5 }, { 1010: 9 }]),
    defs([1010]),
    { id: 's', title: 'S', series: [{ label: 'A', tests: [1010] }] },
  );
  const p = d.series[0].points[0];
  assert.equal(p.median, 5);
  assert.equal(p.count, 3);
  assert.ok(p.p10 < p.median && p.p90 > p.median, 'band straddles the median');
});

test('a test with no data keeps its place with count 0', () => {
  const d = buildSweepData(
    dies([{ 1010: 1, 1012: 3 }]),          // 1011 never measured
    defs([1010, 1011, 1012]),
    { id: 's', title: 'S', series: [{ label: 'A', tests: [1010, 1011, 1012] }] },
  );
  const points = d.series[0].points;
  assert.equal(points.length, 3, 'the gap stays in the sequence');
  assert.equal(points[1].count, 0);
  assert.ok(Number.isNaN(points[1].median));
  assert.deepEqual(points.map(p => p.x), [0, 1, 2], 'positions do not close up');
});

test('non-finite values are excluded from the median', () => {
  const d = buildSweepData(
    dies([{ 1010: 2 }, { 1010: NaN }, { 1010: 4 }]),
    defs([1010]),
    { id: 's', title: 'S', series: [{ label: 'A', tests: [1010] }] },
  );
  assert.equal(d.series[0].points[0].count, 2);
  assert.equal(d.series[0].points[0].median, 3);
});

test('partial and edge-excluded dies are out of the population', () => {
  const all = [
    { x: 0, y: 0, hbin: 1, testValues: { 1010: 1 } },
    { x: 1, y: 0, hbin: 1, testValues: { 1010: 99 }, partial: true },
    { x: 2, y: 0, hbin: 1, testValues: { 1010: 99 }, edgeExcluded: true },
  ];
  const d = buildSweepData(all, defs([1010]), { id: 's', title: 'S', series: [{ label: 'A', tests: [1010] }] });
  assert.equal(d.series[0].points[0].count, 1);
  assert.equal(d.dieCount, 1, 'dieCount is the denominator behind every median');
});

// ── Crossing ──────────────────────────────────────────────────────────────────

test('a rising and a falling series cross in the middle', () => {
  const d = buildSweepData(CROSSING_DIES, defs([...RISING, ...FALLING]), SPEC);
  assert.equal(d.crossing.x, 1);
  assert.equal(d.crossing.y, 2);
  assert.equal(d.crossing.multiple, false);
});

test('series that never cross report null', () => {
  const d = buildSweepData(
    dies([{ 1010: 1, 1011: 2, 1012: 3, 1020: 10, 1021: 11, 1022: 12 }]),
    defs([...RISING, ...FALLING]),
    SPEC,
  );
  assert.equal(d.crossing, null);
});

test('a multiple crossing is flagged, not reported as a single point', () => {
  // A weaves above and below B twice.
  const d = buildSweepData(
    dies([{ 1010: 0, 1011: 4, 1012: 0, 1020: 2, 1021: 2, 1022: 2 }]),
    defs([...RISING, ...FALLING]),
    SPEC,
  );
  assert.equal(d.crossing.multiple, true, 'one number cannot describe two crossings');
});

test('crossing is only measured where the two series share an x', () => {
  const d = buildSweepData(CROSSING_DIES, defs([...RISING, ...FALLING]), {
    ...SPEC,
    series: [
      { label: 'Rising',  tests: RISING,  xValues: [0, 1, 2] },
      { label: 'Falling', tests: FALLING, xValues: [10, 11, 12] },   // disjoint
    ],
  });
  assert.equal(d.crossing, null, 'two sweeps over different x have no defined crossing');
});

test('crossing can be turned off', () => {
  const d = buildSweepData(CROSSING_DIES, defs([...RISING, ...FALLING]), { ...SPEC, crossing: false });
  assert.equal(d.crossing, null);
});

// ── Separation ────────────────────────────────────────────────────────────────

test('separation is the horizontal distance between the curves at a level', () => {
  // Rising 1→3 over x 0..2, falling 3→1 over x 0..2. At y = 2 both are at x = 1.
  // At y = 2.5: rising reaches it at x = 1.5, falling at x = 0.5 → distance 1.
  const d = buildSweepData(CROSSING_DIES, defs([...RISING, ...FALLING]), {
    ...SPEC, separationAt: [2, 2.5],
  });
  assert.equal(d.separations[0].distance, 0);
  assert.equal(d.separations[1].distance, 1);
});

test('a level neither curve reaches is null with a reason, never 0', () => {
  const d = buildSweepData(CROSSING_DIES, defs([...RISING, ...FALLING]), {
    ...SPEC, separationAt: [99],
  });
  assert.equal(d.separations[0].distance, null);
  assert.equal(d.separations[0].reason, 'first-series-never-reaches');
});

// ── Spec problems are reported, never silently drawn ──────────────────────────

test('an undeclared test is reported', () => {
  const d = buildSweepData(CROSSING_DIES, defs(RISING), SPEC);
  assert.ok(d.warnings.some(w => /test 1020 is not in this program/.test(w)));
});

test('a functional test in a sweep is reported and contributes no value', () => {
  const testDefs = [...defs([1010, 1012]), { testNumber: 1011, name: 'F', testType: 'F' }];
  const d = buildSweepData(
    dies([{ 1010: 1, 1012: 3, 1011: 1 }]),
    testDefs,
    { id: 's', title: 'S', series: [{ label: 'A', tests: [1010, 1011, 1012] }] },
  );
  assert.ok(d.warnings.some(w => /test 1011 is functional/.test(w)));
  assert.equal(d.series[0].points[1].count, 0, 'a functional verdict is not a measured value');
});

test('series measuring different units are reported', () => {
  const testDefs = [
    ...defs(RISING, { unit: 'V' }),
    ...defs(FALLING, { unit: 'A' }),
  ];
  const d = buildSweepData(CROSSING_DIES, testDefs, SPEC);
  assert.ok(d.warnings.some(w => /different units \(V and A\)/.test(w)));
});

test('an empty population still produces the sequence', () => {
  const d = buildSweepData([], defs([...RISING, ...FALLING]), SPEC);
  assert.equal(d.series[0].points.length, 3);
  assert.equal(d.series[0].points[0].count, 0);
  assert.equal(d.crossing, null);
  assert.equal(d.dieCount, 0);
});

// ── The V: two monotonic curves crossing near the bottom ─────────────────────
//
// The shape a SET/RESET threshold sweep makes, and the one the crossing and
// width measurements exist for. Each LINE is monotonic — it is the PAIR that
// traces the V — which is what makes a width unambiguous: a level above the
// crossing meets each curve exactly once.

test('two curved monotonic lines crossing low report the crossing and a widening V', () => {
  // SET falls, RESET rises, both quadratic so the V has a rounded bottom.
  // set(t) = 0.2 + 2.8(1-t)²   reset(t) = 0.2 + 2.8t²   → cross at t=0.5, y=0.9
  const N = 9;
  const xs = Array.from({ length: N }, (_, i) => i);
  const setT = xs.map(i => 100 + i);
  const rstT = xs.map(i => 200 + i);
  const testDefs = [...setT, ...rstT].map(n => ({ testNumber: n, name: `T${n}`, unit: 'V' }));

  const die = { x: 0, y: 0, hbin: 1, testValues: {} };
  xs.forEach((_, i) => {
    const t = i / (N - 1);
    die.testValues[setT[i]] = 0.2 + 2.8 * (1 - t) ** 2;
    die.testValues[rstT[i]] = 0.2 + 2.8 * t ** 2;
  });

  const d = buildSweepData([die], testDefs, {
    id: 'v', title: 'SET / RESET', xLabel: 'Step',
    series: [
      { label: 'SET',   tests: setT, xValues: xs },
      { label: 'RESET', tests: rstT, xValues: xs },
    ],
    separationAt: [1.0, 2.0, 3.0],
  });

  assert.equal(d.crossing.x, 4, 'the curves cross at the middle step');
  assert.ok(Math.abs(d.crossing.y - 0.9) < 1e-9, 'and at the analytic crossing value');
  assert.equal(d.crossing.multiple, false, 'monotonic lines cross exactly once');

  const widths = d.separations.map(s => s.distance);
  assert.ok(widths.every(w => w !== null), 'every level above the crossing is measurable');
  assert.ok(
    widths[0] < widths[1] && widths[1] < widths[2],
    'the V widens as the level rises above the crossing',
  );
  assert.equal(widths[2], 8, 'at the top level the width is the whole sweep');
});
