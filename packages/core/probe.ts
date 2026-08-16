import type { Die } from './dies.js';
import { hasPosition } from './dies.js';

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
 *
 * An unpositioned die (see `hasPosition`) has no spatial order to assign for
 * `row`/`column`/`snake` — it's carried through unchanged (no `probeIndex`
 * set), appended after every positioned die. `custom` is unaffected, since
 * it orders by `id`, not position.
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

  const positioned = dies.filter(hasPosition);
  const unpositioned = dies.filter(d => !hasPosition(d));

  if (type === 'column') {
    const sorted = [...positioned].sort((a, b) => a.x - b.x || b.y - a.y);
    return [...sorted.map((d, i) => ({ ...d, probeIndex: i })), ...unpositioned];
  }

  // 'row' and 'snake': group by row y, descending (top of wafer first)
  const rowMap = new Map<number, typeof positioned>();
  for (const d of positioned) {
    if (!rowMap.has(d.y)) rowMap.set(d.y, []);
    rowMap.get(d.y)!.push(d);
  }

  const sortedRows = [...rowMap.entries()].sort(([a], [b]) => b - a);
  const ordered: typeof positioned = [];

  sortedRows.forEach(([, rowDies], rowIdx) => {
    const row = rowDies.sort((a, b) => a.x - b.x);
    ordered.push(...(type === 'snake' && rowIdx % 2 === 1 ? [...row].reverse() : row));
  });

  return [...ordered.map((d, i) => ({ ...d, probeIndex: i })), ...unpositioned];
}
