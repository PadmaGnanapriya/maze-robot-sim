/**
 * Compiles the AST into JavaScript closures (no eval). Code that can block (delay, pulseIn, loops) becomes generator functions so the simulator can pause the virtual Uno between frames.
 */
import { CompileError, cppParse } from './parser.js';
import {
  ARDUINO_CONSTS, BUILTINS, CAST_NAMES, GEN_BUILTINS, GEN_METHODS, INT_K, NEWPING_METHODS, PWM_PINS, SERIAL_METHODS, SIG_BRK, SIG_CNT, SIG_RET, STRING_METHODS, TY, WRAP,
  arrT, cloneVal, commonK, fmtValue, fr, isNumK, kindOf, promoteK, sizeOfT, subT, toStrFn, typeName, type Kind, type BuiltinSpec,
} from './types.js';
import type { MCU } from './mcu.js';
import type {
  Token, PType, StructDef, EnumDef, Expr, Stmt, TopDecl, Program, FuncDecl, InitListNode, CField,
} from './ast.js';

/* ===================== Closure compiler: AST -> JS closures / generators (no eval) ===================== */
const PURE_BUILTINS = new Set(['abs', 'fabs', 'min', 'max', 'constrain', 'map', 'sq', 'sqrt', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
  'exp', 'log', 'log10', 'floor', 'ceil', 'pow', 'hypot', 'fmod', 'fmin', 'fmax', 'trunc', 'cbrt', 'round', 'lround', 'radians', 'degrees', 'bit', 'lowByte', 'highByte', 'bitRead']);
const ID = (v: any) => v;
const EMPTY_ARGS: unknown[] = [];

function valueRange(k: Kind): [number, number] | null {
  switch (k) {
    case 'bool': return [0, 1]; case 'u8': return [0, 255]; case 'i8': return [-128, 127];
    case 'i16': return [-32768, 32767]; case 'u16': return [0, 65535]; case 'i32': return [-2147483648, 2147483647];
    case 'u32': return [0, 4294967295]; case 'i64': return [-9e15, 9e15]; case 'f32': return [-3.4e38, 3.4e38];
  }
  return null;
}

/**
 * The compiled-closure shape. Every compiled expression/statement is a "step": either
 * synchronous (`s: true`, `f` is a plain function of the frame) or a generator (`s: false`,
 * `f` is a generator function) - generators are how delay()/pulseIn()/loops can pause the
 * virtual Uno mid-statement and resume next frame. `cv` is the value when it's also a
 * compile-time constant. Real discriminated union on `s`; the payloads inside `f` (frame
 * slots holding arbitrary sketch values - numbers, strings, arrays, structs) stay `any`,
 * since modeling the sketch's own dynamic value space precisely would mean re-deriving the
 * compiler's entire type system a second time at the value level for no safety benefit.
 */
export type Frame = any[];
export type SyncFn = (F: Frame) => any;
export type GenFn = (F: Frame) => Generator<number, any, unknown>;
interface SyncStep { t: PType; s: true; f: SyncFn; cv?: unknown; paren?: boolean; comb?: (o: any, v: any) => any }
interface AsyncStep { t: PType; s: false; f: GenFn; cv?: unknown; paren?: boolean; comb?: (o: any, v: any) => any }
export type Step = SyncStep | AsyncStep;

type Sym =
  | { kind: 'const'; t: PType; val: unknown }
  | { kind: 'global'; t: PType; slot: number; isConst: boolean; cv?: unknown }
  | { kind: 'local'; t: PType; slot: number; isConst: boolean; cv?: unknown }
  | { kind: 'ref'; t: PType; slot: number }
  | { kind: 'serial' };

interface ParamRec { name: string | null; t: PType; isRef: boolean; def: Expr | null; tok: Token }
interface FuncRec {
  name: string; retT: PType; params: ParamRec[]; sig: string;
  node: FuncDecl | null; tok: Token; isGen?: boolean;
  pslots: number[]; nSlots: number; body: Step | null;
  retDefault: unknown; missing?: boolean; minArgs: number; hasReturn?: boolean;
  invokeSync: (av: unknown[]) => unknown;
  invokeGen: (av: unknown[]) => Generator<number, unknown, unknown>;
}

/** compileLv()'s result: an lvalue reached either through a direct get/set pair ("fast" -
 * a plain variable) or through a container/key pair reached via a (possibly generator) path
 * (array element, struct field). */
interface FastLv { t: PType; fast: true; s: true; get: (F: Frame) => any; set: (F: Frame, v: any) => void; pair: (F: Frame) => [any, any] }
interface SlowLvSync { t: PType; fast: false; s: true; loc: (F: Frame) => [any, any] }
interface SlowLvGen { t: PType; fast: false; s: false; loc: (F: Frame) => Generator<number, [any, any], unknown> }
type Lv = FastLv | SlowLvSync | SlowLvGen;

interface Warning { msg: string; file: string; line: number; col: number; kind: string; _k?: string }
export interface CompiledProgram { main: () => Generator<number, void, unknown>; ram: number; warnings: Warning[]; globals: unknown[] }

class ArduinoCompiler {
  ast: Program; M: MCU; mainFile: string;
  G: unknown[] = []; gscope = new Map<string, Sym>(); funcs = new Map<string, FuncRec[]>(); enumScopes = new Map<string, { map: Map<string, number>; t: PType }>();
  warnings: Warning[] = []; initSteps: (Step | null)[] = []; globalRam = 0; strRam = 0; usesSerial = false;
  fn: { rec?: FuncRec; scopes: Map<string, Sym>[]; nSlots: number; ctx: string[] } | null = null;
  structsDone = new Set<StructDef>();
  ramUsed = 0;

  constructor(ast: Program, M: MCU, mainFile: string) {
    this.ast = ast; this.M = M; this.mainFile = mainFile;
  }
  err(msg: string, tok?: Token | null): never { throw new CompileError(msg, tok || { file: this.mainFile, line: 0, col: 0 }); }
  warn(msg: string, tok?: Token | null): void {
    const key = msg + (tok ? tok.file + ':' + tok.line : '');
    if (this.warnings.some(w => w._k === key)) return;
    this.warnings.push({ msg, file: tok ? tok.file : '', line: tok ? tok.line : 0, col: tok ? tok.col : 0, kind: 'warning', _k: key });
  }
  K(t: PType, v: unknown): Step { return { t, s: true, f: () => v, cv: v }; }
  lookup(name: string): Sym | undefined {
    if (this.fn) for (let i = this.fn.scopes.length - 1; i >= 0; i--) { const s = this.fn.scopes[i]!.get(name); if (s) return s; }
    return this.gscope.get(name);
  }
  curScope(): Map<string, Sym> { return this.fn ? this.fn.scopes[this.fn.scopes.length - 1]! : this.gscope; }
  declare(name: string, sym: Sym, tok?: Token | null): void {
    const sc = this.curScope();
    if (sc.has(name) && sc.get(name)!.kind !== 'const') this.err(`redeclaration of '${name}'`, tok);
    if (!this.fn && this.funcs.has(name)) this.err(`'${name}' redeclared as different kind of entity (it is a function)`, tok);
    sc.set(name, sym);
  }

  /* ------------------------------ types ------------------------------ */
  resolveType(pt: PType, tok?: Token | null): PType {
    switch (pt.k) {
      case 'enum': return { k: 'enum', name: pt.name, def: pt.def };
      case 'struct': this.ensureStruct(pt.def); return { k: 'struct', name: pt.name, def: pt.def };
      case 'obj': return { k: 'obj', cls: pt.cls };
      case 'auto': return { k: 'auto' };
      default: if (TY[pt.k]) return TY[pt.k]!;
    }
    this.err('unknown type', tok);
  }
  withDims(t: PType, dims: (Expr | null)[] | undefined, init: Expr | InitListNode | null | undefined, tok: Token): PType {
    if (!dims || !dims.length) return t;
    const vals = dims.map((d, i) => {
      if (d == null) {
        if (i > 0) this.err('declaration of multidimensional array must have bounds for all dimensions except the first', tok);
        return null;
      }
      const v = this.constInt(d, `array bound for '${tok.v || ''}'`);
      if (v <= 0) this.err(`size of array is ${v <= 0 ? 'not positive' : v}`, tok);
      return v;
    });
    if (vals[0] == null) {
      if (!init) this.err(`storage size of '${tok.v}' isn't known`, tok);
      if (init.k === 'InitList') vals[0] = init.items.length;
      else if (init.k === 'Str') vals[0] = init.v.length + 1;
      else this.err('array must be initialized with a brace-enclosed initializer', tok);
    }
    const n = vals.reduce((a: number, b) => a * (b as number), 1);
    if (n > 6000) this.err(`array '${tok.v}' is far too large for the Uno's 2 KB of RAM`, tok);
    return arrT(t, vals);
  }
  ensureStruct(def: StructDef): void {
    if (this.structsDone.has(def)) return;
    this.structsDone.add(def);
    def.cfields = def.fields.map(f => {
      const bt = this.resolveType(f.type, f.tok);
      const t = this.withDims(bt, f.dims, f.init, f.tok);
      let initConst: unknown;
      if (f.init) {
        const saved = this.fn; this.fn = null;
        try { const mi = this.makeInit(t, f.init, f.tok); if (mi && mi.cv !== undefined) initConst = mi.cv; else if (mi && mi.s) initConst = mi.f([]); }
        finally { this.fn = saved; }
      }
      return { name: f.name, t, initConst, tok: f.tok } as CField;
    });
    for (const f of def.cfields) f.ctype = f.t;
    const seen = new Set<string>();
    for (const f of def.cfields) { if (seen.has(f.name)) this.err(`redeclaration of '${f.name}' in struct '${def.name}'`, f.tok); seen.add(f.name); }
  }
  zeroOf(t: PType): any {
    switch (t.k) {
      case 'array': { const n = t.dims[0] as number, st = subT(t); const a = new Array(n); for (let i = 0; i < n; i++) a[i] = this.zeroOf(st); return a; }
      case 'struct': { const o: Record<string, unknown> = {}; for (const f of t.def.cfields!) o[f.name] = f.initConst !== undefined ? cloneVal(f.initConst) : this.zeroOf(f.t); return o; }
      case 'str': return '';
      case 'obj': return null;
      default: return 0;
    }
  }
  convFn(from: PType, to: PType, tok?: Token | null, explicit?: boolean): (v: any) => any {
    const fk = kindOf(from), tk = kindOf(to);
    if (to.k === 'auto' || to.k === 'void') return ID;
    if (to.k === 'array' || from.k === 'array') {
      if (to.k === 'array' && from.k === 'array') return ID;
      if (to.k === 'str' && from.k === 'array' && (from.elem.k === 'i8' || from.elem.k === 'u8')) return (a: number[]) => String.fromCharCode(...a.filter(c => c)).split('\0')[0];
      this.err(`cannot convert '${typeName(from)}' to '${typeName(to)}'`, tok);
    }
    if (to.k === 'struct') {
      if (from.k !== 'struct' || from.def !== to.def) this.err(`conversion from '${typeName(from)}' to non-scalar type '${typeName(to)}' requested`, tok);
      return cloneVal;
    }
    if (from.k === 'struct') this.err(`cannot convert '${typeName(from)}' to '${typeName(to)}'`, tok);
    if (to.k === 'obj') { if (from.k !== 'obj' || from.cls !== to.cls) this.err(`cannot convert '${typeName(from)}' to '${typeName(to)}'`, tok); return ID; }
    if (from.k === 'obj') this.err(`cannot convert '${typeName(from)}' to '${typeName(to)}'`, tok);
    if (from.k === 'serialObj') return () => 1;
    if (tk === 'str') return fk === 'str' ? ID : toStrFn(from);
    if (fk === 'str') this.err(`cannot convert 'String' to '${typeName(to)}'${(from as { charPtr?: boolean }).charPtr ? '' : ' (use .toInt() or .toFloat())'}`, tok);
    if (!isNumK(fk)) this.err(`cannot convert '${typeName(from)}' to '${typeName(to)}'`, tok);
    if (to.k === 'enum' && from.k !== 'enum' && !explicit) this.warn(`invalid conversion from '${typeName(from)}' to '${typeName(to)}' [-fpermissive]`, tok);
    if (fk === tk) return ID;
    if (tk === 'bool') return WRAP.bool!;
    if (tk === 'f32') { if (fk === 'i32' || fk === 'u32' || fk === 'i64') return WRAP.f32!; return ID; }
    const rf = valueRange(fk), rt = valueRange(tk);
    if (fk !== 'f32' && rf && rt && rf[0] >= rt[0] && rf[1] <= rt[1]) return ID;
    return WRAP[tk]!;
  }
  constInt(expr: Expr, what: string): number {
    const E = this.compileExpr(expr);
    if (E.cv === undefined || typeof E.cv !== 'number') this.err(`${what} is not an integer constant`, expr.tok);
    if (!INT_K.has(kindOf(E.t) as any)) this.err(`${what} must be an integer, not '${typeName(E.t)}'`, expr.tok);
    return E.cv;
  }

  /* ------------------------------ expressions ------------------------------ */
  compileExpr(n: Expr): Step {
    switch (n.k) {
      case 'Num': return this.compileNum(n);
      case 'Chr': return this.K(TY.i8!, WRAP.i8!(n.val));
      case 'Bool': return this.K(TY.bool!, n.val);
      case 'Str': this.strRam += n.v.length + 1; return this.K({ k: 'str', lit: true }, n.v);
      case 'Paren': { const e = this.compileExpr(n.e); return Object.assign({}, e, { paren: true }); }
      case 'Ident': return this.compileIdent(n);
      case 'Qual': return this.compileQual(n);
      case 'Binary': {
        const A = this.compileExpr(n.a), B = this.compileExpr(n.b);
        if ((n.op === '/' || n.op === '%') && B.cv === 0 && INT_K.has(kindOf(B.t) as any)) this.warn('division by zero [-Wdiv-by-zero]', n.tok);
        const { rt, fn } = this.binOp(n.op, A.t, B.t, n.tok);
        return this.combine2(rt, A, B, fn, n.tok, n.op);
      }
      case 'Logical': return this.compileLogical(n);
      case 'Unary': return this.compileUnary(n);
      case 'Update': return this.compileUpdate(n);
      case 'Assign': return this.compileAssign(n);
      case 'Cond': return this.compileCondExpr(n);
      case 'Comma': {
        const list = n.list.map(x => this.compileExpr(x));
        const last = list[list.length - 1]!;
        if (list.every(x => x.s)) return { t: last.t, s: true, f: F => { let v; for (let i = 0; i < list.length; i++) v = (list[i] as SyncStep).f(F); return v; } };
        return { t: last.t, s: false, f: function* (F) { let v; for (const x of list) v = x.s ? x.f(F) : yield* x.f(F); return v; } };
      }
      case 'Call': return this.compileCall(n);
      case 'Index': return this.compileIndex(n);
      case 'Member': return this.compileMember(n);
      case 'Cast': return this.compileCast(this.resolveType(n.type, n.tok), n.a, n.tok);
      case 'Sizeof': {
        let size;
        if (n.type) size = sizeOfT(this.resolveType(n.type, n.tok));
        else if (n.expr!.k === 'Str') size = n.expr!.v.length + 1;
        else { const saved = this.strRam; const E = this.compileExpr(n.expr!); this.strRam = saved; size = sizeOfT(E.t); }
        return this.K(TY.u16!, size);
      }
      case 'InitList': this.err('braced initializer lists can only be used in declarations here', n.tok);
    }
  }
  compileNum(n: import('./ast.js').NumNode): Step {
    const tk = n.tok;
    if (tk.isFloat) return this.K(TY.f32!, fr(tk.val!));
    const v = tk.val!, suf = tk.suffix || '';
    const u = suf.includes('u'), l = suf.includes('l'), ll = suf.includes('ll');
    let k: Kind;
    if (ll) k = 'i64';
    else if (u && l) k = 'u32';
    else if (l) k = v <= 2147483647 ? 'i32' : 'u32';
    else if (u) k = v <= 65535 ? 'u16' : 'u32';
    else if (v <= 32767) k = 'i16';
    else if (tk.hex && v <= 65535) k = 'u16';
    else if (v <= 2147483647) k = 'i32';
    else if (tk.hex && v <= 4294967295) k = 'u32';
    else k = 'i64';
    return this.K(TY[k]!, v);
  }
  compileIdent(n: import('./ast.js').IdentNode): Step {
    const sym = this.lookup(n.name);
    if (!sym) {
      if (this.funcs.has(n.name) || BUILTINS[n.name]) this.err(`'${n.name}' is a function; did you forget the parentheses '()'?`, n.tok);
      this.err(`'${n.name}' was not declared in this scope`, n.tok);
    }
    const G = this.G;
    switch (sym.kind) {
      case 'const': return this.K(sym.t, sym.val);
      case 'global': { if (sym.cv !== undefined) return this.K(sym.t, sym.cv); const s = sym.slot; return { t: sym.t, s: true, f: () => G[s] }; }
      case 'local': { if (sym.cv !== undefined) return this.K(sym.t, sym.cv); const s = sym.slot; return { t: sym.t, s: true, f: (F: Frame) => F[s] }; }
      case 'ref': { const s = sym.slot; return { t: sym.t, s: true, f: (F: Frame) => { const p = F[s]; return p[0][p[1]]; } }; }
      case 'serial': this.usesSerial = true; return { t: { k: 'serialObj' }, s: true, f: () => 1 };
    }
  }
  compileQual(n: import('./ast.js').QualNode): Step {
    const items = this.enumScopes.get(n.scope);
    if (items) {
      if (!items.map.has(n.name)) this.err(`'${n.name}' is not a member of '${n.scope}'`, n.tok);
      return this.K(items.t, items.map.get(n.name));
    }
    if (n.scope === 'NewPing') this.err(`'NewPing::${n.name}' must be called like a function`, n.tok);
    this.err(`'${n.scope}' has not been declared`, n.tok);
  }
  combine1(rt: PType, A: Step, fn: (a: any) => any): Step {
    if (A.cv !== undefined) return this.K(rt, fn(A.cv));
    const fa = A.f;
    if (A.s) return { t: rt, s: true, f: (F: Frame) => fn(fa(F)) };
    return { t: rt, s: false, f: function* (F) { return fn(yield* fa(F)); } };
  }
  combine2(rt: PType, A: Step, B: Step, fn: (a: any, b: any) => any, tok: Token, op: string): Step {
    if (A.cv !== undefined && B.cv !== undefined && !((op === '/' || op === '%') && B.cv === 0)) {
      const v = fn(A.cv, B.cv);
      if ((rt.k === 'i16' || rt.k === 'i32') && (op === '+' || op === '-' || op === '*' || op === '<<')) {
        const ex = op === '+' ? (A.cv as number) + (B.cv as number) : op === '-' ? (A.cv as number) - (B.cv as number) : op === '*' ? (A.cv as number) * (B.cv as number) : (A.cv as number) * Math.pow(2, B.cv as number);
        if (ex !== v) this.warn(`integer overflow in expression of type '${typeName(rt)}' results in '${v}' [-Woverflow]  (the Uno's int is 16-bit; use ${rt.k === 'i16' ? '30000L or long' : 'unsigned long'})`, tok);
      }
      return this.K(rt, v);
    }
    const fa = A.f, fb = B.f;
    if (A.s && B.s) return { t: rt, s: true, f: (F: Frame) => fn((fa as SyncFn)(F), (fb as SyncFn)(F)) };
    const as = A.s, bs = B.s;
    return { t: rt, s: false, f: function* (F) { const a = as ? (fa as SyncFn)(F) : yield* (fa as GenFn)(F); const b = bs ? (fb as SyncFn)(F) : yield* (fb as GenFn)(F); return fn(a, b); } };
  }
  binOp(op: string, ta: PType, tb: PType, tok: Token): { rt: PType; fn: (a: any, b: any) => any } {
    const ka0 = kindOf(ta), kb0 = kindOf(tb);
    const scalar = (k: Kind) => isNumK(k) || k === 'str';
    if (!scalar(ka0) || !scalar(kb0)) this.err(`invalid operands of types '${typeName(ta)}' and '${typeName(tb)}' to binary 'operator${op}'`, tok);
    const ka = promoteK(ka0), kb = promoteK(kb0);
    if (ka === 'str' || kb === 'str') {
      if (op === '+') {
        if ((ta as { lit?: boolean }).lit && (tb as { lit?: boolean }).lit) this.err(`invalid operands of types 'const char*' to binary 'operator+' (wrap one side in String(...))`, tok);
        const f1 = toStrFn(ta), f2 = toStrFn(tb); return { rt: TY.str!, fn: (a: any, b: any) => f1(a) + f2(b) };
      }
      if (ka === 'str' && kb === 'str') {
        const cmp = ({ '==': (a: string, b: string) => (a === b ? 1 : 0), '!=': (a: string, b: string) => (a !== b ? 1 : 0), '<': (a: string, b: string) => (a < b ? 1 : 0), '>': (a: string, b: string) => (a > b ? 1 : 0), '<=': (a: string, b: string) => (a <= b ? 1 : 0), '>=': (a: string, b: string) => (a >= b ? 1 : 0) } as Record<string, (a: string, b: string) => number>)[op];
        if (cmp) return { rt: TY.bool!, fn: cmp };
      }
      this.err(`invalid operands of types '${typeName(ta)}' and '${typeName(tb)}' to binary 'operator${op}'`, tok);
    }
    const ct = commonK(ka, kb);
    const M = this.M;
    const T = TY[ct]!;
    switch (op) {
      case '+': case '-': case '*': {
        if (ct === 'f32') return { rt: T, fn: op === '+' ? (a: number, b: number) => fr(a + b) : op === '-' ? (a: number, b: number) => fr(a - b) : (a: number, b: number) => fr(a * b) };
        if (ct === 'i64') return { rt: T, fn: op === '+' ? (a: number, b: number) => a + b : op === '-' ? (a: number, b: number) => a - b : (a: number, b: number) => a * b };
        if (ct === 'i32') return { rt: T, fn: op === '+' ? (a: number, b: number) => (a + b) | 0 : op === '-' ? (a: number, b: number) => (a - b) | 0 : (a: number, b: number) => Math.imul(a, b) };
        if (ct === 'u32') return { rt: T, fn: op === '+' ? (a: number, b: number) => (a + b) >>> 0 : op === '-' ? (a: number, b: number) => (a - b) >>> 0 : (a: number, b: number) => Math.imul(a, b) >>> 0 };
        const w = WRAP[ct]!;
        return { rt: T, fn: op === '+' ? (a: number, b: number) => w(a + b) : op === '-' ? (a: number, b: number) => w(a - b) : (a: number, b: number) => w(a * b) };
      }
      case '/': {
        if (ct === 'f32') return { rt: T, fn: (a: number, b: number) => fr(a / b) };
        const w = WRAP[ct]!;
        return { rt: T, fn: (a: number, b: number) => { a = w(a); b = w(b); if (b === 0) { M.divZero(tok); return w(-1); } return w(Math.trunc(a / b)); } };
      }
      case '%': {
        if (ct === 'f32') this.err(`invalid operands of types '${typeName(ta)}' and '${typeName(tb)}' to binary 'operator%' (use fmod() for floats)`, tok);
        const w = WRAP[ct]!;
        return { rt: T, fn: (a: number, b: number) => { a = w(a); b = w(b); if (b === 0) { M.divZero(tok); return 0; } return w(a % b); } };
      }
      case '<<': case '>>': {
        if (ka === 'f32' || kb === 'f32') this.err(`invalid operands of types '${typeName(ta)}' and '${typeName(tb)}' to binary 'operator${op}'`, tok);
        const rk = ka, R = TY[rk]!;
        if (op === '<<') {
          if (rk === 'u32') return { rt: R, fn: (a: number, b: number) => (b >= 32 ? 0 : (a << b) >>> 0) };
          if (rk === 'i32') return { rt: R, fn: (a: number, b: number) => (b >= 32 ? 0 : a << b) };
          if (rk === 'i64') return { rt: R, fn: (a: number, b: number) => a * Math.pow(2, b) };
          const w = WRAP[rk]!; return { rt: R, fn: (a: number, b: number) => (b >= 32 ? 0 : w(a << b)) };
        }
        if (rk === 'u32') return { rt: R, fn: (a: number, b: number) => (b >= 32 ? 0 : a >>> b) };
        if (rk === 'i64') return { rt: R, fn: (a: number, b: number) => Math.floor(a / Math.pow(2, b)) };
        return { rt: R, fn: (a: number, b: number) => (b >= 32 ? (a < 0 ? -1 : 0) : a >> b) };
      }
      case '&': case '|': case '^': {
        if (ct === 'f32') this.err(`invalid operands of types '${typeName(ta)}' and '${typeName(tb)}' to binary 'operator${op}'`, tok);
        const w = WRAP[ct === 'i64' ? 'i32' : ct]!;
        return { rt: T, fn: op === '&' ? (a: number, b: number) => w(a & b) : op === '|' ? (a: number, b: number) => w(a | b) : (a: number, b: number) => w(a ^ b) };
      }
      case '==': case '!=': case '<': case '>': case '<=': case '>=': {
        const w = ct === 'f32' ? ID : WRAP[ct]!;
        const need = ct !== 'f32' && (promoteK(ka0) !== ct || promoteK(kb0) !== ct);
        const W2 = need ? w : ID;
        switch (op) {
          case '==': return { rt: TY.bool!, fn: (a: number, b: number) => (W2(a) === W2(b) ? 1 : 0) };
          case '!=': return { rt: TY.bool!, fn: (a: number, b: number) => (W2(a) !== W2(b) ? 1 : 0) };
          case '<': return { rt: TY.bool!, fn: (a: number, b: number) => (W2(a) < W2(b) ? 1 : 0) };
          case '>': return { rt: TY.bool!, fn: (a: number, b: number) => (W2(a) > W2(b) ? 1 : 0) };
          case '<=': return { rt: TY.bool!, fn: (a: number, b: number) => (W2(a) <= W2(b) ? 1 : 0) };
          case '>=': return { rt: TY.bool!, fn: (a: number, b: number) => (W2(a) >= W2(b) ? 1 : 0) };
        }
      }
    }
    this.err(`unsupported operator '${op}'`, tok);
  }
  compileLogical(n: import('./ast.js').LogicalNode): Step {
    const A = this.compileExpr(n.a), B = this.compileExpr(n.b);
    for (const X of [A, B]) if (!(isNumK(kindOf(X.t)) || kindOf(X.t) === 'str' || X.t.k === 'serialObj')) this.err(`could not convert '${typeName(X.t)}' to 'bool'`, n.tok);
    const and = n.op === '&&';
    if (A.cv !== undefined && B.cv !== undefined) return this.K(TY.bool!, and ? (A.cv && B.cv ? 1 : 0) : (A.cv || B.cv ? 1 : 0));
    const fa = A.f, fb = B.f, as = A.s, bs = B.s;
    if (as && bs) return { t: TY.bool!, s: true, f: (F: Frame) => (and ? ((fa as SyncFn)(F) && (fb as SyncFn)(F) ? 1 : 0) : ((fa as SyncFn)(F) || (fb as SyncFn)(F) ? 1 : 0)) };
    return {
      t: TY.bool!, s: false, f: function* (F) {
        const a = as ? (fa as SyncFn)(F) : yield* (fa as GenFn)(F);
        if (and ? !a : a) return and ? 0 : 1;
        const b = bs ? (fb as SyncFn)(F) : yield* (fb as GenFn)(F);
        return b ? 1 : 0;
      }
    };
  }
  compileUnary(n: import('./ast.js').UnaryNode): Step {
    const A = this.compileExpr(n.a); const k0 = kindOf(A.t);
    if (n.op === '!') {
      if (!(isNumK(k0) || k0 === 'str' || A.t.k === 'serialObj')) this.err(`no match for 'operator!' (operand type is '${typeName(A.t)}')`, n.tok);
      return this.combine1(TY.bool!, A, v => (v ? 0 : 1));
    }
    if (!isNumK(k0)) this.err(`wrong type argument to unary ${n.op === '-' ? 'minus' : n.op === '+' ? 'plus' : 'complement'} ('${typeName(A.t)}')`, n.tok);
    const pk = promoteK(k0);
    if (n.op === '+') return this.combine1(TY[pk]!, A, ID);
    if (n.op === '-') { if (pk === 'f32') return this.combine1(TY.f32!, A, v => -v); const w = WRAP[pk]!; return this.combine1(TY[pk]!, A, v => w(-v)); }
    if (n.op === '~') { if (pk === 'f32') this.err("wrong type argument to bit-complement ('float')", n.tok); const w = WRAP[pk === 'i64' ? 'i32' : pk]!; return this.combine1(TY[pk]!, A, v => w(~v)); }
    this.err('unsupported unary operator', n.tok);
  }
  compileLv(n: Expr, tok: Token | undefined, what: string): Lv {
    const G = this.G, M = this.M;
    if (n.k === 'Paren') return this.compileLv(n.e, tok, what);
    if (n.k === 'Ident') {
      const sym = this.lookup(n.name);
      if (!sym) this.err(`'${n.name}' was not declared in this scope`, n.tok);
      if (sym.kind === 'const' || sym.kind === 'serial') this.err(`lvalue required as ${what}`, n.tok);
      if ((sym as { isConst?: boolean }).isConst) this.err(`assignment of read-only variable '${n.name}'`, n.tok);
      const s = sym.slot;
      if (sym.kind === 'global') return { t: sym.t, fast: true, s: true, get: (_F: Frame) => G[s], set: (_F: Frame, v: any) => { G[s] = v; }, pair: (_F: Frame) => [G, s] };
      if (sym.kind === 'local') return { t: sym.t, fast: true, s: true, get: (F: Frame) => F[s], set: (F: Frame, v: any) => { F[s] = v; }, pair: (F: Frame) => [F, s] };
      if (sym.kind === 'ref') return { t: sym.t, fast: true, s: true, get: (F: Frame) => { const p = F[s]; return p[0][p[1]]; }, set: (F: Frame, v: any) => { const p = F[s]; p[0][p[1]] = v; }, pair: (F: Frame) => F[s] };
    }
    if (n.k === 'Index') {
      const B = this.compileExpr(n.obj), I = this.compileExpr(n.index);
      if (B.t.k === 'str') this.err('changing single characters of a String is not supported by the simulator; build a new String instead', n.tok);
      if (B.t.k !== 'array') this.err(`invalid types '${typeName(B.t)}[${typeName(I.t)}]' for array subscript`, n.tok);
      if (!INT_K.has(kindOf(I.t) as any)) this.err(`invalid types '${typeName(B.t)}[${typeName(I.t)}]' for array subscript`, n.tok);
      const t = subT(B.t), fb = B.f, fi = I.f, itok = n.tok;
      const scratch: [any] = [0];
      const pick = (a: any[], i: number): [any, any] => { if (i >= 0 && i < a.length) return [a, i]; M.oob(itok, i, a.length); scratch[0] = 0; return [scratch, 0]; };
      if (B.s && I.s) return { t, fast: false, s: true, loc: (F: Frame) => pick((fb as SyncFn)(F), (fi as SyncFn)(F)) };
      const bs = B.s, is = I.s;
      return { t, fast: false, s: false, loc: function* (F) { const a = bs ? (fb as SyncFn)(F) : yield* (fb as GenFn)(F); const i = is ? (fi as SyncFn)(F) : yield* (fi as GenFn)(F); return pick(a, i); } };
    }
    if (n.k === 'Member') {
      const B = this.compileExpr(n.obj);
      const fld = this.fieldOf(B.t, n.name, n.tok);
      const fb = B.f, nm = n.name;
      if (B.s) return { t: fld.t, fast: false, s: true, loc: (F: Frame) => [(fb as SyncFn)(F), nm] };
      return { t: fld.t, fast: false, s: false, loc: function* (F) { return [yield* (fb as GenFn)(F), nm]; } };
    }
    this.err(`lvalue required as ${what}`, tok || n.tok);
  }
  fieldOf(t: PType, name: string, tok: Token): CField {
    if (t.k !== 'struct') this.err(`request for member '${name}' in something of non-class type '${typeName(t)}'`, tok);
    const f = t.def.cfields!.find(x => x.name === name);
    if (!f) this.err(`'struct ${t.name}' has no member named '${name}'`, tok);
    return f;
  }
  compileUpdate(n: import('./ast.js').UpdateNode): Step {
    const L = this.compileLv(n.a, n.tok, n.op === '++' ? 'increment operand' : 'decrement operand');
    const k = kindOf(L.t);
    if (!isNumK(k)) this.err(`no match for 'operator${n.op}' (operand type is '${typeName(L.t)}')`, n.tok);
    const d = n.op === '++' ? 1 : -1, pre = n.prefix;
    const w = k === 'bool' ? (v: number) => (d > 0 ? 1 : (v ? 1 : 0)) : WRAP[k]!;
    if (L.fast) {
      const get = L.get, set = L.set;
      return { t: L.t, s: true, f: (F: Frame) => { const o = get(F); const nv = w(o + d); set(F, nv); return pre ? nv : o; } };
    }
    const loc = L.loc;
    const apply = (p: [any, any]) => { const o = p[0][p[1]]; const nv = w(o + d); p[0][p[1]] = nv; return pre ? nv : o; };
    if (L.s) return { t: L.t, s: true, f: (F: Frame) => apply((loc as (F: Frame) => [any, any])(F)) };
    return { t: L.t, s: false, f: function* (F) { return apply(yield* (loc as (F: Frame) => Generator<number, [any, any], unknown>)(F)); } };
  }
  compileAssign(n: import('./ast.js').AssignNode): Step {
    const L = this.compileLv(n.target, n.tok, 'left operand of assignment');
    if (L.t.k === 'array') this.err('invalid array assignment', n.tok);
    let V: Step;
    if (n.value.k === 'InitList') {
      if (L.t.k !== 'struct') this.err('braced initializer lists can only be assigned to structs here', n.tok);
      V = this.makeInit(L.t, n.value, n.tok) as Step; V.t = L.t;
    } else V = this.compileExpr(n.value);
    let comb: ((v: any) => any) | null;
    if (n.op === '=') comb = this.convFn(V.t, L.t, n.tok);
    else {
      const { rt, fn } = this.binOp(n.op.slice(0, -1), L.t, V.t, n.tok);
      const c2 = this.convFn(rt, L.t, n.tok);
      comb = null; V.comb = (o: any, v: any) => c2(fn(o, v));
    }
    const vf = V.f, vs = V.s, isEq = n.op === '=';
    const cmb = V.comb!;
    if (L.fast) {
      const get = L.get, set = L.set;
      if (isEq) {
        if (vs) return { t: L.t, s: true, f: (F: Frame) => { const v = comb!((vf as SyncFn)(F)); set(F, v); return v; } };
        return { t: L.t, s: false, f: function* (F) { const v = comb!(yield* (vf as GenFn)(F)); set(F, v); return v; } };
      }
      if (vs) return { t: L.t, s: true, f: (F: Frame) => { const v = cmb(get(F), (vf as SyncFn)(F)); set(F, v); return v; } };
      return { t: L.t, s: false, f: function* (F) { const r = yield* (vf as GenFn)(F); const v = cmb(get(F), r); set(F, v); return v; } };
    }
    const loc = L.loc, ls = L.s;
    if (ls && vs) {
      if (isEq) return { t: L.t, s: true, f: (F: Frame) => { const p = (loc as (F: Frame) => [any, any])(F); const v = comb!((vf as SyncFn)(F)); p[0][p[1]] = v; return v; } };
      return { t: L.t, s: true, f: (F: Frame) => { const p = (loc as (F: Frame) => [any, any])(F); const v = cmb(p[0][p[1]], (vf as SyncFn)(F)); p[0][p[1]] = v; return v; } };
    }
    return {
      t: L.t, s: false, f: function* (F) {
        const p: [any, any] = ls ? (loc as (F: Frame) => [any, any])(F) : yield* (loc as (F: Frame) => Generator<number, [any, any], unknown>)(F);
        const r = vs ? (vf as SyncFn)(F) : yield* (vf as GenFn)(F);
        const v = isEq ? comb!(r) : cmb(p[0][p[1]], r);
        p[0][p[1]] = v; return v;
      }
    };
  }
  compileCondExpr(n: import('./ast.js').CondNode): Step {
    const T = this.compileExpr(n.test), A = this.compileExpr(n.a), B = this.compileExpr(n.b);
    const ka = kindOf(A.t), kb = kindOf(B.t);
    let rt: PType;
    if (ka === kb && (ka !== 'struct' || (A.t as { def?: unknown }).def === (B.t as { def?: unknown }).def)) rt = A.t;
    else if (isNumK(ka) && isNumK(kb)) rt = TY[commonK(promoteK(ka), promoteK(kb))]!;
    else if (ka === 'str' || kb === 'str') rt = TY.str!;
    else this.err(`operands to '?:' have different types '${typeName(A.t)}' and '${typeName(B.t)}'`, n.tok);
    const ca = this.convFn(A.t, rt, n.tok), cb = this.convFn(B.t, rt, n.tok);
    if (T.cv !== undefined) { const X = T.cv ? A : B, c = T.cv ? ca : cb; return this.combine1(rt, X, c); }
    const ft = T.f, fa = A.f, fb = B.f;
    if (T.s && A.s && B.s) return { t: rt, s: true, f: (F: Frame) => ((ft as SyncFn)(F) ? ca((fa as SyncFn)(F)) : cb((fb as SyncFn)(F))) };
    const ts = T.s, as = A.s, bs = B.s;
    return { t: rt, s: false, f: function* (F) { const c = ts ? (ft as SyncFn)(F) : yield* (ft as GenFn)(F); if (c) return ca(as ? (fa as SyncFn)(F) : yield* (fa as GenFn)(F)); return cb(bs ? (fb as SyncFn)(F) : yield* (fb as GenFn)(F)); } };
  }
  compileIndex(n: import('./ast.js').IndexNode): Step {
    const B = this.compileExpr(n.obj), I = this.compileExpr(n.index), M = this.M;
    if (!INT_K.has(kindOf(I.t) as any)) this.err(`invalid types '${typeName(B.t)}[${typeName(I.t)}]' for array subscript`, n.tok);
    const fb = B.f, fi = I.f, tok = n.tok;
    if (kindOf(B.t) === 'str') {
      const get = (s: string, i: number) => (i >= 0 && i < s.length ? WRAP.i8!(s.charCodeAt(i)) : 0);
      return this.combine2(TY.i8!, B, I, get, tok, n.k);
    }
    if (B.t.k !== 'array') this.err(`invalid types '${typeName(B.t)}[${typeName(I.t)}]' for array subscript`, tok);
    const rt = subT(B.t);
    const get = (a: any[], i: number) => { if (i >= 0 && i < a.length) return a[i]; M.oob(tok, i, a.length); return this.zeroOf(rt); };
    if (B.s && I.s) return { t: rt, s: true, f: (F: Frame) => get((fb as SyncFn)(F), (fi as SyncFn)(F)) };
    const bs = B.s, is = I.s;
    return { t: rt, s: false, f: function* (F) { const a = bs ? (fb as SyncFn)(F) : yield* (fb as GenFn)(F); const i = is ? (fi as SyncFn)(F) : yield* (fi as GenFn)(F); return get(a, i); } };
  }
  compileMember(n: import('./ast.js').MemberNode): Step {
    const B = this.compileExpr(n.obj);
    if (B.t.k === 'serialObj' || B.t.k === 'str' || B.t.k === 'obj') this.err(`'${n.name}' is a method; call it with parentheses: .${n.name}()`, n.tok);
    const fld = this.fieldOf(B.t, n.name, n.tok);
    const nm = n.name;
    return this.combine1(fld.t, B, (o: any) => o[nm]);
  }
  compileCast(T: PType, argNode: Expr, tok: Token): Step {
    const A = this.compileExpr(argNode);
    if (T.k === 'void') return this.combine1(TY.void!, A, () => undefined);
    const conv = this.convFn(A.t, T, tok, true);
    return this.combine1(T, A, conv);
  }

  /* ------------------------------ calls ------------------------------ */
  compileCall(n: import('./ast.js').CallNode): Step {
    const c = n.callee, M = this.M;
    if (c.k === 'Ident') {
      const name = c.name;
      if (this.funcs.has(name) && !(this.fn && this.fn.scopes.some(s => s.has(name)))) return this.compileUserCall(name, n);
      if (CAST_NAMES[name] && !this.lookup(name)) {
        if (n.args.length !== 1) this.err(`functional cast ${name}(...) takes exactly one argument`, n.tok);
        return this.compileCast(TY[CAST_NAMES[name]]!, n.args[0]!, n.tok);
      }
      if (this.enumScopes.has(name) && n.args.length === 1) return this.compileCast(this.enumScopes.get(name)!.t, n.args[0]!, n.tok);
      if (name === 'String') return this.compileStringCtor(n);
      if (name === 'F') {
        if (n.args.length !== 1 || n.args[0]!.k !== 'Str') this.err('F() expects a string literal, like F("text")', n.tok);
        return this.K(TY.str!, (n.args[0] as import('./ast.js').StrNode).v);
      }
      if (name === 'NewPing') return this.compileNewPing(n.args, n.tok);
      if (name === 'bitSet' || name === 'bitClear' || name === 'bitWrite') return this.compileBitOp(name, n);
      const b = BUILTINS[name];
      if (b) return this.compileBuiltin(b, name, n.args, n.tok, null, false);
      if (name === 'printf' || name === 'sprintf' || name === 'snprintf') this.err(`'${name}' is not available on the Uno in this simulator; use Serial.print()`, n.tok);
      if (this.lookup(name)) this.err(`'${name}' cannot be used as a function`, n.tok);
      this.err(`'${name}' was not declared in this scope`, n.tok);
    }
    if (c.k === 'Member') {
      const O = this.compileExpr(c.obj);
      const name = c.name;
      if (O.t.k === 'serialObj') {
        this.usesSerial = true;
        const spec = SERIAL_METHODS[name];
        if (!spec) this.err(`'class HardwareSerial' has no member named '${name}'`, c.tok);
        return this.compileBuiltin(spec, 'Serial.' + name, n.args, n.tok, null, true);
      }
      if (kindOf(O.t) === 'str') {
        const spec = STRING_METHODS[name];
        if (!spec) this.err(`'class String' has no member named '${name}'`, c.tok);
        if (spec.mut) {
          const L = this.compileLv(c.obj, c.tok, `object of String.${name}()`);
          if (!L.fast) this.err(`String.${name}() on array elements or struct members is not supported by the simulator`, c.tok);
          const A = n.args.map(a => this.compileExpr(a));
          if (A.length < spec.n[0] || A.length > spec.n[1]) this.err(`wrong number of arguments to String.${name}()`, n.tok);
          const impl = spec.make(M, ['str', ...A.map(a => kindOf(a.t))]);
          const get = L.get, set = L.set, rt = TY[spec.ret as string]!;
          if (A.every(a => a.s)) return { t: rt, s: true, f: (F: Frame) => { const r = impl(get(F), ...A.map(a => (a as SyncStep).f(F))); set(F, r); return 1; } };
          return { t: rt, s: false, f: function* (F) { const v = []; for (const a of A) v.push(a.s ? (a.f as SyncFn)(F) : yield* (a.f as GenFn)(F)); set(F, impl(get(F), ...v)); return 1; } };
        }
        return this.compileBuiltin(spec, 'String.' + name, n.args, n.tok, O, true);
      }
      if (O.t.k === 'obj' && O.t.cls === 'NewPing') {
        const spec = NEWPING_METHODS[name];
        if (!spec) this.err(`'class NewPing' has no member named '${name}' (supported: ping, ping_cm, ping_in, ping_median, convert_cm)`, c.tok);
        return this.compileBuiltin(spec, 'NewPing.' + name, n.args, n.tok, O, true);
      }
      if (O.t.k === 'struct') this.err('member functions are not supported by the simulator; use a normal function that takes the struct', c.tok);
      this.err(`request for member '${name}', which is of non-class type '${typeName(O.t)}'`, c.tok);
    }
    if (c.k === 'Qual') {
      if (c.scope === 'NewPing' && (c.name === 'convert_cm' || c.name === 'convert_in')) {
        return this.compileBuiltin(NEWPING_METHODS[c.name]!, 'NewPing::' + c.name, n.args, n.tok, this.K({ k: 'obj', cls: 'NewPing' }, null), true);
      }
      this.err(`'${c.scope}::${c.name}' is not supported`, c.tok);
    }
    this.err('expression cannot be used as a function', n.tok);
  }
  compileBuiltin(spec: BuiltinSpec, name: string, argNodes: Expr[], tok: Token, objE: Step | null, allowStr: boolean): Step {
    const nargs = argNodes.length;
    if (nargs < spec.n[0]) this.err(`too few arguments to function '${name}'`, tok);
    if (nargs > spec.n[1]) this.err(`too many arguments to function '${name}'`, tok);
    const A = argNodes.map(a => this.compileExpr(a));
    A.forEach((a, i) => {
      const k = kindOf(a.t);
      const ok = isNumK(k) || (allowStr && k === 'str');
      if (!ok) this.err(`cannot convert '${typeName(a.t)}' to '${allowStr ? 'a printable value' : 'int'}' for argument ${i + 1} of '${name}'`, argNodes[i]!.tok);
    });
    const kinds = A.map(a => kindOf(a.t));
    // compile-time hints
    if ((name === 'analogWrite') && A[0]!.cv !== undefined && !PWM_PINS.has(A[0]!.cv as number)) this.warn(`analogWrite() on pin ${A[0]!.cv}: not a PWM pin on the Uno (PWM pins are 3, 5, 6, 9, 10, 11), it will only switch fully on/off`, tok);
    if ((name === 'delay') && A[0]!.cv !== undefined && (A[0]!.cv as number) < 0) this.warn('negative delay() wraps around to about 49 days on a real Uno', tok);
    const impl = spec.make(this.M, objE ? ['obj', ...kinds] : kinds);
    const rk = typeof spec.ret === 'function' ? spec.ret(kinds) : spec.ret;
    const rt = TY[rk] || TY.i16!;
    const all = objE ? [objE, ...A] : A;
    if (!spec.gen && PURE_BUILTINS.has(name) && all.every(a => a.cv !== undefined)) return this.K(rt, impl(...all.map(a => a.cv)));
    if (!spec.gen && all.every(a => a.s)) {
      const f = all.map(a => a.f as SyncFn);
      switch (f.length) {
        case 0: return { t: rt, s: true, f: () => impl() };
        case 1: { const f0 = f[0]!; return { t: rt, s: true, f: (F: Frame) => impl(f0(F)) }; }
        case 2: { const f0 = f[0]!, f1 = f[1]!; return { t: rt, s: true, f: (F: Frame) => impl(f0(F), f1(F)) }; }
        case 3: { const f0 = f[0]!, f1 = f[1]!, f2 = f[2]!; return { t: rt, s: true, f: (F: Frame) => impl(f0(F), f1(F), f2(F)) }; }
        default: return { t: rt, s: true, f: (F: Frame) => impl(...f.map(x => x(F))) };
      }
    }
    const isGen = !!spec.gen;
    return {
      t: rt, s: false, f: function* (F) {
        const v = new Array(all.length);
        for (let i = 0; i < all.length; i++) { const a = all[i]!; v[i] = a.s ? (a.f as SyncFn)(F) : yield* (a.f as GenFn)(F); }
        if (isGen) return yield* impl(...v);
        return impl(...v);
      }
    };
  }
  compileStringCtor(n: import('./ast.js').CallNode): Step {
    if (n.args.length === 0) return this.K(TY.str!, '');
    if (n.args.length > 2) this.err('too many arguments to String()', n.tok);
    const A = this.compileExpr(n.args[0]!);
    const k = kindOf(A.t);
    if (!(isNumK(k) || k === 'str')) this.err(`no matching function for call to 'String(${typeName(A.t)})'`, n.tok);
    if (n.args.length === 1) return this.combine1(TY.str!, A, toStrFn(A.t));
    const B = this.compileExpr(n.args[1]!);
    const t = A.t;
    return this.combine2(TY.str!, A, B, (v: any, f: any) => fmtValue(v, t, f), n.tok, n.k);
  }
  compileNewPing(args: Expr[], tok: Token): Step {
    if (args.length < 2 || args.length > 3) this.err('NewPing(trigger_pin, echo_pin[, max_cm_distance]) needs 2 or 3 arguments', tok);
    const A = args.map(a => this.compileExpr(a));
    const M = this.M, t: PType = { k: 'obj', cls: 'NewPing' };
    if (A.every(a => a.s)) return { t, s: true, f: (F: Frame) => M.newPing((A[0] as SyncStep).f(F), (A[1] as SyncStep).f(F), A[2] ? (A[2] as SyncStep).f(F) : 500) };
    return { t, s: false, f: function* (F) { const v = []; for (const a of A) v.push(a.s ? (a.f as SyncFn)(F) : yield* (a.f as GenFn)(F)); return M.newPing(v[0], v[1], v[2] === undefined ? 500 : v[2]); } };
  }
  compileBitOp(name: string, n: import('./ast.js').CallNode): Step {
    const need = name === 'bitWrite' ? 3 : 2;
    if (n.args.length !== need) this.err(`${name}() takes ${need} arguments`, n.tok);
    const L = this.compileLv(n.args[0]!, n.tok, `first argument of ${name}()`);
    const B = this.compileExpr(n.args[1]!); const V = need === 3 ? this.compileExpr(n.args[2]!) : null;
    if (!L.fast || !B.s || (V && !V.s)) this.err(`${name}() only supports simple variables in the simulator`, n.tok);
    const k = kindOf(L.t); if (!INT_K.has(k as any)) this.err(`${name}() needs an integer variable`, n.tok);
    const w = WRAP[k]!, get = L.get, set = L.set, fb = B.f as SyncFn, fv = V ? V.f as SyncFn : null;
    const op = name === 'bitSet' ? (x: number, b: number) => x | (1 << b) : name === 'bitClear' ? (x: number, b: number) => x & ~(1 << b) : null;
    if (op) return { t: L.t, s: true, f: (F: Frame) => { const v = w(op(get(F), fb(F))); set(F, v); return v; } };
    return { t: L.t, s: true, f: (F: Frame) => { const b = fb(F); const v = w(fv!(F) ? (get(F) | (1 << b)) : (get(F) & ~(1 << b))); set(F, v); return v; } };
  }
  pickOverload(name: string, n: import('./ast.js').CallNode): FuncRec {
    const recs = this.funcs.get(name)!;
    const nargs = n.args.length;
    const cands = recs.filter(r => nargs >= r.minArgs && nargs <= r.params.length);
    if (!cands.length) {
      const r = recs[0]!;
      this.err(`${nargs < r.minArgs ? 'too few' : 'too many'} arguments to function '${r.sig}'`, n.tok);
    }
    if (cands.length === 1) return cands[0]!;
    // score by type match
    const saved = this.strRam;
    const kinds = n.args.map(a => { try { return kindOf(this.compileExpr(a).t); } catch { return '?' as Kind; } });
    this.strRam = saved;
    let best: FuncRec | null = null, bestScore = -1;
    for (const r of cands) {
      let s = 0;
      r.params.forEach((p, i) => {
        if (i >= kinds.length) return;
        const pk = kindOf(p.t), ak = kinds[i]!;
        if (pk === ak) s += 3; else if (isNumK(pk) && isNumK(ak)) s += ((pk === 'f32') === (ak === 'f32') ? 2 : 1); else if (pk === 'str' && ak === 'str') s += 3;
      });
      if (s > bestScore) { bestScore = s; best = r; }
    }
    return best!;
  }
  compileUserCall(name: string, n: import('./ast.js').CallNode): Step {
    const rec = this.pickOverload(name, n);
    const args: { s: boolean; f: (F: Frame) => any }[] = [];
    for (let i = 0; i < rec.params.length; i++) {
      const p = rec.params[i]!;
      const argNode = i < n.args.length ? n.args[i]! : p.def!;
      if (!argNode) this.err(`too few arguments to function '${rec.sig}'`, n.tok);
      if (p.isRef) {
        const L = this.compileLv(argNode, argNode.tok, `argument ${i + 1} of '${name}' (it is passed by reference)`);
        if (kindOf(L.t) !== kindOf(p.t) || (L.t.k === 'struct' && p.t.k === 'struct' && L.t.def !== p.t.def)) this.err(`cannot bind reference of type '${typeName(p.t)}&' to a value of type '${typeName(L.t)}'`, argNode.tok);
        args.push(L.fast ? { s: true, f: L.pair } : { s: L.s, f: L.loc as (F: Frame) => any });
      } else if (p.t.k === 'array') {
        const E = this.compileExpr(argNode);
        if (E.t.k !== 'array') this.err(`cannot convert '${typeName(E.t)}' to '${typeName(p.t)}'`, argNode.tok);
        args.push(E as { s: boolean; f: (F: Frame) => any });
      } else {
        const E = this.compileExpr(argNode);
        const conv = this.convFn(E.t, p.t, argNode.tok);
        const ef = E.f;
        if (E.cv !== undefined) { const v = conv(E.cv); args.push({ s: true, f: () => v }); }
        else if (E.s) args.push({ s: true, f: conv === ID ? ef as SyncFn : (F: Frame) => conv((ef as SyncFn)(F)) });
        else args.push({ s: false, f: function* (F: Frame) { return conv(yield* (ef as GenFn)(F)); } as unknown as (F: Frame) => any });
      }
    }
    const rt = rec.retT, na = args.length;
    const allSync = args.every(a => a.s);
    if (rec.isGen !== false) {
      return {
        t: rt, s: false, f: function* (F) {
          const av = new Array(na);
          for (let i = 0; i < na; i++) { const a = args[i]!; av[i] = a.s ? a.f(F) : yield* (a.f(F) as unknown as Generator<number, unknown, unknown>); }
          return yield* rec.invokeGen(av);
        }
      };
    }
    if (allSync) {
      if (na === 0) return { t: rt, s: true, f: () => rec.invokeSync(EMPTY_ARGS) };
      if (na === 1) { const a0 = args[0]!.f; return { t: rt, s: true, f: (F: Frame) => rec.invokeSync([a0(F)]) }; }
      if (na === 2) { const a0 = args[0]!.f, a1 = args[1]!.f; return { t: rt, s: true, f: (F: Frame) => rec.invokeSync([a0(F), a1(F)]) }; }
      return { t: rt, s: true, f: (F: Frame) => { const av = new Array(na); for (let i = 0; i < na; i++) av[i] = args[i]!.f(F); return rec.invokeSync(av); } };
    }
    return {
      t: rt, s: false, f: function* (F) {
        const av = new Array(na);
        for (let i = 0; i < na; i++) { const a = args[i]!; av[i] = a.s ? a.f(F) : yield* (a.f(F) as unknown as Generator<number, unknown, unknown>); }
        return rec.invokeSync(av);
      }
    };
  }

  /* ------------------------------ initializers & declarations ------------------------------ */
  makeInit(t: PType, init: Expr | InitListNode | null, tok?: Token): Step | null {
    if (!init) return null;
    if (init.k === 'InitList') {
      if (t.k === 'array') {
        const st = subT(t);
        if (init.items.length > (t.dims[0] as number)) this.err(`too many initializers for '${typeName(t)}'`, init.tok);
        const items = init.items.map(it => this.makeInit(st, it, tok)!);
        if (!items.every(x => x.s)) this.err('function calls that use delay()/pulseIn() are not allowed inside { } initializers', init.tok);
        if (items.every(x => x.cv !== undefined)) {
          const tmpl = this.zeroOf(t); items.forEach((x, i) => { tmpl[i] = x.cv; });
          return { s: true, f: () => cloneVal(tmpl), cv: tmpl, t };
        }
        return { s: true, f: (F: Frame) => { const a = this.zeroOf(t); for (let i = 0; i < items.length; i++) a[i] = (items[i]!.f as SyncFn)(F); return a; }, t };
      }
      if (t.k === 'struct') {
        const fields = t.def.cfields!;
        if (init.items.length > fields.length) this.err(`too many initializers for '${typeName(t)}'`, init.tok);
        const items = init.items.map((it, i) => this.makeInit(fields[i]!.t, it, tok)!);
        if (!items.every(x => x.s)) this.err('function calls that use delay()/pulseIn() are not allowed inside { } initializers', init.tok);
        return { s: true, f: (F: Frame) => { const o = this.zeroOf(t); for (let i = 0; i < items.length; i++) o[fields[i]!.name] = (items[i]!.f as SyncFn)(F); return o; }, t };
      }
      if (init.items.length === 0) return { s: true, f: () => this.zeroOf(t), cv: this.zeroOf(t), t };
      if (init.items.length > 1) this.err(`scalar object requires one element in initializer`, init.tok);
      return this.makeInit(t, init.items[0]!, tok);
    }
    if (t.k === 'array') {
      if ((t.elem.k === 'i8' || t.elem.k === 'u8') && init.k === 'Str') {
        const s = init.v, n = t.dims[0] as number;
        if (s.length + 1 > n) this.err(`initializer-string for array of chars is too long`, init.tok);
        const a = new Array(n).fill(0); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
        return { s: true, f: () => a.slice(), cv: a, t };
      }
      this.err('array must be initialized with a brace-enclosed initializer', init.tok);
    }
    const E = this.compileExpr(init);
    const conv = this.convFn(E.t, t, init.tok || tok);
    const ef = E.f;
    if (E.cv !== undefined) { const v = conv(E.cv); if (t.k === 'struct') return { s: true, f: () => cloneVal(v), t }; return { s: true, f: () => v, cv: v, t }; }
    if (E.s) return { s: true, f: (F: Frame) => conv((ef as SyncFn)(F)), t };
    return { s: false, f: function* (F) { return conv(yield* (ef as GenFn)(F)); }, t };
  }
  compileVarDecl(d: import('./ast.js').VarStmt, isGlobal: boolean): Step {
    const G = this.G;
    const baseT = this.resolveType(d.type, d.tok);
    const isConst = !!(d.type as { isConst?: boolean }).isConst, isStatic = !!(d.type as { isStatic?: boolean }).isStatic && !isGlobal;
    const steps: Step[] = [];
    for (const dc of d.declarators) {
      let t = baseT;
      const init = dc.init;
      if (t.k === 'auto') {
        if (!init || init.k === 'InitList') this.err(`declaration of 'auto ${dc.name}' has no initializer`, dc.tok);
        const saved = this.strRam; t = this.compileExpr(init).t; this.strRam = saved;
        if ((t as { lit?: boolean }).lit) t = TY.str!;
      }
      if (t.k === 'void') this.err(`variable or field '${dc.name}' declared void`, dc.tok);
      const tokWithName = Object.assign({}, dc.tok, { v: dc.name });
      t = this.withDims(t, dc.dims, init, tokWithName);
      if (t.k === 'array' && t.dims.length === 1 && (t.elem.k === 'i8' || t.elem.k === 'u8') && init && init.k === 'Str' && dc.dims[0] == null) {
        // char msg[] = "..."; -> treat as a String for printing convenience
        t = { k: 'str', charPtr: true };
      }
      let mk: Step | null;
      if (t.k === 'obj') {
        if (dc.ctorArgs) mk = this.compileNewPing(dc.ctorArgs, dc.tok);
        else if (init) { mk = this.compileExpr(init as Expr); if (mk.t.k !== 'obj') this.err(`cannot convert '${typeName(mk.t)}' to 'NewPing'`, dc.tok); }
        else this.err(`no matching function for call to 'NewPing::NewPing()' (use NewPing ${dc.name}(TRIG, ECHO, MAX_CM);)`, dc.tok);
        mk = Object.assign({}, mk, { cv: undefined });
      } else mk = this.makeInit(t, init, dc.tok);
      if (isConst && !init && t.k !== 'obj') this.err(`uninitialized const '${dc.name}'`, dc.tok);
      if (mk && mk.cv !== undefined && init && (init.k === 'Num' || (init.k === 'Unary' && init.a.k === 'Num')) && INT_K.has(kindOf(t) as any) && t.k !== 'bool') {
        const raw = this.compileExprQuiet(init);
        if (typeof raw === 'number' && raw !== mk.cv) {
          if (Number.isInteger(raw)) this.warn(`overflow in conversion from '${raw > 2147483647 || raw < -2147483648 ? 'long long' : 'long'}' to '${typeName(t)}' changes value from '${raw}' to '${mk.cv}' [-Woverflow]  (the Uno's int is 16-bit: -32768..32767)`, dc.tok);
          else this.warn(`conversion from 'double' to '${typeName(t)}' changes value from '${raw}' to '${mk.cv}'`, dc.tok);
        }
      }
      if (isGlobal || isStatic) {
        const slot = G.length; G.push(this.zeroOf(t));
        const sym: Sym = { kind: 'global', t, slot, isConst };
        const scalar = !(t.k === 'array' || t.k === 'struct' || t.k === 'obj');
        if (isConst && scalar && mk && mk.cv !== undefined) { sym.cv = mk.cv; G[slot] = mk.cv; }
        else {
          this.globalRam += t.k === 'obj' ? 8 : sizeOfT(t);
          if (mk) {
            if (mk.cv !== undefined && t.k !== 'array' && t.k !== 'struct') G[slot] = mk.cv;
            else {
              const f = mk.f;
              if (isStatic) {
                // static locals are initialised once, before setup()
                if (!mk.s) this.err('static local variables must be initialised with a value that does not call delay()/pulseIn()', dc.tok);
                this.initSteps.push({ s: true, f: (F: Frame) => { G[slot] = (f as SyncFn)(F); return 0; }, t: TY.void! });
              } else if (mk.s) steps.push({ s: true, f: (F: Frame) => { G[slot] = (f as SyncFn)(F); return 0; }, t: TY.void! });
              else steps.push({ s: false, f: function* (F) { G[slot] = yield* (f as GenFn)(F); return 0; }, t: TY.void! });
            }
          }
        }
        this.declare(dc.name, sym, dc.tok);
      } else {
        const slot = this.fn!.nSlots++;
        const sym: Sym = { kind: 'local', t, slot, isConst };
        const scalar = !(t.k === 'array' || t.k === 'struct' || t.k === 'obj');
        if (isConst && scalar && mk && mk.cv !== undefined) sym.cv = mk.cv;
        if (!mk) {
          if (t.k === 'array' || t.k === 'struct') steps.push({ s: true, f: (F: Frame) => { F[slot] = this.zeroOf(t); return 0; }, t: TY.void! });
          else { const z = this.zeroOf(t); steps.push({ s: true, f: (F: Frame) => { F[slot] = z; return 0; }, t: TY.void! }); }
        } else {
          const f = mk.f;
          if (mk.s) steps.push({ s: true, f: (F: Frame) => { F[slot] = (f as SyncFn)(F); return 0; }, t: TY.void! });
          else steps.push({ s: false, f: function* (F) { F[slot] = yield* (f as GenFn)(F); return 0; }, t: TY.void! });
        }
        this.declare(dc.name, sym, dc.tok);
      }
    }
    return this.seq(steps);
  }
  compileExprQuiet(n: Expr): unknown { const saved = this.strRam; try { const e = this.compileExpr(n); return e.cv; } catch { return undefined; } finally { this.strRam = saved; } }
  defineEnum(def: EnumDef, scope: Map<string, Sym>): void {
    const map = new Map<string, number>(); let next = 0;
    const et: PType = { k: 'enum', name: def.name, def };
    for (const it of def.items) {
      if (it.value) next = this.constInt(it.value, `enumerator value for '${it.name}'`);
      map.set(it.name, next);
      if (!def.scoped) {
        if (scope.has(it.name) && scope.get(it.name)!.kind !== 'const') this.err(`'${it.name}' conflicts with a previous declaration`, it.tok);
        scope.set(it.name, { kind: 'const', t: et, val: next });
      }
      next++;
    }
    this.enumScopes.set(def.name, { map, t: et });
  }

  /* ------------------------------ statements ------------------------------ */
  seq(list: (Step | null)[]): Step {
    const filtered = list.filter((x): x is Step => Boolean(x));
    if (!filtered.length) return { s: true, f: () => 0, t: TY.void! };
    if (filtered.length === 1) return filtered[0]!;
    const n = filtered.length;
    if (filtered.every(x => x.s)) return { s: true, t: TY.void!, f: (F: Frame) => { for (let i = 0; i < n; i++) { const r = (filtered[i] as SyncStep).f(F); if (r) return r; } return 0; } };
    return { s: false, t: TY.void!, f: function* (F) { for (let i = 0; i < n; i++) { const st = filtered[i]!; const r = st.s ? st.f(F) : yield* st.f(F); if (r) return r; } return 0; } };
  }
  pushScope(): void { this.fn!.scopes.push(new Map()); }
  popScope(): void { this.fn!.scopes.pop(); }
  condExpr(n: Expr): Step {
    if (n.k === 'Assign' && n.op === '=') this.warn('suggest parentheses around assignment used as truth value [-Wparentheses]  (did you mean == ?)', n.tok);
    const E = this.compileExpr(n);
    const k = kindOf(E.t);
    if (!(isNumK(k) || k === 'str' || E.t.k === 'serialObj')) this.err(`could not convert '${typeName(E.t)}' to 'bool'`, n.tok);
    return E;
  }
  loopTail(): () => boolean {
    const M = this.M;
    return () => { M.t += 0.25; if (M.t >= M.frameEnd) return true; if (++M.ops > 40000) { M.ops = 0; return M.overBudget(); } return false; };
  }
  compileStmt(n: Stmt): Step | null {
    switch (n.k) {
      case 'Empty': return null;
      case 'Block': { this.pushScope(); const list = n.body.map(s => this.compileStmt(s)); this.popScope(); return this.seq(list); }
      case 'Expr': {
        const E = this.compileExpr(n.expr); const f = E.f;
        if (E.s) return { s: true, t: TY.void!, f: (F: Frame) => { (f as SyncFn)(F); return 0; } };
        return { s: false, t: TY.void!, f: function* (F) { yield* (f as GenFn)(F); return 0; } };
      }
      case 'Var': return this.compileVarDecl(n, false);
      case 'LocalDefs': {
        for (const d of n.defs) { if (d.k === 'Enum') this.defineEnum(d.def, this.curScope()); if (d.k === 'Struct') this.ensureStruct(d.def); }
        return null;
      }
      case 'Typedef': { for (const d of n.defs) { if (d.k === 'Enum') this.defineEnum(d.def, this.curScope()); if (d.k === 'Struct') this.ensureStruct(d.def); } return null; }
      case 'If': {
        const T = this.condExpr(n.test);
        this.pushScope(); const C = this.compileStmt(n.cons) || { s: true, f: () => 0, t: TY.void! }; this.popScope();
        let A: Step | null = null; if (n.alt) { this.pushScope(); A = this.compileStmt(n.alt); this.popScope(); }
        const ft = T.f, fc = C.f, fa = A ? A.f : null;
        if (T.s && C.s && (!A || A.s)) return { s: true, t: TY.void!, f: fa ? (F: Frame) => ((ft as SyncFn)(F) ? (fc as SyncFn)(F) : (fa as SyncFn)(F)) : (F: Frame) => ((ft as SyncFn)(F) ? (fc as SyncFn)(F) : 0) };
        const ts = T.s, cs = C.s, as = A ? A.s : true;
        return { s: false, t: TY.void!, f: function* (F) { const c = ts ? (ft as SyncFn)(F) : yield* (ft as GenFn)(F); if (c) return cs ? (fc as SyncFn)(F) : yield* (fc as GenFn)(F); if (!fa) return 0; return as ? (fa as SyncFn)(F) : yield* (fa as GenFn)(F); } };
      }
      case 'While': case 'DoWhile': {
        const T = this.condExpr(n.test);
        this.fn!.ctx.push('loop'); this.pushScope();
        const B = this.compileStmt(n.body) || { s: true, f: () => 0, t: TY.void! };
        this.popScope(); this.fn!.ctx.pop();
        const tail = this.loopTail();
        const ft = T.f, fb = B.f, ts = T.s, bs = B.s, isDo = n.k === 'DoWhile';
        return {
          s: false, t: TY.void!, f: function* (F) {
            let first = isDo;
            while (true) {
              if (!first) { const c = ts ? (ft as SyncFn)(F) : yield* (ft as GenFn)(F); if (!c) return 0; }
              first = false;
              const r = bs ? (fb as SyncFn)(F) : yield* (fb as GenFn)(F);
              if (r === SIG_BRK) return 0;
              if (r === SIG_RET) return SIG_RET;
              if (tail()) yield 0;
            }
          }
        };
      }
      case 'For': {
        this.pushScope();
        const I = n.init ? this.compileStmt(n.init) : null;
        const T = n.test ? this.condExpr(n.test) : null;
        const U = n.update ? this.compileExpr(n.update) : null;
        this.fn!.ctx.push('loop'); this.pushScope();
        const B = this.compileStmt(n.body) || { s: true, f: () => 0, t: TY.void! };
        this.popScope(); this.fn!.ctx.pop(); this.popScope();
        const tail = this.loopTail();
        const fi = I && I.f, is = I ? I.s : true, ft = T && T.f, ts = T ? T.s : true, fu = U && U.f, us = U ? U.s : true, fb = B.f, bs = B.s;
        return {
          s: false, t: TY.void!, f: function* (F) {
            if (fi) { if (is) (fi as SyncFn)(F); else yield* (fi as GenFn)(F); }
            while (true) {
              if (ft) { const c = ts ? (ft as SyncFn)(F) : yield* (ft as GenFn)(F); if (!c) return 0; }
              const r = bs ? (fb as SyncFn)(F) : yield* (fb as GenFn)(F);
              if (r === SIG_BRK) return 0;
              if (r === SIG_RET) return SIG_RET;
              if (fu) { if (us) (fu as SyncFn)(F); else yield* (fu as GenFn)(F); }
              if (tail()) yield 0;
            }
          }
        };
      }
      case 'Switch': {
        const D = this.compileExpr(n.disc);
        if (!INT_K.has(kindOf(D.t) as any)) this.err(`switch quantity not an integer (it is '${typeName(D.t)}')`, n.tok);
        this.fn!.ctx.push('switch'); this.pushScope();
        const flat: Step[] = []; const map = new Map<unknown, number>(); let def = -1;
        for (const c of n.cases) {
          if (c.test) {
            const v = this.constInt(c.test, 'case label');
            if (map.has(v)) this.err(`duplicate case value ${v}`, c.tok);
            map.set(v, flat.length);
          } else { if (def >= 0) this.err("multiple default labels in one switch", c.tok); def = flat.length; }
          for (const s of c.body) { const st = this.compileStmt(s); flat.push(st || { s: true, f: () => 0, t: TY.void! }); }
        }
        this.popScope(); this.fn!.ctx.pop();
        const fd = D.f, ds = D.s, nf = flat.length;
        const allSync = ds && flat.every(x => x.s);
        if (allSync) return {
          s: true, t: TY.void!, f: (F: Frame) => {
            const v = (fd as SyncFn)(F); let i = map.has(v) ? map.get(v)! : def; if (i < 0) return 0;
            for (; i < nf; i++) { const r = (flat[i] as SyncStep).f(F); if (r === SIG_BRK) return 0; if (r) return r; } return 0;
          }
        };
        return {
          s: false, t: TY.void!, f: function* (F) {
            const v = ds ? (fd as SyncFn)(F) : yield* (fd as GenFn)(F); let i = map.has(v) ? map.get(v)! : def; if (i < 0) return 0;
            for (; i < nf; i++) { const st = flat[i]!; const r = st.s ? st.f(F) : yield* st.f(F); if (r === SIG_BRK) return 0; if (r) return r; } return 0;
          }
        };
      }
      case 'Break': if (!this.fn!.ctx.length) this.err('break statement not within loop or switch', n.tok); return { s: true, t: TY.void!, f: () => SIG_BRK };
      case 'Continue': if (!this.fn!.ctx.includes('loop')) this.err('continue statement not within a loop', n.tok); return { s: true, t: TY.void!, f: () => SIG_CNT };
      case 'Return': {
        const rec = this.fn!.rec!; rec.hasReturn = true;
        if (!n.value) {
          if (rec.retT.k !== 'void') this.warn(`return-statement with no value, in function returning '${typeName(rec.retT)}'`, n.tok);
          return { s: true, t: TY.void!, f: () => SIG_RET };
        }
        const E = this.compileExpr(n.value);
        if (rec.retT.k === 'void') { if (E.t.k !== 'void') this.err(`return-statement with a value, in function returning 'void'`, n.tok); }
        const conv = this.convFn(E.t, rec.retT, n.tok); const ef = E.f;
        if (E.s) return { s: true, t: TY.void!, f: (F: Frame) => { F[0] = conv((ef as SyncFn)(F)); return SIG_RET; } };
        return { s: false, t: TY.void!, f: function* (F) { F[0] = conv(yield* (ef as GenFn)(F)); return SIG_RET; } };
      }
    }
  }

  /* ------------------------------ functions ------------------------------ */
  declareFunc(d: FuncDecl | import('./ast.js').ProtoDecl): void {
    const retT = this.resolveType(d.ret, d.tok);
    const params: ParamRec[] = d.params.map(p => {
      let t = this.resolveType(p.type, p.tok);
      if (p.arrayParam) {
        const dims = p.dims.map(x => (x == null ? null : this.constInt(x, 'array parameter bound')));
        t = arrT(t, dims);
      }
      return { name: p.name, t, isRef: p.isRef, def: p.def, tok: p.tok };
    });
    const sig = `${typeName(retT)} ${d.name}(${params.map(p => typeName(p.t) + (p.isRef ? '&' : '')).join(', ')})`;
    const list = this.funcs.get(d.name) || [];
    let rec = list.find(r => r.params.length === params.length && r.params.every((p, i) => kindOf(p.t) === kindOf(params[i]!.t)));
    if (rec) {
      if (d.k === 'Func' && rec.node) this.err(`redefinition of '${sig}'`, d.tok);
      if (kindOf(rec.retT) !== kindOf(retT)) this.err(`ambiguating new declaration of '${sig}'`, d.tok);
      params.forEach((p, i) => { if (p.def && !rec!.params[i]!.def) rec!.params[i]!.def = p.def; });
      if (d.k === 'Func') { rec.node = d; rec.tok = d.tok; rec.params.forEach((p, i) => { p.name = params[i]!.name; p.tok = params[i]!.tok; }); }
    } else {
      const newRec: FuncRec = {
        name: d.name, retT, params, sig, node: d.k === 'Func' ? d : null, tok: d.tok, isGen: undefined, pslots: [], nSlots: 1, body: null,
        retDefault: undefined, minArgs: 0,
        // placeholders so the object satisfies FuncRec up front; both are replaced below
        // (unlike the original JS, TS doesn't allow constructing the object incrementally).
        invokeSync: () => undefined,
        // eslint-disable-next-line require-yield
        invokeGen: function* () { return undefined; },
      };
      rec = newRec;
      const M = this.M;
      rec.retDefault = this.zeroOf(retT.k === 'array' ? TY.i16! : retT);
      rec.invokeSync = (av: unknown[]) => {
        const F: Frame = new Array(rec!.nSlots);
        for (let i = 0; i < av.length; i++) F[rec!.pslots[i]!] = av[i];
        if (++M.depth > 150) M.stackOverflow(rec!.name);
        M.t += 0.5;
        (rec!.body!.f as SyncFn)(F);
        M.depth--;
        const r = F[0]; return r === undefined ? rec!.retDefault : r;
      };
      rec.invokeGen = function* (av: unknown[]) {
        const F: Frame = new Array(rec!.nSlots);
        for (let i = 0; i < av.length; i++) F[rec!.pslots[i]!] = av[i];
        if (++M.depth > 150) M.stackOverflow(rec!.name);
        M.t += 0.5;
        if (rec!.body!.s) (rec!.body!.f as SyncFn)(F); else yield* (rec!.body!.f as GenFn)(F);
        M.depth--;
        const r = F[0]; return r === undefined ? rec!.retDefault : r;
      };
      list.push(rec); this.funcs.set(d.name, list);
    }
    let seenDef = false;
    rec.params.forEach(p => { if (p.def) seenDef = true; else if (seenDef) this.err(`default argument missing for parameter of '${sig}'`, d.tok); });
    rec.minArgs = rec.params.filter(p => !p.def).length;
  }
  analyzeGen(): void {
    const info = new Map<FuncRec, { own: boolean; callees: Set<string> }>();
    const visit = (node: unknown, inf: { own: boolean; callees: Set<string> }, depth: number): void => {
      if (!node || typeof node !== 'object' || depth > 200) return;
      if (Array.isArray(node)) { for (const x of node) visit(x, inf, depth + 1); return; }
      const rec = node as Record<string, unknown>;
      switch (rec.k) {
        case 'While': case 'DoWhile': case 'For': inf.own = true; break;
        case 'Call': {
          const c = rec.callee as Record<string, unknown>;
          if (c.k === 'Ident') { if (this.funcs.has(c.name as string)) inf.callees.add(c.name as string); else if (GEN_BUILTINS.has(c.name as string)) inf.own = true; }
          if (c.k === 'Member' && GEN_METHODS.has(c.name as string)) inf.own = true;
          break;
        }
      }
      for (const key in rec) {
        if (key === 'tok' || key === 'type' || key === 'def' || key === 'ret') continue;
        const v = rec[key];
        if (v && typeof v === 'object') visit(v, inf, depth + 1);
      }
    };
    for (const [, recs] of this.funcs) for (const r of recs) {
      const inf = { own: false, callees: new Set<string>() };
      if (r.node) { visit(r.node.body, inf, 0); for (const p of r.params) if (p.def) visit(p.def, inf, 0); }
      info.set(r, inf);
    }
    for (const r of info.keys()) r.isGen = info.get(r)!.own;
    let changed = true, guard = 0;
    while (changed && guard++ < 100) {
      changed = false;
      for (const [r, inf] of info) {
        if (r.isGen) continue;
        for (const c of inf.callees) if ((this.funcs.get(c) || []).some(x => x.isGen)) { r.isGen = true; changed = true; break; }
      }
    }
  }
  compileFuncBody(rec: FuncRec): void {
    const d = rec.node!;
    this.fn = { rec, scopes: [new Map()], nSlots: 1, ctx: [] };
    rec.pslots = [];
    rec.params.forEach(p => {
      const slot = this.fn!.nSlots++;
      rec.pslots.push(slot);
      if (p.name) {
        if (this.fn!.scopes[0]!.has(p.name)) this.err(`redefinition of parameter '${p.name}'`, p.tok);
        this.fn!.scopes[0]!.set(p.name, { kind: p.isRef ? 'ref' : 'local', t: p.t, slot, isConst: false } as Sym);
      }
    });
    const body = this.compileStmt(d.body) || { s: true, f: () => 0, t: TY.void! };
    if (rec.isGen === false && !body.s) {
      // should not happen, but keep it safe
      rec.isGen = true;
    }
    rec.body = body;
    rec.nSlots = this.fn.nSlots;
    if (rec.retT.k !== 'void' && !rec.hasReturn && d.name !== 'main') this.warn(`no return statement in function '${rec.sig}' returning non-void [-Wreturn-type]`, d.tok);
    this.fn = null;
  }

  compile(): CompiledProgram {
    for (const [k, [ty, v]] of Object.entries(ARDUINO_CONSTS)) this.gscope.set(k, { kind: 'const', t: TY[ty]!, val: v });
    this.gscope.set('Serial', { kind: 'serial' });
    const decls = this.ast.decls;
    // Signatures first so that functions can be called before their definition (the Arduino IDE generates prototypes).
    // Types used in signatures must be declared first, so enums/structs are processed in order along the way.
    const handledTypes = new Set<TopDecl>();
    const handleTypeDecl = (d: TopDecl): void => {
      if (handledTypes.has(d)) return; handledTypes.add(d);
      if (d.k === 'Enum') this.defineEnum(d.def, this.gscope);
      else if (d.k === 'Struct') this.ensureStruct(d.def);
      else if (d.k === 'Typedef') for (const x of d.defs) handleTypeDecl(x);
    };
    const varsLater: import('./ast.js').VarStmt[] = [];
    for (const d of decls) {
      if (d.k === 'Enum' || d.k === 'Struct' || d.k === 'Typedef') handleTypeDecl(d);
      else if (d.k === 'Func' || d.k === 'Proto') this.declareFunc(d);
      else if (d.k === 'Var') varsLater.push(d);
    }
    this.analyzeGen();
    // globals (in source order relative to each other)
    for (const d of varsLater) this.initSteps.push(this.compileVarDecl(d, true));
    for (const [, recs] of this.funcs) for (const r of recs) if (r.node) this.compileFuncBody(r);
    for (const [, recs] of this.funcs) for (const r of recs) if (!r.node) {
      r.body = { s: true, f: () => 0, t: TY.void! }; r.missing = true;
    }
    const find = (nm: string) => (this.funcs.get(nm) || []).find(r => r.params.length === 0 && r.node);
    const setupRec = find('setup'), loopRec = find('loop');
    const linkTok = { file: this.mainFile, line: 0, col: 0 };
    if (!setupRec) throw new CompileError("undefined reference to `setup' (every sketch needs void setup() { ... })", linkTok, 'link');
    if (!loopRec) throw new CompileError("undefined reference to `loop' (every sketch needs void loop() { ... })", linkTok, 'link');
    for (const [, recs] of this.funcs) for (const r of recs) if (r.missing) {
      // only an error if something calls it; we cannot cheaply tell, so warn
      this.warn(`'${r.sig}' is declared but never defined; calling it will do nothing`, r.tok);
    }
    const ram = this.globalRam + this.strRam + (this.usesSerial ? 175 : 0) + 9;
    this.ramUsed = ram;
    if (ram > 2048) throw new CompileError(`Not enough memory: global variables use ${ram} bytes, the Uno only has 2048 bytes of RAM`, linkTok, 'link');
    if (ram > 1536) this.warn('Low memory available, stability problems may occur.', null);
    const M = this.M;
    const init = this.seq(this.initSteps);
    const GF: Frame = [];
    const loopSync = loopRec.isGen === false;
    function* main() {
      if (init.s) init.f(GF); else yield* init.f(GF);
      yield* setupRec!.invokeGen(EMPTY_ARGS);
      while (true) {
        if (loopSync) loopRec!.invokeSync(EMPTY_ARGS); else yield* loopRec!.invokeGen(EMPTY_ARGS);
        M.t += 1.2;
        if (M.t >= M.frameEnd) yield 0;
        else if (++M.ops > 20000) { M.ops = 0; if (M.overBudget()) yield 0; }
      }
    }
    return { main, ram, warnings: this.warnings, globals: this.G };
  }
}

export function compileSketch(files: Record<string, string>, mainName: string, M: MCU): CompiledProgram {
  const { ast, warnings } = cppParse(files, mainName);
  const c = new ArduinoCompiler(ast, M, mainName);
  const prog = c.compile();
  prog.warnings = warnings.concat(prog.warnings);
  return prog;
}

export { PURE_BUILTINS, ID, EMPTY_ARGS, valueRange, ArduinoCompiler };
