/**
 * Tiny localStorage wrapper. Storage can be unavailable (private mode, sandboxed frames),
 * and its contents are never trusted structurally - callers must run the result through
 * one of settings.ts's `sanitize*` functions before using it.
 */
const PREFIX = 'tsMazeSim.';

/** Parsed JSON for `key`, or `undefined` if it is missing, unreadable, or storage itself is unavailable. */
export function loadRaw(key: string): unknown {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* not available (private mode, quota, sandboxed frame) */
  }
}
