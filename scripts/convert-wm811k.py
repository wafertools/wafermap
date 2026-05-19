#!/usr/bin/env python3
"""
Convert a sample from WM-811K into a wafermap-compatible JSON fixture.

WM-811K grid encoding:
  0 = background (no die at this grid position)
  1 = passing die
  2 = defective/failing die

Output encoding (wafermap DieResult):
  hbin 1 = pass
  hbin 2 = fail

Coordinates are centred: x = col - centerCol, y = row - centerRow.
The library auto-detects symmetric layouts correctly without any dieConfig.

Usage:
  pip install pandas numpy
  python scripts/convert-wm811k.py LSWMD.pkl tests/fixtures/wm811k-sample.json

Then copy the fixture where the demo page can reach it:
  cp tests/fixtures/wm811k-sample.json docs/examples/wm811k-sample.json
"""
import sys
import json
import numpy as np
import pandas as pd

DEFECT_TYPES = [
    'Center',
    'Donut',
    'Edge-Loc',
    'Edge-Ring',
    'Loc',
    'Near-full',
    'Random',
    'Scratch',
    'none',
]

# 3 samples per type → 27 wafers total; keeps fixture under ~500 KB.
# Raise this if you want more coverage.
SAMPLES_PER_TYPE = 3


def grid_to_results(grid):
    """Convert a 2-D WM-811K grid to a list of {x, y, hbin} dicts."""
    rows, cols = grid.shape
    # Centre the coordinate system so (0,0) is the grid centre.
    cr, cc = rows // 2, cols // 2
    results = []
    for r in range(rows):
        for c in range(cols):
            v = int(grid[r, c])
            if v == 0:
                continue  # background — no die at this position
            results.append({
                'x': c - cc,
                'y': r - cr,
                'hbin': 1 if v == 1 else 2,
            })
    return results


def load_pkl(pkl_path):
    """Load the WM-811K pkl, working around old-pandas module renames."""
    import pickle
    import sys

    # WM-811K was pickled with pandas ~0.14-0.19 which used 'pandas.indexes'.
    # Modern pandas renamed this to 'pandas.core.indexes'. Patch the import
    # table so pickle's find_class resolves the old name.
    import pandas.core.indexes
    sys.modules.setdefault('pandas.indexes', pandas.core.indexes)
    import pandas.core.indexes.base
    sys.modules.setdefault('pandas.indexes.base', pandas.core.indexes.base)
    import pandas.core.indexes.range
    sys.modules.setdefault('pandas.indexes.range', pandas.core.indexes.range)
    import pandas.core.indexes.numeric
    sys.modules.setdefault('pandas.indexes.numeric',
                           pandas.core.indexes.numeric
                           if hasattr(pandas.core.indexes, 'numeric')
                           else pandas.core.indexes.base)

    with open(pkl_path, 'rb') as f:
        return pickle.load(f)


def main(pkl_path, out_path):
    print(f"Loading {pkl_path} …")
    try:
        df = pd.read_pickle(pkl_path)
    except ModuleNotFoundError:
        df = load_pkl(pkl_path)

    # The failureType column in WM-811K is stored as nested lists or arrays,
    # e.g. [['Center']] or np.array([['Center']]).
    # Flatten to a plain string: [['Center']] → 'Center', [] → ''.
    def flatten_label(v):
        # Unwrap numpy arrays to plain Python
        if isinstance(v, np.ndarray):
            v = v.tolist()
        if isinstance(v, list):
            if not v:
                return ''
            inner = v[0]
            if isinstance(inner, (list, np.ndarray)):
                inner = list(inner)
                return str(inner[0]) if inner else ''
            return str(inner)
        if v is None or (isinstance(v, float) and np.isnan(v)):
            return ''
        return str(v).strip()

    df['failureType'] = df['failureType'].apply(flatten_label)

    # Keep only labelled rows (non-empty, non-NaN, not 'nan')
    df = df[~df['failureType'].isin(['', 'nan', 'NaN'])]
    print(f"Labelled rows: {len(df)}")
    print(f"Failure types found: {sorted(df['failureType'].unique())}")

    output = []
    for dt in DEFECT_TYPES:
        subset = df[df['failureType'] == dt].head(SAMPLES_PER_TYPE)
        if subset.empty:
            print(f"  WARNING: no samples found for '{dt}'")
            continue
        for _, row in subset.iterrows():
            grid = np.array(row['waferMap'])
            results = grid_to_results(grid)
            n_fail = sum(1 for r in results if r['hbin'] == 2)
            n_pass = sum(1 for r in results if r['hbin'] == 1)
            output.append({
                'failureType': dt,
                'lotName':     str(row.get('lotName', '')),
                'waferIndex':  int(row.get('waferIndex', 0)),
                'gridRows':    int(grid.shape[0]),
                'gridCols':    int(grid.shape[1]),
                'results':     results,
            })
            pct = n_fail / (n_pass + n_fail) * 100 if (n_pass + n_fail) else 0
            print(f"  {dt:15s}  {n_pass + n_fail:4d} dies  {n_fail:4d} fail  ({pct:.0f}%)")

    with open(out_path, 'w') as f:
        json.dump(output, f, separators=(',', ':'))

    size_kb = len(json.dumps(output)) / 1024
    print(f"\nWrote {len(output)} wafers → {out_path}  ({size_kb:.0f} KB)")
    print("\nNext step:")
    print("  cp tests/fixtures/wm811k-sample.json docs/examples/wm811k-sample.json")


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])
