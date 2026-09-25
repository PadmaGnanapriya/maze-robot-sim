import { createContext, useContext, useSyncExternalStore } from 'react';

export const SimContext = createContext(null);

/** The SimController instance. */
export function useSimController() {
  return useContext(SimContext);
}

/** Current snapshot of the controller's state; re-renders when it changes. */
export function useSimState() {
  const sim = useContext(SimContext);
  return useSyncExternalStore(sim.subscribe, sim.getSnapshot);
}
