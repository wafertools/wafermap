// Suggestions for the plot editor's JSON text: what could be written at the caret.
//
// DOM-free, so it is tested without a browser: `completionsAt(text, caret, source)` reads the text before the caret
// to find where in the JSON it is (a key of the plot, of its fields, of one field; or the value of a setting), and
// answers with the range to replace and the items to offer. The words a setting may take come from `PLOT_CHOICES`,
// the table the reader checks a plot against, so a suggestion is never refused on Apply. The lot's own tests and
// wafer fields come from the `source` the editor passes.
//
// It only suggests: Apply and the status line are still what judge the text, and text that is half written, or not
// JSON yet, simply gets no suggestions.

import { PLOT_BIN_BY, PLOT_BUILTINS, PLOT_CHOICES, PLOT_JUDGES, type PlotField } from '../stats/plotSpec.js';

export interface CompletionSource {
  /** The lot's tests, for the number of a `test` or `passRate` field. */
  tests?: ReadonlyArray<{ number: number; name?: string }>;
  /** The values a condition on `field` can name in its `values` list: what the lot holds for that field. */
  conditionValues?: (field: PlotField) => readonly string[];
  /** The lot's wafer fields, for a `meta` field: the key, and the name the field list shows for it. */
  metaKeys?: ReadonlyArray<{ key: string; label?: string }>;
  /** The gradients a plot's colours can take, by name and the name to show. */
  gradients?: ReadonlyArray<{ name: string; label?: string }>;
  /** One line about a word a setting can take (a chart, an aggregate), shown beside it. */
  describe?: (setting: string, value: string) => string | undefined;
}

export interface CompletionItem {
  /** What the list shows. */
  label: string;
  /** What replaces the range: with its quotes, and the colon after a key, as it is written in the text. */
  insert: string;
  detail?: string;
}

export interface Completion {
  /** The text from `from` to `to` is replaced by the chosen item's `insert`. */
  from: number;
  to: number;
  items: CompletionItem[];
  /** What the reader has typed of the word being completed (empty at a bare position): the list is for that word. */
  typed: string;
}

interface Frame {
  /** Where the container opens in the text. */
  start: number;
  kind: 'object' | 'array';
  /** The key this container is the value of (`[]` inside a list); undefined for the root. */
  key?: string;
  expect: 'key' | 'colon' | 'value' | 'comma';
  /** The key just read (an object), whose value is next. */
  current?: string;
  /** Every key of the object so far, so one already written is not offered again. */
  seen: Set<string>;
}

const FIELD_ROLES = ['x', 'y', 'color', 'rows', 'facet'];
const FIELD_KEYS: Array<[string, string]> = [
  ['test', 'A measured test, by number'], ['name', 'The test’s name when the plot was made'], ['builtin', 'A built-in field: wafer, ring, bin…'],
  ['meta', 'A wafer field of the lot: a split, a lot'], ['passRate', 'A test’s pass rate, by number'], ['judge', 'Judge a pass rate by limits or by the tester flag'],
  ['tests', 'A set of tests, as numbers or ranges'], ['names', 'The names of the tests of a set'], ['binned', 'Put a value into ranges'],
  ['bins', 'How many ranges'], ['by', 'Ranges of equal count or equal width'],
];
const AXIS_KEYS = ['label', 'scale', 'min', 'max', 'reverse', 'includeLimits', 'clip', 'references'];
const ROOT_KEYS = [
  'chart', 'title', 'fields', 'level', 'aggregate', 'normalize', 'axes', 'where', 'limits', 'bins', 'stack', 'sort', 'top', 'barNorm', 'histNorm',
  'orientation', 'valueLabels', 'cumulative', 'spread', 'fit', 'identity', 'normalCurve', 'whatIf', 'baseline', 'probabilityAxis', 'sweep',
  'colorGradient', 'colorReverse',
];
const SWEEP_KEYS = ['series', 'xLabel', 'xUnit', 'yLabel', 'xScale', 'crossing', 'separationAt'];
const SERIES_KEYS = ['label', 'tests', 'xValues', 'xFromName', 'testNames'];
const BOOLEANS = new Set(['valueLabels', 'cumulative', 'identity', 'normalCurve', 'not', 'off', 'reverse', 'includeLimits', 'clip', 'crossing', 'colorReverse']);
const WORD = /[A-Za-z0-9_.+-]/;

/** Where the text before the caret leaves it. */
interface Where {
  frames: Frame[];
  /** The string the caret is in, or undefined. */
  string?: { start: number; prefix: string };
  /** The bare word (a number, true) the caret ends, or undefined. */
  bare?: { start: number; prefix: string };
}

function locate(text: string, caret: number): Where | undefined {
  const frames: Frame[] = [];
  const top = (): Frame | undefined => frames[frames.length - 1];
  const valueDone = (): void => { const t = top(); if (t) t.expect = 'comma'; };
  let i = 0;
  while (i < caret) {
    const c = text[i];
    if (c === ' ' || c === '\n' || c === '\r' || c === '\t') { i++; continue; }
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"' && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      // The caret is inside the string (before its closing quote), or the string never closes on its line.
      if (j >= caret || j >= text.length || text[j] !== '"') return { frames, string: { start: i, prefix: text.slice(i + 1, caret) } };
      const t = top();
      if (t?.kind === 'object' && t.expect === 'key') { t.current = text.slice(i + 1, j); t.seen.add(t.current); t.expect = 'colon'; } else valueDone();
      i = j + 1;
      continue;
    }
    if (c === '{' || c === '[') {
      const t = top();
      frames.push({ start: i, kind: c === '{' ? 'object' : 'array', key: t ? (t.kind === 'array' ? '[]' : t.current) : undefined, expect: c === '{' ? 'key' : 'value', seen: new Set() });
      i++;
      continue;
    }
    if (c === '}' || c === ']') { frames.pop(); valueDone(); i++; continue; }
    if (c === ':') { const t = top(); if (t) t.expect = 'value'; i++; continue; }
    if (c === ',') { const t = top(); if (t) t.expect = t.kind === 'object' ? 'key' : 'value'; i++; continue; }
    if (WORD.test(c)) {
      let j = i;
      while (j < text.length && WORD.test(text[j])) j++;
      if (j >= caret) return { frames, bare: { start: i, prefix: text.slice(i, caret) } };
      valueDone();
      i = j;
      continue;
    }
    return undefined;   // not JSON here: no suggestions
  }
  return { frames };
}

/** The path of keys from the root to the container the caret is in (`[]` for a list), and that container. */
const pathOf = (frames: Frame[]): string[] => frames.slice(1).map(f => f.key ?? '');

/** The keys an object at `path` may have, with a line about each where there is one. */
function keysAt(path: string[]): Array<[string, string | undefined]> | undefined {
  const p = path.join('/');
  if (p === '') return ROOT_KEYS.map(k => [k, undefined]);
  if (p === 'fields') return FIELD_ROLES.map(k => [k, undefined]);
  const last = path[path.length - 1];
  if (path[0] === 'fields' && (path.length === 2 || (path.length === 3 && last === '[]') || last === 'binned')) {
    const roleKeys: Array<[string, string | undefined]> = path[1] === 'color' ? [['follow', 'Follow Group by'], ['none', 'A single colour']] : [];
    return [...roleKeys, ...FIELD_KEYS];
  }
  if (p === 'axes') return [['x', undefined], ['y', undefined]];
  if (path[0] === 'axes' && path.length === 2) return AXIS_KEYS.map(k => [k, undefined]);
  if (p === 'where') return [['conditions', undefined], ['off', undefined]];
  if (p === 'where/conditions/[]') return [['field', undefined], ['values', undefined], ['min', undefined], ['max', undefined], ['not', undefined]];
  if (p === 'where/conditions/[]/field') return FIELD_KEYS;
  if (p === 'whatIf') return [['lo', undefined], ['hi', undefined]];
  if (p === 'sweep') return SWEEP_KEYS.map(k => [k, undefined]);
  if (p === 'sweep/series/[]') return SERIES_KEYS.map(k => [k, undefined]);
  return undefined;
}

/** True when the object at `path` is a field (so `test`, `builtin` and `meta` mean what they say there). */
const isFieldPath = (path: string[]): boolean => {
  const p = path.join('/');
  const last = path[path.length - 1];
  return (path[0] === 'fields' && (path.length === 2 || (path.length === 3 && last === '[]') || last === 'binned')) || p === 'where/conditions/[]/field';
};

interface ValueSet { words: ReadonlyArray<{ word: string; detail?: string }>; kind: 'string' | 'number' | 'boolean' }

/** The values `setting` may take in the object at `path`, or undefined when nothing can be suggested. */
function valuesAt(path: string[], setting: string, src: CompletionSource, inList: boolean, conditionText?: string): ValueSet | undefined {
  const words = (list: readonly string[], key = setting) => list.map(word => ({ word, detail: src.describe?.(key, word) }));
  // The values a filter condition names: what the lot holds for the condition's own field.
  if (inList && setting === 'values' && path.join('/') === 'where/conditions/[]' && src.conditionValues && conditionText) {
    const meta = /"meta"\s*:\s*"([^"]+)"/.exec(conditionText), builtin = /"builtin"\s*:\s*"([^"]+)"/.exec(conditionText), test = /"test"\s*:\s*(\d+)/.exec(conditionText);
    const field = (meta ? { meta: meta[1] } : builtin ? { builtin: builtin[1] } : test ? { test: Number(test[1]) } : undefined) as PlotField | undefined;
    const vs = field ? src.conditionValues(field) : [];
    return vs.length ? { kind: 'string', words: vs.map(word => ({ word })) } : undefined;
  }
  if (path.length === 0 && setting in PLOT_CHOICES) {
    return { kind: 'string', words: words(PLOT_CHOICES[setting as keyof typeof PLOT_CHOICES]) };
  }
  if (path.length === 0 && setting === 'colorGradient') {
    return src.gradients?.length ? { kind: 'string', words: src.gradients.map(c => ({ word: c.name, detail: c.label && c.label !== c.name ? c.label : undefined })) } : undefined;
  }
  if (isFieldPath(path)) {
    if (setting === 'builtin') return { kind: 'string', words: PLOT_BUILTINS.map(word => ({ word, detail: src.describe?.('builtin', word) })) };
    if (setting === 'meta') return src.metaKeys?.length ? { kind: 'string', words: src.metaKeys.map(m => ({ word: m.key, detail: m.label && m.label !== m.key ? m.label : undefined })) } : undefined;
    if (setting === 'judge') return { kind: 'string', words: words(PLOT_JUDGES) };
    if (setting === 'by') return { kind: 'string', words: words(PLOT_BIN_BY) };
    if ((setting === 'test' || setting === 'passRate' || (setting === 'tests' && inList)) && src.tests?.length) {
      return { kind: 'number', words: src.tests.map(t => ({ word: String(t.number), detail: t.name })) };
    }
  }
  if ((path[0] === 'axes' && path.length === 2 && setting === 'scale') || (path.length === 1 && path[0] === 'sweep' && setting === 'xScale')) return { kind: 'string', words: words(['linear', 'log']) };
  if (setting === 'follow') return { kind: 'string', words: words(['groupBy']) };
  if (BOOLEANS.has(setting) || (setting === 'none' && path[0] === 'fields')) return { kind: 'boolean', words: [{ word: 'true' }, { word: 'false' }] };
  return undefined;
}

/** Items whose label starts with, then contains, what is typed; nothing when it is already exactly one of them. */
function filtered<T extends { label: string }>(items: T[], typed: string): T[] {
  const t = typed.toLowerCase();
  if (items.some(i => i.label === typed)) return [];
  const starts = items.filter(i => i.label.toLowerCase().startsWith(t));
  const has = items.filter(i => !i.label.toLowerCase().startsWith(t) && i.label.toLowerCase().includes(t));
  return [...starts, ...has];
}

/**
 * What could be written at `caret`, or undefined for nothing. `force` (Ctrl+Space) also answers where nothing has been
 * typed yet; otherwise a suggestion needs the reader to be inside a string, or to have started a number.
 */
export function completionsAt(text: string, caret: number, source: CompletionSource = {}, o: { force?: boolean; as?: 'filter' } = {}): Completion | undefined {
  const at = locate(text, caret);
  const frame = at?.frames[at.frames.length - 1];
  if (!at || !frame) return undefined;
  // A filter is the document itself; as a plot's `where` it is one level down, and the same schema describes it.
  const path = [...(o.as === 'filter' ? ['where'] : []), ...pathOf(at.frames)];
  const typed = at.string ? at.string.prefix : at.bare ? at.bare.prefix : '';
  if (!at.string && !at.bare && !o.force) return undefined;

  // Where the replaced range runs: a string to its closing quote, a bare word to its end, nothing to the caret.
  let from = caret, to = caret;
  if (at.string) {
    from = at.string.start;
    const close = text.indexOf('"', caret);
    const eol = text.indexOf('\n', caret);
    to = close >= 0 && (eol < 0 || close < eol) ? close + 1 : caret;
  } else if (at.bare) {
    from = at.bare.start;
    to = caret;
    while (to < text.length && WORD.test(text[to])) to++;
  }

  if (frame.kind === 'object' && frame.expect === 'key') {
    const keys = (keysAt(path) ?? []).filter(([k]) => !frame.seen.has(k));
    if (!keys.length) return undefined;
    // A key is written with its colon unless one follows already, and takes the space after it from the text when there is one.
    const colon = /^\s*:/.test(text.slice(to)) ? '' : /^\s/.test(text.slice(to)) ? ':' : ': ';
    const items = filtered(keys.map(([k, detail]) => ({ label: k, insert: `"${k}"${colon}`, detail })), typed);
    return items.length ? { from, to, items, typed } : undefined;
  }

  const inList = frame.kind === 'array';
  const setting = inList ? (frame.key ?? '') : frame.current;
  if (setting === undefined || (frame.kind === 'object' && frame.expect !== 'value')) return undefined;
  // A list's own container is the object path: `tests` sits in the field object, one level up from the `[]`.
  const owner = inList ? path.slice(0, -1) : path;
  const parent = at.frames[at.frames.length - 2];
  const set = valuesAt(owner, setting, source, inList, inList && parent ? text.slice(parent.start, caret) : undefined);
  if (!set) return undefined;
  // A number or true/false cannot be written inside quotes; a number being typed is digits.
  if (at.string && set.kind !== 'string') return undefined;
  if (set.kind === 'number' && at.bare && !/^\d*$/.test(typed)) return undefined;
  // Straight after a colon, a value is given its space.
  const lead = !at.string && !at.bare && text.slice(0, from).endsWith(':') ? ' ' : '';
  const items = filtered(set.words.map(w => ({
    label: w.word, detail: w.detail,
    insert: lead + (set.kind === 'string' ? `"${w.word}"` : w.word),
  })), typed);
  return items.length ? { from, to, items, typed } : undefined;
}
