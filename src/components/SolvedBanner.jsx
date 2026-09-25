import { useEffect, useRef, useState } from 'react';
import { useSimController, useSimState } from '../hooks/useSim.js';

export default function SolvedBanner() {
  const sim = useSimController();
  const { runState, solved, mazeSize } = useSimState();
  const [dismissed, setDismissed] = useState(null);
  const again = useRef(null);
  const open = runState === 'solved' && solved && dismissed !== solved;

  useEffect(() => { if (open) setTimeout(() => again.current?.focus({ preventScroll: true }), 30); }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = e => { if (e.key === 'Escape') setDismissed(solved); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, solved]);
  if (!open) return null;

  const c = solved.contacts;
  return (
    <div className="banner" role="dialog" aria-labelledby="bannerTitle">
      <h2 id="bannerTitle">Reached the white area</h2>
      <div className="big">{solved.seconds.toFixed(1)} s</div>
      <p>{c === 0 ? 'No wall contacts' : c === 1 ? '1 wall contact' : `${c} wall contacts`}, {solved.metres.toFixed(1)} m driven in a {mazeSize.cols} × {mazeSize.rows} maze.</p>
      <div className="row">
        <button ref={again} className="btn primary" onClick={() => sim.restart(true)}>Run again</button>
        <button className="btn" onClick={() => sim.newMaze()}>New maze</button>
        <button className="btn quiet" onClick={() => setDismissed(solved)}>Close</button>
      </div>
    </div>
  );
}
