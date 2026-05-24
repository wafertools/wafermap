export { toCanvas } from './toCanvas.js';
export type { ToCanvasOptions, ToCanvasResult, CanvasHitTarget, ViewportTransform } from './toCanvas.js';

import { renderWaferMap as _renderWaferMap } from './renderWaferMap.js';
import { renderWaferGallery as _renderWaferGallery } from './renderWaferGallery.js';
import type { WaferMapResult } from '../renderer/buildWaferMap.js';
import type { RenderOptions, WaferCanvasController } from './renderWaferMap.js';
import type { WaferMapDisplayItem, WaferMapDisplayItemFactory, GalleryOptions, GalleryController } from './renderWaferGallery.js';

export type { RenderOptions, MountOptions, WaferCanvasController, WaferViewOptions } from './renderWaferMap.js';
export type { WaferMapDisplayItem, WaferMapDisplayItemFactory, GalleryOptions, GalleryController } from './renderWaferGallery.js';
export type { SummaryPanelOptions } from './summaryPanel.js';

/**
 * Render a single interactive wafer map into `container`.
 * Pass the `WaferMapResult` returned by `buildWaferMap` directly.
 * The function creates and manages its own `<canvas>` — pass any block element
 * (e.g. a `<div>`) sized to the desired display area.
 */
export function renderWaferMap(
  container: HTMLElement,
  result: WaferMapResult,
  options?: RenderOptions,
): WaferCanvasController;

/**
 * Render an interactive wafer gallery (multiple cards) into `container`.
 * Pass an array of `WaferMapResult` objects, optionally with display overrides
 * (`label`, `statsSummary`, `viewOptions`, `onClick`, `onSelect`) spread in.
 */
export function renderWaferMap(
  container: HTMLElement,
  items: Array<WaferMapDisplayItem | WaferMapDisplayItemFactory>,
  options?: GalleryOptions,
): GalleryController;

export function renderWaferMap(
  container: HTMLElement,
  resultOrItems: WaferMapResult | Array<WaferMapDisplayItem | WaferMapDisplayItemFactory>,
  options?: RenderOptions | GalleryOptions,
): WaferCanvasController | GalleryController {
  if (Array.isArray(resultOrItems)) {
    if (resultOrItems.length === 1 && typeof resultOrItems[0] !== 'function') {
      return _renderWaferMap(container, resultOrItems[0], options as RenderOptions);
    }
    return _renderWaferGallery(container, resultOrItems, options as GalleryOptions);
  }
  return _renderWaferMap(container, resultOrItems, options as RenderOptions);
}
