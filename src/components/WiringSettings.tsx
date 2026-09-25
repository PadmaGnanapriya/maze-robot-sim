import { useSimController, useSimState } from '../hooks/useSim.js';
import { PWM_PINS } from '../engine/index.js';
import { SyncCallout } from './Field.js';

const pinName = (p: number) => (p < 14 ? 'D' + p : 'A' + (p - 14));
const PIN_OPTIONS: [number, string][] = Array.from({ length: 20 }, (_, p) => [p, pinName(p) + (PWM_PINS.has(p) ? ' (PWM)' : '')]);
const SONAR_NAMES = ['Front sonar', 'Left sonar', 'Right sonar'];
const PARTS: [string, string][] = [
  ['1', 'Arduino Uno R3 (ATmega328P, 16 MHz, 2 KB RAM)'], ['1', 'L298N dual H-bridge motor driver module'],
  ['2', 'Yellow TT gear motors (1:48) with 65 mm wheels'], ['1', 'Swivel caster with white wheel'],
  ['3', 'HC-SR04 / HY-SRF05 ultrasonic sensors'], ['1', '8 × AA battery holder (12 V)'],
  ['2', 'Clear acrylic chassis plates with brass hex standoffs'], ['1', 'Mini breadboard and a bundle of jumper wires'],
];

export default function WiringSettings() {
  const sim = useSimController();
  const { wiring: W, mismatch } = useSimState();

  const uses: Record<number, string[]> = {};
  const note = (p: number, name: string) => { (uses[p] ||= []).push(name); };
  (['ENA', 'IN1', 'IN2', 'IN3', 'IN4', 'ENB'] as const).forEach(k => note(W[k], k));
  W.sonars.forEach(s => { note(s.trig, s.id + ' trig'); note(s.echo, s.id + ' echo'); });
  const clash = (p: number) => (uses[p]?.length ?? 0) > 1;
  const clashes = Object.keys(uses).filter(p => clash(+p));

  const rows: [string, string, number, (v: number) => void, string?][] = [
    ['L298N', 'ENA', W.ENA, v => sim.setWiring(w => { w.ENA = v; }), 'Left motor speed, needs a PWM pin'],
    ['L298N', 'IN1', W.IN1, v => sim.setWiring(w => { w.IN1 = v; })],
    ['L298N', 'IN2', W.IN2, v => sim.setWiring(w => { w.IN2 = v; })],
    ['L298N', 'IN3', W.IN3, v => sim.setWiring(w => { w.IN3 = v; })],
    ['L298N', 'IN4', W.IN4, v => sim.setWiring(w => { w.IN4 = v; })],
    ['L298N', 'ENB', W.ENB, v => sim.setWiring(w => { w.ENB = v; }), 'Right motor speed, needs a PWM pin'],
    ...W.sonars.flatMap((s, i) => [
      [SONAR_NAMES[i]!, 'TRIG', s.trig, (v: number) => sim.setWiring(w => { w.sonars[i]!.trig = v; })] as [string, string, number, (v: number) => void, string?],
      [SONAR_NAMES[i]!, 'ECHO', s.echo, (v: number) => sim.setWiring(w => { w.sonars[i]!.echo = v; })] as [string, string, number, (v: number) => void, string?],
    ]),
  ];
  const check = (key: 'invertL' | 'invertR' | 'jumpers', label: string) => (
    <label className="check block"><input type="checkbox" checked={!!W[key]} onChange={e => sim.setWiring(w => { w[key] = e.target.checked; })} /> {label}</label>
  );

  return (
    <div className="scroll form">
      <h3>Arduino Uno pins</h3>
      <p className="help">Match this to how your robot is wired. The jumper wires in the 3D model follow these pins. Changes apply the next time you upload or press reset.</p>
      <table className="wire">
        <thead><tr><th>Part</th><th>Signal</th><th>Uno pin</th></tr></thead>
        <tbody>
          {rows.map(([part, signal, pin, onChange, hint]) => (
            <tr key={part + signal} className={clash(pin) ? 'conflict' : undefined}>
              <td>{part}</td>
              <td>{signal}{hint && <div className="muted small">{hint}</div>}</td>
              <td><select className="sel" value={pin} onChange={e => onChange(+e.target.value)} aria-label={`${part} ${signal} pin`}>
                {PIN_OPTIONS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select></td>
            </tr>
          ))}
        </tbody>
      </table>
      {clashes.length > 0 && <div className="callout warn">Pin {clashes.map(p => pinName(+p)).join(', ')} is wired to more than one signal.</div>}
      {(!PWM_PINS.has(W.ENA) || !PWM_PINS.has(W.ENB)) && <div className="callout warn">ENA and ENB should use PWM pins (3, 5, 6, 9, 10, 11), otherwise analogWrite() can only switch the motors fully on or off.</div>}
      {mismatch.pins && (
        <SyncCallout onSync={() => sim.syncConfig('pins')}>
          config.h pins differ from this wiring: {mismatch.pins.map((p, i) => <span key={p.name}>{i ? ', ' : ''}<b>{p.name}</b> {p.config} → {p.actual}</span>)}.
        </SyncCallout>
      )}
      <h3>Wiring quirks</h3>
      {check('invertL', 'Left motor wires swapped (it runs backwards)')}
      {check('invertR', 'Right motor wires swapped (it runs backwards)')}
      {check('jumpers', 'ENA and ENB jumpers left on the L298N (full speed only, PWM ignored)')}
      <h3>Parts in the photo</h3>
      <ul className="bom">{PARTS.map(([n, text]) => <li key={text}><b>{n}×</b><span>{text}</span></li>)}</ul>
    </div>
  );
}
