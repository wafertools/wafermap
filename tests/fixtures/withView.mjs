// Rebuild a map's draw list under view options, the way renderWaferMap does on
// each option change: buildWaferMap takes no view options, so a test that needs
// the drawn geometry under a rotation, flip or overlay builds the view itself,
// from the result's own wafer, dies, reticles and axis flip.
import { buildView } from '../../dist/packages/renderer/buildView.js';

export function withView(result, viewOpts = {}) {
  const view = buildView(result.wafer, result.dies.filter((d) => d.x != null && d.y != null), {
    plotMode:     result.plotMode,
    testDefs:     result.testDefs,
    passBins:     result.passBins,
    ringCount:    result.ringCount,
    reticles:     result.reticles,
    showReticle:  (result.reticles?.length ?? 0) > 0,
    dataAxisFlip: result.view.dataAxisFlip,
    ...viewOpts,
  }, { hbinDefs: result.hbinDefs, sbinDefs: result.sbinDefs });
  return { ...result, view };
}
