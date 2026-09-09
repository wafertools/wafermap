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
import { getDieKey } from '../core/dies.js';

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

  const byKey = new Map<string, PositionedDie>();
  for (const d of failing) byKey.set(getDieKey(d), d);

  const visited = new Set<string>();
  const components: PositionedDie[][] = [];

  for (const seed of failing) {
    const seedKey = getDieKey(seed);
    if (visited.has(seedKey)) continue;

    const component: PositionedDie[] = [];
    const queue: PositionedDie[] = [seed];
    visited.add(seedKey);

    while (queue.length > 0) {
      const current = queue.pop()!;
      component.push(current);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const key = `${current.x + dx},${current.y + dy}`;
          if (visited.has(key)) continue;
          const candidate = byKey.get(key);
          if (!candidate) continue;
          visited.add(key);
          queue.push(candidate);
        }
      }
    }

    components.push(component);
  }

  return components;
}
