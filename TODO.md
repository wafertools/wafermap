# TODO / Future Considerations

Items here are ideas or half-designed features that need more thought before implementation.

---

## Gallery card removal (× button)

**Idea:** Add an × close button to each gallery card so users can remove individual wafers from the gallery without the host calling `setItems()`.

**What's straightforward:**
- Remove the card from the DOM and from `currentItems` / `originalItems` / `cardControllers` / `cardContainers`
- Rebuild the legend and grid layout (both already read from `currentItems`)
- Clear finding highlights (`clearLotFindingHighlight()`) since card indices shift
- Fire an `onRemoveItem(index, item)` callback so the host can mirror the removal in its own state
- Hide/disable the × in stacked modes (cards are synthetic aggregates, not individual wafers)

**Open questions:**

1. **Who re-runs `analyzeWaferLot`?**  
   `currentLotStats` is externally computed and passed in — the gallery has no way to recompute it after a wafer is removed. Options:
   - Host is responsible: `onRemoveItem` callback prompts the host to call `analyzeWaferLot()` and then `setLotStatsSummary()`.
   - Gallery is responsible: wire `analyzeWaferLot` from the stats package into the gallery so it can recompute internally. The dependency already exists for stacked modes (`analyzeWaferMap`), but lot-level stats is a bigger step.

2. **What happens to the summary panel in the interim?**  
   If the host is responsible for recomputing, lot-level stats are stale the moment a card is removed. Options:
   - Proactively hide/disable the summary panel on removal and restore it when `setLotStatsSummary()` is called with fresh data — never shows stale state.
   - Leave it open but mark it stale somehow.
   - Only show the summary panel if the host opted in to managing stats updates.

3. **Is this the right UX at all?**  
   An alternative is to leave removal as a pure host concern (host manages the items array and calls `setItems()`), and just make `setItems()` cheaper/smoother for the partial-removal case rather than adding internal removal logic.
