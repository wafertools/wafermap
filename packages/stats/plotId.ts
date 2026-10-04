// A plot's identity. Its own module so the plot store, which every map and gallery loads, does not carry the
// plot file reader along with it.

let counter = 0;

/** A new plot id: unique across a session and, with the random part, across files. */
export function newPlotId(): string {
  const rand = Math.floor(Math.random() * 0x100000000).toString(36).padStart(7, '0');
  return `plot-${Date.now().toString(36)}-${rand}-${(counter++).toString(36)}`;
}
