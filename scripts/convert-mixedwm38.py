#!/usr/bin/env python3
"""
Convert a sample from MixedWM38 into a wafermap-compatible JSON fixture.

MixedWM38 grid encoding (arr_0, shape N×52×52):
  0 = background (no die)
  1 = passing die
  2 = defective/failing die
  3 = rare edge marker — treated as background

Labels (arr_1, shape N×8) are multi-hot encoded across 8 base defect types:
  col 0: Center   col 1: Donut   col 2: Edge-Loc   col 3: Edge-Ring
  col 4: LOC      col 5: Near-Full  col 6: Scratch  col 7: Random

The 38 unique combinations of these 8 bits produce the 38 MixedWM38 classes.
Normal wafers have all-zero labels.

Output encoding (wafermap DieResult):
  hbin 1 = pass
  hbin 2 = fail

Coordinates are centred: x = col - centerCol, y = row - centerRow.

Usage:
  python scripts/convert-mixedwm38.py \\
    tests/fixtures/Wafer_Map_Datasets.npz \\
    tests/fixtures/mixedwm38-sample.json

Then copy the fixture where the demo page can reach it:
  cp tests/fixtures/mixedwm38-sample.json docs/examples/mixedwm38-sample.json
"""
import sys
import json
import numpy as np

LABEL_COLS = ['Center', 'Donut', 'Edge-Loc', 'Edge-Ring', 'LOC', 'Near-Full', 'Scratch', 'Random']

# 1 sample per class → 38 wafers total; keeps fixture under ~1.5 MB.
SAMPLES_PER_CLASS = 1


def label_name(bits):
    """Convert an 8-bit label vector to a human-readable class name."""
    active = [LABEL_COLS[i] for i, b in enumerate(bits) if b]
    return '+'.join(active) if active else 'Normal'


def grid_to_results(grid):
    """Convert a 52×52 MixedWM38 grid to a list of {x, y, hbin} dicts."""
    rows, cols = grid.shape
    cr, cc = rows // 2, cols // 2
    results = []
    for r in range(rows):
        for c in range(cols):
            v = int(grid[r, c])
            if v == 0 or v == 3:
                continue  # background or edge marker — no die
            results.append({
                'x': c - cc,
                'y': r - cr,
                'hbin': 1 if v == 1 else 2,
            })
    return results


def main(npz_path, out_path):
    print(f"Loading {npz_path} …")
    d = np.load(npz_path)
    grids  = d['arr_0']   # (38015, 52, 52)
    labels = d['arr_1']   # (38015, 8)

    # Group indices by label combination
    from collections import defaultdict
    groups = defaultdict(list)
    for i, label in enumerate(labels):
        key = tuple(int(b) for b in label)
        groups[key].append(i)

    print(f"Found {len(groups)} unique classes across {len(grids)} wafers")

    output = []
    for key in sorted(groups.keys()):
        indices = groups[key]
        name    = label_name(key)
        sample_indices = indices[:SAMPLES_PER_CLASS]

        for idx in sample_indices:
            grid    = grids[idx]
            results = grid_to_results(grid)
            n_fail  = sum(1 for r in results if r['hbin'] == 2)
            n_pass  = sum(1 for r in results if r['hbin'] == 1)
            total   = n_pass + n_fail
            pct     = n_fail / total * 100 if total else 0
            output.append({
                'className':   name,
                'labelBits':   list(key),
                'sampleIndex': int(idx),
                'gridRows':    int(grid.shape[0]),
                'gridCols':    int(grid.shape[1]),
                'results':     results,
            })
            print(f"  {name:40s}  {total:4d} dies  {n_fail:4d} fail  ({pct:.0f}%)")

    with open(out_path, 'w') as f:
        json.dump(output, f, separators=(',', ':'))

    size_kb = len(json.dumps(output)) / 1024
    print(f"\nWrote {len(output)} wafers → {out_path}  ({size_kb:.0f} KB)")
    print("\nNext step:")
    print("  cp tests/fixtures/mixedwm38-sample.json docs/examples/mixedwm38-sample.json")


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])
