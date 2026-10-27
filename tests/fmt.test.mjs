import test from 'node:test';
import assert from 'node:assert/strict';
import { fmt, fmtColorbarAxis, fmtExact, nameStatesUnit } from '../dist/packages/renderer/fmt.js';
import { makeAxisFormat } from '../dist/packages/canvas-adapter/charts/chartShell.js';

test('fmt — non-finite values', () => {
  assert.equal(fmt(Infinity), 'Infinity');
  assert.equal(fmt(-Infinity), '-Infinity');
  assert.equal(fmt(NaN), 'NaN');
});

test('fmt — zero', () => {
  assert.equal(fmt(0), '0');
  assert.equal(fmt(0, 'V'), '0 V');
});

test('fmt — SI prefix with unit', () => {
  assert.equal(fmt(0.001, 'A'), '1.00 mA');
  assert.equal(fmt(1e-6, 'V'), '1.00 µV');
  assert.equal(fmt(1500, 'Hz'), '1.50 kHz');
});

test('fmt — normal range without unit', () => {
  assert.equal(fmt(0.1), '0.100');
  assert.equal(fmt(5), '5.000');
  assert.equal(fmt(50), '50.00');
  assert.equal(fmt(500), '500.0');
  assert.equal(fmt(1234), '1234');
});

test('fmt — engineering notation for out-of-range values', () => {
  assert.match(fmt(1e6), /E\+6/);
  assert.match(fmt(1e-6), /E-6/);
});

test('fmt — SI fallback format', () => {
  assert.match(fmt(1e-6, undefined, 'si'), /µ/);
});

test('fmt — negative values', () => {
  assert.equal(fmt(-5), '-5.000');
  assert.equal(fmt(-1e-3, 'A'), '-1.00 mA');
});

// ── fmtColorbarAxis with unit ─────────────────────────────────────────────────

test('fmtColorbarAxis — milli prefix for 1mA', () => {
  const { tickFmt, axisLabel } = fmtColorbarAxis(0.001, 'Idsat', 'A');
  assert.equal(axisLabel, 'Idsat (mA)');
  assert.equal(tickFmt(0.001), '1.00');
  assert.equal(tickFmt(0.002), '2.00');
});

test('fmtColorbarAxis — nano prefix for 1nA', () => {
  const { tickFmt, axisLabel } = fmtColorbarAxis(1e-9, 'Ioff', 'A');
  assert.equal(axisLabel, 'Ioff (nA)');
  assert.equal(tickFmt(1e-9), '1.00');
});

test('fmtColorbarAxis — base unit for 2.5V', () => {
  const { tickFmt, axisLabel } = fmtColorbarAxis(2.5, 'Vth', 'V');
  assert.equal(axisLabel, 'Vth (V)');
  assert.equal(tickFmt(2.5), '2.50');
});

test('fmtColorbarAxis — zero vRef with unit', () => {
  const { axisLabel } = fmtColorbarAxis(0, 'X', 'V');
  assert.equal(axisLabel, 'X (V)');
});

test('fmtColorbarAxis — null name omitted from label', () => {
  const { axisLabel } = fmtColorbarAxis(0.001, null, 'A');
  assert.equal(axisLabel, 'mA');
});

test('fmtColorbarAxis — tickFmt(0) returns "0"', () => {
  const { tickFmt } = fmtColorbarAxis(1e-3, 'X', 'A');
  assert.equal(tickFmt(0), '0');
});

test('fmtColorbarAxis — tickFmt handles Infinity', () => {
  const { tickFmt } = fmtColorbarAxis(1e-3, 'X', 'A');
  assert.equal(tickFmt(Infinity), 'Infinity');
});

// ── fmtColorbarAxis no unit, normal range ─────────────────────────────────────

test('fmtColorbarAxis — no unit normal range uses name as label', () => {
  const { tickFmt, axisLabel } = fmtColorbarAxis(100, 'Gain', undefined);
  assert.equal(axisLabel, 'Gain');
  assert.equal(tickFmt(100), '100.0');
});

test('fmtColorbarAxis — null name returns empty label', () => {
  const { axisLabel } = fmtColorbarAxis(5, null, undefined);
  assert.equal(axisLabel, '');
});

test('fmtColorbarAxis — zero vRef no unit', () => {
  const { axisLabel, tickFmt } = fmtColorbarAxis(0, 'X', undefined);
  assert.equal(axisLabel, 'X');
  assert.equal(tickFmt(0), '0');
});

// ── fmtColorbarAxis no unit, SI fallback ──────────────────────────────────────

test('fmtColorbarAxis — no unit SI mode large value produces ×10E label', () => {
  const { axisLabel } = fmtColorbarAxis(1e9, 'Cap', undefined, 'si');
  assert.match(axisLabel, /Cap.*×10E/);
});

test('fmtColorbarAxis — no unit SI mode scale=1 gives bare name', () => {
  const { axisLabel } = fmtColorbarAxis(500, 'X', undefined, 'si');
  assert.equal(axisLabel, 'X');
});

// ── fmtColorbarAxis no unit, engineering fallback ─────────────────────────────

test('fmtColorbarAxis — engineering E6 label and scaled ticks', () => {
  const { tickFmt, axisLabel } = fmtColorbarAxis(1e6, 'Cgg', undefined, 'engineering');
  assert.match(axisLabel, /×10E6/);
  assert.equal(tickFmt(1e6), '1.00');
  assert.equal(tickFmt(2e6), '2.00');
});

test('fmtColorbarAxis — engineering E-15 label for tiny values', () => {
  const { axisLabel } = fmtColorbarAxis(1e-15, 'Cgg', undefined, 'engineering');
  assert.match(axisLabel, /×10E-15/);
});

test('fmtColorbarAxis — engineering no exponent suffix for normal range', () => {
  const { axisLabel } = fmtColorbarAxis(50, 'X', undefined, 'engineering');
  assert.equal(axisLabel, 'X');
});

// STDF stores limits and results as float32: 1.6 arrives as 1.600000023841858.
test('fmtExact: a float32 in its shortest exact digits, anything else as it is', () => {
  assert.equal(fmtExact(Math.fround(1.6)), '1.6');
  assert.equal(fmtExact(Math.fround(2.0087667)), '2.0087667');
  assert.equal(fmtExact(Math.fround(-1e-9)), '-1e-9');
  assert.equal(fmtExact(5), '5');
  assert.equal(fmtExact(0.1 + 0.2), String(0.1 + 0.2), 'not a float32: unchanged');
  assert.equal(fmtExact(NaN), 'NaN');
});

test('fmt — a percentage is written 83.8%: no space before the sign and never an SI prefix', () => {
  assert.equal(fmt(83.8, '%'), '83.8%');
  assert.equal(fmt(100, '%'), '100%');
  assert.equal(fmt(5.25, '%'), '5.25%');
  assert.equal(fmt(0.5, '%'), '0.50%', 'not 500 m%');
  assert.equal(fmt(0.05, '%'), '0.050%');
  assert.equal(fmt(0, '%'), '0%');
  assert.equal(fmt(-2.5, '%'), '-2.50%');
});

test('fmtColorbarAxis — a percentage axis is unprefixed and says % once', () => {
  const small = fmtColorbarAxis(0.05, 'Yield', '%');
  assert.equal(small.axisLabel, 'Yield (%)');
  assert.equal(small.scaledUnit, '%');
  assert.equal(fmtColorbarAxis(88, null, '%').axisLabel, '%');
});

test('fmtColorbarAxis — a name that states its unit keeps it, unscaled, as the whole title', () => {
  const a = fmtColorbarAxis(2100, 'fmax_MHz', 'MHz');
  assert.equal(a.axisLabel, 'fmax_MHz');
  assert.equal(a.tickFmt(2100), '2100');
  assert.equal(a.scaledUnit, 'MHz');
  assert.equal(fmtColorbarAxis(2100, 'Fmax', 'MHz').axisLabel, 'Fmax (GHz)', 'a name without the unit is still rescaled');
  assert.equal(fmtColorbarAxis(0.5, 'Vth (V)', 'V').axisLabel, 'Vth (V)');
});

test('fmtColorbarAxis — a base unit in the name with small values keeps legible ticks', () => {
  const a = fmtColorbarAxis(1.2e-6, 'Idsat_A', 'A');
  assert.equal(a.axisLabel, 'Idsat_A (×10E-6)');
  assert.equal(a.tickFmt(1.2e-6), '1.20');
  assert.equal(fmtColorbarAxis(0.5, 'Vth_V', 'V').axisLabel, 'Vth_V', 'readable values need no exponent');
});

test('nameStatesUnit — the unit must be a separate trailing token', () => {
  assert.ok(nameStatesUnit('fmax_MHz', 'MHz'));
  assert.ok(nameStatesUnit('Vth (mV)', 'mV'));
  assert.ok(!nameStatesUnit('Gain', 'V'), 'a letter inside a word is not a unit');
  assert.ok(!nameStatesUnit('fmax_MHz', 'GHz'));
  assert.ok(!nameStatesUnit('Vth', undefined));
});

test('makeAxisFormat — a name that ends in its own bracketed unit is not given that unit again', () => {
  // The title is built as `${label} (${unitLabel})`; "Vth (mV)" already says mV, so nothing follows it.
  assert.equal(makeAxisFormat(380, 'mV', undefined, 'Vth (mV)').unitLabel, '');
  assert.equal(makeAxisFormat(380, 'mV', undefined, 'vth_n_mV').unitLabel, '');
  assert.equal(makeAxisFormat(0.3, 'nA', undefined, 'Leak [nA]').unitLabel, '');
  // Only the exponent note fmtColorbarAxis adds for a very small or large base-unit value follows a name.
  assert.equal(makeAxisFormat(1e-6, 'A', undefined, 'Idsat_A').unitLabel, '×10E-6');
  assert.equal(makeAxisFormat(1e-6, 'A', undefined, 'Idsat (A)').unitLabel, '×10E-6');
  // A name that does not state its unit still gets the unit label.
  assert.equal(makeAxisFormat(380, 'mV', undefined, 'Threshold').unitLabel, 'mV');
});
