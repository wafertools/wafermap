// Once-per-name deprecation notices for public exports.
//
// A deprecated export is wrapped in its index file and nowhere else: the
// library's own code imports from the defining module, so it never trips the
// notice, and a host sees it once — the first time it calls the old name. The
// `@deprecated` JSDoc on the wrapped const is what makes an editor strike the
// name through; this notice covers plain-JavaScript callers, who get neither.
//
// Lives in renderer/ rather than core/ because it writes to the console, and
// core/ is side-effect free.

/**
 * The release that deletes an export deprecated through this helper, unless its
 * deprecation names a later one. Named in each notice and each `@deprecated` tag,
 * and held to by tests/deprecations.test.mjs, which fails once the changelog or
 * package.json reaches an export's removal release with it still here.
 */
export const DEPRECATED_REMOVAL_VERSION = '0.32.0';

/**
 * @internal The release that removes each deprecated name. A name deprecated
 * after the default removal release was scheduled gets a later one — a removal
 * must follow a release in which the name shipped deprecated, never coincide
 * with it.
 */
export const DEPRECATED_REMOVALS = new Map<string, string>();

/**
 * @internal Every name deprecated through this module, and whether it is a function
 * (which logs a notice) or a value (which cannot). tests/deprecations.test.mjs pins
 * it to the announced list, so a deprecation cannot be added or dropped silently.
 */
export const DEPRECATED_EXPORTS = new Map<string, 'function' | 'value'>();

const noticed = new Set<string>();

/**
 * @internal Log `message` once per `key` for the life of the page — the one
 * copy of the once-only rule, for export deprecations (`deprecated`) and for
 * notices about an option whose behaviour is changing, which is not an export
 * and so is not registered in DEPRECATED_EXPORTS or held to its removal.
 */
export function noticeOnce(key: string, message: string): void {
  if (noticed.has(key)) return;
  noticed.add(key);
  console.warn(`[wafermap] ${message}`);
}

/**
 * @internal Wrap `fn` so its first call logs one notice naming `name` and `advice`.
 * The wrapper has exactly `fn`'s type — generics and overloads included — so a
 * deprecated export's signature does not change until it is removed.
 */
export function deprecated<F extends (...args: never[]) => unknown>(
  fn: F, name: string, advice: string, removal: string = DEPRECATED_REMOVAL_VERSION,
): F {
  DEPRECATED_EXPORTS.set(name, 'function');
  DEPRECATED_REMOVALS.set(name, removal);
  const call = fn as unknown as (...args: unknown[]) => unknown;
  return ((...args: unknown[]) => {
    noticeOnce(name, `${name} is deprecated and will be removed in ${removal}. ${advice}`);
    return call(...args);
  }) as unknown as F;
}

/**
 * @internal Register a deprecated constant. A value cannot log on use, so its
 * `@deprecated` tag and the changelog are the only announcement.
 */
export function deprecatedValue<T>(value: T, name: string, removal: string = DEPRECATED_REMOVAL_VERSION): T {
  DEPRECATED_EXPORTS.set(name, 'value');
  DEPRECATED_REMOVALS.set(name, removal);
  return value;
}
