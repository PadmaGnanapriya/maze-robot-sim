import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useSimController, useSimState } from '../hooks/useSim.js';
import { useTicker } from '../hooks/useTicker.js';

const BAUDS = [9600, 19200, 38400, 57600, 115200];

export default function SerialMonitor() {
  const sim = useSimController();
  const { ui } = useSimState();
  const [message, setMessage] = useState('');
  const [hint, setHint] = useState('Send to the Uno');
  const log = useRef(null);
  const read = useCallback(() => ({ v: sim.serial.version, baud: sim.telemetry().baud }), [sim]);
  const { v, baud } = useTicker(read, 12);
  const text = sim.serial.text(ui.timestamps);   // cheap enough at this rate; v triggers the refresh

  useLayoutEffect(() => {
    const el = log.current;
    if (el && ui.autoscroll) el.scrollTop = el.scrollHeight;
  }, [v, ui.autoscroll, ui.timestamps]);

  const send = () => {
    if (sim.sendSerial(message, ui.lineEnd)) setMessage('');
    else setHint('Start the sketch first');
  };

  return (
    <>
      <div className="sbar">
        <label className="check"><input type="checkbox" checked={ui.autoscroll} onChange={e => sim.setUi({ autoscroll: e.target.checked })} />Autoscroll</label>
        <label className="check"><input type="checkbox" checked={ui.timestamps} onChange={e => sim.setUi({ timestamps: e.target.checked })} />Show timestamps</label>
        <div className="spacer" />
        <label className="sr-only" htmlFor="baud">Monitor baud rate</label>
        <select id="baud" className="sel" value={ui.baud} onChange={e => sim.setUi({ baud: +e.target.value })} title="Must match Serial.begin() in the sketch">
          {BAUDS.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <button className="btn sm" onClick={() => sim.serial.clear()}>Clear</button>
      </div>
      {baud && baud !== ui.baud && (
        <div className="callout warn tight">The sketch called Serial.begin({baud}) but the monitor is set to {ui.baud} baud, so the text is garbled.</div>
      )}
      <pre className="serial-log" ref={log} tabIndex={0} aria-label="Serial output">
        {text || <span className="faint">Nothing received yet. The default sketch prints every state change at 115200 baud.</span>}
      </pre>
      <div className="sin">
        <label className="sr-only" htmlFor="serialIn">Message to send</label>
        <input id="serialIn" className="txt" value={message} placeholder={hint} autoComplete="off"
          onChange={e => setMessage(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send(); }} />
        <select className="sel" value={ui.lineEnd} onChange={e => sim.setUi({ lineEnd: e.target.value })} title="Line ending">
          <option value="nl">Newline</option><option value="none">No line ending</option><option value="crlf">Both NL and CR</option>
        </select>
        <button className="btn sm" onClick={send}>Send</button>
      </div>
    </>
  );
}
