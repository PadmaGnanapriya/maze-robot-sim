import { useSimController, useSimState } from '../hooks/useSim.js';
import { Dice, Pencil, Check, Upload, Play, Pause, Reset, Pin, Code, GitHub } from './icons-data.js';
import { Logo } from './Icons.js';
import type { MazeType, CameraView } from '../sim/settings.js';

const MAZE_TYPES: [MazeType, string][] = [['backtracker', 'Long corridors'], ['prim', 'Many branches'], ['braid', 'With loops'], ['arena', 'Open arena']];
const VIEWS: [CameraView, string, string][] = [['orbit', 'Orbit', 'Orbit around the maze (1)'], ['top', 'Top', 'Top-down plan (2)'], ['follow', 'Follow', 'Chase camera (3)'], ['pov', 'Robot', 'From the front sonar (4)']];
const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
const REPO_URL: string | undefined = import.meta.env.VITE_REPO_URL;

export default function TopBar({ panelOpen, onTogglePanel }: { panelOpen: boolean; onTogglePanel: () => void }) {
  const sim = useSimController();
  const { runState, hasProgram, mz, ui, editWalls } = useSimState();
  const active = runState === 'running' || runState === 'paused';
  const paused = runState === 'paused';

  return (
    <header className="bar">
      <div className="brand">
        <Logo />
        <div><b>Padma's Studio</b><span>Maze robot simulator</span></div>
      </div>

      <div className="grp" aria-label="Maze">
        <label className="sr-only" htmlFor="mazeType">Maze type</label>
        <select id="mazeType" className="sel" value={mz.type} onChange={e => sim.setMazeCfg({ type: e.target.value as MazeType })} title="Maze type">
          {MAZE_TYPES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        <button className="btn" onClick={() => sim.newMaze()} title="Generate a new maze"><Dice /><span className="t-hide">New maze</span></button>
        <button className="btn" aria-pressed={editWalls} onClick={() => sim.toggleEditWalls()} title="Click edges to add or remove walls"><Pencil /><span className="t-hide">Edit walls</span></button>
      </div>

      <div className="grp" aria-label="Program">
        <button className="btn" onClick={() => sim.verify()} title="Compile without running (Ctrl+S)"><Check /><span className="t-hide">Verify</span></button>
        <button className="btn primary" onClick={() => sim.uploadAndRun()} title="Compile, upload to the simulated Uno and run (Ctrl+Enter)"><Upload />Upload &amp; run</button>
        <button className="btn icon" disabled={!active} onClick={() => sim.togglePause()} aria-label={paused ? 'Resume' : 'Pause'} title={paused ? 'Resume (Space)' : 'Pause (Space)'}>
          {paused ? <Play /> : <Pause />}
        </button>
        <button className="btn icon" disabled={!hasProgram} onClick={() => sim.restart(false)} aria-label="Reset the Uno" title="Press the Uno's reset button: restart the sketch where the robot is"><Reset /></button>
        <button className="btn" onClick={() => sim.backToStart()} title="Put the robot back on the start square (R)"><Pin /><span className="t-hide">Back to start</span></button>
      </div>

      <div className="grp">
        <label className="lbl lbl-hide" htmlFor="speedSel">Speed</label>
        <select id="speedSel" className="sel" value={ui.speed} onChange={e => sim.setUi({ speed: +e.target.value })} title="Simulation speed">
          {SPEEDS.map(s => <option key={s} value={s}>{s}×</option>)}
        </select>
      </div>

      <div className="spacer" />

      <div className="grp">
        <div className="seg" role="group" aria-label="Camera view">
          {VIEWS.map(([v, label, title]) => (
            <button key={v} aria-pressed={ui.view === v} title={title} onClick={() => sim.setUi({ view: v })}>{label}</button>
          ))}
        </div>
        <button className="btn panel-toggle" aria-expanded={panelOpen} aria-controls="panel" onClick={onTogglePanel}><Code />Code</button>
        {REPO_URL && <a className="btn icon quiet" href={REPO_URL} target="_blank" rel="noreferrer" aria-label="Source code on GitHub" title="Source code on GitHub"><GitHub /></a>}
      </div>
    </header>
  );
}
