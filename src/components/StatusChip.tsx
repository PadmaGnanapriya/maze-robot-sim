import { useCallback } from 'react';
import { useSimController } from '../hooks/useSim.js';
import { useTicker } from '../hooks/useTicker.js';
import { formatTime, type RunState } from '../sim/SimController.js';

const NAMES: Record<RunState, string> = { idle: 'Not running', running: 'Running', paused: 'Paused', fault: 'Stopped by a fault', solved: 'Solved', error: 'Build failed' };

export default function StatusChip() {
  const sim = useSimController();
  const read = useCallback(() => {
    const t = sim.telemetry();
    return { state: t.runState, time: t.runTime, over: t.overloaded, solved: t.solvedSeconds };
  }, [sim]);
  const s = useTicker(read, 8);
  const time = s.state === 'running' || s.state === 'paused' ? formatTime(s.time) + (s.over ? ', slowed down' : '')
    : s.state === 'solved' && s.solved != null ? s.solved.toFixed(1) + ' s' : '';
  return (
    <div className="chip" data-s={s.state} role="status">
      <i className="led" /><span>{NAMES[s.state] || s.state}</span>{time && <span className="t">{time}</span>}
    </div>
  );
}
