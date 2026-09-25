import { useEffect, useRef, useState } from 'react';
import { useSimController, useSimState } from './hooks/useSim.js';
import { useMediaQuery } from './hooks/useMediaQuery.js';
import { useShortcuts } from './hooks/useShortcuts.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import TopBar from './components/TopBar.js';
import Stage from './components/Stage.js';
import Panel from './components/Panel.js';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

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
  const startResize = (e: React.PointerEvent) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); };
  const resize = (e: React.PointerEvent) => { if (dragging.current) document.documentElement.style.setProperty('--panel-w', clamp(window.innerWidth - e.clientX, 340, window.innerWidth - 360) + 'px'); };
  const endResize = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    sim.setUi({ panelW: clamp(window.innerWidth - e.clientX, 340, window.innerWidth - 360) });
  };
  const keyResize = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { sim.setUi({ panelW: ui.panelW + (e.key === 'ArrowLeft' ? 24 : -24) }); e.preventDefault(); }
  };
  useEffect(() => { document.documentElement.style.setProperty('--panel-w', panelW + 'px'); }, [panelW]);

  return (
    <ErrorBoundary>
      <div id="app">
        <TopBar panelOpen={panelOpen} onTogglePanel={() => setPanelOpen(o => !o)} />
        <main>
          <Stage />
          <div id="resizer" role="separator" aria-orientation="vertical" aria-label="Resize panel" tabIndex={0}
            onPointerDown={startResize} onPointerMove={resize} onPointerUp={endResize} onPointerCancel={endResize} onKeyDown={keyResize} />
          <Panel open={mobile && panelOpen} />
        </main>
      </div>
    </ErrorBoundary>
  );
}
