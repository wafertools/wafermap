/**
 * Names for saved files — the one rule for every PNG and CSV the library saves.
 *
 * Every export used to be named for its content alone (`dies.csv`,
 * `test-values.csv`, `wafermap.png`, a chart's title), so saving the same export
 * from two wafers gave `dies.csv` and `dies (1).csv`, and nothing in the file
 * name said which lot or wafer either one described. The library has that
 * identity, so naming the file is its job, not the host's.
 *
 * The split: a save site names only its CONTENT (`die-list.csv`, the map's
 * title) and keeps passing its `onSaveImage`/`onSaveText` handler as before.
 * Each renderer wraps the host's handlers once with `withExportContext`, which
 * prepends the context it knows — the host's `downloadFilename` prefix, the lot,
 * the wafer or wafer count — read at save time, so the name follows
 * `setResult`, `setItems` and mode changes. No save site threads identity.
 *
 * @internal Not exported from the package: hosts receive the result as the
 * `suggestedName` argument of their save hooks.
 */

import { downloadBlob, type SaveImageHandler, type SaveTextHandler } from './toolbar.js';

/** What a renderer knows about the data behind an export. */
export interface ExportContext {
  /** The host's `downloadFilename`: leads the name, and suppresses any context it already names. */
  prefix?: string;
  /** Distinct lot IDs covered, in display order. */
  lots: string[];
  /** One wafer's identity (`waferIdentityLabel`), when the export covers exactly one. */
  wafer?: string;
  /** Wafers covered, when the export covers several (a gallery or lot). */
  waferCount?: number;
  /** Set on a lot-stacked map: the wafers aggregated into it, or `true` when unknown. */
  stackedWafers?: number | true;
}

/** Longest a single name segment may run before it is cut. */
const MAX_SEGMENT = 60;
/** Longest the whole name (before the extension) may run. */
const MAX_STEM = 180;
/** Device names Windows refuses as a file name, whatever the extension. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/**
 * One segment made safe for every common filesystem: letters and digits in any
 * script, and `. _ + -`, are kept; runs of anything else (spaces,
 * `/ \ : * ? " < > |`, `·`, brackets) become a single `-`; leading and trailing
 * separators are dropped. `_` is kept so a host prefix like `LOT123_sort`
 * survives as written.
 */
function safeSegment(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}._+-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, MAX_SEGMENT)
    .replace(/[-._]+$/g, '');
}

/** An identity value that is only digits reads as a count or index in a file name — label it. */
function labelled(kind: 'lot' | 'wafer', value: string): string {
  return /^\d+$/.test(value) ? `${kind}-${value}` : value;
}

/** True when `segment` already appears in `prefix` as a whole separator-bounded run. */
function prefixNames(prefix: string, segment: string): boolean {
  const hay = `_${prefix.toLowerCase().replace(/[-_.\s]+/g, '_')}_`;
  const needle = `_${segment.toLowerCase().replace(/[-_.\s]+/g, '_')}_`;
  return hay.includes(needle);
}

/**
 * The file name for an export: `prefix_lot_wafer_content.ext`, each part only
 * when known and not already named by the prefix.
 *
 * @param ctx         what the renderer knows (see `ExportContext`)
 * @param contentName the save site's own name, with extension — e.g.
 *                    `die-list.csv`, or a map title plus `.png`
 */
export function buildExportFilename(ctx: ExportContext, contentName: string): string {
  const dot = contentName.lastIndexOf('.');
  const ext = dot >= 0 ? contentName.slice(dot) : '';
  const content = safeSegment(dot >= 0 ? contentName.slice(0, dot) : contentName).toLowerCase();

  const prefix = ctx.prefix?.trim() ? safeSegment(ctx.prefix) : '';

  // Context segments, each with the raw value used to test the prefix — so a
  // prefix of `123_sort` suppresses lot `123` even though it is written `lot-123`.
  const context: Array<{ raw: string; text: string }> = [];
  if (ctx.lots.length === 1) {
    context.push({ raw: ctx.lots[0], text: labelled('lot', ctx.lots[0]) });
  } else if (ctx.lots.length > 1) {
    context.push({ raw: `${ctx.lots.length}-lots`, text: `${ctx.lots.length}-lots` });
  }
  if (ctx.stackedWafers !== undefined) {
    const t = ctx.stackedWafers === true ? 'stacked' : `stacked-${ctx.stackedWafers}-wafer${ctx.stackedWafers === 1 ? '' : 's'}`;
    context.push({ raw: t, text: t });
  } else if (ctx.wafer !== undefined) {
    context.push({ raw: ctx.wafer, text: labelled('wafer', ctx.wafer) });
  } else if (ctx.waferCount !== undefined && ctx.waferCount > 1) {
    context.push({ raw: `${ctx.waferCount}-wafers`, text: `${ctx.waferCount}-wafers` });
  }

  const parts = [prefix];
  for (const { raw, text } of context) {
    const seg = safeSegment(text);
    if (!seg) continue;
    if (prefix && (prefixNames(prefix, safeSegment(raw)) || prefixNames(prefix, seg))) continue;
    parts.push(seg);
  }
  parts.push(content);

  let stem = parts.filter(Boolean).join('_').slice(0, MAX_STEM).replace(/[-_.]+$/g, '');
  if (!stem) stem = 'wafermap';
  if (WINDOWS_RESERVED.test(stem)) stem = `wafermap-${stem}`;
  return `${stem}${ext}`;
}

/**
 * Wrap a renderer's save hooks so every export it makes is named by
 * `buildExportFilename`. The returned handlers are always defined: with no host
 * hook they perform the browser download themselves, so a save site cannot
 * bypass the naming by falling through to its own default path.
 *
 * Hand the host's RAW hooks, never these, to anything that wraps again (a
 * gallery card or detached window is its own renderer with its own context) —
 * wrapping twice would name the lot twice.
 */
export function withExportContext(
  getContext: () => ExportContext,
  onSaveImage: SaveImageHandler | undefined,
  onSaveText: SaveTextHandler | undefined,
): { onSaveImage: SaveImageHandler; onSaveText: SaveTextHandler } {
  return {
    onSaveImage: (blob, suggestedName) => {
      const name = buildExportFilename(getContext(), suggestedName);
      if (onSaveImage) return onSaveImage(blob, name);
      downloadBlob(blob, name);
    },
    onSaveText: (text, suggestedName, mimeType) => {
      const name = buildExportFilename(getContext(), suggestedName);
      if (onSaveText) return onSaveText(text, name, mimeType);
      downloadBlob(new Blob([text], { type: mimeType }), name);
    },
  };
}
