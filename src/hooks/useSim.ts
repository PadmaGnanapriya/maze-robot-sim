import { createContext, useContext, useSyncExternalStore } from 'react';
import type { SimController } from '../sim/SimController.js';

export const SimContext = createContext<SimController | null>(null);

function requireSim(sim: SimController | null): SimController {
  if (!sim) throw new Error('useSimController/useSimState must be used inside <SimContext.Provider>');
  return sim;
}

/** The SimController instance. */
export function useSimController(): SimController {
  return requireSim(useContext(SimContext));
}

/** Current snapshot of the controller's state; re-renders when it changes. */
export function useSimState() {
  const sim = requireSim(useContext(SimContext));
  return useSyncExternalStore(sim.subscribe, sim.getSnapshot);
}
