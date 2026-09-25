import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SimController } from './sim/SimController.js';
import { SimContext } from './hooks/useSim.js';
import App from './App.js';
import './styles/tokens.css';
import './styles/app.css';

// One controller for the whole app; it holds the simulation and all settings.
const sim = new SimController();

// Exposed so you can poke at the simulation from the browser console in development,
// e.g. mazeSim.world.pose. Not exposed in production builds.
if (import.meta.env.DEV) (window as unknown as { mazeSim: SimController }).mazeSim = sim;

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element not found; check index.html');

createRoot(rootEl).render(
  <StrictMode>
    <SimContext.Provider value={sim}>
      <App />
    </SimContext.Provider>
  </StrictMode>,
);
