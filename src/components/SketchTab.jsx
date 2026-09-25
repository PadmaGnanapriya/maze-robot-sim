import { useRef, useState } from 'react';
import { useSimController, useSimState } from '../hooks/useSim.js';
import { FILES } from '../sim/SimController.js';
import CodeEditor from './CodeEditor.jsx';
import BuildOutput from './BuildOutput.jsx';

export default function SketchTab() {
  const sim = useSimController();
  const { files, activeFile, marks, jump } = useSimState();
  const fileInput = useRef(null);
  const [copyLabel, setCopyLabel] = useState('Copy');
  const [confirmRestore, setConfirmRestore] = useState(false);
  const restoreTimer = useRef(0);

  const copy = async () => {
    try { await navigator.clipboard.writeText(files[activeFile]); setCopyLabel('Copied'); }
    catch { setCopyLabel('Press Ctrl+C'); }
    setTimeout(() => setCopyLabel('Copy'), 1600);
  };
  const restore = () => {
    clearTimeout(restoreTimer.current);
    if (!confirmRestore) { setConfirmRestore(true); restoreTimer.current = setTimeout(() => setConfirmRestore(false), 3500); return; }
    setConfirmRestore(false); sim.restoreFile(activeFile);
  };
  const open = e => {
    const file = e.target.files?.[0]; if (!file) return;
    file.text().then(text => sim.openFile(file.name, text));
    e.target.value = '';
  };

  return (
    <>
      <div className="filebar">
        <div role="tablist" aria-label="Files" className="files">
          {FILES.map(f => {
            const m = marks[f] || [];
            return (
              <button key={f} role="tab" className="ftab" aria-selected={f === activeFile} onClick={() => sim.setActiveFile(f)}>
                {f}{m.some(x => x.kind === 'e') ? <i className="mk" /> : m.length ? <i className="mk w" /> : null}
              </button>
            );
          })}
        </div>
        <div className="spacer" />
        <button className="btn quiet sm" onClick={() => fileInput.current.click()} title="Load an .ino or .h file from your computer">Open file</button>
        <button className="btn quiet sm" onClick={copy} title="Copy this file to the clipboard">{copyLabel}</button>
        <button className="btn quiet sm" onClick={restore} title={confirmRestore ? `Click again to replace ${activeFile} with the default solver` : 'Put the default solver back in this file'}>{confirmRestore ? 'Confirm restore' : 'Restore default'}</button>
        <input ref={fileInput} type="file" accept=".ino,.h,.cpp,.c,.txt" hidden onChange={open} />
      </div>
      <CodeEditor value={files[activeFile]} onChange={text => sim.setFile(activeFile, text)} marks={marks[activeFile]} jump={jump && jump.file === activeFile ? jump : null} label={`Source code of ${activeFile}`} />
      <BuildOutput />
    </>
  );
}
