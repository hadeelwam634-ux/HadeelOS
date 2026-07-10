/**
 * Defensive deep clone used at every persistence read/write boundary.
 *
 * Without this, an in-memory repository stores and returns the exact
 * object references it was given. Any caller holding onto one of those
 * references — the object it passed to `append()`/`upsert()`, or the
 * object it got back from `getAll()`/`get()` — could mutate it and
 * silently rewrite "immutable" history after the fact. Cloning at both
 * the write boundary and the read boundary closes that hole, so the
 * append-only / never-rewritten guarantee actually holds, not just
 * "there's no update() method".
 */
export function clone<T>(value: T): T {
  return structuredClone(value);
}
