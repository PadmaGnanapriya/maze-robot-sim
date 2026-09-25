/**
 * Arduino C++ front end: comment stripping, lexer, preprocessor (#include, #define, #if) and a recursive-descent parser that produces an AST.
 */
/* ===================== Arduino C++ front end: lexer, preprocessor, parser ===================== */
import type {
  Token, TokenType, PType, EnumDef, EnumItem, StructDef, StructField, Param, Declarator, SwitchCase,
  Expr, Stmt, TopDecl, TypeDeclOnly, Program, BlockStmt, VarStmt, TypedefStmt, InitListNode, ExprStmt,
} from './ast.js';

export class CompileError extends Error {
  file: string; line: number; col: number; kind: string;
  constructor(msg: string, tok?: { file: string; line: number; col: number } | null, kind?: string) {
    super(msg);
    this.file = tok ? tok.file : '';
    this.line = tok ? tok.line : 0;
    this.col = tok ? tok.col : 0;
    this.kind = kind || 'error';
  }
}

export interface Warning { msg: string; file: string; line: number; col: number; kind: string }

export const CPP_PUNCT = ['<<=', '>>=', '...', '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '::', '##', '+', '-', '*', '/', '%', '<', '>', '=', '!', '~',
  '&', '|', '^', '?', ':', ';', ',', '.', '(', ')', '[', ']', '{', '}', '#'];

export function cppStripComments(src: string, file: string): string {
  const out: string[] = [];
  let i = 0; const n = src.length; let line = 1;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { out.push(' '); i++; }
    } else if (c === '/' && d === '*') {
      const startLine = line;
      out.push('  '); i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') { out.push('\n'); line++; } else out.push(' ');
        i++;
      }
      if (i >= n) throw new CompileError('unterminated comment', { file, line: startLine, col: 1 });
      out.push('  '); i += 2;
    } else if (c === '"' || c === "'") {
      const q = c; out.push(c); i++;
      while (i < n && src[i] !== q && src[i] !== '\n') {
        if (src[i] === '\\' && i + 1 < n && src[i + 1] !== '\n') { out.push(src[i]!, src[i + 1]!); i += 2; continue; }
        out.push(src[i]!); i++;
      }
      if (i < n && src[i] === q) { out.push(q); i++; }
    } else {
      if (c === '\n') line++;
      out.push(c!); i++;
    }
  }
  return out.join('');
}

export function cppUnescape(s: string, tok: Token): string {
  let r = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') { r += c; continue; }
    const e = s[++i];
    switch (e) {
      case 'n': r += '\n'; break; case 't': r += '\t'; break; case 'r': r += '\r'; break;
      case '0': case '1': case '2': case '3': case '4': case '5': case '6': case '7': {
        let o = e; while (o.length < 3 && /[0-7]/.test(s[i + 1] || '')) o += s[++i];
        r += String.fromCharCode(parseInt(o, 8)); break;
      }
      case 'x': { let h = ''; while (/[0-9a-fA-F]/.test(s[i + 1] || '')) h += s[++i]; r += String.fromCharCode(parseInt(h || '0', 16)); break; }
      case 'a': r += '\x07'; break; case 'b': r += '\b'; break; case 'f': r += '\f'; break; case 'v': r += '\v'; break;
      case '\\': r += '\\'; break; case "'": r += "'"; break; case '"': r += '"'; break; case '?': r += '?'; break;
      default: r += e;
    }
  }
  void tok; // kept for a uniform signature with other lexer helpers that need location info
  return r;
}

export function cppLexLine(text: string, file: string, line: number, out: Token[]): void {
  let i = 0; const n = text.length;
  while (i < n) {
    const c = text[i]!;
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') { i++; continue; }
    const col = i + 1;
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1; while (j < n && /[A-Za-z0-9_]/.test(text[j]!)) j++;
      out.push({ t: 'id', v: text.slice(i, j), file, line, col });
      i = j; continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(text[i + 1] || ''))) {
      let j = i; let isFloat = false; let val: number;
      if (c === '0' && /[xX]/.test(text[i + 1] || '')) {
        j = i + 2; while (j < n && /[0-9a-fA-F']/.test(text[j]!)) j++;
        val = parseInt(text.slice(i + 2, j).replace(/'/g, ''), 16);
      } else if (c === '0' && /[bB]/.test(text[i + 1] || '')) {
        j = i + 2; while (j < n && /[01']/.test(text[j]!)) j++;
        val = parseInt(text.slice(i + 2, j).replace(/'/g, ''), 2);
      } else {
        while (j < n && /[0-9']/.test(text[j]!)) j++;
        if (text[j] === '.') { isFloat = true; j++; while (j < n && /[0-9]/.test(text[j]!)) j++; }
        if (/[eE]/.test(text[j] || '') && /[-+0-9]/.test(text[j + 1] || '')) {
          isFloat = true; j++; if (/[-+]/.test(text[j]!)) j++; while (j < n && /[0-9]/.test(text[j]!)) j++;
        }
        const s = text.slice(i, j).replace(/'/g, '');
        if (isFloat) val = parseFloat(s);
        else if (s.length > 1 && s[0] === '0') val = parseInt(s, 8);
        else val = parseInt(s, 10);
      }
      let k = j; while (k < n && /[uUlLfF]/.test(text[k]!)) k++;
      const suffix = text.slice(j, k).toLowerCase();
      if (suffix.includes('f') && !isFloat && !/^0[xX]/.test(text.slice(i, i + 2))) isFloat = true;
      if (k < n && /[A-Za-z0-9_]/.test(text[k]!)) {
        throw new CompileError(`invalid suffix "${text.slice(j, k + 1)}" on numeric constant`, { file, line, col });
      }
      out.push({ t: 'num', v: text.slice(i, k), val, isFloat, suffix, hex: /^0[xXbB]|^0[0-7]/.test(text.slice(i, k)), file, line, col });
      i = k; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && text[j] !== c) { if (text[j] === '\\') j++; j++; }
      if (j >= n) throw new CompileError(c === '"' ? 'missing terminating " character' : "missing terminating ' character", { file, line, col });
      const raw = text.slice(i + 1, j);
      const tok = { file, line, col };
      if (c === '"') out.push({ t: 'str', v: cppUnescape(raw, tok as Token), file, line, col });
      else {
        const s = cppUnescape(raw, tok as Token);
        if (s.length === 0) throw new CompileError('empty character constant', tok);
        out.push({ t: 'chr', v: s, val: s.charCodeAt(0) & 255, file, line, col });
      }
      i = j + 1; continue;
    }
    let matched: string | null = null;
    for (const p of CPP_PUNCT) { if (text.startsWith(p, i)) { matched = p; break; } }
    if (!matched) throw new CompileError(`stray '${c}' in program`, { file, line, col });
    out.push({ t: 'op', v: matched, file, line, col });
    i += matched.length;
  }
}

export const KNOWN_LIBS: Record<string, 0 | 1> = { 'Arduino.h': 1, 'NewPing.h': 1, 'Wire.h': 1, 'SPI.h': 1, 'math.h': 1, 'stdint.h': 1, 'stdlib.h': 1, 'string.h': 1, 'avr/pgmspace.h': 1, 'EEPROM.h': 0, 'Servo.h': 0, 'SoftwareSerial.h': 0 };

interface Macro { params: string[] | null; variadic: boolean; body: Token[]; file?: string; line?: number }

export function cppPreprocess(files: Record<string, string>, mainName: string): { tokens: Token[]; warnings: Warning[]; macros: Map<string, Macro> } {
  const macros = new Map<string, Macro>();
  const warnings: Warning[] = [];
  const pre = (name: string, val: string | number) => { const toks: Token[] = []; cppLexLine(String(val), '<builtin>', 0, toks); macros.set(name, { params: null, variadic: false, body: toks }); };
  pre('ARDUINO', 10819); pre('ARDUINO_AVR_UNO', 1); pre('__AVR__', 1); pre('__AVR_ATmega328P__', 1);
  pre('F_CPU', '16000000L'); pre('NULL', 0); pre('PROGMEM', ''); pre('__cplusplus', '201103L');
  const out: Token[] = [];
  const once = new Set<string>();
  const includeStack: string[] = [];

  function expand(tokens: Token[], hide: Set<string> | null): Token[] {
    const res: Token[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const tk = tokens[i]!;
      if (tk.t !== 'id' || !macros.has(tk.v) || (hide && hide.has(tk.v))) { res.push(tk); continue; }
      const m = macros.get(tk.v)!;
      const nh = new Set<string>(hide || []); nh.add(tk.v);
      if (m.params === null) {
        const body = m.body.map(b => Object.assign({}, b, { file: tk.file, line: tk.line, col: tk.col }));
        for (const x of expand(body, nh)) res.push(x);
        continue;
      }
      if (!(tokens[i + 1] && tokens[i + 1]!.t === 'op' && tokens[i + 1]!.v === '(')) { res.push(tk); continue; }
      let j = i + 2, depth = 0; const args: Token[][] = [[]];
      for (; j < tokens.length; j++) {
        const a = tokens[j]!;
        if (a.t === 'op' && (a.v === '(' || a.v === '[' || a.v === '{')) depth++;
        else if (a.t === 'op' && (a.v === ')' || a.v === ']' || a.v === '}')) { if (depth === 0) break; depth--; }
        else if (a.t === 'op' && a.v === ',' && depth === 0) { args.push([]); continue; }
        args[args.length - 1]!.push(a);
      }
      if (j >= tokens.length) throw new CompileError(`unterminated argument list invoking macro "${tk.v}"`, tk);
      if (args.length === 1 && args[0]!.length === 0 && m.params.length === 0) args.length = 0;
      if (args.length !== m.params.length && !m.variadic) throw new CompileError(`macro "${tk.v}" requires ${m.params.length} arguments, but ${args.length} given`, tk);
      const expArgs = args.map(a => expand(a, hide));
      const sub: Token[] = [];
      for (let b = 0; b < m.body.length; b++) {
        const bt = m.body[b]!;
        if (bt.t === 'op' && bt.v === '#' && m.body[b + 1] && m.body[b + 1]!.t === 'id' && m.params.includes(m.body[b + 1]!.v)) {
          const pi = m.params.indexOf(m.body[b + 1]!.v);
          sub.push({ t: 'str', v: args[pi]!.map(x => x.t === 'str' ? JSON.stringify(x.v) : x.v).join(' '), file: tk.file, line: tk.line, col: tk.col });
          b++; continue;
        }
        if (bt.t === 'op' && bt.v === '##' && sub.length && m.body[b + 1]) {
          const left = sub.pop()!; let rightToks: Token[];
          const nb = m.body[b + 1]!;
          if (nb.t === 'id' && m.params.includes(nb.v)) rightToks = args[m.params.indexOf(nb.v)]!; else rightToks = [nb];
          const joined = (left.v || '') + (rightToks[0] ? rightToks[0].v : '');
          const tmp: Token[] = []; cppLexLine(joined, tk.file, tk.line, tmp);
          for (const x of tmp) sub.push(Object.assign(x, { col: tk.col }));
          for (const x of rightToks.slice(1)) sub.push(x);
          b++; continue;
        }
        if (bt.t === 'id' && m.params.includes(bt.v)) {
          for (const x of expArgs[m.params.indexOf(bt.v)]!) sub.push(x);
        } else if (bt.t === 'id' && bt.v === '__VA_ARGS__' && m.variadic) {
          const extra = expArgs.slice(m.params.length);
          extra.forEach((a, k) => { if (k) sub.push({ t: 'op', v: ',', file: tk.file, line: tk.line, col: tk.col }); for (const x of a) sub.push(x); });
        } else sub.push(Object.assign({}, bt, { file: tk.file, line: tk.line, col: tk.col }));
      }
      for (const x of expand(sub, nh)) res.push(x);
      i = j;
    }
    return res;
  }

  function evalIf(toks: Token[], tok: Token): boolean {
    // replace defined(X) / defined X
    const t2: Token[] = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]!;
      if (t.t === 'id' && t.v === 'defined') {
        let name: string | undefined;
        if (toks[i + 1] && toks[i + 1]!.v === '(') { name = toks[i + 2] && toks[i + 2]!.v; i += 3; }
        else { name = toks[i + 1] && toks[i + 1]!.v; i += 1; }
        t2.push({ t: 'num', v: '', val: macros.has(name!) ? 1 : 0, isFloat: false, file: t.file, line: t.line, col: t.col });
      } else t2.push(t);
    }
    const e = expand(t2, null);
    let p = 0;
    const peek = () => e[p];
    const prim = (): number => {
      const t = e[p++];
      if (!t) throw new CompileError('#if with no expression', tok);
      if (t.t === 'num' || t.t === 'chr') return t.val!;
      if (t.t === 'id') return (t.v === 'true') ? 1 : 0;
      if (t.v === '(') { const v = bin(0); p++; return v; }
      if (t.v === '!') return prim() ? 0 : 1;
      if (t.v === '-') return -prim();
      if (t.v === '+') return prim();
      if (t.v === '~') return ~prim();
      throw new CompileError(`token "${t.v}" is not valid in preprocessor expressions`, tok);
    };
    const PR: Record<string, number> = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };
    const bin = (min: number): number => {
      let a = prim();
      while (peek() && PR[peek()!.v] && PR[peek()!.v]! > min) {
        const op = e[p++]!.v; const b = bin(PR[op]!);
        switch (op) {
          case '||': a = (a || b) ? 1 : 0; break; case '&&': a = (a && b) ? 1 : 0; break;
          case '|': a = a | b; break; case '^': a = a ^ b; break; case '&': a = a & b; break;
          case '==': a = a === b ? 1 : 0; break; case '!=': a = a !== b ? 1 : 0; break;
          case '<': a = a < b ? 1 : 0; break; case '>': a = a > b ? 1 : 0; break;
          case '<=': a = a <= b ? 1 : 0; break; case '>=': a = a >= b ? 1 : 0; break;
          case '<<': a = a << b; break; case '>>': a = a >> b; break;
          case '+': a = a + b; break; case '-': a = a - b; break; case '*': a = a * b; break;
          case '/': a = b ? Math.trunc(a / b) : 0; break; case '%': a = b ? a % b : 0; break;
        }
      }
      return a;
    };
    const v = bin(0);
    return !!v;
  }

  function processFile(name: string, fromTok: Token | null): void {
    if (once.has(name)) return;
    if (includeStack.includes(name)) throw new CompileError(`#include nested too deeply (${name} includes itself)`, fromTok);
    if (includeStack.length > 16) throw new CompileError('#include nested too deeply', fromTok);
    includeStack.push(name);
    let src = files[name]!;
    src = cppStripComments(src, name);
    const rawLines = src.split('\n');
    // join backslash continuations, preserving line numbers
    const lines: { text: string; line: number }[] = [];
    for (let i = 0; i < rawLines.length; i++) {
      let l = rawLines[i]!; const startLine = i + 1;
      while (/\\\s*$/.test(l) && i + 1 < rawLines.length) { l = l.replace(/\\\s*$/, ' ') + rawLines[++i]; }
      lines.push({ text: l, line: startLine });
    }
    const cond: { active: boolean; taken: boolean }[] = [];
    const active = () => cond.every(c => c.active);
    let pending: Token[] = [];
    const flush = () => { if (pending.length) { for (const x of expand(pending, null)) out.push(x); pending = []; } };
    for (const { text, line } of lines) {
      const trimmed = text.trim();
      if (trimmed.startsWith('#')) {
        const dtok = { file: name, line, col: text.indexOf('#') + 1 } as Token;
        const body = trimmed.slice(1).trim();
        const m = /^([A-Za-z_]+)\s*([\s\S]*)$/.exec(body);
        if (!m) { if (body === '') continue; throw new CompileError(`invalid preprocessing directive #${body.split(/\s/)[0]}`, dtok); }
        const dir = m[1]!, rest = m[2]!;
        if (dir === 'ifdef' || dir === 'ifndef') {
          const nm = rest.trim().split(/\s+/)[0]!;
          const def = macros.has(nm);
          const on = dir === 'ifdef' ? def : !def;
          cond.push({ active: on, taken: on }); continue;
        }
        if (dir === 'if') {
          let on = false;
          if (active()) { const tk: Token[] = []; cppLexLine(rest, name, line, tk); on = evalIf(tk, dtok); }
          cond.push({ active: on, taken: on }); continue;
        }
        if (dir === 'elif') {
          const c = cond[cond.length - 1]; if (!c) throw new CompileError('#elif without #if', dtok);
          if (c.taken) c.active = false;
          else { const tk: Token[] = []; cppLexLine(rest, name, line, tk); const outer = cond.slice(0, -1).every(x => x.active); c.active = outer && evalIf(tk, dtok); c.taken = c.active; }
          continue;
        }
        if (dir === 'else') { const c = cond[cond.length - 1]; if (!c) throw new CompileError('#else without #if', dtok); c.active = !c.taken; c.taken = true; continue; }
        if (dir === 'endif') { if (!cond.length) throw new CompileError('#endif without #if', dtok); cond.pop(); continue; }
        if (!active()) continue;
        flush();
        if (dir === 'include') {
          const mm = /^[<"]([^>"]+)[>"]/.exec(rest.trim());
          if (!mm) throw new CompileError('#include expects "FILENAME" or <FILENAME>', dtok);
          const inc = mm[1]!;
          const base = inc.split('/').pop()!;
          if (files[inc] !== undefined || files[base] !== undefined) processFile(files[inc] !== undefined ? inc : base, dtok);
          else if (KNOWN_LIBS[inc] === 1) { /* built into the simulator */ }
          else if (KNOWN_LIBS[inc] === 0) warnings.push({ msg: `${inc} is not simulated; calls into it will fail to compile`, file: name, line, col: dtok.col, kind: 'warning' });
          else throw new CompileError(`${inc}: No such file or directory`, dtok, 'fatal');
          continue;
        }
        if (dir === 'define') {
          const dm = /^([A-Za-z_][A-Za-z0-9_]*)(\()?/.exec(rest);
          if (!dm) throw new CompileError('macro names must be identifiers', dtok);
          const nm = dm[1]!;
          let after = rest.slice(nm.length);
          let params: string[] | null = null, variadic = false;
          if (dm[2]) {
            const close = after.indexOf(')');
            if (close < 0) throw new CompileError('missing \')\' in macro parameter list', dtok);
            params = after.slice(1, close).split(',').map(s => s.trim()).filter(s => s.length);
            if (params.length && params[params.length - 1] === '...') { variadic = true; params.pop(); }
            after = after.slice(close + 1);
          }
          const bodyToks: Token[] = []; cppLexLine(after, name, line, bodyToks);
          if (macros.has(nm) && macros.get(nm)!.file && warnings.length < 50) {
            const prev = macros.get(nm)!;
            const same = prev.body.map(x => x.v).join(' ') === bodyToks.map(x => x.v).join(' ');
            if (!same) warnings.push({ msg: `"${nm}" redefined`, file: name, line, col: dtok.col, kind: 'warning' });
          }
          macros.set(nm, { params, variadic, body: bodyToks, file: name, line });
          continue;
        }
        if (dir === 'undef') { macros.delete(rest.trim().split(/\s+/)[0]!); continue; }
        if (dir === 'pragma') { if (/^once\b/.test(rest.trim())) once.add(name); continue; }
        if (dir === 'error') throw new CompileError(`#error ${rest.trim()}`, dtok);
        if (dir === 'warning') { warnings.push({ msg: `#warning ${rest.trim()}`, file: name, line, col: dtok.col, kind: 'warning' }); continue; }
        if (dir === 'line') continue;
        throw new CompileError(`invalid preprocessing directive #${dir}`, dtok);
      }
      if (!active()) continue;
      cppLexLine(text, name, line, pending);
    }
    if (cond.length) throw new CompileError('unterminated #if / #ifdef (missing #endif)', { file: name, line: lines.length, col: 1 });
    flush();
    includeStack.pop();
  }
  processFile(mainName, null);
  return { tokens: out, warnings, macros };
}

/* ------------------------------------------------ Parser ------------------------------------------------ */
const CPP_TYPE_WORDS = new Set(['void', 'bool', 'boolean', 'char', 'short', 'int', 'long', 'float', 'double', 'signed', 'unsigned',
  'byte', 'word', 'size_t', 'String', 'uint8_t', 'int8_t', 'uint16_t', 'int16_t', 'uint32_t', 'int32_t', 'uint64_t', 'int64_t', 'auto']);
const CPP_QUALS = new Set(['const', 'static', 'volatile', 'constexpr', 'inline', 'extern', 'register']);
const CPP_LIB_CLASSES = new Set(['NewPing']);
const CPP_UNSUPPORTED_CLASSES = new Set(['Servo', 'SoftwareSerial', 'LiquidCrystal', 'LiquidCrystal_I2C']);

/** parseType()'s return value: a PType plus, when it just parsed an inline enum/struct
 * *definition* (not just a reference to a previously-declared one), the Enum/Struct decl
 * node(s) the caller must splice into the surrounding declaration list. */
type ParsedType = PType & { defs?: TypeDeclOnly[]; defOnly?: boolean };

export class CppParser {
  toks: Token[]; i = 0;
  EOF: Token;
  enums = new Map<string, EnumDef>();
  structs = new Map<string, StructDef>();
  typedefs = new Map<string, ParsedType>();

  constructor(tokens: Token[]) {
    this.toks = tokens;
    const last = tokens[tokens.length - 1];
    this.EOF = { t: 'eof', v: 'end of input', file: last ? last.file : '', line: last ? last.line : 1, col: last ? last.col + 1 : 1 };
  }
  peek(k = 0): Token { return this.toks[this.i + k] || this.EOF; }
  next(): Token { return this.toks[this.i++] || this.EOF; }
  is(v: string, k = 0): boolean { const t = this.peek(k); return (t.t === 'op' || t.t === 'id') && t.v === v; }
  accept(v: string): Token | null { if (this.is(v)) { return this.next(); } return null; }
  expect(v: string, what?: string): Token {
    const t = this.peek();
    if (this.is(v)) return this.next();
    const got = t.t === 'eof' ? 'end of input' : `'${t.t === 'str' ? '"' + t.v + '"' : t.v}'`;
    if (v === ';') {
      const prev = this.toks[this.i - 1] || t;
      throw new CompileError(`expected ';' ${what ? what : 'before ' + got}`, { file: prev.file, line: prev.line, col: prev.col + String(prev.v).length });
    }
    throw new CompileError(`expected '${v}'${what ? ' ' + what : ''} before ${got}`, t);
  }
  err(msg: string, tok?: Token | null): never { throw new CompileError(msg, tok || this.peek()); }

  isTypeName(v: string): boolean { return CPP_TYPE_WORDS.has(v) || this.enums.has(v) || this.structs.has(v) || this.typedefs.has(v) || CPP_LIB_CLASSES.has(v) || CPP_UNSUPPORTED_CLASSES.has(v); }
  isTypeStart(k = 0): boolean {
    const t = this.peek(k);
    if (t.t !== 'id') return false;
    return CPP_QUALS.has(t.v) || t.v === 'enum' || t.v === 'struct' || t.v === 'typedef' || this.isTypeName(t.v);
  }

  parseProgram(): Program {
    const decls: TopDecl[] = [];
    while (this.peek().t !== 'eof') {
      if (this.accept(';')) continue;
      decls.push(...this.parseTopLevel());
    }
    return { decls };
  }

  parseTopLevel(): TopDecl[] {
    const t = this.peek();
    if (t.t === 'id' && t.v === 'typedef') return [this.parseTypedef()];
    if (t.t === 'id' && (t.v === 'class' || t.v === 'namespace' || t.v === 'template')) this.err(`'${t.v}' is not supported by the simulator; use functions, structs and enums`);
    if (t.t === 'id' && t.v === 'using') this.err(`'using' is not supported by the simulator`);
    if (!this.isTypeStart()) {
      if (t.t === 'id' && this.peek(1).t === 'op' && this.peek(1).v === '(') this.err(`ISO C++ forbids declaration of '${t.v}' with no type`, t);
      if (t.t === 'id') this.err(`'${t.v}' does not name a type`, t);
      this.err(`expected unqualified-id before '${t.v}'`, t);
    }
    const startTok = this.peek();
    const type = this.parseType();
    if (type.defOnly && this.accept(';')) return type.defs!;
    const out: TopDecl[] = [...(type.defs || [])];
    // function?
    const nameTok = this.peek();
    const looksLikeFunc = nameTok.t === 'id' && this.is('(', 1) && type.k !== 'obj' && (this.is(')', 2) || this.isTypeStart(2));
    if (looksLikeFunc) {
      this.next(); this.next();
      const params = this.parseParams();
      if (this.accept(';')) { out.push({ k: 'Proto', name: nameTok.v, ret: type, params, tok: nameTok }); return out; }
      if (!this.is('{')) this.expect('{', `for the body of '${nameTok.v}'`);
      const body = this.parseBlock();
      out.push({ k: 'Func', name: nameTok.v, ret: type, params, body, tok: nameTok });
      return out;
    }
    out.push(this.parseVarDeclRest(type, startTok, true));
    return out;
  }

  parseTypedef(): TypedefStmt {
    const tk = this.next();
    const type = this.parseType();
    const name = this.next();
    if (name.t !== 'id') this.err('expected a name for the typedef', name);
    this.expect(';');
    this.typedefs.set(name.v, type);
    if (type.k === 'struct' && !this.structs.has(name.v)) this.structs.set(name.v, type.def);
    if (type.k === 'enum' && !this.enums.has(name.v)) this.enums.set(name.v, type.def);
    return { k: 'Typedef', name: name.v, type, defs: type.defs || [], tok: tk };
  }

  parseType(): ParsedType {
    const startTok = this.peek();
    let isConst = false, isStatic = false, isVolatile = false;
    let guard = 0;
    while (this.peek().t === 'id' && CPP_QUALS.has(this.peek().v)) {
      const q = this.next().v;
      if (q === 'const' || q === 'constexpr') isConst = true;
      if (q === 'static') isStatic = true;
      if (q === 'volatile') isVolatile = true;
      if (++guard > 8) break;
    }
    let ty: PType | null = null; const defs: TypeDeclOnly[] = [];
    const t = this.peek();
    if (t.t === 'id' && t.v === 'enum') {
      this.next();
      let scoped = false;
      if (this.is('class') || this.is('struct')) { this.next(); scoped = true; }
      let name: string | null = null;
      if (this.peek().t === 'id' && !this.is('{')) name = this.next().v;
      if (this.accept(':')) { this.parseType(); }
      if (this.is('{')) {
        this.next();
        const items: EnumItem[] = [];
        while (!this.is('}')) {
          const it = this.next();
          if (it.t !== 'id') this.err('expected identifier in enum', it);
          let value: Expr | null = null;
          if (this.accept('=')) value = this.parseAssign();
          items.push({ name: it.v, value, tok: it });
          if (!this.accept(',')) break;
        }
        this.expect('}', 'at end of enum');
        const def: EnumDef = { name: name || ('enum#' + t.line), items, scoped, tok: t };
        if (name) this.enums.set(name, def);
        defs.push({ k: 'Enum', def, tok: t });
        ty = { k: 'enum', name: def.name, def };
      } else {
        if (!name || !this.enums.has(name)) this.err(`use of enum '${name}' without previous declaration`, t);
        ty = { k: 'enum', name, def: this.enums.get(name)! };
      }
    } else if (t.t === 'id' && t.v === 'struct') {
      this.next();
      let name: string | null = null;
      if (this.peek().t === 'id' && !this.is('{')) name = this.next().v;
      if (this.is('{')) {
        this.next();
        const fields: StructField[] = [];
        const def: StructDef = { name: name || ('struct#' + t.line), fields, tok: t };
        if (name) this.structs.set(name, def);
        while (!this.is('}')) {
          if (this.peek().t === 'eof') this.err("expected '}' at end of struct");
          const ft = this.parseType();
          if (ft.defs) defs.push(...ft.defs);
          do {
            if (this.is('(', 1)) this.err('member functions in structs are not supported by the simulator; use a normal function that takes the struct', this.peek());
            const fn = this.next();
            if (fn.t !== 'id') this.err('expected member name', fn);
            const dims: (Expr | null)[] = [];
            while (this.accept('[')) { dims.push(this.parseExpr()); this.expect(']'); }
            let init: Expr | InitListNode | null = null;
            if (this.accept('=')) init = this.is('{') ? this.parseInitList() : this.parseAssign();
            fields.push({ name: fn.v, type: ft, dims, init, tok: fn });
          } while (this.accept(','));
          this.expect(';', 'after struct member');
        }
        this.expect('}');
        defs.push({ k: 'Struct', def, tok: t });
        ty = { k: 'struct', name: def.name, def };
      } else {
        if (!name || !this.structs.has(name)) this.err(`use of struct '${name}' without definition`, t);
        ty = { k: 'struct', name, def: this.structs.get(name)! };
      }
    } else if (t.t === 'id' && (t.v === 'unsigned' || t.v === 'signed')) {
      this.next();
      const uns = t.v === 'unsigned';
      if (this.accept('char')) ty = { k: uns ? 'u8' : 'i8' };
      else if (this.accept('short')) { this.accept('int'); ty = { k: uns ? 'u16' : 'i16' }; }
      else if (this.accept('long')) { if (this.accept('long')) { this.accept('int'); ty = { k: 'i64' }; } else { this.accept('int'); ty = { k: uns ? 'u32' : 'i32' }; } }
      else { this.accept('int'); ty = { k: uns ? 'u16' : 'i16' }; }
    } else if (t.t === 'id' && t.v === 'long') {
      this.next();
      if (this.accept('long')) { this.accept('int'); ty = { k: 'i64' }; }
      else if (this.accept('double')) ty = { k: 'f32' };
      else { this.accept('int'); ty = { k: 'i32' }; }
    } else if (t.t === 'id' && t.v === 'short') { this.next(); this.accept('int'); ty = { k: 'i16' }; }
    else if (t.t === 'id' && this.isTypeName(t.v)) {
      this.next();
      const map: Record<string, PType['k']> = {
        void: 'void', bool: 'bool', boolean: 'bool', char: 'i8', int: 'i16', float: 'f32', double: 'f32', byte: 'u8', word: 'u16',
        size_t: 'u16', String: 'str', uint8_t: 'u8', int8_t: 'i8', uint16_t: 'u16', int16_t: 'i16', uint32_t: 'u32', int32_t: 'i32',
        uint64_t: 'i64', int64_t: 'i64', auto: 'auto',
      };
      if (map[t.v]) ty = { k: map[t.v] } as PType;
      else if (this.enums.has(t.v)) ty = { k: 'enum', name: t.v, def: this.enums.get(t.v)! };
      else if (this.structs.has(t.v)) ty = { k: 'struct', name: t.v, def: this.structs.get(t.v)! };
      else if (this.typedefs.has(t.v)) ty = Object.assign({}, this.typedefs.get(t.v), { defs: undefined, defOnly: false });
      else if (CPP_LIB_CLASSES.has(t.v)) ty = { k: 'obj', cls: t.v };
      else if (CPP_UNSUPPORTED_CLASSES.has(t.v)) this.err(`'${t.v}' is not simulated (no ${t.v} hardware on this robot)`, t);
    } else {
      this.err(`expected a type before '${t.v}'`, t);
    }
    while (this.peek().t === 'id' && (this.peek().v === 'const' || this.peek().v === 'volatile')) { if (this.next().v === 'const') isConst = true; }
    if (this.is('*')) {
      this.next();
      while (this.accept('const')) { /* pointer-to-const is unsupported anyway; just consume it */ }
      if (ty!.k === 'i8' || ty!.k === 'u8') ty = { k: 'str', charPtr: true };
      else this.err('pointers are not supported by the simulator (use arrays or reference parameters)', startTok);
      if (this.is('*')) this.err('pointers are not supported by the simulator', this.peek());
    }
    ty = Object.assign({}, ty, { isConst, isStatic, isVolatile }) as PType;
    const parsed = ty as ParsedType;
    if (defs.length) { parsed.defs = defs; parsed.defOnly = true; }
    return parsed;
  }

  parseParams(): Param[] {
    const params: Param[] = [];
    if (this.accept(')')) return params;
    if (this.is('void') && this.is(')', 1)) { this.next(); this.next(); return params; }
    while (true) {
      if (this.is('...')) this.err('variadic functions are not supported', this.peek());
      const pt = this.parseType();
      let isRef = false;
      if (this.accept('&')) isRef = true;
      let name: string | null = null; const tok = this.peek();
      if (this.peek().t === 'id') name = this.next().v;
      const dims: (Expr | null)[] = [];
      let arrayParam = false;
      while (this.accept('[')) { arrayParam = true; if (this.is(']')) dims.push(null); else dims.push(this.parseExpr()); this.expect(']'); }
      let def: Expr | null = null;
      if (this.accept('=')) def = this.parseAssign();
      params.push({ name, type: pt, isRef, dims, arrayParam, def, tok });
      if (this.accept(')')) break;
      this.expect(',', 'or \')\' in parameter list');
    }
    return params;
  }

  parseVarDeclRest(type: PType, startTok: Token, isGlobal: boolean): VarStmt {
    const declarators: Declarator[] = [];
    do {
      let isRef = false;
      if (this.accept('&')) isRef = true;
      const nameTok = this.next();
      if (nameTok.t !== 'id') this.err(`expected unqualified-id before '${nameTok.v}'`, nameTok);
      if (isRef) this.err('reference variables are not supported by the simulator (reference parameters are)', nameTok);
      const dims: (Expr | null)[] = [];
      while (this.accept('[')) { if (this.is(']')) dims.push(null); else dims.push(this.parseExpr()); this.expect(']'); }
      while (this.is('PROGMEM')) this.next();
      let init: Expr | InitListNode | null = null, ctorArgs: Expr[] | null = null;
      if (this.accept('=')) init = this.is('{') ? this.parseInitList() : this.parseAssign();
      else if (this.is('{') && dims.length === 0 && type.k !== 'obj') init = this.parseInitList();
      else if (this.is('(')) {
        this.next(); ctorArgs = [];
        if (!this.accept(')')) { do { ctorArgs.push(this.parseAssign()); } while (this.accept(',')); this.expect(')'); }
        if (type.k !== 'obj') { if (ctorArgs.length !== 1) this.err('unexpected initializer', nameTok); init = ctorArgs[0]!; ctorArgs = null; }
      }
      declarators.push({ name: nameTok.v, dims, init, ctorArgs, tok: nameTok });
    } while (this.accept(','));
    this.expect(';', isGlobal ? 'after declaration' : undefined);
    return { k: 'Var', type, declarators, tok: startTok, isGlobal };
  }

  parseInitList(): InitListNode {
    const tk = this.expect('{');
    const items: (Expr | InitListNode)[] = [];
    while (!this.is('}')) {
      items.push(this.is('{') ? this.parseInitList() : this.parseAssign());
      if (!this.accept(',')) break;
    }
    this.expect('}', 'at end of initializer list');
    return { k: 'InitList', items, tok: tk };
  }

  parseBlock(): BlockStmt {
    const tk = this.expect('{');
    const body: Stmt[] = [];
    while (!this.is('}')) {
      if (this.peek().t === 'eof') this.err(`expected '}' at end of input (block opened at line ${tk.line})`, this.EOF);
      body.push(this.parseStatement());
    }
    this.next();
    return { k: 'Block', body, tok: tk };
  }

  looksLikeDecl(): boolean {
    if (!this.isTypeStart()) return false;
    const t = this.peek();
    // Function-style casts / constructors used as expressions: int(x), String(x), NewPing(..)
    if (this.is('(', 1) && !CPP_QUALS.has(t.v)) return false;
    if (this.is('::', 1)) return false;
    return true;
  }

  parseStatement(): Stmt {
    const t = this.peek();
    if (t.t === 'op') {
      if (t.v === '{') return this.parseBlock();
      if (t.v === ';') { this.next(); return { k: 'Empty', tok: t }; }
    }
    if (t.t === 'id') {
      switch (t.v) {
        case 'if': {
          this.next(); this.expect('(', "after 'if'");
          const test = this.parseExpr(); this.expect(')');
          const cons = this.parseStatement();
          let alt: Stmt | null = null; if (this.accept('else')) alt = this.parseStatement();
          return { k: 'If', test, cons, alt, tok: t };
        }
        case 'while': {
          this.next(); this.expect('(', "after 'while'");
          const test = this.parseExpr(); this.expect(')');
          return { k: 'While', test, body: this.parseStatement(), tok: t };
        }
        case 'do': {
          this.next(); const body = this.parseStatement();
          this.expect('while', "in do-while loop"); this.expect('(');
          const test = this.parseExpr(); this.expect(')'); this.expect(';');
          return { k: 'DoWhile', test, body, tok: t };
        }
        case 'for': {
          this.next(); this.expect('(', "after 'for'");
          let init: VarStmt | ExprStmt | null = null;
          if (!this.accept(';')) {
            if (this.looksLikeDecl()) { const ty = this.parseType(); init = this.parseVarDeclRest(ty, t, false); }
            else { init = { k: 'Expr', expr: this.parseExpr(), tok: t }; this.expect(';'); }
          }
          let test: Expr | null = null; if (!this.is(';')) test = this.parseExpr(); this.expect(';');
          let update: Expr | null = null; if (!this.is(')')) update = this.parseExpr(); this.expect(')');
          return { k: 'For', init, test, update, body: this.parseStatement(), tok: t };
        }
        case 'switch': {
          this.next(); this.expect('('); const disc = this.parseExpr(); this.expect(')');
          this.expect('{', 'for switch body');
          const cases: SwitchCase[] = []; let cur: SwitchCase | null = null;
          while (!this.is('}')) {
            if (this.peek().t === 'eof') this.err("expected '}' at end of switch");
            if (this.is('case')) {
              const ct = this.next(); const test = this.parseCond(); this.expect(':', 'after case label');
              cur = { test, body: [], tok: ct }; cases.push(cur);
            } else if (this.is('default')) {
              const ct = this.next(); this.expect(':', "after 'default'");
              cur = { test: null, body: [], tok: ct }; cases.push(cur);
            } else {
              if (!cur) this.err("statement before the first 'case' label in switch");
              cur.body.push(this.parseStatement());
            }
          }
          this.next();
          return { k: 'Switch', disc, cases, tok: t };
        }
        case 'break': this.next(); this.expect(';'); return { k: 'Break', tok: t };
        case 'continue': this.next(); this.expect(';'); return { k: 'Continue', tok: t };
        case 'return': {
          this.next(); let value: Expr | null = null;
          if (!this.is(';')) value = this.parseExpr();
          this.expect(';'); return { k: 'Return', value, tok: t };
        }
        // each of these always throws (this.err()'s return type is `never`), so there is no real fallthrough
        case 'goto': this.err("'goto' is not supported by the simulator");
        case 'else': this.err("'else' without a previous 'if'"); // eslint-disable-line no-fallthrough
        case 'case': case 'default': this.err(`'${t.v}' label not within a switch statement`); // eslint-disable-line no-fallthrough
      }
      if (t.v === 'typedef') return this.parseTypedef();
      if (this.looksLikeDecl()) {
        const ty = this.parseType();
        if (ty.defOnly && this.accept(';')) return { k: 'LocalDefs', defs: ty.defs!, tok: t };
        return this.parseVarDeclRest(ty, t, false);
      }
    }
    const expr = this.parseExpr();
    this.expect(';');
    return { k: 'Expr', expr, tok: t };
  }

  /* -------- expressions -------- */
  parseExpr(): Expr {
    const first = this.parseAssign();
    if (!this.is(',')) return first;
    const list = [first];
    while (this.accept(',')) list.push(this.parseAssign());
    return { k: 'Comma', list, tok: first.tok };
  }
  parseAssign(): Expr {
    const left = this.parseCond();
    const t = this.peek();
    if (t.t === 'op' && ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>='].includes(t.v)) {
      this.next();
      const right = this.is('{') ? this.parseInitList() : this.parseAssign();
      return { k: 'Assign', op: t.v, target: left, value: right, tok: t };
    }
    return left;
  }
  parseCond(): Expr {
    const test = this.parseBin(0);
    if (this.is('?')) {
      const t = this.next();
      const a = this.parseExpr(); this.expect(':', 'in conditional expression');
      const b = this.parseAssign();
      return { k: 'Cond', test, a, b, tok: t };
    }
    return test;
  }
  parseBin(minPrec: number): Expr {
    const PREC: Record<string, number> = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };
    let left = this.parseUnary();
    while (true) {
      const t = this.peek();
      const p = t.t === 'op' ? PREC[t.v] : (t.t === 'id' && (t.v === 'and' || t.v === 'or') ? PREC[t.v === 'and' ? '&&' : '||'] : undefined);
      if (!p || p <= minPrec) break;
      this.next();
      const op = t.v === 'and' ? '&&' : t.v === 'or' ? '||' : t.v;
      const right = this.parseBin(p);
      left = (op === '&&' || op === '||') ? { k: 'Logical', op, a: left, b: right, tok: t } : { k: 'Binary', op, a: left, b: right, tok: t };
    }
    return left;
  }
  isCastAhead(): boolean {
    if (!this.is('(')) return false;
    const t = this.peek(1);
    if (t.t !== 'id') return false;
    if (!(CPP_TYPE_WORDS.has(t.v) || this.enums.has(t.v) || this.structs.has(t.v) || this.typedefs.has(t.v) || t.v === 'const')) return false;
    // scan to ')' ensuring only type tokens
    let k = 1;
    while (true) {
      const x = this.peek(k);
      if (x.t === 'op' && x.v === ')') return k > 1;
      if (x.t === 'op' && x.v === '*') { k++; continue; }
      if (x.t !== 'id') return false;
      if (!(CPP_TYPE_WORDS.has(x.v) || this.enums.has(x.v) || this.structs.has(x.v) || this.typedefs.has(x.v) || x.v === 'const' || x.v === 'volatile')) return false;
      k++;
      if (k > 6) return false;
    }
  }
  parseUnary(): Expr {
    const t = this.peek();
    if (t.t === 'op') {
      if (t.v === '!' || t.v === '~' || t.v === '-' || t.v === '+') { this.next(); return { k: 'Unary', op: t.v, a: this.parseUnary(), tok: t }; }
      if (t.v === '++' || t.v === '--') { this.next(); return { k: 'Update', op: t.v as '++' | '--', prefix: true, a: this.parseUnary(), tok: t }; }
      if (t.v === '*') this.err('pointer dereference is not supported by the simulator', t);
      if (t.v === '&') this.err("taking an address ('&') is not supported by the simulator; use a reference parameter instead", t);
      if (this.isCastAhead()) {
        this.next(); const ty = this.parseType(); this.expect(')');
        return { k: 'Cast', type: ty, a: this.parseUnary(), tok: t };
      }
    }
    if (t.t === 'id' && t.v === 'not') { this.next(); return { k: 'Unary', op: '!', a: this.parseUnary(), tok: t }; }
    if (t.t === 'id' && t.v === 'sizeof') {
      this.next();
      if (this.is('(') && this.isTypeStart(1)) {
        this.next(); const ty = this.parseType(); this.expect(')');
        return { k: 'Sizeof', type: ty, tok: t };
      }
      return { k: 'Sizeof', expr: this.parseUnary(), tok: t };
    }
    return this.parsePostfix();
  }
  parsePostfix(): Expr {
    let e = this.parsePrimary();
    while (true) {
      const t = this.peek();
      if (t.t !== 'op') break;
      if (t.v === '(') {
        this.next(); const args: Expr[] = [];
        if (!this.accept(')')) { do { args.push(this.parseAssign()); } while (this.accept(',')); this.expect(')', 'to close the argument list'); }
        e = { k: 'Call', callee: e, args, tok: e.tok || t };
      } else if (t.v === '[') {
        this.next(); const idx = this.parseExpr(); this.expect(']');
        e = { k: 'Index', obj: e, index: idx, tok: t };
      } else if (t.v === '.' || t.v === '->') {
        this.next(); const nm = this.next();
        if (nm.t !== 'id') this.err(`expected member name after '${t.v}'`, nm);
        e = { k: 'Member', obj: e, name: nm.v, tok: nm };
      } else if (t.v === '++' || t.v === '--') {
        this.next(); e = { k: 'Update', op: t.v as '++' | '--', prefix: false, a: e, tok: t };
      } else break;
    }
    return e;
  }
  parsePrimary(): Expr {
    const t = this.next();
    if (t.t === 'num') return { k: 'Num', tok: t };
    if (t.t === 'chr') return { k: 'Chr', val: t.val!, tok: t };
    if (t.t === 'str') {
      let v = t.v;
      while (this.peek().t === 'str') v += this.next().v;
      return { k: 'Str', v, tok: t };
    }
    if (t.t === 'op' && t.v === '(') {
      const e = this.parseExpr(); this.expect(')');
      return { k: 'Paren', e, tok: t };
    }
    if (t.t === 'id') {
      if (t.v === 'true' || t.v === 'false') return { k: 'Bool', val: t.v === 'true' ? 1 : 0, tok: t };
      if (t.v === 'nullptr') return { k: 'Bool', val: 0, tok: t };
      if (t.v === 'static_cast' || t.v === 'reinterpret_cast' || t.v === 'const_cast') {
        this.expect('<'); const ty = this.parseType(); this.expect('>'); this.expect('(');
        const a = this.parseExpr(); this.expect(')');
        return { k: 'Cast', type: ty, a, tok: t };
      }
      if (this.is('::')) {
        this.next(); const nm = this.next();
        if (nm.t !== 'id') this.err("expected identifier after '::'", nm);
        return { k: 'Qual', scope: t.v, name: nm.v, tok: nm };
      }
      if ((t.v === 'unsigned' || t.v === 'signed' || t.v === 'long') && this.peek().t === 'id') {
        this.i--; const ty = this.parseType(); this.expect('(');
        const a = this.parseExpr(); this.expect(')');
        return { k: 'Cast', type: ty, a, tok: t, functional: true };
      }
      return { k: 'Ident', name: t.v, tok: t };
    }
    if (t.t === 'eof') this.err('expected expression before end of input', t);
    this.err(`expected primary-expression before '${t.v}'`, t);
  }
}

export function cppParse(files: Record<string, string>, mainName: string): { ast: Program; warnings: Warning[]; parser: CppParser } {
  const pp = cppPreprocess(files, mainName);
  const parser = new CppParser(pp.tokens);
  const ast = parser.parseProgram();
  return { ast, warnings: pp.warnings, parser };
}

export type { TokenType };
