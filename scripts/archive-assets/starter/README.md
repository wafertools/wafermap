# wafermap starter

A minimal, self-contained wafer map. Copy this whole folder somewhere and start
editing — it is meant to be a seed, not a demo.

## What to edit first

| File | What it is |
|---|---|
| `app.js` | The whole app: `buildWaferMap` → `renderWaferMap`, with every option commented. Start here. |
| `generate-data.js` | Synthetic data so something renders before you have a file. Delete once you load real data. |
| `load-csv.js` | CSV → `DieResult[]`. Point `COLUMNS` at your tester's column names. |
| `index.html` | Page shell and the importmap that resolves `wafermap` with no bundler. |

## Running it

This folder must be served over HTTP — ES modules and `fetch` do not work from
`file://`. From the root of the examples package:

```
sh serve.sh        # macOS / Linux
serve.cmd          # Windows
```

Then open <http://localhost:8080/starter/>.

## Loading your own data

1. Put your CSV next to `app.js`.
2. In `app.js`, replace the `generate-data.js` import with:

   ```js
   import { loadCsv } from './load-csv.js';
   const results = await loadCsv('./my-wafer.csv');
   ```

3. If it throws "could not find x/y columns", add your column names to
   `COLUMNS` in `load-csv.js`.

Two things worth knowing before you look at the output:

- **`x` and `y` are prober step positions, not millimetres.** Pass them through
  unchanged; `dieConfig` is what converts to physical units.
- **A missing bin is not bin 0.** `load-csv.js` deliberately omits the field
  rather than defaulting it, so those dies render as no-data grey instead of
  being counted into a real bin.

## Moving to a bundler

Delete the `<script type="importmap">` block from `index.html` and run:

```
npm install @wafertools/wafermap
```

The `import` statements in `app.js` do not change.

## Where to go next

- The `../examples/` folder — 20 worked examples, each on one topic.
- [API reference](https://wafertools.github.io/wafermap/api/)
- [Developer guide](https://wafertools.github.io/wafermap/guide/)
