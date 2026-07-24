/**
 * A memoized async factory: calling it returns the same instance every time.
 */
export interface LazySingleton<T> {
  (): Promise<T>;
  /** Drops the cached instance so the next call builds a new one. Intended for tests. */
  reset(): void;
}

/**
 * Wraps an async factory so that it runs at most once and its result is reused.
 *
 * Building dependencies at module load is unsafe when the work is async: the first
 * request can arrive before the promise settles (leaving the dependency `undefined`),
 * and a rejection nobody awaits crashes the process as an unhandled rejection. Deferring
 * the work to the first caller keeps both problems out of module scope.
 *
 * A failed attempt is not cached, so the next caller retries instead of being stuck with
 * a permanently rejected promise (e.g. after a restarted database).
 *
 * @param factory The async factory to memoize.
 * @returns A function that builds the instance once and returns it thereafter.
 */
export function lazySingleton<T>(factory: () => Promise<T>): LazySingleton<T> {
  let instance: Promise<T> | undefined;

  const get = (() => {
    if (!instance) {
      instance = factory().catch((error) => {
        instance = undefined;
        throw error;
      });
    }

    return instance;
  }) as LazySingleton<T>;

  get.reset = () => {
    instance = undefined;
  };

  return get;
}
