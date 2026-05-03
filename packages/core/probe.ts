import type { Die } from './dies.js';

export interface ProbeSequenceConfig {
  type: 'row' | 'column' | 'snake' | 'custom';
  /** Ordered array of die IDs — required when type='custom'. */
  customOrder?: string[];
}

/**
 * Assign a probeIndex to each die according to the chosen scan strategy.
 *
 * row    — left→right, top→bottom
 * snake  — alternating direction per row (boustrophedon)
 * column — top→bottom, left→right
 * custom — explicit die ID ordering
 */
export function applyProbeSequence(dies: Die[], config: ProbeSequenceConfig): Die[] {
  const { type, customOrder } = config;

  if (type === 'custom') {
    if (!customOrder) throw new Error('customOrder is required for type="custom"');
    const indexMap = new Map(customOrder.map((id, i) => [id, i]));
    const result = dies.map((d) => ({ ...d, probeIndex: indexMap.get(d.id) }));
    const missing = result.filter((d) => d.probeIndex === undefined).map((d) => d.id);
    if (missing.length > 0) {
      throw new Error(`applyProbeSequence: die IDs not found in customOrder: ${missing.join(', ')}`);
    }
    return result;
  }

  if (type === 'column') {
    const sorted = [...dies].sort((a, b) => a.i - b.i || b.j - a.j);
    return sorted.map((d, i) => ({ ...d, probeIndex: i }));
  }

  // 'row' and 'snake': group by row j, descending (top of wafer first)
  const rowMap = new Map<number, Die[]>();
  for (const d of dies) {
    if (!rowMap.has(d.j)) rowMap.set(d.j, []);
    rowMap.get(d.j)!.push(d);
  }

  const sortedRows = [...rowMap.entries()].sort(([a], [b]) => b - a);
  const ordered: Die[] = [];

  sortedRows.forEach(([, rowDies], rowIdx) => {
    const row = rowDies.sort((a, b) => a.i - b.i);
    ordered.push(...(type === 'snake' && rowIdx % 2 === 1 ? [...row].reverse() : row));
  });

  return ordered.map((d, i) => ({ ...d, probeIndex: i }));
}
