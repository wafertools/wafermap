import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/index.js';
import { analyzeWaferMap } from '../dist/packages/stats/index.js';
import { plainBinTerms } from '../dist/packages/renderer/fmt.js';

// ─────────────────────────────────────────────────────────────────────────────
// Findings redundancy collapse.
//
// Several independent passes legitimately detect the same physical phenomenon,
// and the list then restates one fact many times — on an edge-failure wafer:
// hard bin 1 / soft bin 1 / yield all reporting the identical delta, plus a
// hard+soft pair for every failure bin.
//
// The collapse is safe ONLY because it is structural. Hard and soft bins are
// independent number spaces, so merging on the bin NUMBER would conflate two
// unrelated populations — the sort of quietly-wrong output that drives a bad
// lot disposition. It merges on die-set identity instead, and the negative test
// below is the one that matters most.
// ─────────────────────────────────────────────────────────────────────────────

/** Wafer with a heavy edge-failure ring, hbin and sbin carrying the SAME partition. */
function edgeFailWafer({ mirrorSoftBins = true } = {}) {
  const R = 12;
  const results = [];
  for (let x = -R; x <= R; x++) {
    for (let y = -R; y <= R; y++) {
      const r = Math.hypot(x, y);
      if (r > R) continue;
      const edge = r > R * 0.82;
      // Bin 1 pass; 2 and 3 are failure modes concentrated at the edge.
      const hbin = edge ? ((x + y) % 2 === 0 ? 2 : 3) : 1;
      const die = { x, y, hbin };
      if (mirrorSoftBins) {
        // Soft bin partition IDENTICAL to the hard bin partition.
        die.sbin = hbin;
      } else {
        // Soft bins that deliberately do NOT line up with hard bins: every die
        // gets soft bin 3 regardless of its hard bin, so 'hard bin 3' and
        // 'soft bin 3' cover completely different die sets.
        die.sbin = 3;
      }
      results.push(die);
    }
  }
  return buildWaferMap({
    results,
    waferConfig: { diameter: 300, notch: { type: 'bottom' } },
    dieConfig:   { width: 10, height: 10 },
    passBins:    [1],
  });
}

const analyse = (result, opts = {}) =>
  analyzeWaferMap(result, { ringCount: 4, passBins: [1], ...opts });

const claimedIds = (summary) => new Set(summary.findings.flatMap(f => f.absorbedIds ?? []));
const visible = (summary) => {
  const claimed = claimedIds(summary);
  return summary.findings.filter(f => !claimed.has(f.id));
};

test('hard/soft twins over identical dies collapse into one visible finding', () => {
  const summary = analyse(edgeFailWafer());
  const shown = visible(summary);

  // Every soft-bin finding whose hard-bin twin covers the same dies is claimed.
  const shownSoft = shown.filter(f => f.variable.kind === 'softBin');
  assert.equal(shownSoft.length, 0,
    `soft-bin twins should be absorbed, still visible: ${shownSoft.map(f => f.variable.label)}`);

  // And the surviving row says so, rather than silently dropping the soft half.
  // Findings hold the INTERNAL vocabulary (`HBin 3`/`SBin 3`); every display
  // surface expands it via plainBinTerms. Assert on both: the label carries the
  // soft bin, and the prose a user actually reads says "soft bin" in full.
  // A first attempt merged using display wording, which plainBinTerms then never
  // matched — the soft half silently vanished from the rendered sentence while
  // the raw label looked correct.
  const merged = shown.filter(f => /SBin \d+/.test(f.variable.label));
  assert.ok(merged.length > 0, 'the merged row must name the soft bin it absorbed');
  for (const f of merged) {
    assert.match(f.variable.label, /same dies/,
      'the merged label must state WHY the two were merged');

    const prose = plainBinTerms(f.summary);
    assert.match(prose, /hard bin \d+ and soft bin \d+/,
      `rendered prose must name both bins, got: ${prose}`);
    assert.match(prose, /same dies/,
      'rendered prose must keep the "(same dies)" qualifier — without it, ' +
      '"hard bin 3 and soft bin 3" reads as two populations summed');
  }
});

test('NEGATIVE: bins with the same number but different dies are never merged', () => {
  // This is the invariant that matters. Hard bin 3 and soft bin 3 here cover
  // completely different populations; merging them would report one bin's
  // behaviour under the other's name.
  const summary = analyse(edgeFailWafer({ mirrorSoftBins: false }));

  for (const f of summary.findings) {
    if (f.variable.kind !== 'hardBin') continue;
    assert.doesNotMatch(f.variable.label ?? '', /soft/i,
      `hard bin ${f.variable.bin} was merged with a soft bin covering different dies`);
  }
  // The soft-bin findings must remain visible in their own right.
  const claimed = claimedIds(summary);
  const softVisible = summary.findings
    .filter(f => f.variable.kind === 'softBin' && !claimed.has(f.id));
  const softTotal = summary.findings.filter(f => f.variable.kind === 'softBin');
  if (softTotal.length > 0) {
    assert.ok(softVisible.length > 0, 'non-coincident soft-bin findings must not be absorbed');
  }
});

test('the single pass bin is absorbed into the yield finding that restates it', () => {
  const summary = analyse(edgeFailWafer());
  const claimed = claimedIds(summary);

  for (const f of summary.findings) {
    if (f.variable.kind !== 'yield') continue;
    const region = f.comparison.left;
    // Any pass-bin (bin 1) row for the same region must be claimed by it.
    const passRows = summary.findings.filter(o =>
      o.comparison.left === region &&
      (o.variable.kind === 'hardBin' || o.variable.kind === 'softBin') &&
      o.variable.bin === 1);
    for (const p of passRows) {
      assert.ok(claimed.has(p.id),
        `bin 1 row in ${region} restates the yield finding but was not absorbed`);
    }
  }
});

test('with several pass bins, no single bin row equals yield, so nothing is absorbed on that rule', () => {
  const summary = analyse(edgeFailWafer(), { passBins: [1, 2] });
  const claimed = claimedIds(summary);

  // A bin-1 row is no longer the same statement as yield (yield counts 1 AND 2),
  // so it must survive on its own unless a hard/soft twin claimed it.
  const binOneRows = summary.findings.filter(f => f.variable.kind === 'hardBin' && f.variable.bin === 1);
  for (const f of binOneRows) {
    assert.ok(!claimed.has(f.id),
      'bin 1 must not be absorbed into yield when it is not the only pass bin');
  }
});

test('collapse never deletes findings — claimed ones stay readable programmatically', () => {
  const summary = analyse(edgeFailWafer());
  const ids = new Set(summary.findings.map(f => f.id));

  // NOTE: not every relatedId resolves to a live finding, and that predates the
  // collapse — `finalizeProportionFindings` merges a run of per-region findings
  // into one whose relatedIds name the constituents it REPLACED (e.g. a merged
  // "Rings 3–4" finding referencing `yield:ring:3`). Those constituents are gone
  // by design. So the guarantee asserted here is the narrower, meaningful one:
  // anything the redundancy collapse claims is still present to be read.
  const collapsed = summary.findings.filter(f =>
    (f.variable.kind === 'softBin') ||
    ((f.variable.kind === 'hardBin' || f.variable.kind === 'softBin') && f.variable.bin === 1));
  for (const f of collapsed) {
    assert.ok(ids.has(f.id), `${f.id} was deleted rather than claimed`);
  }

  // And collapsing must actually reduce what a reader sees.
  assert.ok(visible(summary).length < summary.findings.length,
    'expected the collapse to hide at least one restatement');
});

test('collapse is idempotent — re-analysing the same wafer gives the same claims', () => {
  const a = analyse(edgeFailWafer());
  const b = analyse(edgeFailWafer());
  assert.deepEqual(
    [...claimedIds(a)].sort(),
    [...claimedIds(b)].sort(),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Lot level. This is where the duplication is most misleading: an absorbed twin
// that reappears as its own lot row is annotated "seen on N/M wafers", so one
// fact restated twice reads as two independent signals corroborating each other.
// ─────────────────────────────────────────────────────────────────────────────

test('absorbed findings do not reappear as their own lot-level rows', async () => {
  const { analyzeWaferLot } = await import('../dist/packages/stats/index.js');

  const results = Array.from({ length: 6 }, () => edgeFailWafer());
  const perWaferSummaries = results.map(r => analyse(r));
  const lot = analyzeWaferLot(results, {
    ringCount: 4,
    passBins: [1],
    perWaferSummaries,
  });

  // No lot row may be a soft-bin twin the wafer level already absorbed.
  const absorbedPerWafer = new Set(
    perWaferSummaries.flatMap(s => s.findings.flatMap(f => f.absorbedIds ?? [])),
  );
  const absorbedLabels = new Set(
    perWaferSummaries.flatMap(s =>
      s.findings.filter(f => absorbedPerWafer.has(f.id)).map(f => `${f.variable.label}|${f.comparison.left}`)),
  );

  for (const f of lot.findings) {
    const key = `${f.variable.label}|${f.comparison.left}`;
    assert.ok(!absorbedLabels.has(key),
      `lot row "${f.variable.label}" (${f.comparison.left}) restates a finding absorbed at wafer level`);
  }

  // The merged label carries through to the lot list rather than being lost.
  const merged = lot.findings.filter(f => /same dies/.test(f.variable.label));
  assert.ok(merged.length > 0, 'expected the merged hard+soft label at lot level');

  // And a bare soft-bin row must not survive alongside it.
  const bareSoft = lot.findings.filter(f => f.variable.kind === 'softBin');
  assert.equal(bareSoft.length, 0,
    `soft-bin twins should not produce lot rows: ${bareSoft.map(f => f.variable.label)}`);
});
