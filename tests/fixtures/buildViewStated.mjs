// `buildView` with the pass bins a view unit test judges by, stated.
//
// `buildView` has no default pass bins: a view built without them is refused, because a default could count a failing
// bin as a pass. A test of the view's drawing, not of its pass bins, builds a hand-made wafer with no built map behind
// it, so it states `passBins: [1]` here rather than in each of its calls. A test of what the pass bins change passes its
// own (an explicit `passBins` in the options wins).
import { buildView as buildViewRaw } from '../../dist/packages/renderer/buildView.js';

export function buildView(wafer, dies, options = {}, defs) {
  return buildViewRaw(wafer, dies, { passBins: [1], ...options }, defs);
}
