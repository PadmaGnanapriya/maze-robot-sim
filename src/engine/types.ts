/**
 * Type system and runtime library: AVR integer semantics (16-bit int), Arduino print formatting, and the built-in functions, Serial, String and NewPing methods.
 */
import type { PrimK, PType, StrType } from './ast.js';

/* ===================== Types, conversions, printing ===================== */
export const SIG_BRK = 1, SIG_CNT = 2, SIG_RET = 3;

const TSIZE: Record<string, number> = { bool: 1, i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, i64: 8, f32: 4, str: 6, enum: 2, void: 0, obj: 8 };
export const INT_K = new Set<PrimK>(['bool', 'i8', 'u8', 'i16', 'u16', 'i32', 'u32', 'i64']);

/** All possible values of a resolved type's kind tag (PType['k']), plus 'enum' collapsed to 'i16' by kindOf(). */
export type Kind = PType['k'];

export const TY: Record<string, PType> = {};
for (const k of ['void', 'bool', 'i8', 'u8', 'i16', 'u16', 'i32', 'u32', 'i64', 'f32', 'str'] as const) TY[k] = { k };
const TYPE_CNAME: Record<string, string> = { void: 'void', bool: 'bool', i8: 'char', u8: 'byte', i16: 'int', u16: 'unsigned int', i32: 'long', u32: 'unsigned long', i64: 'long long', f32: 'float', str: 'String' };

/** Wrap a JS number to the given AVR integer/float width, matching real overflow behaviour. */
export const WRAP: Record<string, (v: number) => number> = {
  bool: v => (v ? 1 : 0),
  i8: v => ((v | 0) << 24) >> 24,
  u8: v => (v | 0) & 255,
  i16: v => ((v | 0) << 16) >> 16,
  u16: v => (v | 0) & 65535,
  i32: v => v | 0,
  u32: v => v >>> 0,
  i64: v => Math.trunc(v),
  f32: v => Math.fround(v),
};

export function kindOf(t: PType | null | undefined): Kind { if (!t) return 'void'; if (t.k === 'enum') return 'i16'; return t.k; }
export function isNumK(k: Kind): boolean { return INT_K.has(k as PrimK) || k === 'f32'; }
export function promoteK(k: Kind): Kind { if (k === 'bool' || k === 'i8' || k === 'u8' || k === 'i16' || k === 'enum') return 'i16'; return k; }
export function commonK(a: Kind, b: Kind): Kind {
  if (a === 'str' || b === 'str') return 'str';
  if (a === 'f32' || b === 'f32') return 'f32';
  if (a === 'i64' || b === 'i64') return 'i64';
  if (a === 'u32' || b === 'u32') return 'u32';
  if (a === 'i32' || b === 'i32') return 'i32';
  if (a === 'u16' || b === 'u16') return 'u16';
  return 'i16';
}
export function typeName(t: PType | null | undefined): string {
  if (!t) return 'void';
  if (t.k === 'array') return typeName(t.elem) + t.dims.map(d => `[${d == null ? '' : d}]`).join('');
  if (t.k === 'enum') return t.name;
  if (t.k === 'struct') return t.name;
  if (t.k === 'obj') return t.cls;
  return TYPE_CNAME[t.k] || t.k;
}
export function arrT(elem: PType, dims: (number | null)[]): PType { return { k: 'array', elem, dims }; }
export function subT(t: PType): PType {
  if (t.k !== 'array') throw new Error('subT() called on a non-array type');
  return t.dims.length > 1 ? arrT(t.elem, t.dims.slice(1)) : t.elem;
}
export function sizeOfT(t: PType): number {
  if (t.k === 'array') return t.dims.reduce((a: number, d) => a * (d || 0), 1) * sizeOfT(t.elem);
  if (t.k === 'struct') return t.def.fields.reduce((a, f) => a + sizeOfT(f.type || TY.i16!), 0);
  return TSIZE[t.k] != null ? TSIZE[t.k]! : 2;
}

function fmtFloat(x: number, digits?: number | null): string {
  if (digits == null) digits = 2;
  if (Number.isNaN(x)) return 'nan';
  if (!Number.isFinite(x)) return 'inf';
  if (x > 4294967040 || x < -4294967040) return 'ovf';
  let s = '';
  if (x < 0) { s = '-'; x = -x; }
  let r = 0.5; for (let i = 0; i < digits; i++) r /= 10;
  x += r;
  const ip = Math.floor(x); let rem = x - ip;
  s += ip;
  if (digits > 0) { s += '.'; for (let i = 0; i < digits; i++) { rem *= 10; const d = Math.min(9, Math.floor(rem)); s += d; rem -= d; } }
  return s;
}
export function fmtValue(v: number | string, t: PType, fmt?: number | null): string {
  const k = kindOf(t);
  if (k === 'str') return String(v);
  const n = v as number;
  if (k === 'f32') return fmtFloat(n, fmt == null ? 2 : fmt);
  if (k === 'i8' && fmt == null) return String.fromCharCode(n & 255);
  if (fmt == null || fmt === 10) return String(k === 'i64' ? Math.trunc(n) : n);
  if (fmt === 0) return String.fromCharCode(n & 255);
  let u = n;
  if (u < 0) u = u >>> 0;
  return u.toString(fmt).toUpperCase();
}
export function toStrFn(t: PType): (v: number | string) => string {
  const k = kindOf(t);
  if (k === 'str') return v => v as string;
  if (k === 'i8') return v => String.fromCharCode((v as number) & 255);
  if (k === 'f32') return v => fmtFloat(v as number, 2);
  return v => String(v);
}
export function cloneVal<T>(v: T): T {
  if (Array.isArray(v)) return v.map(cloneVal) as T;
  if (v && typeof v === 'object' && !(v as { __obj?: boolean }).__obj) {
    const o: Record<string, unknown> = {};
    for (const key in v) o[key] = cloneVal((v as Record<string, unknown>)[key]);
    return o as T;
  }
  return v;
}

/* ---- builtin constants ---- */
export const ARDUINO_CONSTS: Record<string, [PrimK, number]> = {
  HIGH: ['i16', 1], LOW: ['i16', 0], INPUT: ['i16', 0], OUTPUT: ['i16', 1], INPUT_PULLUP: ['i16', 2],
  LED_BUILTIN: ['i16', 13], A0: ['i16', 14], A1: ['i16', 15], A2: ['i16', 16], A3: ['i16', 17], A4: ['i16', 18], A5: ['i16', 19],
  PI: ['f32', Math.fround(Math.PI)], HALF_PI: ['f32', Math.fround(Math.PI / 2)], TWO_PI: ['f32', Math.fround(Math.PI * 2)],
  DEG_TO_RAD: ['f32', Math.fround(Math.PI / 180)], RAD_TO_DEG: ['f32', Math.fround(180 / Math.PI)], EULER: ['f32', Math.fround(Math.E)],
  DEC: ['i16', 10], HEX: ['i16', 16], OCT: ['i16', 8], BIN: ['i16', 2],
  CHANGE: ['i16', 1], FALLING: ['i16', 2], RISING: ['i16', 3], LSBFIRST: ['i16', 0], MSBFIRST: ['i16', 1],
  SERIAL_8N1: ['i16', 6], NULL: ['i16', 0],
  MAX_SENSOR_DISTANCE: ['i16', 500], US_ROUNDTRIP_CM: ['i16', 57], US_ROUNDTRIP_IN: ['i16', 146], NO_ECHO: ['i16', 0],
  PING_MEDIAN_DELAY: ['i16', 29000],
};
export const GEN_BUILTINS = new Set(['delay', 'delayMicroseconds', 'pulseIn', 'pulseInLong']);
export const GEN_METHODS = new Set(['ping', 'ping_cm', 'ping_in', 'ping_median', 'readString', 'readStringUntil', 'parseInt', 'parseFloat']);
export const PWM_PINS = new Set([3, 5, 6, 9, 10, 11]);
export const CAST_NAMES: Record<string, PrimK> = {
  int: 'i16', float: 'f32', double: 'f32', long: 'i32', byte: 'u8', char: 'i8', bool: 'bool', boolean: 'bool', word: 'u16',
  uint8_t: 'u8', int8_t: 'i8', uint16_t: 'u16', int16_t: 'i16', uint32_t: 'u32', int32_t: 'i32', size_t: 'u16', unsigned: 'u16',
};

export const fr = Math.fround;

/**
 * A builtin/method spec, shared by BUILTINS/SERIAL_METHODS/STRING_METHODS/NEWPING_METHODS.
 * `make` is handed the live MCU instance (mcu.ts; kept as `any` here since types.ts is
 * foundational and mcu.ts depends on it, not the other way around - see mcu.ts's header)
 * and the argument kinds, and returns a plain function or, when `gen` is set, a generator
 * function - the same sync/generator duality as the rest of the compiled-closure machinery
 * in compiler.ts, which is also why the return type here is deliberately loose.
 */
export interface BuiltinSpec {
  n: [number, number];
  ret: Kind | ((argKinds: Kind[]) => Kind);
  gen?: boolean;
  mut?: boolean;
  make: (M: any, argKinds: Kind[]) => (...args: any[]) => any;
}

function mathF(fn: (...a: number[]) => number): BuiltinSpec { return { n: [fn.length, fn.length], ret: 'f32', make: () => (...a: number[]) => fr(fn(...a)) }; }
function numCommon(ts: Kind[]): Kind { let k = promoteK(ts[0]!); for (let i = 1; i < ts.length; i++) k = commonK(k, promoteK(ts[i]!)); return k === 'str' ? 'i16' : k; }

// Builtin functions. make(M, argKinds) returns an implementation (plain function or generator function).
export const BUILTINS: Record<string, BuiltinSpec> = {
  pinMode: { n: [2, 2], ret: 'void', make: M => (p: number, m: number) => M.pinMode(p, m) },
  digitalWrite: { n: [2, 2], ret: 'void', make: M => (p: number, v: number) => M.digitalWrite(p, v) },
  digitalRead: { n: [1, 1], ret: 'i16', make: M => (p: number) => M.digitalRead(p) },
  analogWrite: { n: [2, 2], ret: 'void', make: M => (p: number, v: number) => M.analogWrite(p, v) },
  analogRead: { n: [1, 1], ret: 'i16', make: M => (p: number) => M.analogRead(p) },
  analogReference: { n: [1, 1], ret: 'void', make: () => () => { } },
  millis: { n: [0, 0], ret: 'u32', make: M => () => { M.t += 1; return Math.floor((M.t - M.t0) / 1000) >>> 0; } },
  micros: { n: [0, 0], ret: 'u32', make: M => () => { M.t += 1; return (Math.floor((M.t - M.t0) / 4) * 4) >>> 0; } },
  delay: { n: [1, 1], ret: 'void', gen: true, make: M => function* (ms: number) { M.delayMs(ms); if (M.t >= M.frameEnd) yield 0; } },
  delayMicroseconds: { n: [1, 1], ret: 'void', gen: true, make: M => function* (us: number) { M.t += (us & 65535) + 0.5; if (M.t >= M.frameEnd) yield 0; } },
  pulseIn: { n: [2, 3], ret: 'u32', gen: true, make: M => function* (p: number, st: number, to?: number) { const r = M.pulseIn(p, st, to); if (M.t >= M.frameEnd) yield 0; return r; } },
  pulseInLong: { n: [2, 3], ret: 'u32', gen: true, make: M => function* (p: number, st: number, to?: number) { const r = M.pulseIn(p, st, to); if (M.t >= M.frameEnd) yield 0; return r; } },
  tone: { n: [2, 3], ret: 'void', make: M => () => M.warnOnce('tone', 'tone(): there is no buzzer on this robot, call ignored') },
  noTone: { n: [1, 1], ret: 'void', make: () => () => { } },
  yield: { n: [0, 0], ret: 'void', make: () => () => { } },
  interrupts: { n: [0, 0], ret: 'void', make: () => () => { } },
  noInterrupts: { n: [0, 0], ret: 'void', make: () => () => { } },
  attachInterrupt: { n: [3, 3], ret: 'void', make: M => () => M.warnOnce('isr', 'attachInterrupt(): this robot has no encoders or interrupt sources; the ISR will never run') },
  detachInterrupt: { n: [1, 1], ret: 'void', make: () => () => { } },
  digitalPinToInterrupt: { n: [1, 1], ret: 'i16', make: () => (p: number) => (p === 2 ? 0 : p === 3 ? 1 : -1) },
  randomSeed: { n: [1, 1], ret: 'void', make: M => (s: number) => M.randomSeed(s) },
  random: { n: [1, 2], ret: 'i32', make: M => (a: number, b?: number) => M.random(a, b) },
  abs: { n: [1, 1], ret: ts => promoteK(ts[0]!), make: (_M, ts) => { const k = promoteK(ts[0]!); if (k === 'f32') return (x: number) => Math.abs(x); const w = WRAP[k]!; return (x: number) => w(x < 0 ? -x : x); } },
  fabs: mathF(Math.abs),
  min: { n: [2, 2], ret: ts => numCommon(ts), make: (_M, ts) => { const w = WRAP[numCommon(ts)]!; return (a: number, b: number) => w(a < b ? a : b); } },
  max: { n: [2, 2], ret: ts => numCommon(ts), make: (_M, ts) => { const w = WRAP[numCommon(ts)]!; return (a: number, b: number) => w(a > b ? a : b); } },
  constrain: { n: [3, 3], ret: ts => numCommon(ts), make: (_M, ts) => { const w = WRAP[numCommon(ts)]!; return (x: number, lo: number, hi: number) => w(x < lo ? lo : (x > hi ? hi : x)); } },
  map: {
    n: [5, 5], ret: 'i32', make: () => (x: number, a: number, b: number, c: number, d: number) => {
      x = x | 0; a = a | 0; b = b | 0; c = c | 0; d = d | 0;
      if (b === a) return -1;
      return ((Math.trunc((Math.imul((x - a) | 0, (d - c) | 0)) / ((b - a) | 0)) + c) | 0);
    }
  },
  sq: { n: [1, 1], ret: ts => promoteK(ts[0]!) === 'str' ? 'i16' : promoteK(ts[0]!), make: (_M, ts) => { const w = WRAP[promoteK(ts[0]!)] || WRAP.f32!; return (x: number) => w(x * x); } },
  sqrt: mathF(Math.sqrt), sin: mathF(Math.sin), cos: mathF(Math.cos), tan: mathF(Math.tan), asin: mathF(Math.asin), acos: mathF(Math.acos),
  atan: mathF(Math.atan), atan2: mathF(Math.atan2), exp: mathF(Math.exp), log: mathF(Math.log), log10: mathF(Math.log10),
  floor: mathF(Math.floor), ceil: mathF(Math.ceil), pow: mathF(Math.pow), hypot: mathF(Math.hypot), fmod: mathF((a, b) => a % b),
  fmin: mathF(Math.min), fmax: mathF(Math.max), trunc: mathF(Math.trunc), cbrt: mathF(Math.cbrt),
  round: mathF(x => (x >= 0 ? Math.floor(x + 0.5) : -Math.floor(-x + 0.5))), lround: { n: [1, 1], ret: 'i32', make: () => (x: number) => (x >= 0 ? Math.floor(x + 0.5) : -Math.floor(-x + 0.5)) | 0 },
  radians: mathF(x => x * Math.PI / 180), degrees: mathF(x => x * 180 / Math.PI),
  isnan: { n: [1, 1], ret: 'bool', make: () => (x: number) => (Number.isNaN(x) ? 1 : 0) }, isinf: { n: [1, 1], ret: 'bool', make: () => (x: number) => (x === Infinity || x === -Infinity ? 1 : 0) },
  bitRead: { n: [2, 2], ret: 'i16', make: () => (v: number, b: number) => (b < 32 ? (v >>> b) & 1 : 0) },
  bit: { n: [1, 1], ret: 'u32', make: () => (b: number) => (1 << b) >>> 0 },
  lowByte: { n: [1, 1], ret: 'u8', make: () => (v: number) => v & 255 },
  highByte: { n: [1, 1], ret: 'u8', make: () => (v: number) => (v >> 8) & 255 },
};

// Serial methods
export const SERIAL_METHODS: Record<string, BuiltinSpec> = {
  begin: { n: [1, 2], ret: 'void', make: M => (b: number) => M.serialBegin(b) },
  end: { n: [0, 0], ret: 'void', make: M => () => { M.serialOn = false; } },
  print: { n: [1, 2], ret: 'u16', make: (M, ts) => { const t: StrType | PType = { k: ts[0]! } as PType; return (v: number | string, f?: number) => M.serialWrite(fmtValue(v, t as PType, f)); } },
  println: { n: [0, 2], ret: 'u16', make: (M, ts) => { if (!ts.length) return () => M.serialWrite('\r\n'); const t = { k: ts[0]! } as PType; return (v: number | string, f?: number) => M.serialWrite(fmtValue(v, t, f) + '\r\n'); } },
  write: { n: [1, 1], ret: 'u16', make: (M, ts) => (ts[0] === 'str' ? (v: string) => M.serialWrite(v) : (v: number) => M.serialWrite(String.fromCharCode(v & 255))) },
  available: { n: [0, 0], ret: 'i16', make: M => () => M.rx.length },
  availableForWrite: { n: [0, 0], ret: 'i16', make: () => () => 63 },
  read: { n: [0, 0], ret: 'i16', make: M => () => (M.rx.length ? M.rx.shift() : -1) },
  peek: { n: [0, 0], ret: 'i16', make: M => () => (M.rx.length ? M.rx[0] : -1) },
  flush: { n: [0, 0], ret: 'void', make: M => () => M.serialFlush() },
  setTimeout: { n: [1, 1], ret: 'void', make: M => (ms: number) => { M.serialTimeout = ms; } },
  readString: { n: [0, 0], ret: 'str', gen: true, make: M => function* () { const s = M.rx.map((c: number) => String.fromCharCode(c)).join(''); M.rx.length = 0; M.t += 1000; if (M.t >= M.frameEnd) yield 0; return s; } },
  readStringUntil: {
    n: [1, 1], ret: 'str', gen: true, make: M => function* (term: number) {
      let s = ''; while (M.rx.length) { const c = M.rx.shift(); if (c === term) break; s += String.fromCharCode(c); }
      M.t += 50; if (M.t >= M.frameEnd) yield 0; return s;
    }
  },
  parseInt: {
    n: [0, 0], ret: 'i32', gen: true, make: M => function* () {
      while (M.rx.length && !/[-0-9]/.test(String.fromCharCode(M.rx[0]))) M.rx.shift();
      let s = ''; while (M.rx.length && /[-0-9]/.test(String.fromCharCode(M.rx[0]))) s += String.fromCharCode(M.rx.shift());
      if (!s) { M.t += (M.serialTimeout || 1000) * 1000; if (M.t >= M.frameEnd) yield 0; } return parseInt(s || '0', 10) | 0;
    }
  },
  parseFloat: {
    n: [0, 0], ret: 'f32', gen: true, make: M => function* () {
      while (M.rx.length && !/[-0-9.]/.test(String.fromCharCode(M.rx[0]))) M.rx.shift();
      let s = ''; while (M.rx.length && /[-0-9.]/.test(String.fromCharCode(M.rx[0]))) s += String.fromCharCode(M.rx.shift());
      if (!s) { M.t += (M.serialTimeout || 1000) * 1000; if (M.t >= M.frameEnd) yield 0; } return fr(parseFloat(s || '0'));
    }
  },
};

// String (Arduino String class) methods. mut: method mutates the object.
export const STRING_METHODS: Record<string, BuiltinSpec> = {
  length: { n: [0, 0], ret: 'u16', make: () => (s: string) => s.length },
  charAt: { n: [1, 1], ret: 'i8', make: () => (s: string, i: number) => (i < s.length ? WRAP.i8!(s.charCodeAt(i)) : 0) },
  indexOf: { n: [1, 2], ret: 'i16', make: (_M, ts) => (s: string, x: number | string, from?: number) => s.indexOf(ts[1] === 'i8' ? String.fromCharCode(x as number) : String(x), from || 0) },
  lastIndexOf: { n: [1, 1], ret: 'i16', make: (_M, ts) => (s: string, x: number | string) => s.lastIndexOf(ts[1] === 'i8' ? String.fromCharCode(x as number) : String(x)) },
  substring: { n: [1, 2], ret: 'str', make: () => (s: string, a: number, b?: number) => (b === undefined ? s.substring(a) : s.substring(a, b)) },
  toInt: { n: [0, 0], ret: 'i32', make: () => (s: string) => (parseInt(s, 10) | 0) },
  toFloat: { n: [0, 0], ret: 'f32', make: () => (s: string) => fr(parseFloat(s) || 0) },
  equals: { n: [1, 1], ret: 'bool', make: () => (s: string, o: string) => (s === o ? 1 : 0) },
  equalsIgnoreCase: { n: [1, 1], ret: 'bool', make: () => (s: string, o: string) => (s.toLowerCase() === String(o).toLowerCase() ? 1 : 0) },
  startsWith: { n: [1, 1], ret: 'bool', make: () => (s: string, o: string) => (s.startsWith(o) ? 1 : 0) },
  endsWith: { n: [1, 1], ret: 'bool', make: () => (s: string, o: string) => (s.endsWith(o) ? 1 : 0) },
  compareTo: { n: [1, 1], ret: 'i16', make: () => (s: string, o: string) => (s < o ? -1 : s > o ? 1 : 0) },
  c_str: { n: [0, 0], ret: 'str', make: () => (s: string) => s },
  reserve: { n: [1, 1], ret: 'void', make: () => () => { } },
  trim: { n: [0, 0], ret: 'void', mut: true, make: () => (s: string) => s.trim() },
  toUpperCase: { n: [0, 0], ret: 'void', mut: true, make: () => (s: string) => s.toUpperCase() },
  toLowerCase: { n: [0, 0], ret: 'void', mut: true, make: () => (s: string) => s.toLowerCase() },
  concat: { n: [1, 1], ret: 'bool', mut: true, make: (_M, ts) => { const f = toStrFn({ k: ts[1]! } as PType); return (s: string, o: number | string) => s + f(o); } },
  replace: { n: [2, 2], ret: 'void', mut: true, make: (_M, ts) => { const f1 = toStrFn({ k: ts[1]! } as PType), f2 = toStrFn({ k: ts[2]! } as PType); return (s: string, a: number | string, b: number | string) => s.split(f1(a)).join(f2(b)); } },
  remove: { n: [1, 2], ret: 'void', mut: true, make: () => (s: string, i: number, c?: number) => (c === undefined ? s.slice(0, i) : s.slice(0, i) + s.slice(i + c)) },
};

// NewPing library
export const NEWPING_METHODS: Record<string, BuiltinSpec> = {
  ping: { n: [0, 1], ret: 'u32', gen: true, make: M => function* (o: unknown, mx?: number) { const r = M.npPing(o, mx); if (M.t >= M.frameEnd) yield 0; return r; } },
  ping_cm: { n: [0, 1], ret: 'u32', gen: true, make: M => function* (o: unknown, mx?: number) { const us = M.npPing(o, mx); if (M.t >= M.frameEnd) yield 0; return Math.floor((us + 28) / 57) >>> 0; } },
  ping_in: { n: [0, 1], ret: 'u32', gen: true, make: M => function* (o: unknown, mx?: number) { const us = M.npPing(o, mx); if (M.t >= M.frameEnd) yield 0; return Math.floor((us + 73) / 146) >>> 0; } },
  ping_median: {
    n: [0, 2], ret: 'u32', gen: true, make: M => function* (o: unknown, it?: number, mx?: number) {
      it = it || 5; const v: number[] = [];
      let us = 0;
      for (let i = 0; i < it; i++) { us = M.npPing(o, mx); if (us) v.push(us); if (i < it - 1) M.t += Math.max(0, 29000 - (us || 0)); if (M.t >= M.frameEnd) yield 0; }
      if (!v.length) return 0; v.sort((a, b) => a - b); return v[Math.floor(v.length / 2)]! >>> 0;
    }
  },
  convert_cm: { n: [1, 1], ret: 'u32', make: () => (_o: unknown, us: number) => Math.floor((us + 28) / 57) >>> 0 },
  convert_in: { n: [1, 1], ret: 'u32', make: () => (_o: unknown, us: number) => Math.floor((us + 73) / 146) >>> 0 },
};
