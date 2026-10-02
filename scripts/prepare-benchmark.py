#!/usr/bin/env python3
"""
Convert LSWMD.pkl (WM-811K) to a benchmark JSON file for classifier evaluation.
Only includes labelled wafers (failureType != 'none' and not NaN).

Usage: python3 scripts/prepare-benchmark.py [path/to/LSWMD.pkl]
The input defaults to the LSWMD_PKL environment variable, then to ./LSWMD.pkl.

Output: tests/fixtures/wm811k-benchmark.json
Format: array of { failureType, gridRows, gridCols, results: [{x, y, hbin}] }
"""
import os
import sys
import json
from pathlib import Path
import numpy as np

# Compat shim for old pandas pickle
import pandas.core.indexes
sys.modules['pandas.indexes'] = pandas.core.indexes
import pickle

PICKLE_PATH = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('LSWMD_PKL', 'LSWMD.pkl')
OUTPUT_PATH = str(Path(__file__).resolve().parent.parent / 'tests' / 'fixtures' / 'wm811k-benchmark.json')

print('Loading LSWMD.pkl...', flush=True)
with open(PICKLE_PATH, 'rb') as f:
    df = pickle.load(f, encoding='latin1')

print(f'Loaded: {df.shape[0]} rows, columns: {df.columns.tolist()}', flush=True)
print(f'failureType distribution:\n{df["failureType"].value_counts().to_dict()}', flush=True)

# Keep only labelled wafers (failureType is not NaN and not empty string)
labelled = df[df['failureType'].notna() & (df['failureType'] != '')].copy()
print(f'\nLabelled wafers: {len(labelled)}', flush=True)
print('Extracting arrays...', flush=True)

out = []
skipped = 0

# Use direct array access — iterrows() is ~100x slower than iterating values
wafer_maps    = labelled['waferMap'].values
print(f'waferMap array ready: {len(wafer_maps)}', flush=True)
failure_types = labelled['failureType'].values
print(f'failureType array ready, starting conversion...', flush=True)
n_total = len(wafer_maps)

for i in range(n_total):
    wmap = wafer_maps[i]
    if not hasattr(wmap, 'shape') or wmap.ndim != 2:
        skipped += 1
        continue

    nrows, ncols = wmap.shape
    cx = ncols // 2
    cy = nrows // 2

    # Vectorised: find all non-zero positions at once
    r_idx, c_idx = np.where(wmap != 0)
    if r_idx.size == 0:
        skipped += 1
        continue

    xs    = (c_idx - cx).tolist()
    ys    = (cy - r_idx).tolist()   # flip Y so +y is up
    hbins = np.where(wmap[r_idx, c_idx] == 2, 2, 1).tolist()

    results = [{'x': int(x), 'y': int(y), 'hbin': int(h)} for x, y, h in zip(xs, ys, hbins)]

    out.append({
        'failureType': str(failure_types[i]),
        'gridRows': int(nrows),
        'gridCols': int(ncols),
        'results': results,
    })

    if len(out) % 100 == 0:
        print(f'  converted {len(out)}/{n_total} wafers...', flush=True)

print(f'\nConverted: {len(out)} wafers, skipped: {skipped}', flush=True)
print(f'Writing to {OUTPUT_PATH}...', flush=True)

with open(OUTPUT_PATH, 'w') as f:
    json.dump(out, f)

print('Done.', flush=True)

# Print final label distribution
from collections import Counter
label_counts = Counter(w['failureType'] for w in out)
print('\nFinal label distribution:')
for label, count in sorted(label_counts.items(), key=lambda x: -x[1]):
    print(f'  {label}: {count}')
