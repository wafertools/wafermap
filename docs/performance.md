# Performance

**For:** developers sizing up the library or tuning large-lot workloads.

The wafermap library is fast. Rendering the map is effectively instant, and every
optional analysis feature — the Summary panel's statistics, the Insights
tab's charts, automatic spatial finding detection — completes in single-digit
to low double-digit milliseconds for a typical wafer. This page exists so you
can pick features by what they *do*, not out of worry about what they cost —
but if you're curious, or you're working with very large lots, here are the
actual numbers.

**How to read the numbers below:** timings were measured on a
3-year-old mini-desktop running Ubuntu — not tuned, not
server-grade hardware. If anything, expect *better* numbers on a typical
dev machine or a user's browser. Percentages are included alongside the
milliseconds purely as a size comparison between features, not as a warning
sign — a feature going from 4ms to 9ms is still 9ms.

---

## The short version

Every optional feature costs low single-digit to low double-digit
milliseconds per wafer — the kind of cost that's invisible to a user, even
on a full production-density wafer. There's exactly one feature worth
knowing about before you flip it on for every wafer in a large lot:
automatic spatial finding detection (`enableTestValueAnalysis`), which is
the most powerful option (it finds statistical anomalies for you) and also
the priciest — still comfortably under 110ms on the largest wafer we tested,
but the one to reach for deliberately rather than as a default. Everything
else — the Summary panel, distribution charts, all of the Insights tab — is
cheap enough to enable freely. Two Insights panels even get *faster* for
free if the Summary panel already ran first.

---

## What each option actually buys you

| Option | What you get | Where it shows up |
|---|---|---|
| *(none — just `buildWaferMap` + `renderWaferMap`)* | The interactive map itself | Always |
| `analyzeWaferMap()` — no extra flags | Yield %, bin breakdown, ring/quadrant yield, basic findings | Summary panel, Insights → Overview |
| `analyzeWaferMap({ computePerTestStats: true })` | Per-test five-number summaries (min/Q1/median/Q3/max) | Insights → Distributions (box plot) |
| `analyzeWaferMap({ enableTestValueAnalysis: true })` | Automatic spatial statistical findings — flags regions where a test's values differ significantly (Welch's t-test per region) | Findings sidebar, Summary panel's findings list |
| `insights: { enabled: true }` (Insights tab) | Process capability, distributions, correlation charts | Insights tab (opt-in toolbar button) |
| `analyzeWaferLot(..., { perWaferSummaries })` | Lot-level findings + reuses per-wafer stats you already computed | Gallery's lot Summary panel |

`computePerTestStats` and `enableTestValueAnalysis` are **alternatives**, not
a ladder — pick the cheaper one unless you specifically need automatic
spatial finding detection. `enableTestValueAnalysis` computes distributions
internally too, so you don't need both.

---

## Measured cost, by wafer size

Full 300mm wafers, **15 parametric tests per die** — a realistic count for analysing
a subset of DC/AC parametrics from a production test program, not a toy
single-test example. `buildWaferMap` (drawing the map) is included as a
reference point — it's mandatory, everything else is opt-in on top of it.

| Wafer size | `buildWaferMap` | `analyzeWaferMap()` (Summary panel) | `+ computePerTestStats` | `+ enableTestValueAnalysis` |
|---|---|---|---|---|
| Small (~150 dies) | 1.0ms | 1.2ms *(+117% total)* | 1.7ms *(+165% total)* | 4.8ms *(+475% total)* |
| Medium (~1,000 dies) | 4.4ms | 5.1ms *(+114% total)* | 10.5ms *(+236% total)* | 33.6ms *(+759% total)* |
| Large (~4,200 dies) | 12.2ms | 18.4ms *(+151% total)* | 37.6ms *(+308% total)* | 129.4ms *(+1060% total)* |

("total" % is the combined `buildWaferMap` + `analyzeWaferMap` pipeline cost
relative to `buildWaferMap` alone — included for scale comparison, not as a
target to avoid.)

Every number in the first three columns is small enough to not think about —
low double-digit milliseconds even at 4,200 dies × 15 tests.
`enableTestValueAnalysis` is the one to be deliberate about: it compares
every region against every other region *for every test*, so it scales with
both die count and test count, and on the largest, densest wafer with 15
tests it reaches ~130ms. Still fast for a one-off computation — just not
something you'd want re-running on every frame of an animation, and worth
knowing it grows with how many tests you hand it (more on that below).

---

## Only pass the tests you'll actually use

`testDefs` should be the tests you intend to analyze or display — not
necessarily every test in the underlying test program. A few features scale
with test count, and one of them (test correlation) scales *quadratically*,
since it compares every test against every other test:

| Tests passed | `computePerTestStats` | `enableTestValueAnalysis` | `buildCorrelationMatrix` (pairs) |
|---|---|---|---|
| 6 | 8.7ms | 25.1ms | 0.2ms (15 pairs) |
| 15 | 10.7ms | 36.5ms | 1.2ms (105 pairs) |
| 30 | 14.7ms | 49.5ms | 4.1ms (435 pairs) |
| 60 | 16.8ms | 90.6ms | 16.4ms (1,770 pairs) |

(medium/~1,000-die wafer, held constant — only the test count changes)

None of this is expensive at reasonable test counts (15–30 is typical), but
if your data source hands you a full parametric test program with hundreds
of tests and only a handful are ever shown to the user, filter `testDefs`
down to the ones you actually chart or analyze before passing it in — the
library has no way to know which tests you care about, so it treats every
`testDef` you give it as one worth analyzing.

---

## The Insights tab: fast alone, faster still if the Summary panel already ran

Every Insights panel computes in single-digit milliseconds, even on the
largest wafer tested (the priciest panel, process capability, tops out
around 21ms at 4,200 dies × 15 tests). Two panels — box plot and bin pareto — get **even cheaper**
if the Summary panel already computed its stats, since they can reuse that
work instead of re-scanning every die:

| Panel | Computed standalone | Reusing the Summary panel's stats |
|---|---|---|
| Box plot | up to ~1ms | **~2µs** |
| Bin pareto | up to ~175µs | **~2µs** |
| Capability, correlation, scatter, histogram | up to ~21ms | *(always reads raw die values — no reuse path, by design)* |

**Practical effect:** if a user opens the Summary panel first and then the
Insights tab, box plot and bin pareto are effectively free. If Insights is
the *first* thing they open, everything computes fresh — still fast, just
not quite as fast.

---

## Galleries: let `analyzeWaferLot` reuse work you already did

If you're building a gallery and computing `statsSummary` for each card
*and* a lot-level `lotStatsSummary`, pass the per-wafer results you already
have — it's a free win:

```ts
const waferSummaries = results.map(r => analyzeWaferMap(r));
const lotSummary = analyzeWaferLot(results, {
  perWaferSummaries: waferSummaries,   // ← reuse, don't let it recompute
});
```

Without `perWaferSummaries`, `analyzeWaferLot` quietly redoes the entire
per-wafer analysis itself internally — for a 6-wafer lot, that's roughly six
times the per-wafer `analyzeWaferMap` cost from the table above, paid a
second time for no benefit. With `perWaferSummaries` supplied, the lot-level
pass adds no measurable time on top of the per-wafer work you already did.
Either way the absolute cost is small at typical lot sizes — this is a free
optimization worth taking, not a fix for a real bottleneck.

---

## Recommended settings by what you're building

| You're building… | Recommended options | Why |
|---|---|---|
| A simple embedded viewer, no stats UI | Nothing extra — just `buildWaferMap` + `renderWaferMap` | No reason to compute analysis nobody sees |
| A viewer with yield/bin summary | `analyzeWaferMap()`, no extra flags | Fast, powers the whole Summary panel |
| …plus distribution/box-plot charts | `+ computePerTestStats: true` | Still fast; unlocks Insights → Distributions |
| A QA/engineering tool that should flag anomalies automatically | `+ enableTestValueAnalysis: true` | The only option that finds spatial patterns for you automatically — the one worth being deliberate about on very large lots (see below) |
| A lot gallery (many wafers) | Always pass `perWaferSummaries` to `analyzeWaferLot` | Free reuse of work you already did |
| Very large lots using `enableTestValueAnalysis` on every wafer | Run analysis in a [Web Worker](guide.md#17-processing-large-datasets-with-a-web-worker) via `createWafermapWorker` | Keeps the main thread free while the heavier pass runs, even though each individual call is fast |
| A dashboard rendering many wafers/lots at once | Compute `statsSummary` for every card, then open Insights on demand | Box plot and bin pareto ride along nearly free once Summary panel stats exist |
| Any app, if your data source has a large parametric test program | Filter `testDefs` down to the tests you actually analyze/display | Correlation and `enableTestValueAnalysis` both scale with test count — unused tests cost you for nothing shown to the user |

---

## Methodology, if you want to reproduce this

Wafer sizes above are full 300mm wafers with realistic die pitch (small:
~20mm die, medium: ~8mm die, large: ~4mm die), 15 parametric tests per die
(the test-count table varies this deliberately), 8% fail rate, deterministic
synthetic data. Each number is the **median**
of many repeated runs (9–41, more reps for smaller/faster operations) to
cancel out timer jitter and GC pauses — a single-shot timing at this scale
isn't trustworthy. Every function measured is a real, unmodified library
export, run against the actual built `dist/` output, on a 3-year-old
SER5-Pro desktop (Ubuntu) — nothing exotic, and a typical modern machine
should do at least as well.
