/**
 * localStorage behind a null check. Reading `localStorage` throws in some private modes and when a
 * site's storage is blocked, and writes can fail when it is full; nothing on the site may depend on
 * it, so callers get null (or a silent no-op) instead of an exception.
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function browserStorage(): StorageLike | null {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    // Some browsers hand out the object and only throw on use.
    const probe = 'aw:probe';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/** Parse stored JSON, or return null for anything missing, malformed or unreadable. */
export function readJson(storage: StorageLike | null, key: string): unknown {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function writeJson(storage: StorageLike | null, key: string, value: unknown): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Full or blocked: the setting simply does not survive the visit.
  }
}
