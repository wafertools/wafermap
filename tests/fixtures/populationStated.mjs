// `selectionPopulation` / `waferPopulation` with the pass bins and ring count a test's wafer was built with, stated.
//
// A drilldown population carries its wafer's own pass bins and ring count, and has no default for either: a chart or
// table of these dies that judged by a guess could state a wrong yield or draw the wrong rings. The tests here use hand-made
// facts rather than a built map, so they state `passBins: [1]` and `ringCount: 4` once, here; an explicit value in a
// test's own facts wins.
import { selectionPopulation as selection, waferPopulation as wafer } from '../../dist/packages/canvas-adapter/chartPopulation.js';

const stated = { passBins: [1], ringCount: 4 };
export const selectionPopulation = (dies, facts) => selection(dies, { ...stated, ...facts });
export const waferPopulation = (dies, facts) => wafer(dies, { ...stated, ...facts });
