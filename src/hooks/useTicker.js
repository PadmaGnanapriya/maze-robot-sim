import { useEffect, useState } from 'react';

/**
 * Re-render at a fixed rate and return fresh data from `read()`.
 * Used for fast-changing values (telemetry, serial text) that do not go
 * through the controller's snapshot.
 */
export function useTicker(read, hz = 20, enabled = true) {
  const [value, setValue] = useState(read);
  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(() => setValue(read()), 1000 / hz);
    return () => clearInterval(id);
  }, [read, hz, enabled]);
  return value;
}
