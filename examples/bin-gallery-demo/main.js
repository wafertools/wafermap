import { buildWaferMap, getUniqueBins, aggregateBinCounts } from 'wafermap';
import { renderWaferGallery } from 'wafermap/canvas-adapter';

const PITCH = 10;
const WAFER_DIAMETER = 150;
const WAFER_IDS = ['W01', 'W02', 'W03', 'W04', 'W05', 'W06'];

const HBIN_DEFS = [
  { bin: 1, name: 'Pass' },
  { bin: 2, name: 'Leakage' },
  { bin: 3, name: 'Vth Shift' },
  { bin: 5, name: 'Contact Open' },
  { bin: 7, name: 'Parametric Low' },
];

async function main() {
  const rows = await loadCsv('../../data/dummy-fulldata.csv');

  // Establish geometry from the first wafer — reuse the same die grid for all.
  const W01rows = rows.filter(r => r.wafer === WAFER_IDS[0]);
  const firstRow = W01rows[0] ?? {};

  const template = buildWaferMap({
    results: W01rows.map(r => ({ x: Number(r.x), y: Number(r.y), hbin: Number(r.hbin) })),
    waferConfig: {
      diameter: WAFER_DIAMETER,
      notch: { type: 'bottom' },
      metadata: { lot: firstRow.lot ?? 'LOT456', testDate: firstRow.testdate ?? '—' },
    },
    dieConfig: { width: PITCH, height: PITCH },
  });

  const templateDies = template.dies;
  const wafer = template.wafer;

  // Enrich each wafer's dies from the full dataset.
  const diesByWafer = WAFER_IDS.map(waferId => {
    const waferRows = rows.filter(r => r.wafer === waferId);
    const rowMap = new Map(waferRows.map(r => [`${r.x},${r.y}`, r]));
    return templateDies.map(die => {
      const row = rowMap.get(`${die.i},${die.j}`);
      return row
        ? { ...die, hbin: Number(row.hbin), values: [Number(row.testA)] }
        : { ...die, hbin: 0, values: [0] };
    });
  });

  const uniqueBins = getUniqueBins(diesByWafer.flat());
  const numWafers = diesByWafer.length;
  const hbinDefMap = new Map(HBIN_DEFS.map(b => [b.bin, b]));

  // Build one gallery item per hard bin. All share valueRange so maps are comparable.
  const items = uniqueBins.map(bin => {
    const dies = aggregateBinCounts(diesByWafer, bin);
    const totalOccurrences = dies.reduce((sum, d) => sum + (d.values?.[0] ?? 0), 0);
    const affectedPositions = dies.filter(d => (d.values?.[0] ?? 0) > 0).length;
    const binName = hbinDefMap.get(bin)?.name ?? `Bin ${bin}`;
    return {
      wafer,
      dies,
      label: `${binName} · ${affectedPositions} positions · ${totalOccurrences} total`,
    };
  });

  renderWaferGallery(
    document.getElementById('gallery'),
    items,
    {
      sceneOptions: { plotMode: 'value', valueRange: [0, numWafers], colorScheme: 'viridis', hbinDefs: HBIN_DEFS },
      downloadFilename: 'bin-occurrence-map',
    },
  );
}

async function loadCsv(path) {
  const text = await (await fetch(path)).text();
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(',');
  return lines.filter(Boolean).map(line => {
    const values = line.split(',');
    return Object.fromEntries(headers.map((h, i) => [h, values[i]]));
  });
}

main().catch(err => {
  document.getElementById('gallery').textContent = `Failed to load: ${err.message}`;
});
