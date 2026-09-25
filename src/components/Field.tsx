import { useEffect, useId, useState, type ReactNode } from 'react';

interface NumberFieldProps {
  label: string; value: number; unit?: string; min: number; max: number; step?: number;
  onCommit: (v: number) => void; help?: string;
}

/** Number input that commits on blur or Enter, clamped to its range. */
export function NumberField({ label, value, unit, min, max, step = 1, onCommit, help }: NumberFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    let v = parseFloat(draft);
    if (!Number.isFinite(v)) { setDraft(String(value)); return; }
    v = Math.min(max, Math.max(min, v));
    if (step >= 1) v = Math.round(v);
    setDraft(String(v));
    if (v !== value) onCommit(v);
  };
  return (
    <div className="field" title={help}>
      <label htmlFor={id}>{label}</label>
      <div className="in">
        <input id={id} className="num" type="number" min={min} max={max} step={step} value={draft}
          onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); }} />
        {unit && <span className="u">{unit}</span>}
      </div>
    </div>
  );
}

interface SelectFieldProps<T extends string | number> {
  label: string; value: T; options: [T, string][]; onChange: (v: T) => void;
}

export function SelectField<T extends string | number>({ label, value, options, onChange }: SelectFieldProps<T>) {
  const id = useId();
  const numeric = typeof options[0]?.[0] === 'number';
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="in">
        <select id={id} className="sel" value={value} onChange={e => onChange((numeric ? +e.target.value : e.target.value) as T)}>
          {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
        </select>
      </div>
    </div>
  );
}

export function Section({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  return (
    <>
      <h3>{title}</h3>
      {help && <p className="help">{help}</p>}
      <div className="fgrid">{children}</div>
    </>
  );
}

/** Offer to update config.h when it no longer matches the settings. */
export function SyncCallout({ children, onSync }: { children: ReactNode; onSync: () => void }) {
  return (
    <div className="callout">
      <span>{children}</span>
      <button className="btn sm" onClick={onSync}>Update config.h</button>
    </div>
  );
}
