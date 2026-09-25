import { useCallback, useRef } from 'react';
import { useSimController, useSimState } from '../hooks/useSim.js';
import { useTicker } from '../hooks/useTicker.js';
import SketchTab from './SketchTab.jsx';
import SerialMonitor from './SerialMonitor.jsx';
import RobotSettings from './RobotSettings.jsx';
import MazeSettings from './MazeSettings.jsx';
import WiringSettings from './WiringSettings.jsx';

const TABS = [['sketch', 'Sketch'], ['serial', 'Serial monitor'], ['robot', 'Robot'], ['maze', 'Maze'], ['wiring', 'Wiring']];

export default function Panel({ open }) {
  const sim = useSimController();
  const { ui, output } = useSimState();
  const tabRefs = useRef({});
  const errors = output.filter(e => e.kind === 'error' || e.kind === 'fault').length;

  // count serial lines that arrived while the tab was hidden
  const serialVisible = ui.tab === 'serial';
  const readUnseen = useCallback(() => { if (serialVisible) sim.serial.unseen = 0; return sim.serial.unseen; }, [sim, serialVisible]);
  const unseen = useTicker(readUnseen, 4);

  const select = id => sim.setUi({ tab: id });
  const onKeyDown = e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = TABS.findIndex(t => t[0] === ui.tab);
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0];
    select(next); tabRefs.current[next]?.focus(); e.preventDefault();
  };

  return (
    <aside id="panel" className={open ? 'open' : undefined} aria-label="Code and settings">
      <div className="tabs" role="tablist" onKeyDown={onKeyDown}>
        {TABS.map(([id, label]) => (
          <button key={id} ref={el => { tabRefs.current[id] = el; }} role="tab" id={'t-' + id} aria-controls={'p-' + id}
            aria-selected={ui.tab === id} tabIndex={ui.tab === id ? 0 : -1} onClick={() => select(id)}>
            {label}
            {id === 'sketch' && errors > 0 && <span className="badge">{errors}</span>}
            {id === 'serial' && !serialVisible && unseen > 0 && <span className="badge w">{unseen > 99 ? '99+' : unseen}</span>}
          </button>
        ))}
      </div>
      <section className="tabpanel" role="tabpanel" id={'p-' + ui.tab} aria-labelledby={'t-' + ui.tab}>
        {ui.tab === 'sketch' && <SketchTab />}
        {ui.tab === 'serial' && <SerialMonitor />}
        {ui.tab === 'robot' && <RobotSettings />}
        {ui.tab === 'maze' && <MazeSettings />}
        {ui.tab === 'wiring' && <WiringSettings />}
      </section>
    </aside>
  );
}
