// The tests a reader has pinned: listed first in every test picker, so a debug session on a handful of tests out of
// hundreds does not mean searching the whole list each time.
//
// One set for the page rather than one per map or card: a pin is a statement about the reader's focus, and the same
// reader would be surprised to find a test pinned in the box plot and loose in the histogram beside it. Test numbers are
// what identify a test across the charts; a pinned number a lot does not have is simply not listed.
//
// A host keeps the set between sessions. It adopts the saved numbers with {@link setPinnedTests} (which does not report
// itself, so loading cannot write back) and saves what {@link onPinnedTestsChange} reports a reader's own pin or unpin.

const pinned = new Set<number>();
const listeners = new Set<(testNumbers: number[]) => void>();

/** The pinned test numbers, in the order they were pinned. */
export function getPinnedTests(): number[] {
  return [...pinned];
}

/** Adopt a saved set of pinned tests. Does not call {@link onPinnedTestsChange}: that reports the reader's own changes only. */
export function setPinnedTests(testNumbers: Iterable<number>): void {
  pinned.clear();
  for (const n of testNumbers) if (Number.isFinite(n)) pinned.add(n);
}

/** Called with the whole set after the reader pins or unpins a test. Returns a function that stops the calls. */
export function onPinnedTestsChange(listener: (testNumbers: number[]) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function isTestPinned(testNumber: number): boolean {
  return pinned.has(testNumber);
}

/** The reader's pin or unpin of one test. */
export function toggleTestPinned(testNumber: number): void {
  if (!pinned.delete(testNumber)) pinned.add(testNumber);
  const all = getPinnedTests();
  for (const listener of listeners) listener(all);
}
