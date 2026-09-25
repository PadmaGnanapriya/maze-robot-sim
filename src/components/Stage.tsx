import { useEffect, useRef } from 'react';
import { SceneView } from '../three/SceneView.js';
import { useSimController, useSimState } from '../hooks/useSim.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import Telemetry from './Telemetry.js';
import StatusChip from './StatusChip.js';
import SolvedBanner from './SolvedBanner.js';
import WelcomeCard from './WelcomeCard.js';
import { Icon } from './Icons.js';

export default function Stage() {
  const sim = useSimController();
  const { ui, editWalls } = useSimState();
  const canvasRef = useRef<HTMLCanvasElement>(null), hudRef = useRef<HTMLDivElement>(null), viewRef = useRef<SceneView | null>(null);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const dark = useMediaQuery('(prefers-color-scheme: dark)');

  // create the 3D view once; it drives the simulation from its frame loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const reservedLeft = () => {
      const w = canvas.parentElement?.clientWidth ?? 0;
      return w > 760 && sim.ui.hud && hudRef.current ? hudRef.current.offsetWidth + 24 : 0;
    };
    const view = new SceneView(canvas, sim, { reduceMotion, reservedLeft });
    viewRef.current = view;
    return () => { view.dispose(); viewRef.current = null; };
  }, [sim, reduceMotion]);

  useEffect(() => { viewRef.current?.setView(ui.view); }, [ui.view]);
  useEffect(() => { requestAnimationFrame(() => viewRef.current?.fit()); }, [ui.hud]);
  useEffect(() => {
    const stage = getComputedStyle(document.documentElement).getPropertyValue('--stage').trim() || '#07161F';
    viewRef.current?.setTheme(stage, dark);
  }, [dark, reduceMotion]);

  const toggle = (key: 'beams' | 'trail') => () => sim.setUi({ [key]: !ui[key] });

  return (
    <section id="stage" aria-label="3D maze">
      <canvas ref={canvasRef} className="gl" tabIndex={0} aria-label="3D view of the maze and robot. Drag to orbit, drag the robot to move it." />
      <Telemetry ref={hudRef} />
      <StatusChip />
      <p className="hint">
        {editWalls
          ? 'Click a gap between squares to add a wall, or click a wall to remove it. Drag to paint several. The outer border stays fixed.'
          : <>Drag the robot or the white goal to move them. <kbd>Q</kbd> <kbd>E</kbd> or the scroll wheel rotate the robot while you hold it. Drag empty space to orbit, right-drag to pan.</>}
      </p>
      <div className="stage-tools">
        <button className="btn icon" aria-pressed={ui.beams} onClick={toggle('beams')} title="Show sonar beams" aria-label="Show sonar beams"><Icon.Beams /></button>
        <button className="btn icon" aria-pressed={ui.trail} onClick={toggle('trail')} title="Show the path driven" aria-label="Show the path driven"><Icon.Trail /></button>
        <button className="btn icon" onClick={() => { sim.world.trail = []; }} title="Clear the path" aria-label="Clear the path"><Icon.Trash /></button>
      </div>
      <SolvedBanner />
      <WelcomeCard />
    </section>
  );
}
