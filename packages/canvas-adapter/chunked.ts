import type { Chunked } from '../core/utils.js';

/** Handle on a running {@link runChunked} computation. */
export interface ChunkedRun {
  /** True once the work has finished — set synchronously when it finished
   *  inside the first slice, so a caller can tell "already done" from "staged". */
  readonly done: boolean;
  /**
   * Abandon the rest of the work. Safe to call at any time, including after it
   * has finished. Whatever the work has already written (DOM appended so far,
   * for instance) is left as it is — the caller owns that, and in practice
   * clears it by starting the next render.
   */
  cancel(): void;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * Drive a {@link Chunked} computation on the main thread in time-boxed slices,
 * yielding to the event loop between them so the browser can paint, keep
 * responding to input, and — the reason this exists — never show its "page
 * unresponsive" dialog.
 *
 * **The first slice is deliberately generous.** Work that finishes inside it
 * never yields at all, so a small lot's panel renders in one synchronous pass
 * exactly as it always did: no flash of half a panel, no extra frame, nothing
 * for a caller to special-case. Only work that genuinely overruns starts
 * staging, which is the case the staging is for.
 *
 * A slice always runs at least one step before checking its budget, because a
 * step is atomic — the budget bounds how many steps share a task, never how
 * long one step may take. **Keeping each step short is the generator's job**,
 * and it is what actually bounds the longest task.
 *
 * `setTimeout(0)`, not `requestAnimationFrame`: a slice may overrun a frame, and
 * rAF in a background tab stops firing entirely, which would strand a render.
 */
export function runChunked<T>(
  work: Chunked<T>,
  opts: {
    /** Budget for the synchronous first slice. Default 150 ms — below the ~250 ms
     *  at which a wait starts reading as a stall, so anything under it is better
     *  finished than staged. Pass 0 to force staging (what the tests do). */
    firstSliceMs?: number;
    /** Budget for every slice after the first. Default 16 ms — one frame. */
    sliceMs?: number;
    /** Called with the result when the work finishes. Not called if cancelled. */
    onDone?: (result: T) => void;
  } = {},
): ChunkedRun {
  const { firstSliceMs = 150, sliceMs = 16, onDone } = opts;
  let cancelled = false;
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const slice = (budgetMs: number): void => {
    timer = undefined;
    if (cancelled) return;
    const start = nowMs();
    for (;;) {
      const step = work.next();
      if (step.done) {
        done = true;
        onDone?.(step.value);
        return;
      }
      if (nowMs() - start >= budgetMs) break;
    }
    timer = setTimeout(() => slice(sliceMs), 0);
  };

  slice(firstSliceMs);

  return {
    get done() { return done; },
    cancel() {
      if (cancelled || done) return;
      cancelled = true;
      if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
      // Lets the generator run its own `finally` blocks rather than being left
      // suspended forever holding the pooled dies it was walking.
      work.return(undefined as never);
    },
  };
}
