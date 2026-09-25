/** Tiny localStorage wrapper. Storage can be unavailable (private mode, sandboxed frames). */
const PREFIX = 'tsMazeSim.';

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* not available */ }
}
