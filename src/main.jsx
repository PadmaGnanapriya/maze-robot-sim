import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SimController } from './sim/SimController.js';
import { SimContext } from './hooks/useSim.js';
import App from './App.jsx';
import './styles/tokens.css';
import './styles/app.css';

// One controller for the whole app; it holds the simulation and all settings.
const sim = new SimController();
// Exposed so you can poke at the simulation from the browser console, e.g. mazeSim.world.pose
window.mazeSim = sim;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <SimContext.Provider value={sim}>
      <App />
    </SimContext.Provider>
  </StrictMode>,
);
