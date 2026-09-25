import { useEffect, useRef } from 'react';
import { useSimController, useSimState } from '../hooks/useSim.js';

const KIND_LABEL = { error: 'error:', warning: 'warning:', fault: 'stopped:' };

/** Compiler and runtime messages. Locations are buttons that jump to the line. */
export default function BuildOutput() {
  const sim = useSimController();
  const { output } = useSimState();
  const list = useRef(null);
  useEffect(() => { if (list.current) list.current.scrollTop = list.current.scrollHeight; }, [output]);
  const errors = output.filter(e => e.kind === 'error' || e.kind === 'fault').length;
  const warnings = output.filter(e => e.kind === 'warning').length;

  return (
    <div className="out">
      <div className="out-head">
        <b>Output</b>
        <span>{errors ? `${errors} error${errors > 1 ? 's' : ''}` : warnings ? `${warnings} warning${warnings > 1 ? 's' : ''}` : ''}</span>
        <div className="spacer" />
        <button className="btn quiet sm" onClick={() => sim.clearOutput()}>Clear</button>
      </div>
      <div className="out-list" ref={list} aria-live="polite">
        {!output.length && <div className="out-empty">Press Verify to compile, or Upload &amp; run to start the robot.</div>}
        {output.map(e => (
          <div className={'msg ' + e.kind} key={e.id}>
            <i className="ic" />
            <div>
              {e.file && e.line ? <button className="loc" onClick={() => sim.jumpTo(e.file, e.line, e.col)}>{e.file}:{e.line}{e.col ? ':' + e.col : ''}</button> : null}{' '}
              <span className="txt">{KIND_LABEL[e.kind] && <span className="kind">{KIND_LABEL[e.kind]} </span>}{e.text}</span>
              {e.sub && <div className="sub">{e.sub}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
