/**
 * Type system and runtime library: AVR integer semantics (16-bit int), Arduino print formatting, and the built-in functions, Serial, String and NewPing methods.
 */
/* ===================== Types, conversions, printing ===================== */
const SIG_BRK = 1, SIG_CNT = 2, SIG_RET = 3;
const TSIZE = { bool: 1, i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, i64: 8, f32: 4, str: 6, enum: 2, void: 0, obj: 8 };
const INT_K = new Set(['bool', 'i8', 'u8', 'i16', 'u16', 'i32', 'u32', 'i64']);
const TY = {};
for (const k of ['void', 'bool', 'i8', 'u8', 'i16', 'u16', 'i32', 'u32', 'i64', 'f32', 'str']) TY[k] = { k };
const TYPE_CNAME = { void: 'void', bool: 'bool', i8: 'char', u8: 'byte', i16: 'int', u16: 'unsigned int', i32: 'long', u32: 'unsigned long', i64: 'long long', f32: 'float', str: 'String' };

const WRAP = {
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

function kindOf(t) { if (!t) return 'void'; if (t.k === 'enum') return 'i16'; return t.k; }
function isNumK(k) { return INT_K.has(k) || k === 'f32'; }
function promoteK(k) { if (k === 'bool' || k === 'i8' || k === 'u8' || k === 'i16' || k === 'enum') return 'i16'; return k; }
function commonK(a, b) {
  if (a === 'str' || b === 'str') return 'str';
  if (a === 'f32' || b === 'f32') return 'f32';
  if (a === 'i64' || b === 'i64') return 'i64';
  if (a === 'u32' || b === 'u32') return 'u32';
  if (a === 'i32' || b === 'i32') return 'i32';
  if (a === 'u16' || b === 'u16') return 'u16';
  return 'i16';
}
function typeName(t) {
  if (!t) return 'void';
  if (t.k === 'array') return typeName(t.elem) + t.dims.map(d => `[${d == null ? '' : d}]`).join('');
  if (t.k === 'enum') return t.name;
  if (t.k === 'struct') return t.name;
  if (t.k === 'obj') return t.cls;
  return TYPE_CNAME[t.k] || t.k;
}
function arrT(elem, dims) { return { k: 'array', elem, dims }; }
function subT(t) { return t.dims.length > 1 ? arrT(t.elem, t.dims.slice(1)) : t.elem; }
function sizeOfT(t) {
  if (t.k === 'array') return t.dims.reduce((a, d) => a * (d || 0), 1) * sizeOfT(t.elem);
  if (t.k === 'struct') return t.def.fields.reduce((a, f) => a + sizeOfT(f.ctype || TY.i16), 0);
  return TSIZE[t.k] != null ? TSIZE[t.k] : 2;
}

function fmtFloat(x, digits) {
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
function fmtValue(v, t, fmt) {
  const k = kindOf(t);
  if (k === 'str') return String(v);
  if (k === 'f32') return fmtFloat(v, fmt == null ? 2 : fmt);
  if (k === 'i8' && fmt == null) return String.fromCharCode(v & 255);
  if (fmt == null || fmt === 10) return String(k === 'i64' ? Math.trunc(v) : v);
  if (fmt === 0) return String.fromCharCode(v & 255);
  let u = v;
  if (u < 0) u = u >>> 0;
  return u.toString(fmt).toUpperCase();
}
function toStrFn(t) {
  const k = kindOf(t);
  if (k === 'str') return v => v;
  if (k === 'i8') return v => String.fromCharCode(v & 255);
  if (k === 'f32') return v => fmtFloat(v, 2);
  return v => String(v);
}
function cloneVal(v) {
  if (Array.isArray(v)) return v.map(cloneVal);
  if (v && typeof v === 'object' && !v.__obj) { const o = {}; for (const key in v) o[key] = cloneVal(v[key]); return o; }
  return v;
}

/* ---- builtin constants ---- */
const ARDUINO_CONSTS = {
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
const GEN_BUILTINS = new Set(['delay', 'delayMicroseconds', 'pulseIn', 'pulseInLong']);
const GEN_METHODS = new Set(['ping', 'ping_cm', 'ping_in', 'ping_median', 'readString', 'readStringUntil', 'parseInt', 'parseFloat']);
const PWM_PINS = new Set([3, 5, 6, 9, 10, 11]);
const CAST_NAMES = { int: 'i16', float: 'f32', double: 'f32', long: 'i32', byte: 'u8', char: 'i8', bool: 'bool', boolean: 'bool', word: 'u16',
  uint8_t: 'u8', int8_t: 'i8', uint16_t: 'u16', int16_t: 'i16', uint32_t: 'u32', int32_t: 'i32', size_t: 'u16', unsigned: 'u16' };

const fr = Math.fround;
function mathF(fn) { return { n: [fn.length, fn.length], ret: 'f32', make: () => (...a) => fr(fn(...a)) }; }
function numCommon(ts) { let k = promoteK(ts[0]); for (let i = 1; i < ts.length; i++) k = commonK(k, promoteK(ts[i])); return k === 'str' ? 'i16' : k; }

// Builtin functions. make(M, argKinds) returns an implementation (plain function or generator function).
const BUILTINS = {
  pinMode: { n: [2, 2], ret: 'void', make: M => (p, m) => M.pinMode(p, m) },
  digitalWrite: { n: [2, 2], ret: 'void', make: M => (p, v) => M.digitalWrite(p, v) },
  digitalRead: { n: [1, 1], ret: 'i16', make: M => p => M.digitalRead(p) },
  analogWrite: { n: [2, 2], ret: 'void', make: M => (p, v) => M.analogWrite(p, v) },
  analogRead: { n: [1, 1], ret: 'i16', make: M => p => M.analogRead(p) },
  analogReference: { n: [1, 1], ret: 'void', make: () => () => { } },
  millis: { n: [0, 0], ret: 'u32', make: M => () => { M.t += 1; return Math.floor((M.t - M.t0) / 1000) >>> 0; } },
  micros: { n: [0, 0], ret: 'u32', make: M => () => { M.t += 1; return (Math.floor((M.t - M.t0) / 4) * 4) >>> 0; } },
  delay: { n: [1, 1], ret: 'void', gen: true, make: M => function* (ms) { M.delayMs(ms); if (M.t >= M.frameEnd) yield 0; } },
  delayMicroseconds: { n: [1, 1], ret: 'void', gen: true, make: M => function* (us) { M.t += (us & 65535) + 0.5; if (M.t >= M.frameEnd) yield 0; } },
  pulseIn: { n: [2, 3], ret: 'u32', gen: true, make: M => function* (p, st, to) { const r = M.pulseIn(p, st, to); if (M.t >= M.frameEnd) yield 0; return r; } },
  pulseInLong: { n: [2, 3], ret: 'u32', gen: true, make: M => function* (p, st, to) { const r = M.pulseIn(p, st, to); if (M.t >= M.frameEnd) yield 0; return r; } },
  tone: { n: [2, 3], ret: 'void', make: M => () => M.warnOnce('tone', 'tone(): there is no buzzer on this robot, call ignored') },
  noTone: { n: [1, 1], ret: 'void', make: () => () => { } },
  yield: { n: [0, 0], ret: 'void', make: () => () => { } },
  interrupts: { n: [0, 0], ret: 'void', make: () => () => { } },
  noInterrupts: { n: [0, 0], ret: 'void', make: () => () => { } },
  attachInterrupt: { n: [3, 3], ret: 'void', make: M => () => M.warnOnce('isr', 'attachInterrupt(): this robot has no encoders or interrupt sources; the ISR will never run') },
  detachInterrupt: { n: [1, 1], ret: 'void', make: () => () => { } },
  digitalPinToInterrupt: { n: [1, 1], ret: 'i16', make: () => p => (p === 2 ? 0 : p === 3 ? 1 : -1) },
  randomSeed: { n: [1, 1], ret: 'void', make: M => s => M.randomSeed(s) },
  random: { n: [1, 2], ret: 'i32', make: M => (a, b) => M.random(a, b) },
  abs: { n: [1, 1], ret: ts => promoteK(ts[0]), make: (M, ts) => { const k = promoteK(ts[0]); if (k === 'f32') return x => Math.abs(x); const w = WRAP[k]; return x => w(x < 0 ? -x : x); } },
  fabs: mathF(Math.abs),
  min: { n: [2, 2], ret: ts => numCommon(ts), make: (M, ts) => { const w = WRAP[numCommon(ts)]; return (a, b) => w(a < b ? a : b); } },
  max: { n: [2, 2], ret: ts => numCommon(ts), make: (M, ts) => { const w = WRAP[numCommon(ts)]; return (a, b) => w(a > b ? a : b); } },
  constrain: { n: [3, 3], ret: ts => numCommon(ts), make: (M, ts) => { const w = WRAP[numCommon(ts)]; return (x, lo, hi) => w(x < lo ? lo : (x > hi ? hi : x)); } },
  map: {
    n: [5, 5], ret: 'i32', make: () => (x, a, b, c, d) => {
      x = x | 0; a = a | 0; b = b | 0; c = c | 0; d = d | 0;
      if (b === a) return -1;
      return ((Math.trunc((Math.imul((x - a) | 0, (d - c) | 0)) / ((b - a) | 0)) + c) | 0);
    }
  },
  sq: { n: [1, 1], ret: ts => promoteK(ts[0]) === 'str' ? 'i16' : promoteK(ts[0]), make: (M, ts) => { const w = WRAP[promoteK(ts[0])] || WRAP.f32; return x => w(x * x); } },
  sqrt: mathF(Math.sqrt), sin: mathF(Math.sin), cos: mathF(Math.cos), tan: mathF(Math.tan), asin: mathF(Math.asin), acos: mathF(Math.acos),
  atan: mathF(Math.atan), atan2: mathF(Math.atan2), exp: mathF(Math.exp), log: mathF(Math.log), log10: mathF(Math.log10),
  floor: mathF(Math.floor), ceil: mathF(Math.ceil), pow: mathF(Math.pow), hypot: mathF(Math.hypot), fmod: mathF((a, b) => a % b),
  fmin: mathF(Math.min), fmax: mathF(Math.max), trunc: mathF(Math.trunc), cbrt: mathF(Math.cbrt),
  round: mathF(x => (x >= 0 ? Math.floor(x + 0.5) : -Math.floor(-x + 0.5))), lround: { n: [1, 1], ret: 'i32', make: () => x => (x >= 0 ? Math.floor(x + 0.5) : -Math.floor(-x + 0.5)) | 0 },
  radians: mathF(x => x * Math.PI / 180), degrees: mathF(x => x * 180 / Math.PI),
  isnan: { n: [1, 1], ret: 'bool', make: () => x => (Number.isNaN(x) ? 1 : 0) }, isinf: { n: [1, 1], ret: 'bool', make: () => x => (x === Infinity || x === -Infinity ? 1 : 0) },
  bitRead: { n: [2, 2], ret: 'i16', make: () => (v, b) => (b < 32 ? (v >>> b) & 1 : 0) },
  bit: { n: [1, 1], ret: 'u32', make: () => b => (1 << b) >>> 0 },
  lowByte: { n: [1, 1], ret: 'u8', make: () => v => v & 255 },
  highByte: { n: [1, 1], ret: 'u8', make: () => v => (v >> 8) & 255 },
};

// Serial methods
const SERIAL_METHODS = {
  begin: { n: [1, 2], ret: 'void', make: M => b => M.serialBegin(b) },
  end: { n: [0, 0], ret: 'void', make: M => () => { M.serialOn = false; } },
  print: { n: [1, 2], ret: 'u16', make: (M, ts) => { const t = { k: ts[0] }; return (v, f) => M.serialWrite(fmtValue(v, t, f)); } },
  println: { n: [0, 2], ret: 'u16', make: (M, ts) => { if (!ts.length) return () => M.serialWrite('\r\n'); const t = { k: ts[0] }; return (v, f) => M.serialWrite(fmtValue(v, t, f) + '\r\n'); } },
  write: { n: [1, 1], ret: 'u16', make: (M, ts) => (ts[0] === 'str' ? v => M.serialWrite(v) : v => M.serialWrite(String.fromCharCode(v & 255))) },
  available: { n: [0, 0], ret: 'i16', make: M => () => M.rx.length },
  availableForWrite: { n: [0, 0], ret: 'i16', make: () => () => 63 },
  read: { n: [0, 0], ret: 'i16', make: M => () => (M.rx.length ? M.rx.shift() : -1) },
  peek: { n: [0, 0], ret: 'i16', make: M => () => (M.rx.length ? M.rx[0] : -1) },
  flush: { n: [0, 0], ret: 'void', make: M => () => M.serialFlush() },
  setTimeout: { n: [1, 1], ret: 'void', make: M => ms => { M.serialTimeout = ms; } },
  readString: { n: [0, 0], ret: 'str', gen: true, make: M => function* () { const s = M.rx.map(c => String.fromCharCode(c)).join(''); M.rx.length = 0; M.t += 1000; if (M.t >= M.frameEnd) yield 0; return s; } },
  readStringUntil: {
    n: [1, 1], ret: 'str', gen: true, make: M => function* (term) {
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
const STRING_METHODS = {
  length: { n: [0, 0], ret: 'u16', make: () => s => s.length },
  charAt: { n: [1, 1], ret: 'i8', make: () => (s, i) => (i < s.length ? WRAP.i8(s.charCodeAt(i)) : 0) },
  indexOf: { n: [1, 2], ret: 'i16', make: (M, ts) => (s, x, from) => s.indexOf(ts[1] === 'i8' ? String.fromCharCode(x) : String(x), from || 0) },
  lastIndexOf: { n: [1, 1], ret: 'i16', make: (M, ts) => (s, x) => s.lastIndexOf(ts[1] === 'i8' ? String.fromCharCode(x) : String(x)) },
  substring: { n: [1, 2], ret: 'str', make: () => (s, a, b) => (b === undefined ? s.substring(a) : s.substring(a, b)) },
  toInt: { n: [0, 0], ret: 'i32', make: () => s => (parseInt(s, 10) | 0) },
  toFloat: { n: [0, 0], ret: 'f32', make: () => s => fr(parseFloat(s) || 0) },
  equals: { n: [1, 1], ret: 'bool', make: () => (s, o) => (s === o ? 1 : 0) },
  equalsIgnoreCase: { n: [1, 1], ret: 'bool', make: () => (s, o) => (s.toLowerCase() === String(o).toLowerCase() ? 1 : 0) },
  startsWith: { n: [1, 1], ret: 'bool', make: () => (s, o) => (s.startsWith(o) ? 1 : 0) },
  endsWith: { n: [1, 1], ret: 'bool', make: () => (s, o) => (s.endsWith(o) ? 1 : 0) },
  compareTo: { n: [1, 1], ret: 'i16', make: () => (s, o) => (s < o ? -1 : s > o ? 1 : 0) },
  c_str: { n: [0, 0], ret: 'str', make: () => s => s },
  reserve: { n: [1, 1], ret: 'void', make: () => () => { } },
  trim: { n: [0, 0], ret: 'void', mut: true, make: () => s => s.trim() },
  toUpperCase: { n: [0, 0], ret: 'void', mut: true, make: () => s => s.toUpperCase() },
  toLowerCase: { n: [0, 0], ret: 'void', mut: true, make: () => s => s.toLowerCase() },
  concat: { n: [1, 1], ret: 'bool', mut: true, make: (M, ts) => { const f = toStrFn({ k: ts[1] }); return (s, o) => s + f(o); } },
  replace: { n: [2, 2], ret: 'void', mut: true, make: (M, ts) => { const f1 = toStrFn({ k: ts[1] }), f2 = toStrFn({ k: ts[2] }); return (s, a, b) => s.split(f1(a)).join(f2(b)); } },
  remove: { n: [1, 2], ret: 'void', mut: true, make: () => (s, i, c) => (c === undefined ? s.slice(0, i) : s.slice(0, i) + s.slice(i + c)) },
};

// NewPing library
const NEWPING_METHODS = {
  ping: { n: [0, 1], ret: 'u32', gen: true, make: M => function* (o, mx) { const r = M.npPing(o, mx); if (M.t >= M.frameEnd) yield 0; return r; } },
  ping_cm: { n: [0, 1], ret: 'u32', gen: true, make: M => function* (o, mx) { const us = M.npPing(o, mx); if (M.t >= M.frameEnd) yield 0; return Math.floor((us + 28) / 57) >>> 0; } },
  ping_in: { n: [0, 1], ret: 'u32', gen: true, make: M => function* (o, mx) { const us = M.npPing(o, mx); if (M.t >= M.frameEnd) yield 0; return Math.floor((us + 73) / 146) >>> 0; } },
  ping_median: {
    n: [0, 2], ret: 'u32', gen: true, make: M => function* (o, it, mx) {
      it = it || 5; const v = [];
      for (let i = 0; i < it; i++) { const us = M.npPing(o, mx); if (us) v.push(us); if (i < it - 1) M.t += Math.max(0, 29000 - (us || 0)); if (M.t >= M.frameEnd) yield 0; }
      if (!v.length) return 0; v.sort((a, b) => a - b); return v[Math.floor(v.length / 2)] >>> 0;
    }
  },
  convert_cm: { n: [1, 1], ret: 'u32', make: () => (o, us) => Math.floor((us + 28) / 57) >>> 0 },
  convert_in: { n: [1, 1], ret: 'u32', make: () => (o, us) => Math.floor((us + 73) / 146) >>> 0 },
};

export { SIG_BRK, TSIZE, INT_K, TY, TYPE_CNAME, WRAP, kindOf, isNumK, promoteK, commonK, typeName, arrT, subT, sizeOfT, fmtFloat, fmtValue, toStrFn, cloneVal, ARDUINO_CONSTS, GEN_BUILTINS, GEN_METHODS, PWM_PINS, CAST_NAMES, fr, mathF, numCommon, BUILTINS, SERIAL_METHODS, STRING_METHODS, NEWPING_METHODS, SIG_CNT, SIG_RET };
