export { toCanvas } from './toCanvas.js';
export type { ToCanvasOptions, ToCanvasResult, CanvasHitTarget, ViewportTransform } from './toCanvas.js';

import { renderWaferMap as _renderWaferMap } from './renderWaferMap.js';
import { renderWaferGallery as _renderWaferGallery } from './renderWaferGallery.js';
import type { Wafer } from '../core/wafer.js';
import type { Die } from '../core/dies.js';
import type { MountOptions, WaferCanvasController } from './renderWaferMap.js';
import type { GalleryItem, GalleryItemFactory, GalleryOptions, GalleryController } from './renderWaferGallery.js';

export type { MountOptions, WaferCanvasController, WaferSceneOptions } from './renderWaferMap.js';
export type { GalleryItem, GalleryItemFactory, GalleryOptions, GalleryController } from './renderWaferGallery.js';
export type { SummaryPanelOptions } from './summaryPanel.js';

/**
 * Render a single interactive wafer map into `container`.
 * The function creates and manages its own `<canvas>` — pass any block element
 * (e.g. a `<div>`) sized to the desired display area.
 *
 * @deprecated Passing an `HTMLCanvasElement` directly still works for one release
 * but will be removed — pass a container `<div>` instead.
 */
export function renderWaferMap(
  container: HTMLElement,
  wafer: Wafer,
  dies: Die[],
  options?: MountOptions,
): WaferCanvasController;

/**
 * Render an interactive wafer gallery (multiple cards) into `container`.
 * Equivalent to the deprecated `renderWaferGallery`.
 */
export function renderWaferMap(
  container: HTMLElement,
  items: Array<GalleryItem | GalleryItemFactory>,
  options?: GalleryOptions,
): GalleryController;

export function renderWaferMap(
  container: HTMLElement,
  waferOrItems: Wafer | Array<GalleryItem | GalleryItemFactory>,
  dieOrOptions?: Die[] | MountOptions | GalleryOptions,
  mountOptions?: MountOptions,
): WaferCanvasController | GalleryController {
  if (Array.isArray(waferOrItems)) {
    return _renderWaferGallery(container, waferOrItems, dieOrOptions as GalleryOptions);
  }
  if (Array.isArray(dieOrOptions)) {
    return _renderWaferMap(container, waferOrItems as Wafer, dieOrOptions as Die[], mountOptions);
  }
  // Should not reach here with correct TS usage — satisfy runtime safety.
  return _renderWaferMap(container, waferOrItems as Wafer, [], dieOrOptions as MountOptions);
}

/** @deprecated Use renderWaferMap instead. */
export const mountWaferCanvas = _renderWaferMap;

/** @deprecated Use renderWaferMap instead. */
export const renderWaferGallery = _renderWaferGallery;
