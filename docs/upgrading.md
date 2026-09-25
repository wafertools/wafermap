# Upgrading

What to change in your code when a release removes or changes something you use, newest
release first. Each release's full list of changes is in the
[changelog](https://github.com/wafertools/wafermap/blob/main/CHANGELOG.md). The reasons for
each removal, and whether it could come back, are in
[API_REMOVALS.md](https://github.com/wafertools/wafermap/blob/main/API_REMOVALS.md).

## 0.31.0

### Removed exports

0.31.0 removes 74 exports: the 73 deprecated in 0.30.0 and `renderFindingsReportHtml`,
deprecated in 0.30.3. Each one logged a console notice naming its replacement on first use.
If your code calls `buildWaferMap`, `renderWaferMap`, `renderWaferGallery`,
`analyzeWaferMap` and `analyzeWaferLot`, and imports none of the names below, you have
nothing to change here.

To check: search your imports from `@wafertools/wafermap` for the names in these tables. In
TypeScript, each one is now a compile error at the import.

#### Colours

| Removed | Use instead |
|---|---|
| `resolveBinColors` | `binColorsForMaps(results)`, which reads each map's own pass bins, or `getBinColors()` on a `WaferMapController` or `GalleryController` |
| `getBinColorScheme` | `binColorsForMaps(results)`: the colours a map actually draws |
| `valueToViridis`, `valueToGreyscale` | `resolveValueColorFn('default')`, `resolveValueColorFn('greyscale')` |
| `getValueColorScheme` | `resolveValueColorFn(name, reversed)` to colour by value; `listValueColorSchemes()` for names and labels |
| `contrastTextColor` | none: the renderers choose label colours themselves |

```js
// Before
const colours = resolveBinColors(result.dies, { passBins: [1, 5] });

// After: pass bins come from the result
const colours = binColorsForMaps(result);          // one map
const lotColours = binColorsForMaps(results);      // several, resolved together
```

#### Figures for your own tables, exports and charts

Every figure the charts, Summary panel and reports show comes back from the analysis.
Options such as `computePerTestStats` are on `analyzeWaferMap` and `analyzeWaferLot`.

| Removed | Use instead |
|---|---|
| `buildYieldData`, `buildYieldDataCombined` | `lotYieldSeries` on `analyzeWaferLot`'s result; `stats.yieldPercent` on each summary |
| `buildBinParetoData`, `buildBinClusterData` | `stats.hardBinCounts` and `stats.softBinCounts`, on the wafer summary or on each `perWafer` entry of a lot summary |
| `buildCapabilityData` | `stats.capability` (enable `computePerTestStats`) |
| `buildTestBoxplotData` | `stats.perTestStats` (enable `computePerTestStats`); `perWaferTestStats` on a lot summary |
| `buildTestTrendData`, `trendCentre` | `perWaferTestStats` on `analyzeWaferLot`'s result, in slot order |
| `buildTestPassRateData`, `hasJudgeableTests` | `stats.testSpecYield` (test limits), `stats.testFlagYield` (tester verdicts), `stats.functionalYield`, and `stats.specVerdictDisagreementDies` |
| `computeFunctionalYield` | `stats.functionalYield` |
| `buildRegionYieldData`, `buildRingRegions`, `buildQuadrantRegions` | `stats.regionYield.ring` and `stats.regionYield.quadrant` |
| `buildSectorRegions`, `buildReticlePositionRegions`, `buildTestSiteRegions`, `areQuadrantsAdjacent`, `sectorCompassNames`, `parseRegionKey` | the findings: each names its region in `comparison.left`. Region keys are identities; do not parse them |
| `classifyPattern` | `stats.spatialPattern`: label, confidence and geometry features, for every wafer |
| `classifyDie`, `getRingLabel` | ring and quadrant yield in `stats.regionYield`; a die's ring and quadrant in the die list's CSV export |
| `buildTestHistogramData`, `buildTestHistogramSeries`, `buildScatterData`, `buildScatterDataGrouped`, `buildCorrelationMatrix`, `filterCorrelationMatrix` | none: these prepared data for the Insights charts, which the renderers draw (`insights: { enabled: true }`). If you need correlations as data, [ask](https://github.com/wafertools/wafermap/issues) |

```js
// Before
const yieldData = buildYieldData(items, [1]);

// After
const lot = analyzeWaferLot(results);
lot.lotYieldSeries;                  // [{ waferIndex, yieldPercent }, …]
lot.perWafer[0].summary.stats.regionYield.quadrant;   // [{ key, label, yieldPercent, n, passDies }, …]
```

#### Reports

| Removed | Use instead |
|---|---|
| `renderSummaryReportHtml` | `renderWaferReportHtml(result, summary?)` |
| `renderLotSummaryReportHtml` | `renderLotReportHtml(results)` |
| `renderFindingsReportHtml` | `renderWaferReportHtml` or `renderLotReportHtml`: their Findings section is the same table |
| `openHtmlReport` | `openReportModal(html)`, or `setReportOpener` to route reports into your app |

Both report builders read pass bins and ring count from the built maps, so there is nothing
to keep in step.

#### Die layouts and geometry

| Removed | Use instead |
|---|---|
| `createWafer`, `generateDies`, `clipDiesToWafer` | `buildWaferMap({ layout: true, waferConfig, dieConfig })` for a die layout with no test data |
| `STANDARD_WAFER_DIAMETERS_MM` | `buildWaferMap`'s `standardDiameters`; the default is `[100, 125, 150, 200, 300]` |
| `resolveGridPitch` | each built die's `width` and `height` carry the pitch `buildWaferMap` resolved |
| `aggregateValues`, `aggregateBinCounts`, `getUniqueBins` | `buildWaferMap`'s `lotStack` option |
| `isPositionedDie` | `hasPosition` |

```js
// Before
const wafer = createWafer({ diameter: 300 });
const dies = clipDiesToWafer(generateDies(wafer, { width: 10, height: 10 }), wafer, { width: 10, height: 10 });

// After
const layout = buildWaferMap({
  layout: true,
  waferConfig: { diameter: 300 },
  dieConfig: { width: 10, height: 10 },
});
renderWaferMap(container, layout);
```

#### Small helpers

| Removed | Use instead |
|---|---|
| `getDieTestValue(die, n)` | `die.testValues?.[n]` |
| `dieHasTestData` | none: `buildWaferMap`, the analysis and the renderers apply it themselves |
| `isParametricTest(def)` | `def.testType !== 'F'` |
| `metadataCategoricalValue` | `metadataDisplayValue` |
| `DEFAULT_FACET_CURATION` | `buildFacetTable` applies it by default; its `curation` option layers over it |
| `buildDieListSection` | the maps show the die list themselves (the `dieList` option) |

#### The low-level drawing pipeline

`buildView`, `toCanvas`, `buildHoverText`, `buildMapTitle`, `applyOrientation`,
`transformDies`, `isInsideWafer`, `generateReticleGrid`, `applyProbeSequence`,
`mapDataToDies` and the `affine*` helpers are removed with no direct replacement. Build with
`buildWaferMap` and draw with `renderWaferMap` or `renderWaferGallery`. If you drew maps
yourself (to SVG, a server-side image or another canvas library), say what you need in an
[issue](https://github.com/wafertools/wafermap/issues).

#### Options

| Removed or changed | What to do |
|---|---|
| `downloadFilename` (changed) | It is now a prefix for every file a map or gallery saves, CSVs included: `LOT123_sort` gives `LOT123_sort_W05_hard-bin.png`, not `LOT123_sort.png`. If your `onSaveImage` or `onSaveText` matches the name it receives, match on the prefix. |
| `buildWaferMap`'s second argument (`WaferMapOptions`) | Set the starting plot mode and other view options on the renderer: `renderWaferMap(container, result, { viewOptions: { plotMode: 'value' } })`. The second argument only set the initial `result.plotMode`, and the Web Worker never passed it. |
| `WaferViewOptions.showPartialDies` | Remove it. No map `buildWaferMap` builds has partial dies, so it had nothing to act on. A saved preference that still carries it is ignored. |
| `isYieldEligibleDie`'s `includePartial` | Remove it. Partial dies are always left out of yield; `includeEdgeExcluded` is unchanged. |

#### Types

The types that belonged only to removed functions are removed with them. The types of
everything that remains, such as `WaferMapResult`, `StatsSummary` and `RenderOptions`, are
unchanged.

| Removed with | Types |
|---|---|
| The chart-data builders | `CapabilityDatum`, `CapabilityItem`, `CorrelationTestInfo`, `CorrelationCell`, `CorrelationMatrix`, `CorrelationSummary`, `BoxplotDatum`, `BoxplotItem`, `TrendDatum`, `TrendItem`, `TestPassKind`, `TestPassRateData`, `TestPassRateItem`, `TestPassRateRow`, `TestPassRateValue`, `HistogramBucket`, `HistogramItem`, `HistogramSeries`, `HistogramSeriesData`, `ScatterPoint`, `ScatterItem`, `ChartDatum`, `YieldItem`, `YieldSortBy`, `BinType`, `BinItem`, `BinCluster`, `BinClusterData` |
| The region builders | `StatsRegion`, `RegionYieldDatum`, `ParsedRegionKey` |
| The drawing pipeline and geometry helpers | `View`, `ViewOptions`, `ViewRect`, `ViewText`, `ViewOverlay`, `ViewHoverPoint`, `WaferMapOptions`, `ToCanvasResult`, `HitTarget`, `MapTitleParts`, `WaferSpec`, `WaferNotch`, `DieSpec`, `PositionedDie`, `ReticleSpec`, `ProbeSequenceConfig`, `TransformOptions`, `DataRow`, `MapOptions`, `Quadrant`, `DieClassification`, `ClassifyOptions`, `AggregationMethod`, `DieLike`, `PitchResult` |
| The other helpers | `BinColorOptions`, `DieListOptions`, `LotSummaryReportParams`, `MetadataColumn`, `MetadataColumnScope`, `MetadataColumnSet`, `ResolveMetadataColumnsOptions` |

### STDF value ranges

0.30.4 warned about values STDF V4 cannot store (`input-values-outside-stdf`) and used them as
given. 0.31.0 treats them as missing. If that warning appeared on your data, the map now
differs:

| Value | Legal | Outside the range |
|---|---|---|
| `hbin`, `sbin` | whole numbers 0–32767 | the die has no bin — neither pass nor fail |
| `x`, `y` | whole numbers −32767 to 32767 | the die has no position, and is listed rather than drawn |
| test numbers (`testValues`/`testPass` keys, `TestDef.testNumber`, derived tests) | whole numbers 0–4294967295 | the test is left out |
| test values | finite numbers | the value is left out |
| `siteNum` | 0–255 | the die has no site |
| `waferConfig.orientation` | 0, 90, 180, 270 (or an equivalent such as −90) | the map is built at 0 |

Fix the data at its source, or convert it before building. A coordinate given as `1.5` is the
usual cause of a map losing its dies' positions: pass whole prober steps.
