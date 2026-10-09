// 8-connected component labelling over a set of dies on the die grid.
//
// Extracted because it existed twice: `clusterDetection.ts` had it inline and
// `patternClassification.ts` had it as a private `findConnectedComponents`.
// Same algorithm, same 8-neighbour window, same visited-set keying — different
// variable names, which is why no name-based check saw it.
//
// This one is worth more than tidiness. Both callers answer "which failing dies
// form a contiguous group", and their answers reach the user as different
// things: a cluster finding on the map, and a pattern classification for the
// lot. Two implementations of the same question can drift into disagreeing, and
// the disagreement would surface as a wafer that reports a cluster in one place
// and no pattern in the other, with nothing to point at.

// `PositionedDie` comes from core, not a local re-declaration. A narrower
// local copy compiled fine and then rejected callers whose dies legitimately
// carry `physX`/`physY` — a duplicated type reproducing, in miniature, exactly
// the problem this file exists to remove.
import type { PositionedDie } from '../core/dies.js';
import { gridKey } from '../core/dies.js';

/**
 * The 8 grid steps that make two dies neighbours: the one adjacency rule both component searches use.
 * Flat x and y arrays, not pairs: destructuring a pair in the search loops is slow in JavaScriptCore.
 */
const STEP_X = [-1, 0, 1, -1, 1, -1, 0, 1];
const STEP_Y = [-1, -1, -1, 0, 0, 1, 1, 1];

/**
 * Group `failing` into 8-connected components on the integer die grid.
 *
 * Adjacency is `|dx| <= 1 && |dy| <= 1` on `die.x`/`die.y` — the ORIGINAL
 * prober coordinates, per this library's rule that those are the only
 * coordinates any consumer sees. Dies not in `failing` are never traversed, so
 * a component is a contiguous run of failures and nothing else.
 *
 * Iterative, not recursive: a large contiguous failure region is exactly the
 * case this is for, and it is also exactly the case that blows a call stack.
 */
export function findConnectedComponents(failing: readonly PositionedDie[]): PositionedDie[][] {
  if (failing.length === 0) return [];

  const byKey = new Map<number, PositionedDie>();
  for (const d of failing) byKey.set(gridKey(d.x, d.y), d);

  const visited = new Set<number>();
  const components: PositionedDie[][] = [];

  for (const seed of failing) {
    const seedKey = gridKey(seed.x, seed.y);
    if (visited.has(seedKey)) continue;

    const component: PositionedDie[] = [];
    const queue: PositionedDie[] = [seed];
    visited.add(seedKey);

    while (queue.length > 0) {
      const current = queue.pop()!;
      component.push(current);
      for (let s = 0; s < 8; s++) {
        const key = gridKey(current.x + STEP_X[s], current.y + STEP_Y[s]);
        if (visited.has(key)) continue;
        const candidate = byKey.get(key);
        if (!candidate) continue;
        visited.add(key);
        queue.push(candidate);
      }
    }

    components.push(component);
  }

  return components;
}

/**
 * The size of the largest 8-connected group of failing dies, for many failure sets over one die layout:
 * a permutation null sizes the largest group on every shuffle. The neighbours of each die are found once
 * (by the same steps as {@link findConnectedComponents}) and held as index lists, and
 * each call is a flood fill over typed arrays, with no maps, sets or allocation.
 */
export class LargestComponentSizer {
  private readonly start: Int32Array;
  private readonly list: Int32Array;
  private readonly seen: Int32Array;
  private readonly stack: Int32Array;
  private stamp = 0;

  constructor(dies: readonly { x: number; y: number }[]) {
    const n = dies.length;
    const index = new Map<number, number>();
    for (let i = 0; i < n; i++) index.set(gridKey(dies[i].x, dies[i].y), i);
    const start = new Int32Array(n + 1);
    const neighbours: number[] = [];
    for (let i = 0; i < n; i++) {
      start[i] = neighbours.length;
      for (let s = 0; s < 8; s++) {
        const j = index.get(gridKey(dies[i].x + STEP_X[s], dies[i].y + STEP_Y[s]));
        if (j !== undefined) neighbours.push(j);
      }
    }
    start[n] = neighbours.length;
    this.start = start;
    this.list = Int32Array.from(neighbours);
    this.seen = new Int32Array(n);
    this.stack = new Int32Array(n);
  }

  /** The largest group among the dies with `failing[i]` set (indices as given to the constructor). */
  largest(failing: Uint8Array): number {
    const { start, list, seen, stack } = this;
    const stamp = ++this.stamp;
    let best = 0;
    for (let i = 0; i < failing.length; i++) {
      if (!failing[i] || seen[i] === stamp) continue;
      seen[i] = stamp;
      let top = 0;
      stack[top++] = i;
      let size = 0;
      while (top > 0) {
        const d = stack[--top];
        size++;
        for (let e = start[d]; e < start[d + 1]; e++) {
          const nb = list[e];
          if (failing[nb] && seen[nb] !== stamp) { seen[nb] = stamp; stack[top++] = nb; }
        }
      }
      if (size > best) best = size;
    }
    return best;
  }
}
