// Saved filters and their file. A saved filter is a named set of conditions (`PlotFilter` without its on/off switch,
// which belongs to the filter in force), kept by the host and moved between machines as a `wafermap-filters` file: JSON,
// written and read like a plots file, so a hand-written or host-generated one is as welcome as an exported one.

import { addIdentified, readFilter, readIdentified, unwrapListFile, type PlotCondition } from './plotSpec.js';
import { newFilterId } from './plotId.js';

export const FILTERS_FORMAT = 'wafermap-filters';
export const FILTERS_VERSION = 1;

/** A named filter. `id` tells it apart from its copies; `name` is what the picker lists. */
export interface SavedFilter {
  id: string;
  name: string;
  conditions: PlotCondition[];
}

export interface ReadFiltersResult {
  filters: SavedFilter[];
  /** Problems that dropped a filter, a condition or a setting, each naming where. */
  warnings: string[];
  /** Set when nothing could be read at all: the file as a whole is rejected. */
  error?: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The filters in a list the host or a file gave: lenient, so a filter that can be read is kept and each problem named.
 * A filter written as a bare `{ field, values }` is a list of one condition; a missing name becomes "Filter N"; a repeated
 * id is given a new one.
 */
export function readSavedFilters(list: readonly unknown[], where = 'filters'): { filters: SavedFilter[]; warnings: string[] } {
  const warnings: string[] = [];
  const filters = readIdentified<SavedFilter>(list, warnings, {
    labelOf: (raw, i) => `"${nameOf(raw, i)}"`,
    read: (raw, label, warn) => {
      const i = list.indexOf(raw);
      if (!isObject(raw)) { warn.push(`${where}[${i}]: not a filter, left out`); return undefined; }
      const read = readFilter(raw, `${where}[${i}] ${label}`, warn);
      if (!read) { warn.push(`${where}[${i}] ${label}: has no condition that can be read, left out`); return undefined; }
      const { off: _off, ...rest } = read;
      return { ...rest, id: typeof raw.id === 'string' && raw.id ? raw.id : newFilterId(), name: nameOf(raw, i) };
    },
    newId: newFilterId,
  });
  return { filters, warnings };
}

const nameOf = (raw: unknown, i: number): string => (isObject(raw) && typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : `Filter ${i + 1}`);

/**
 * Reads a filters file. Lenient like the plots file: every filter that can be read is kept and each problem is named;
 * only a file with nothing usable is an error. A bare array of filters is accepted as well as the wrapped form.
 */
export function readFiltersFile(text: string): ReadFiltersResult {
  const file = unwrapListFile(text, { format: FILTERS_FORMAT, noun: 'filters', key: 'filters', version: FILTERS_VERSION });
  if ('error' in file) return { filters: [], warnings: [], error: file.error };
  const { list, warnings } = file;
  const read = readSavedFilters(list);
  if (read.filters.length === 0 && list.length > 0) return { filters: [], warnings: [...warnings, ...read.warnings], error: 'No filter in the file could be read' };
  return { filters: read.filters, warnings: [...warnings, ...read.warnings] };
}

/** The file for `filters`: wrapped, versioned, with every setting (including ones this build does not know). */
export function writeFiltersFile(filters: readonly SavedFilter[]): string {
  return JSON.stringify({ format: FILTERS_FORMAT, version: FILTERS_VERSION, filters }, null, 2) + '\n';
}

/**
 * Adds `incoming` to `existing`, never replacing: an import must not overwrite a filter the reader has edited since.
 * One whose id is already in use is added as a copy under a new id, and the names of those are returned.
 */
export function addSavedFilters(existing: readonly SavedFilter[], incoming: readonly SavedFilter[]): { filters: SavedFilter[]; copies: string[] } {
  const { items, copies } = addIdentified(existing, incoming, f => f.name, newFilterId);
  return { filters: items, copies };
}
