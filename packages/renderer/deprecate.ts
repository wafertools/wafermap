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
 * The release that deletes every export deprecated through this helper. Named in
 * each notice and each `@deprecated` tag, and held to by tests/deprecations.test.mjs,
 * which fails once the changelog or package.json reaches it with them still here.
 */
export const DEPRECATED_REMOVAL_VERSION = '0.31.0';

/**
 * @internal Every name deprecated through this module, and whether it is a function
 * (which logs a notice) or a value (which cannot). tests/deprecations.test.mjs pins
 * it to the announced list, so a deprecation cannot be added or dropped silently.
 */
export const DEPRECATED_EXPORTS = new Map<string, 'function' | 'value'>();

const noticed = new Set<string>();

/**
 * @internal Wrap `fn` so its first call logs one notice naming `name` and `advice`.
 * The wrapper has exactly `fn`'s type — generics and overloads included — so a
 * deprecated export's signature does not change until it is removed.
 */
export function deprecated<F extends (...args: never[]) => unknown>(fn: F, name: string, advice: string): F {
  DEPRECATED_EXPORTS.set(name, 'function');
  const call = fn as unknown as (...args: unknown[]) => unknown;
  return ((...args: unknown[]) => {
    if (!noticed.has(name)) {
      noticed.add(name);
      console.warn(`[wafermap] ${name} is deprecated and will be removed in ${DEPRECATED_REMOVAL_VERSION}. ${advice}`);
    }
    return call(...args);
  }) as unknown as F;
}

/**
 * @internal Register a deprecated constant. A value cannot log on use, so its
 * `@deprecated` tag and the changelog are the only announcement.
 */
export function deprecatedValue<T>(value: T, name: string): T {
  DEPRECATED_EXPORTS.set(name, 'value');
  return value;
}
