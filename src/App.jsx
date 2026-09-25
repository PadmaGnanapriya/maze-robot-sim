import { useEffect, useRef, useState } from 'react';
import { useSimController, useSimState } from './hooks/useSim.js';
import { useMediaQuery } from './hooks/useMediaQuery.js';
import { useShortcuts } from './hooks/useShortcuts.js';
import TopBar from './components/TopBar.jsx';
import Stage from './components/Stage.jsx';
import Panel from './components/Panel.jsx';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export default function App() {
  const sim = useSimController();
  const { ui, jump } = useSimState();
  const mobile = useMediaQuery('(max-width: 900px)');
  const [panelOpen, setPanelOpen] = useState(false);
  const dragging = useRef(false);
  useShortcuts(sim);

  // phones start with the telemetry card folded away, unless the user chose otherwise
  useEffect(() => { if (window.innerWidth < 600 && !sim.ui.hudSet) sim.setUi({ hud: false }); }, [sim]);
  // compile once on load so the output panel shows the memory report straight away
  useEffect(() => { sim.verify(); }, [sim]);
  // clicking an error location opens the panel on phones
  useEffect(() => { if (jump) setPanelOpen(true); }, [jump]);

  const panelW = clamp(ui.panelW, 340, Math.max(360, window.innerWidth - 360));
  const startResize = e => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); };
  const resize = e => { if (dragging.current) document.documentElement.style.setProperty('--panel-w', clamp(window.innerWidth - e.clientX, 340, window.innerWidth - 360) + 'px'); };
  const endResize = e => {
    if (!dragging.current) return;
    dragging.current = false;
    sim.setUi({ panelW: clamp(window.innerWidth - e.clientX, 340, window.innerWidth - 360) });
  };
  const keyResize = e => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { sim.setUi({ panelW: ui.panelW + (e.key === 'ArrowLeft' ? 24 : -24) }); e.preventDefault(); }
  };
  useEffect(() => { document.documentElement.style.setProperty('--panel-w', panelW + 'px'); }, [panelW]);

  return (
    <div id="app">
      <TopBar panelOpen={panelOpen} onTogglePanel={() => setPanelOpen(o => !o)} />
      <main>
        <Stage />
        <div id="resizer" role="separator" aria-orientation="vertical" aria-label="Resize panel" tabIndex={0}
          onPointerDown={startResize} onPointerMove={resize} onPointerUp={endResize} onPointerCancel={endResize} onKeyDown={keyResize} />
        <Panel open={mobile && panelOpen} />
      </main>
    </div>
  );
}
