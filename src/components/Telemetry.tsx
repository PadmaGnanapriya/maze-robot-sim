import { forwardRef, useCallback, useEffect, useMemo, useRef } from 'react';
import { useSimController, useSimState } from '../hooks/useSim.js';
import { useTicker } from '../hooks/useTicker.js';
import type { Wiring } from '../sim/settings.js';
import Scope from './Scope.js';

const SONARS: [string, string][] = [['Front', 'var(--sF)'], ['Left', 'var(--sL)'], ['Right', 'var(--sR)']];
const pinName = (p: number) => (p < 14 ? 'D' + p : 'A' + (p - 14));

function pinRoles(w: Wiring): Record<number, string> {
  const roles: Record<number, string> = {};
  const add = (p: number, r: string) => { roles[p] = roles[p] ? roles[p] + ', ' + r : r; };
  add(w.ENA, 'ENA left speed'); add(w.IN1, 'IN1'); add(w.IN2, 'IN2'); add(w.IN3, 'IN3'); add(w.IN4, 'IN4'); add(w.ENB, 'ENB right speed');
  (['front', 'left', 'right'] as const).forEach((n, i) => { add(w.sonars[i]!.trig, n + ' sonar TRIG'); add(w.sonars[i]!.echo, n + ' sonar ECHO'); });
  add(0, 'Serial RX'); add(1, 'Serial TX');
  return roles;
}

/** Floating card with live sonar readings, motor PWM, stats and the Uno's pin states. */
const Telemetry = forwardRef<HTMLDivElement>(function Telemetry(_props, ref) {
  const sim = useSimController();
  const { ui, wiring } = useSimState();
  const read = useCallback(() => sim.telemetry(), [sim]);
  const t = useTicker(read, 20, ui.hud);
  const roles = useMemo(() => pinRoles(wiring), [wiring]);
  const hitsRef = useRef<HTMLDivElement>(null), lastHits = useRef(t.contacts);
  useEffect(() => {
    if (t.contacts > lastHits.current && hitsRef.current) {
      hitsRef.current.animate([{ color: 'var(--err)' }, { color: 'inherit' }], { duration: 500 });
    }
    lastHits.current = t.contacts;
  }, [t.contacts]);

  return (
    <div className={'hud' + (ui.hud ? '' : ' min')} ref={ref}>
      <div className="hud-head">
        <h2>Telemetry</h2>
        <button className="btn quiet sm" aria-expanded={ui.hud} onClick={() => sim.setUi({ hud: !ui.hud, hudSet: true })}>{ui.hud ? 'Hide' : 'Show'}</button>
      </div>
      {ui.hud && (
        <div className="hud-body">
          {SONARS.map(([name, colour], i) => {
            const rd = t.readings[i], age = rd ? (t.t - rd.t) / 1e6 : Infinity;
            const stale = !rd || age > 1.2, none = !stale && rd.d == null;
            const width = stale ? 0 : none ? 100 : Math.min(100, Math.sqrt(rd.d! / 150) * 100);
            return (
              <div className="sonar-row" key={name}>
                <span className="nm"><i className="dot" style={{ background: colour }} />{name}</span>
                <span className="bar-track"><i className="bar-fill" style={{ background: colour, width: width + '%', opacity: none ? 0.25 : 1 }} /></span>
                <span className={'v' + (stale || none ? ' none' : '')}>{stale ? '–' : none ? 'no echo' : rd!.d!.toFixed(1) + ' cm'}</span>
              </div>
            );
          })}
          <Scope readings={t.readings} now={t.t} />
          <div className="hud-sec">
            <div className="hud-sub">Motor PWM, from the L298N pins</div>
            {(['Left', 'Right'] as const).map((name, side) => {
              const m = t.motors[side]!, d = Math.max(-1, Math.min(1, m.duty)), pwm = Math.round(d * 255);
              return (
                <div className="motor-row" key={name}>
                  <span className="nm">{name}</span>
                  <span className="mtrack"><i className="mfill" style={{ left: (d >= 0 ? 50 : 50 + d * 50) + '%', width: Math.abs(d) * 50 + '%' }} /></span>
                  <span className="v">{m.brake > 0 && Math.abs(d) < 0.01 ? 'brake' : pwm === 0 ? '0' : (pwm > 0 ? '+' : '−') + Math.abs(pwm)}</span>
                </div>
              );
            })}
          </div>
          <div className="hud-sec">
            <div className="stats">
              <div className="stat"><div className="k">Speed</div><div className="v">{t.speed.toFixed(0)} cm/s</div></div>
              <div className="stat"><div className="k">Heading</div><div className="v">{String(Math.round(t.heading) % 360).padStart(3, '0')}°</div></div>
              <div className="stat"><div className="k">Contacts</div><div className="v" ref={hitsRef}>{t.contacts}</div></div>
              <div className="stat"><div className="k">Driven</div><div className="v">{t.metres.toFixed(1)} m</div></div>
            </div>
          </div>
          <div className="hud-sec opt">
            <div className="pins">
              {t.pins.map((p, i) => (
                <div key={i} title={pinName(i) + (roles[i] ? ': ' + roles[i] : '')}
                  className={'pin' + (roles[i] && i > 1 ? ' used' : '') + (p.state === 'high' ? ' p-hi' : p.state === 'echo' ? ' p-echo' : '')}
                  style={{ '--lv': p.level } as React.CSSProperties}>{pinName(i)}</div>
              ))}
            </div>
            <div className="hud-note">Yellow: output high or PWM. Blue: sonar echo pulse.</div>
          </div>
        </div>
      )}
    </div>
  );
});

export default Telemetry;
