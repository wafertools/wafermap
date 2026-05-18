import test from 'node:test';
import assert from 'node:assert/strict';
import { fmt, fmtColorbarAxis } from '../dist/packages/renderer/fmt.js';

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
