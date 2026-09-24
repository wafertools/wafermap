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
import { parseTestReference, parseExpression } from '../dist/packages/renderer/derivedTests/parser.js';

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
  assert.equal(d.crossing, null, 'an ordinal crossing must not be reported under a physical x label');
  assert.match(d.notMeasured, /not measured/);
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

// ── Test ranges: one syntax, shared with derived-test expressions ─────────────
//
// A sweep's `tests` accepts "1010..1030", parsed by the SAME code as an
// expression's t[1010..1030]. What must hold is that the same text can never
// name different tests in the two places, and that a range can never slide
// xValues onto the wrong tests.

const EVEN = [1010, 1012, 1014, 1016, 1018, 1020];
const EVEN_ODD_OFFSET = EVEN.map(n => n + 1);   // 1011..1021, odd

test('a range expands to the declared tests only, so an even-numbered program needs no step', () => {
  const d = buildSweepData([], defs(EVEN), {
    id: 's', title: 'S',
    series: [{ label: 'A', tests: ['1010..1020'], xValues: [0, 1, 2, 3, 4, 5] }],
  });
  assert.deepEqual(d.series[0].points.map(p => p.testNumber), EVEN);
  assert.equal(d.xIsPhysical, true);
  assert.deepEqual(d.warnings, []);
});

test('ranges and numbers expand in the order written', () => {
  const d = buildSweepData([], defs([1010, 1011, 1012, 1030]), {
    id: 's', title: 'S', series: [{ label: 'A', tests: ['1010..1012', 1030] }],
  });
  assert.deepEqual(d.series[0].points.map(p => p.testNumber), [1010, 1011, 1012, 1030]);
});

test('the same range text names the same tests in a sweep and in an expression', () => {
  const testDefs = new Map(defs([...EVEN, ...EVEN_ODD_OFFSET, 1500]).map(d => [d.testNumber, d]));
  for (const text of ['1010..1020', '1011..1011', '1000..1016', '1010 .. 1500', '1020']) {
    const ref = parseTestReference(text, testDefs);
    // A single test is a scalar and a range a set that must be reduced.
    const source = text.includes('..') ? `mean(t[${text}])` : `t[${text}]`;
    const expr = parseExpression(source, { testDefs, constants: {} });
    assert.equal(ref.ok, true, text);
    assert.equal(expr.ok, true, text);
    assert.deepEqual(ref.tests, expr.reads.map(r => r.test), text);
  }
});

test('a range is rejected for the same reasons in both places', () => {
  const testDefs = new Map(defs(EVEN).map(d => [d.testNumber, d]));
  for (const [text, pattern] of [['1020..1010', /backwards/], ['2000..2010', /matches no declared test/], ['10.5', /test number/], ['1010..', /test number/], ['1010,1012', /Unexpected/]]) {
    const ref = parseTestReference(text, testDefs);
    assert.equal(ref.ok, false, text);
    assert.match(ref.message, pattern, text);
    const expr = parseExpression(`mean(t[${text}])`, { testDefs, constants: {} });
    assert.equal(expr.ok, false, `${text} must fail in an expression too`);
  }
});

test('a huge range is not a loop over every integer', () => {
  const testDefs = new Map(defs(EVEN).map(d => [d.testNumber, d]));
  const t0 = Date.now();
  const ref = parseTestReference('0..2000000000', testDefs);
  assert.ok(Date.now() - t0 < 200, 'resolved by filtering declared tests');
  assert.deepEqual(ref.tests, EVEN);
});

test('a test missing from a range cannot slide the x values onto the wrong tests', () => {
  // 1014 is not declared in this lot: the range matches 5 tests, not 6.
  const present = EVEN.filter(n => n !== 1014);
  const rows = [Object.fromEntries([...present.map((n, i) => [n, i]), ...present.map((n, i) => [n + 100, 5 - i])])];
  const d = buildSweepData(dies(rows), defs([...present, ...present.map(n => n + 100)]), {
    id: 's', title: 'S', xLabel: 'Power (dBm)',
    series: [
      { label: 'Rising',  tests: ['1010..1020'], xValues: [0, 1, 2, 3, 4, 5] },
      { label: 'Falling', tests: ['1110..1120'], xValues: [0, 1, 2, 3, 4, 5] },
    ],
    separationAt: [2],
  });
  assert.equal(d.xIsPhysical, false);
  assert.match(d.warnings[0], /"Rising": 6 x values for 5 tests — the ranges matched 1010, 1012, 1016, 1018, 1020/);
  assert.equal(d.crossing, null);
  assert.deepEqual(d.separations, []);
  assert.equal(d.xLabel, 'Test', 'the physical label is not put on an ordinal axis');
  assert.match(d.notMeasured, /not measured/);
});

test('an unreadable range entry is reported and contributes no tests', () => {
  const d = buildSweepData([], defs(EVEN), {
    id: 's', title: 'S', series: [{ label: 'A', tests: ['1010..1012', 'abc'] }],
  });
  assert.deepEqual(d.series[0].points.map(p => p.testNumber), [1010, 1012]);
  assert.match(d.warnings[0], /"A": "abc"/);
});

// ── x values read from test names (`xFromName`), `xUnit`, `xScale: 'log'` ──
//
// A program that records the swept quantity only in the test text — a CDF of
// LRS resistance, one test per threshold, named "… LRS_STATS_12K / …". The
// pattern is a placeholder template, not a regex (see stats/sweepXFromName.ts).

const { compileXNamePattern, readXFromName } = await import('../dist/packages/stats/sweepXFromName.js');

// The real test text, truncated at STDF's 255 characters as it arrives.
const PTR_NAME = 'Normalized_LRS= LRS_STATS_12K / Total_LRS= Parametric test descriptor [Test name=0x55555555_15_30000_LRSerr, Test suite name=Main.Readouts_Autoconfig_flow.Read_CDF_after_0x5, Test number=31285, Test text=Register_0x2000013c, Low limit=0.0, Low limit compa';
const read = (pattern, name) => readXFromName(compileXNamePattern(pattern), name);

test('a name pattern finds the value anywhere in the name, with its SI prefix', () => {
  assert.equal(read('LRS_STATS_{x}', PTR_NAME), 12000);
  // The prefix written into the pattern keeps the number as the name shows it.
  assert.equal(read('LRS_STATS_{x}K', PTR_NAME), 12);
  // Literal text ignores case — test text changes case between programs.
  assert.equal(read('lrs_stats_{x}', PTR_NAME), 12000);
  assert.equal(read('Normalized*STATS_{x}', PTR_NAME), 12000);
  assert.equal(read('HRS_STATS_{x}', PTR_NAME), null);
});

test('the SI prefix is case-sensitive: m is milli, M is mega; K is the one alias', () => {
  assert.equal(read('R_{x}', 'R_1M'), 1e6);
  assert.equal(read('V_{x}', 'V_10m'), 0.01);
  assert.equal(read('R_{x}', 'R_2.5k'), 2500);
  assert.equal(read('R_{x}', 'R_2.5K'), 2500);
});

test('a letter after the number is a prefix only when it stands alone or leads a unit', () => {
  // Alone, or before a unit symbol: a prefix.
  assert.equal(read('T_{x}', 'T_12K / Total'), 12000);
  assert.equal(read('T_{x}', 'T_12kohm'), 12000);
  assert.equal(read('T_{x}', 'T_10GHz'), 1e10);
  assert.equal(read('T_{x}', 'T_5us'), 5e-6);
  // A unit in capitals, as test text often is: the text has lost its case, so
  // the prefix is read in any case too — K, N, U, P are unambiguous.
  assert.equal(read('R_{x}', 'R_12KOHM'), 12000);
  assert.equal(read('T_{x}', 'T_5NS'), 5e-9);
  assert.equal(read('I_{x}', 'I_3UA'), 3e-6);
  assert.equal(read('C_{x}', 'C_2PF'), 2e-12);
  // Starting a word: not a prefix. These read 12,000, 1.2e-8, 3e-12 and 0.01.
  assert.equal(read('LRS_STATS_{x}', 'LRS_STATS_12Kangaroos'), 12);
  assert.equal(read('T_{x}', 'T_12nodes'), 12);
  assert.equal(read('T_{x}', 'T_3pass'), 3);
  assert.equal(read('T_{x}', 'T_10mins'), 10);
});

test('an M before a unit in capitals is refused, not guessed — milli or mega?', () => {
  // "2MV" in shouted test text is far more likely 2 mV than 2 MV.
  assert.deepEqual(read('V_{x}', 'V_2MV'), { ambiguous: '2MV' });
  assert.deepEqual(read('F_{x}', 'F_5MHZ'), { ambiguous: '5MHZ' });
  // Alone, M keeps its SI meaning; spelled out in the pattern it is literal text.
  assert.equal(read('R_{x}', 'R_1M'), 1e6);
  assert.equal(read('V_{x}MV', 'V_2MV'), 2);
  // The sweep reports it by name, with the way out.
  const d = buildSweepData(dies([{ 5001: 1, 5002: 2 }]),
    [{ testNumber: 5001, name: 'V_2MV' }, { testNumber: 5002, name: 'V_5MV' }],
    { id: 'm', title: 'M', series: [{ label: 'A', tests: [5001, 5002], xFromName: 'V_{x}' }] });
  assert.ok(d.warnings.some(w => /"2MV" is written in capitals, where M could be milli or mega/.test(w)), d.warnings.join(' | '));
});

test('a prefixed value is exact, not a product carrying binary rounding', () => {
  // 5 × 1e-6 is 4.9999999999999996e-6, which leaks into every label.
  assert.equal(read('T_{x}', 'T_5u'), 0.000005);
  assert.equal(read('T_{x}', 'T_12n'), 1.2e-8);
});

test('a pattern must contain {x} exactly once', () => {
  assert.ok('error' in compileXNamePattern('LRS_STATS_'));
  assert.ok('error' in compileXNamePattern('{x}_{x}'));
});

test('a hostile pattern cannot freeze the reader — its cost is bounded', () => {
  const t = Date.now();
  read('*a*a*a*a*a*a*a*a*a*a*{x}b', 'a'.repeat(255));
  assert.ok(Date.now() - t < 500, 'a regex engine would backtrack exponentially here');
});

/** Four thresholds per series, one decade apart, named the way the program names them. */
const CDF_TESTS = [2001, 2002, 2003, 2004, 2011, 2012, 2013, 2014];
const THRESHOLDS = ['1K', '10K', '100K', '1M'];
const cdfDefs = CDF_TESTS.map((n, i) => ({
  testNumber: n, unit: '', name: `Normalized_LRS= LRS_STATS_${THRESHOLDS[i % 4]} / Total_LRS= (${n < 2010 ? 'before' : 'after'})`,
}));
// Before: fraction below threshold 0.1, 0.4, 0.8, 1.0 — after: shifted up one step
// in resistance, 0.02, 0.2, 0.6, 0.95. Level 0.5 is crossed between 10K and 100K.
const CDF_DIES = dies([{ 2001: 0.1, 2002: 0.4, 2003: 0.8, 2004: 1.0, 2011: 0.02, 2012: 0.2, 2013: 0.6, 2014: 0.95 }]);
const CDF_SPEC = {
  id: 'cdf', title: 'LRS CDF', xLabel: 'LRS threshold', xUnit: 'Ω', xScale: 'log', separationAt: [0.5],
  series: [
    { label: 'Before', tests: ['2001..2004'], xFromName: 'LRS_STATS_{x}' },
    { label: 'After',  tests: ['2011..2014'], xFromName: 'LRS_STATS_{x}' },
  ],
};

test('xFromName gives a physical axis in base units, and xUnit travels with it', () => {
  const d = buildSweepData(CDF_DIES, cdfDefs, CDF_SPEC);
  assert.equal(d.xIsPhysical, true);
  assert.deepEqual(d.series[0].points.map(p => p.x), [1e3, 1e4, 1e5, 1e6]);
  assert.equal(d.xUnit, 'Ω');
  assert.equal(d.xScale, 'log');
  assert.deepEqual(d.warnings, []);
});

test('on a log axis a width is interpolated in log x and reported as a ratio', () => {
  const d = buildSweepData(CDF_DIES, cdfDefs, CDF_SPEC);
  const [w] = d.separations;
  // Before reaches 0.5 a quarter of the way from 10K (0.4) to 100K (0.8) in
  // log x: 10^4.25. After, three quarters of the way from 10K (0.2) to 100K (0.6).
  assert.ok(Math.abs(w.from - 10 ** 4.25) < 1e-6);
  assert.ok(Math.abs(w.to - 10 ** 4.75) < 1e-6);
  assert.ok(Math.abs(w.ratio - 10 ** 0.5) < 1e-9);
  // Linear interpolation would have put them at 32.5k and 77.5k instead.
  const lin = buildSweepData(CDF_DIES, cdfDefs, { ...CDF_SPEC, xScale: 'linear' }).separations[0];
  assert.equal(lin.ratio, undefined);
  assert.ok(Math.abs(lin.from - 32500) < 1e-6);
});

test('a name the pattern does not fit is reported and nothing is measured', () => {
  const broken = cdfDefs.map(d => d.testNumber === 2003 ? { ...d, name: 'LRS_TOTAL' } : d);
  const d = buildSweepData(CDF_DIES, broken, CDF_SPEC);
  assert.equal(d.xIsPhysical, false);
  assert.ok(d.notMeasured);
  assert.ok(d.warnings.some(w => /found no x value in the name of test 2003/.test(w)), d.warnings.join(' | '));
});

test('giving both xValues and xFromName is reported, not resolved by preference', () => {
  const spec = { ...CDF_SPEC, series: [{ ...CDF_SPEC.series[0], xValues: [1, 2, 3, 4] }, CDF_SPEC.series[1]] };
  const d = buildSweepData(CDF_DIES, cdfDefs, spec);
  assert.ok(d.warnings.some(w => /both xValues and xFromName/.test(w)));
  assert.ok(d.notMeasured);
});

test('a series that revisits an x value is drawn but not measured', () => {
  const dup = cdfDefs.map(d => d.testNumber === 2002 ? { ...d, name: 'LRS_STATS_1K' } : d);
  const d = buildSweepData(CDF_DIES, dup, CDF_SPEC);
  assert.equal(d.xIsPhysical, true);
  assert.match(d.notMeasured ?? '', /revisits an x value/);
  assert.equal(d.crossing, null);
  assert.deepEqual(d.separations, []);
});

test('a log axis with a non-positive x falls back to linear and says so', () => {
  const spec = { ...CDF_SPEC, series: CDF_SPEC.series.map(s => ({ label: s.label, tests: s.tests, xValues: [0, 1, 2, 3] })) };
  const d = buildSweepData(CDF_DIES, cdfDefs, spec);
  assert.equal(d.xScale, 'linear');
  assert.ok(d.warnings.some(w => /log x axis needs every x value to be positive/.test(w)));
});

test('sweepAppliesTo — true when any series names a parametric test in the defs', async () => {
  const { sweepAppliesTo } = await import('../dist/packages/stats/sweep.js');
  const spec = { id: 's', title: 'S', series: [{ label: 'A', tests: ['1200..1210'] }, { label: 'B', tests: [1300] }] };
  const P = n => ({ testNumber: n, name: `T${n}` });
  assert.equal(sweepAppliesTo(spec, [P(1205)]), true, 'a range matching one declared test');
  assert.equal(sweepAppliesTo(spec, [P(1300)]), true, 'a plain number that is declared');
  assert.equal(sweepAppliesTo(spec, [P(5), P(6)]), false, 'another program’s tests');
  assert.equal(sweepAppliesTo(spec, [{ ...P(1300), testType: 'F' }]), false, 'a functional test has nothing to sweep');
  assert.equal(sweepAppliesTo(spec, undefined), false);
});

