import { useEffect } from 'react';

/**
 * Keyboard shortcuts:
 *   Ctrl/Cmd+Enter  upload and run      Ctrl/Cmd+S  verify
 *   Space           pause / resume      Q / E       rotate the robot (Shift: 90 degrees)
 *   R               back to start       1-4         camera views
 */
export function useShortcuts(sim) {
  useEffect(() => {
    const onKey = e => {
      const tag = e.target?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'Enter') { e.preventDefault(); sim.uploadAndRun(); return; }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); sim.verify(); return; }
      if (typing || mod || e.altKey) return;
      if (e.key === ' ' && tag !== 'BUTTON' && ['running', 'paused'].includes(sim.run.state)) { e.preventDefault(); sim.togglePause(); return; }
      const k = e.key.toLowerCase();
      if (k === 'q' || k === 'e') { e.preventDefault(); sim.rotateRobot(k === 'q' ? 15 : -15, e.shiftKey); return; }
      if (k === 'r') { sim.backToStart(); return; }
      const views = { 1: 'orbit', 2: 'top', 3: 'follow', 4: 'pov' };
      if (views[e.key]) sim.setUi({ view: views[e.key] });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sim]);
}
