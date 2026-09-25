/**
 * Model of the ATmega328P board: pins, PWM, L298N motor driver outputs, HC-SR04 echo timing, pulseIn and baud-accurate Serial.
 */
import { mulberry32 } from './random.js';
import { PWM_PINS, WRAP } from './types.js';

/* ===================== ATmega328P runtime model ===================== */
class RuntimeFault extends Error { constructor(msg) { super(msg); this.kind = 'fault'; } }


const PIN_NAME = p => (p >= 14 ? 'A' + (p - 14) : 'D' + p);

class MCU {
  constructor(opts) {
    this.t0 = opts.t0 || 0; this.t = this.t0; this.frameEnd = this.t0; this.ops = 0; this.deadline = Infinity; this.depth = 0;
    this.world = opts.world;
    this.wiring = opts.wiring;
    this.onLog = opts.onLog || (() => { });
    this.onSerial = opts.onSerial || (() => { });
    this.pins = [];
    for (let i = 0; i < 20; i++) this.pins.push({ mode: 0, out: 0, pwm: -1, pull: 0, touched: false });
    this.serialOn = false; this.baud = 9600; this.txEnd = this.t0; this.serialTimeout = 1000; this.rx = [];
    this.warned = new Set();
    this.rand = mulberry32(12345);
    const w = this.wiring;
    this.sonars = w.sonars.map((s, i) => ({ idx: i, id: s.id, trig: s.trig, echo: s.echo, level: 0, trigHigh: -1, echoStart: -1e12, echoEnd: -1e12, busyUntil: 0 }));
    this.echoMap = new Map(); this.trigMap = new Map();
    for (const s of this.sonars) { this.echoMap.set(s.echo, s); this.trigMap.set(s.trig, s); }
    this.motorPins = new Set([w.ENA, w.IN1, w.IN2, w.IN3, w.IN4, w.ENB]);
    this.outputPins = new Set([...this.motorPins, ...this.sonars.map(s => s.trig)]);
  }
  warnOnce(key, msg) { if (this.warned.has(key)) return; this.warned.add(key); this.onLog('warn', msg, this.t); }
  noteOnce(key, msg) { if (this.warned.has(key)) return; this.warned.add(key); this.onLog('note', msg, this.t); }
  overBudget() { return performance.now() > this.deadline; }
  pin(p, fn) {
    p = p | 0;
    if (p < 0 || p > 19) { this.warnOnce('badpin' + p, `${fn}(${p}): the Uno has no pin ${p} (use 0–13 or A0–A5)`); return null; }
    const P = this.pins[p]; P.touched = true; return P;
  }
  sync() { this.world.syncTo(this.t); }

  pinMode(p, m) {
    this.t += 3;
    const P = this.pin(p, 'pinMode'); if (!P) return;
    p = p | 0;
    if ((p === 0 || p === 1) && this.serialOn) this.warnOnce('serialpins', `pinMode(${p}, …): pins 0 and 1 are the Serial RX/TX lines`);
    if (this.motorPins.has(p)) this.sync();
    P.mode = m === 1 ? 1 : m === 2 ? 2 : 0;
    if (P.mode === 2) P.pull = 1; else if (P.mode === 0) P.pull = 0;
    if (P.mode !== 1) P.pwm = -1;
  }
  levelOf(p) {
    const P = this.pins[p];
    if (!P) return 0;
    if (P.mode === 1) return P.pwm >= 0 ? (P.pwm >= 128 ? 1 : 0) : P.out;
    return P.pull;
  }
  dutyOf(p) {
    const P = this.pins[p];
    if (!P) return 0;
    if (P.mode === 1) return P.pwm >= 0 ? P.pwm / 255 : P.out;
    return P.pull ? 0.25 : 0; // weak pull-up: unreliable
  }
  digitalWrite(p, v) {
    this.t += 4;
    const P = this.pin(p, 'digitalWrite'); if (!P) return;
    p = p | 0;
    const isMotor = this.motorPins.has(p);
    if (isMotor) this.sync();
    const level = v ? 1 : 0;
    P.pwm = -1;
    if (P.mode === 1) P.out = level;
    else {
      P.pull = level; P.out = level;
      if (this.outputPins.has(p)) this.warnOnce('nomode' + p, `digitalWrite(${PIN_NAME(p)}) on a pin that is still an INPUT: add pinMode(${p}, OUTPUT) in setup(). The pin only gets a weak pull-up, which can't drive the ${isMotor ? 'L298N' : 'sonar trigger'} reliably.`);
    }
    const s = this.trigMap.get(p);
    if (s) this.trigEdge(s, P.mode === 1 ? level : 0);
  }
  trigEdge(s, level) {
    if (level && !s.level) s.trigHigh = this.t;
    if (!level && s.level) {
      const width = this.t - s.trigHigh;
      if (width >= 8) this.fireSonar(s);
      else this.warnOnce('trigshort', `Trigger pulse on ${PIN_NAME(s.trig)} lasted only ${width.toFixed(1)} µs; the HC-SR04 needs at least 10 µs. Add delayMicroseconds(10) between HIGH and LOW.`);
    }
    s.level = level;
  }
  fireSonar(s) {
    if (this.t < s.busyUntil) { s.skipped = true; return; }
    s.skipped = false;
    this.sync();
    const d = this.world.measureSonar(s.idx, this.t);
    const width = d == null ? 38000 : d * 58.2 + (this.rand() - 0.5) * 3;
    s.echoStart = this.t + 460;
    s.echoEnd = s.echoStart + width;
    s.busyUntil = s.echoEnd + 60;
  }
  digitalRead(p) {
    this.t += 4;
    const P = this.pin(p, 'digitalRead'); if (!P) return 0;
    p = p | 0;
    const s = this.echoMap.get(p);
    if (s) return (this.t >= s.echoStart && this.t < s.echoEnd) ? 1 : 0;
    if (P.mode === 1) return P.out;
    return P.pull ? 1 : 0;
  }
  analogWrite(p, v) {
    this.t += 5;
    const P = this.pin(p, 'analogWrite'); if (!P) return;
    p = p | 0; v = WRAP.i16(v);
    if (this.motorPins.has(p)) this.sync();
    P.mode = 1;
    if (v < 0 || v > 255) this.warnOnce('awrange' + p, `analogWrite(${PIN_NAME(p)}, ${v}): values outside 0–255 wrap around on a real Uno (${v} acts like ${v & 255}). Clamp with constrain(value, 0, 255).`);
    if (v === 0) { P.pwm = -1; P.out = 0; return; }
    if (v === 255) { P.pwm = -1; P.out = 1; return; }
    if (PWM_PINS.has(p)) { P.pwm = v & 255; }
    else { P.pwm = -1; P.out = (v & 255) < 128 ? 0 : 1; this.warnOnce('nopwm' + p, `analogWrite(${PIN_NAME(p)}): not a PWM pin, so it only switches fully on or off (PWM pins: 3, 5, 6, 9, 10, 11)`); }
  }
  analogRead(p) {
    this.t += 112;
    let q = p | 0; if (q < 14 && q >= 0 && q <= 5) q += 14;
    if (q < 14 || q > 19) { this.warnOnce('ar' + p, `analogRead(${p}): use A0–A5`); return 0; }
    return (330 + Math.floor(this.rand() * 60)) | 0; // floating input
  }
  delayMs(ms) {
    ms = ms >>> 0;
    if (ms > 3600000) this.warnOnce('longdelay', `delay(${ms}) blocks for ${(ms / 3600000).toFixed(1)} hours (negative values wrap around to ~49 days)`);
    this.t += ms * 1000 + 1;
  }
  pulseIn(p, st, timeout) {
    if (timeout === undefined) timeout = 1000000;
    timeout = timeout >>> 0;
    const t0 = this.t + 2; const tEnd = t0 + timeout;
    this.pin(p, 'pulseIn');
    const s = this.echoMap.get(p | 0);
    if (!s || !st) {
      if (!s) this.warnOnce('pulsein' + p, `pulseIn(${PIN_NAME(p | 0)}): no sonar echo is wired to this pin (check the Wiring tab), it will always time out`);
      this.t = tEnd; return 0;
    }
    let t = t0;
    if (t >= s.echoStart && t < s.echoEnd) {
      if (s.skipped) this.noteOnce('busy', `Sonar ${s.id} was triggered while its previous echo was still HIGH (with no echo an HC-SR04 holds ECHO high for about 38 ms), so the trigger was ignored and pulseIn() timed out. Real modules do this too; treat 0 as "no reading".`);
      else this.warnOnce('pulselate', 'pulseIn() started while the echo pulse was already HIGH, so it missed the start of the pulse and timed out. Call pulseIn() right after the trigger pulse.');
      t = s.echoEnd;
    }
    if (s.echoStart >= t && s.echoStart < tEnd) {
      if (s.echoEnd <= tEnd) { this.t = s.echoEnd + 3; return Math.round(s.echoEnd - s.echoStart) >>> 0; }
      this.t = tEnd; return 0;
    }
    this.t = tEnd; return 0;
  }
  serialBegin(b) { this.serialOn = true; this.baud = b > 0 ? b : 9600; this.t += 10; }
  serialWrite(str) {
    if (!this.serialOn) { this.warnOnce('serialoff', 'Serial.print() before Serial.begin(): the output is lost'); return 0; }
    const charT = 10e6 / this.baud;
    this.txEnd = Math.max(this.txEnd, this.t) + str.length * charT;
    const block = this.txEnd - this.t - 63 * charT;
    if (block > 0) this.t += block;
    this.t += 2 + str.length * 0.6;
    this.onSerial(str, this.t);
    return str.length;
  }
  serialFlush() { this.t = Math.max(this.t, this.txEnd); }
  randomSeed(s) { this.rand = mulberry32((s >>> 0) || 1); }
  random(a, b) {
    if (b === undefined) { if (a <= 0) return 0; return Math.floor(this.rand() * a) | 0; }
    if (a >= b) return a | 0;
    return (a + Math.floor(this.rand() * (b - a))) | 0;
  }
  oob(tok, i, len) {
    this.warnOnce('oob' + tok.file + tok.line, `${tok.file}:${tok.line}: array index ${i} is out of bounds (the array has ${len} elements). A real Uno would silently read or overwrite other variables here.`);
  }
  divZero(tok) { this.warnOnce('div0' + tok.line, `${tok.file}:${tok.line}: integer division by zero (the result is garbage on a real Uno)`); }
  stackOverflow(name) { throw new RuntimeFault(`Stack overflow in '${name}()': recursion went too deep for the Uno's 2 KB of RAM`); }
  newPing(trig, echo, max) {
    const s = this.sonars.find(x => x.trig === (trig | 0) && x.echo === (echo | 0));
    if (!s) this.warnOnce('np' + trig + '_' + echo, `NewPing(${trig}, ${echo}) doesn't match any sonar in the Wiring tab, so it will always read 0`);
    return { __obj: true, cls: 'NewPing', sensor: s || null, max: Math.min(500, (max | 0) || 500) };
  }
  npPing(o, mx) {
    const max = Math.min(500, mx ? mx | 0 : o.max);
    this.t += 16;
    const s = o.sensor;
    if (!s) { this.t += max * 57; return 0; }
    this.sync();
    const d = this.world.measureSonar(s.idx, this.t);
    s.echoStart = this.t + 460;
    const width = d == null ? 38000 : d * 58.2;
    s.echoEnd = s.echoStart + width; s.busyUntil = s.echoEnd + 60;
    this.t += 460;
    if (d == null || d > max) { this.t += max * 58 + 200; return 0; }
    this.t += width + 4;
    return Math.round(width) >>> 0;
  }
  // L298N channel -> signed duty (-1..1) and brake flag
  motorCmd(side) {
    const w = this.wiring;
    const en = side ? w.ENB : w.ENA, a = side ? w.IN3 : w.IN1, b = side ? w.IN4 : w.IN2;
    const e = w.jumpers ? 1 : this.dutyOf(en);
    const da = this.dutyOf(a), db = this.dutyOf(b);
    let duty = 0, brake = 0;
    if (e > 0) {
      if (da > 0 && db === 0) duty = e * da;
      else if (db > 0 && da === 0) duty = -e * db;
      else if (da > 0 && db > 0) { duty = e * (da - db); brake = e * Math.min(da, db); }
      else brake = e;
    }
    const inv = side ? w.invertR : w.invertL;
    if (inv) duty = -duty;
    return { duty, brake, coast: e === 0 };
  }
}

export { RuntimeFault, PIN_NAME, MCU };
