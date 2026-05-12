import { describe, it } from 'node:test';
import assert from 'node:assert';
import { aggregateValues, aggregateBinCounts } from '../packages/core/aggregates.js';
import type { Die } from '../packages/core/dies.js';

describe('Core Aggregates', () => {
  // Mock dies for two wafers
  const w1: Die[] = [
    { id: '0_0', x: 0, y: 0, testValues: { 0: 10, 1010: 1.5 }, hbin: 1, sbin: 10, width: 10, height: 10, physX: 0, physY: 0 },
    { id: '1_0', x: 1, y: 0, testValues: { 0: 20, 1010: 2.5 }, hbin: 2, sbin: 20, width: 10, height: 10, physX: 10, physY: 0 }
  ];
  
  const w2: Die[] = [
    { id: '0_0', x: 0, y: 0, testValues: { 0: 30, 1010: 3.5 }, hbin: 1, sbin: 11, width: 10, height: 10, physX: 0, physY: 0 },
    { id: '1_0', x: 1, y: 0, testValues: { 0: 40, 1010: 4.5 }, hbin: 3, sbin: 20, width: 10, height: 10, physX: 10, physY: 0 }
  ];

  describe('aggregateValues', () => {
    it('should calculate mean correctly', () => {
      const res = aggregateValues([w1, w2], 'mean');
      assert.strictEqual(res.find(d => d.x === 0 && d.y === 0)?.testValues?.[0], 20); // (10+30)/2
      assert.strictEqual(res.find(d => d.x === 1 && d.y === 0)?.testValues?.[0], 30); // (20+40)/2
    });

    it('should calculate median correctly for odd and even sets', () => {
      const w3: Die[] = [
        { id: '0_0', x: 0, y: 0, testValues: { 0: 50 }, width: 10, height: 10, physX: 0, physY: 0 }
      ];
      // Even set [10, 30] -> 20
      const resEven = aggregateValues([w1, w2], 'median');
      assert.strictEqual(resEven.find(d => d.x === 0 && d.y === 0)?.testValues?.[0], 20);
      
      // Odd set [10, 30, 50] -> 30
      const resOdd = aggregateValues([w1, w2, w3], 'median');
      assert.strictEqual(resOdd.find(d => d.x === 0 && d.y === 0)?.testValues?.[0], 30);
    });

    it('should calculate stddev correctly and return 0 for N=1 (consistency check)', () => {
      // Standard sample stddev for [10, 30] is sqrt(200) ≈ 14.142
      const res = aggregateValues([w1, w2], 'stddev');
      const val = res.find(d => d.x === 0 && d.y === 0)?.testValues?.[0] ?? 0;
      assert.ok(Math.abs(val - 14.142) < 0.001);

      // Edge case: single value
      const resSingle = aggregateValues([w1], 'stddev');
      assert.strictEqual(resSingle[0].testValues?.[0], 0);
    });

    it('should support aggregating by specific paramIndex (testNumber)', () => {
      const res = aggregateValues([w1, w2], 'mean', 1010);
      assert.strictEqual(res.find(d => d.x === 0 && d.y === 0)?.testValues?.[0], 2.5); // (1.5 + 3.5)/2
    });

    it('should fall back to deprecated values[] array', () => {
      const wLegacy: Die[] = [
        { id: '0_0', x: 0, y: 0, values: [100], width: 10, height: 10, physX: 0, physY: 0 }
      ];
      const res = aggregateValues([wLegacy], 'mean');
      assert.strictEqual(res[0].testValues?.[0], 100);
    });

    it('should handle wafers with different die populations (union)', () => {
      const wSparse: Die[] = [
        { id: '9_9', x: 9, y: 9, testValues: { 0: 99 }, width: 10, height: 10, physX: 90, physY: 90 }
      ];
      const res = aggregateValues([w1, wSparse], 'count');
      // (0,0) exists in w1 but not wSparse -> count 1
      assert.strictEqual(res.find(d => d.x === 0 && d.y === 0)?.testValues?.[0], 1);
      // (9,9) exists in wSparse but not w1 -> count 1
      assert.strictEqual(res.find(d => d.x === 9 && d.y === 9)?.testValues?.[0], 1);
    });

    it('should use physical properties from the first wafer encountered (template) when dimensions differ', () => {
      const wLarge: Die[] = [
        { id: '0_0', x: 0, y: 0, testValues: { 0: 100 }, width: 50, height: 50, physX: 25, physY: 25 }
      ];
      const wSmall: Die[] = [
        { id: '0_0', x: 0, y: 0, testValues: { 0: 200 }, width: 10, height: 10, physX: 5, physY: 5 }
      ];

      const res = aggregateValues([wLarge, wSmall], 'mean');
      const die = res[0];

      assert.strictEqual(die.testValues?.[0], 150); // Aggregated value
      assert.strictEqual(die.width, 50);             // Kept wLarge width
      assert.strictEqual(die.physX, 25);             // Kept wLarge physX
    });
  });

  describe('aggregateBinCounts', () => {
    it('should count occurrences of a target hard bin', () => {
      const res = aggregateBinCounts([w1, w2], 1, 'hard');
      // (0,0) is bin 1 on both wafers
      assert.strictEqual(res.find(d => d.x === 0 && d.y === 0)?.testValues?.[0], 2);
      // (1,0) is bin 2 and bin 3
      assert.strictEqual(res.find(d => d.x === 1 && d.y === 0)?.testValues?.[0], 0);
    });

    it('should count occurrences of a target soft bin', () => {
      const res = aggregateBinCounts([w1, w2], 20, 'soft');
      // (1,0) is sbin 20 on both wafers
      assert.strictEqual(res.find(d => d.x === 1 && d.y === 0)?.testValues?.[0], 2);
      // (0,0) is sbin 10 and 11
      assert.strictEqual(res.find(d => d.x === 0 && d.y === 0)?.testValues?.[0], 0);
    });

    it('should use the first wafer as the spatial template', () => {
      const wEmpty: Die[] = [];
      const wFull: Die[] = [
        { id: '0_0', x: 0, y: 0, hbin: 1, width: 10, height: 10, physX: 0, physY: 0 }
      ];
      
      // If first wafer is empty, resulting array is empty even if second wafer has dies
      const res1 = aggregateBinCounts([wEmpty, wFull], 1);
      assert.strictEqual(res1.length, 0);

      // If first wafer has dies, it defines the output grid
      const res2 = aggregateBinCounts([wFull, wEmpty], 1);
      assert.strictEqual(res2.length, 1);
    });
  });
});