/**
 * SimController owns everything that is not drawing: the physics world, the virtual
 * Arduino, compiling and running sketches, settings, build output and serial data.
 *
 * React reads it through `subscribe` / `getSnapshot` (see useSim.ts). The 3D view listens
 * for 'maze', 'robot', 'goal' and 'fit' events and calls `tick(dt)` once per frame.
 */
import { World, MCU, Maze, compileSketch, generateMaze, DEFAULT_ROBOT, CompileError, RuntimeFault, type CompiledProgram } from '../engine';
import inoSource from '../sketch/maze_solver.ino?raw';
import configSource from '../sketch/config.h?raw';
import { loadRaw, save } from './storage.js';
import { findMismatches, mismatchNotes, writeDefine, PIN_DEFINES, type Mismatches } from './configSync.js';
import { SerialBuffer } from './SerialBuffer.js';
import {
  sanitizeRobot, sanitizeWiring, sanitizeMazeCfg, sanitizeUi, sanitizeFiles, sanitizeMazeJSON,
  type Robot, type Wiring, type MazeCfg, type UiState, type SketchFiles,
} from './settings.js';

export const FILES = ['maze_solver.ino', 'config.h'] as const;
export const DEFAULT_SKETCH: SketchFiles = { 'maze_solver.ino': inoSource, 'config.h': configSource };

const LAYOUT_KEYS = new Set<keyof MazeCfg>(['type', 'seed', 'cols', 'rows', 'goalMode', 'goalSize']);

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const formatTime = (us: number): string => {
  const s = us / 1e6;
  if (s < 60) return s.toFixed(1) + ' s';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

export type RunState = 'idle' | 'running' | 'paused' | 'solved' | 'fault' | 'error';
export type OutputKind = 'note' | 'error' | 'warning' | 'ok' | 'fault';
export interface OutputEntry {
  id: number; kind: OutputKind; text: string; file?: string; line?: number; col?: number; sub?: string;
}
export interface JumpTarget { file: string; line: number; col: number; n: number }
export interface SolvedResult { seconds: number; contacts: number; metres: number }

interface CompileOk { ok: true; mcu: MCU; program: CompiledProgram; ms: number }
interface CompileErr { ok: false; err: unknown }
type CompileResult = CompileOk | CompileErr;

export interface Snapshot {
  runState: RunState; hasProgram: boolean; solved: SolvedResult | null;
  output: OutputEntry[]; marks: Record<string, { line: number; kind: string }[]>; jump: JumpTarget | null;
  files: SketchFiles; activeFile: string;
  robot: Robot; wiring: Wiring; mz: MazeCfg; ui: UiState;
  editWalls: boolean; mazeSize: { cols: number; rows: number };
  mismatch: Mismatches;
}

export interface SonarReading { t: number; d: number | null }

export interface TelemetrySnapshot {
  t: number; readings: (SonarReading | null)[]; motors: { duty: number; brake: number; coast: boolean }[];
  pins: { state: string | null; level: number }[];
  speed: number; heading: number; contacts: number; metres: number;
  runState: RunState; runTime: number; overloaded: boolean;
  solvedSeconds: number | undefined;
  led13: boolean; tx: boolean; baud: number | null;
}

export interface WallEdge { kind: 'h' | 'v'; c: number; r: number; idx: number }

export class SimController {
  files: SketchFiles;
  activeFile: string;
  robot: Robot;
  wiring: Wiring;
  mz: MazeCfg;
  ui: UiState;
  editWalls: boolean;

  world: World;
  maze: Maze;

  run: {
    state: RunState; mcu: MCU | null; program: Generator<number, void, unknown> | null; startT: number;
    files: SketchFiles | null; solved: SolvedResult | null; overloaded: boolean;
  };
  output: OutputEntry[];
  marks: Record<string, { line: number; kind: string }[]>;
  outputSeq: number;
  jump: JumpTarget | null;
  serial: SerialBuffer;
  idleScanAcc: number;
  dragging: boolean;

  private listeners: Set<() => void>;
  private handlers: Record<string, Set<(...args: never[]) => void>>;
  private snapshot: Snapshot;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.files = sanitizeFiles(loadRaw('files'), FILES, DEFAULT_SKETCH);
    this.activeFile = FILES[0];
    this.robot = sanitizeRobot(loadRaw('robot'));
    this.wiring = sanitizeWiring(loadRaw('wiring'));

    const rawMaze = loadRaw('mazeCfg');
    const hasSavedSeed = typeof rawMaze === 'object' && rawMaze !== null && !Array.isArray(rawMaze) &&
      typeof (rawMaze as Record<string, unknown>).seed !== 'undefined';
    this.mz = sanitizeMazeCfg(rawMaze);
    if (!hasSavedSeed) this.mz.seed = 1 + Math.floor(Math.random() * 9998);

    this.ui = sanitizeUi(loadRaw('ui'));
    this.editWalls = false;

    this.world = new World();
    this.world.setRobot(this.robot);
    const savedMazeJSON = sanitizeMazeJSON(loadRaw('maze'), this.mz.cols, this.mz.rows);
    this.maze = savedMazeJSON ? Maze.fromJSON(savedMazeJSON) : this.makeMaze();
    this.world.setMaze(this.maze, this.mz.cell, this.mz.wallT);
    this.world.resetPose();
    this.world.onGoal = (t: number) => this.onGoal(t);
    this.world.onContact = () => this.fire('contact');

    this.run = { state: 'idle', mcu: null, program: null, startT: 0, files: null, solved: null, overloaded: false };
    this.output = []; this.marks = {}; this.outputSeq = 0;
    this.jump = null;
    this.serial = new SerialBuffer();
    this.idleScanAcc = 0;
    this.dragging = false;

    this.listeners = new Set();
    this.handlers = {};
    this.snapshot = this.makeSnapshot();
  }

  /* ---------- React store ---------- */
  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  getSnapshot = (): Snapshot => this.snapshot;
  makeSnapshot(): Snapshot {
    return {
      runState: this.run.state, hasProgram: !!this.run.files, solved: this.run.solved,
      output: this.output, marks: this.marks, jump: this.jump,
      files: { ...this.files }, activeFile: this.activeFile,
      robot: { ...this.robot }, wiring: clone(this.wiring), mz: { ...this.mz }, ui: { ...this.ui },
      editWalls: this.editWalls, mazeSize: { cols: this.maze.cols, rows: this.maze.rows },
      mismatch: findMismatches(this.files['config.h'] ?? '', { cell: this.mz.cell, robot: this.robot, wiring: this.wiring }),
    };
  }
  emit(): void { this.snapshot = this.makeSnapshot(); for (const fn of this.listeners) fn(); }

  /* ---------- events for the 3D view ---------- */
  on(evt: string, fn: (...args: never[]) => void): () => void {
    (this.handlers[evt] ||= new Set()).add(fn);
    return () => this.handlers[evt]?.delete(fn);
  }
  fire(evt: string, ...args: never[]): void { for (const fn of this.handlers[evt] || []) fn(...args); }

  /* ---------- settings ---------- */
  setUi(patch: Partial<UiState>): void { Object.assign(this.ui, patch); save('ui', this.ui); this.emit(); }

  setFile(name: string, text: string): void {
    this.files[name] = text;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => save('files', this.files), 400);
    this.emit();
  }
  setActiveFile(name: string): void { this.activeFile = name; this.emit(); }
  restoreFile(name: string): void {
    this.setFile(name, DEFAULT_SKETCH[name] ?? '');
    // Persist immediately so a quick reload/close doesn't lose the restored default.
    try { save('files', this.files); } catch {
      /* ignore storage failures */
    }
    this.note(`${name} is back to the default solver.`);
  }
  openFile(fileName: string, text: string): void {
    const target = /\.h$/i.test(fileName) ? 'config.h' : 'maze_solver.ino';
    this.activeFile = target;
    this.setFile(target, text.replace(/\r\n/g, '\n'));
    this.note(`Loaded ${fileName} into ${target}.`);
  }

  setRobot(patch: Partial<Robot>): void {
    Object.assign(this.robot, patch);
    this.world.setRobot(this.robot);
    this.world.resolveOverlap();
    save('robot', this.robot);
    this.fire('robot'); this.emit();
  }
  resetRobot(): void { this.robot = { ...(DEFAULT_ROBOT as Robot) }; this.setRobot({}); }

  setWiring(mutate: (w: Wiring) => void): void {
    mutate(this.wiring);
    save('wiring', this.wiring);
    this.fire('robot'); this.emit();
  }

  setMazeCfg(patch: Partial<MazeCfg>): void {
    const layoutChanged = (Object.keys(patch) as (keyof MazeCfg)[]).some(k => LAYOUT_KEYS.has(k));
    Object.assign(this.mz, patch);
    if (layoutChanged) this.regenerate();
    else this.applyMaze(false, true);
  }
  makeMaze(): Maze {
    const m = generateMaze(this.mz.type, this.mz.cols, this.mz.rows, this.mz.seed, this.mz.goalMode);
    if (this.mz.goalSize === 2 && m.goal.w === 1) {
      const g = m.goal; g.w = Math.min(2, m.cols); g.h = Math.min(2, m.rows);
      g.c = clamp(g.c, 0, m.cols - g.w); g.r = clamp(g.r, 0, m.rows - g.h);
    }
    return m;
  }
  regenerate(): void { this.maze = this.makeMaze(); this.applyMaze(true, true); }
  applyMaze(resetPose: boolean, refit: boolean): void {
    this.world.setMaze(this.maze, this.mz.cell, this.mz.wallT);
    if (resetPose) this.world.resetPose(); else this.world.resolveOverlap();
    save('maze', this.maze.toJSON()); save('mazeCfg', this.mz);
    this.fire('maze');
    if (refit) this.fire('fit');
    this.emit();
  }
  newMaze(): void {
    this.mz.seed = 1 + Math.floor(Math.random() * 99998);
    this.regenerate();
    if (this.run.files && ['running', 'paused', 'solved'].includes(this.run.state)) this.restart(true);
  }
  clearInnerWalls(): void {
    const m = this.maze;
    for (let i = 0; i < m.h.length; i++) if (!m.isBorderEdge('h', i)) m.h[i] = 0;
    for (let i = 0; i < m.v.length; i++) if (!m.isBorderEdge('v', i)) m.v[i] = 0;
    this.applyMaze(false, false);
  }
  toggleEditWalls(): void { this.editWalls = !this.editWalls; this.emit(); }

  /** Interior wall edge under a floor point, or null. */
  edgeAt(pt: { x: number; y: number } | null): WallEdge | null {
    if (!pt) return null;
    const cell = this.mz.cell, C = this.maze.cols, R = this.maze.rows, u = pt.x / cell, v = pt.y / cell;
    if (u < 0 || v < 0 || u > C || v > R) return null;
    const du = Math.abs(u - Math.round(u)), dv = Math.abs(v - Math.round(v));
    if (Math.min(du, dv) > 0.32) return null;
    if (du < dv) { const c = Math.round(u), r = Math.floor(v); return c > 0 && c < C && r >= 0 && r < R ? { kind: 'v', c, r, idx: r * (C + 1) + c } : null; }
    const r = Math.round(v), c = Math.floor(u);
    return r > 0 && r < R && c >= 0 && c < C ? { kind: 'h', c, r, idx: r * C + c } : null;
  }
  edgeValue(e: WallEdge): number { return (e.kind === 'h' ? this.maze.h : this.maze.v)[e.idx]!; }
  setEdge(e: WallEdge, value: number): void {
    const arr = e.kind === 'h' ? this.maze.h : this.maze.v;
    if (arr[e.idx] === value) return;
    arr[e.idx] = value;
    this.world.setMaze(this.maze, this.mz.cell, this.mz.wallT);
    this.world.resolveOverlap();
    this.fire('maze');
  }
  finishEdit(): void { save('maze', this.maze.toJSON()); }

  moveGoalTo(pt: { x: number; y: number }): void {
    const g = this.maze.goal, cell = this.mz.cell;
    const c = clamp(Math.round(pt.x / cell - g.w / 2), 0, this.maze.cols - g.w), r = clamp(Math.round(pt.y / cell - g.h / 2), 0, this.maze.rows - g.h);
    if (c === g.c && r === g.r) return;
    g.c = c; g.r = r; this.world.goalReached = false;
    save('maze', this.maze.toJSON());
    this.fire('goal');
  }

  /** Update config.h so it matches the maze ('cell'), robot ('robot') or wiring ('pins'). */
  syncConfig(kind: 'cell' | 'robot' | 'pins'): void {
    let src = this.files['config.h'] ?? '';
    if (kind === 'cell') src = writeDefine(src, 'CELL_CM', this.mz.cell.toFixed(1));
    if (kind === 'robot') { src = writeDefine(src, 'TRACK_CM', this.robot.track.toFixed(1)); src = writeDefine(src, 'SENSOR_SPAN', (2 * this.robot.sideY).toFixed(1)); }
    if (kind === 'pins') for (const [name, get] of PIN_DEFINES) src = writeDefine(src, name, get(this.wiring));
    this.setFile('config.h', src);
    this.note('config.h updated. Upload again to use the new values.');
  }

  /* ---------- robot placement ---------- */
  rotateRobot(deg: number, snap: boolean): void {
    const cc = this.world.chassisCenter();
    let th = this.world.pose.th;
    if (snap) { const q = Math.PI / 2; th = Math.round(th / q) * q + Math.sign(deg) * q; } else th += deg * Math.PI / 180;
    this.world.setChassisCenter(cc.x, cc.y, th);
    if (!this.dragging) this.world.resolveOverlap();
    this.world.trail = [];
    if (this.run.state !== 'running') this.scanNow();
  }
  beginDrag(): void { this.dragging = true; this.world.held = true; this.world.trail = []; }
  dragTo(x: number, y: number): void {
    const W = this.maze.cols * this.mz.cell, H = this.maze.rows * this.mz.cell;
    this.world.setChassisCenter(clamp(x, -20, W + 20), clamp(y, -20, H + 20), this.world.pose.th);
    if (this.run.state !== 'running') this.scanNow();
  }
  endDrag(): void {
    this.dragging = false; this.world.held = false;
    this.world.resolveOverlap(); this.world.lastContactT = this.world.t; this.world.trail = [];
    if (this.run.state !== 'running') this.scanNow();
  }
  backToStart(): void {
    this.world.resetPose(); this.world.goalReached = false;
    if (this.run.state === 'solved') this.run.state = 'idle';
    this.run.solved = null;
    if (this.run.state !== 'running') this.scanNow();
    this.emit();
  }
  insideGoal(): boolean {
    const g = this.maze.goal, c = this.mz.cell, cc = this.world.chassisCenter();
    return cc.x > g.c * c && cc.x < (g.c + g.w) * c && cc.y > g.r * c && cc.y < (g.r + g.h) * c;
  }

  /* ---------- build output ---------- */
  addOutput(entry: Omit<OutputEntry, 'id'>): void { this.output = [...this.output.slice(-199), { id: ++this.outputSeq, ...entry }]; }
  note(text: string): void { this.addOutput({ kind: 'note', text }); this.emit(); }
  clearOutput(): void { this.output = []; this.emit(); }
  jumpTo(file: string, line: number, col: number): void {
    this.activeFile = (FILES as readonly string[]).includes(file) ? file : this.activeFile;
    this.ui.tab = 'sketch';
    this.jump = { file, line, col, n: (this.jump?.n || 0) + 1 };
    this.emit();
  }

  /* ---------- compile & run ---------- */
  compile(files: SketchFiles): CompileResult {
    const holder: { mcu?: MCU } = {};
    const mcu = new MCU({
      world: this.world, wiring: clone(this.wiring), t0: this.world.t,
      onLog: (kind: string, msg: string, t: number) => { if (this.run.mcu === holder.mcu) this.runtimeLog(kind, msg, t); },
      onSerial: (text: string, t: number) => { if (this.run.mcu === holder.mcu) this.serial.push(text, t - holder.mcu!.t0, holder.mcu!.baud !== this.ui.baud); },
    });
    holder.mcu = mcu;
    const started = performance.now();
    try {
      const program = compileSketch(files, 'maze_solver.ino', mcu);
      return { ok: true, mcu, program, ms: performance.now() - started };
    } catch (err) {
      return { ok: false, err };
    }
  }

  report(res: CompileResult, mode: 'run' | 'verify'): res is CompileOk {
    this.output = []; this.marks = {};
    const mark = (file: string | undefined, line: number | undefined, kind: string) => { if (file && line) (this.marks[file] ||= []).push({ line, kind }); };
    if (!res.ok) {
      const e = res.err;
      if (e instanceof CompileError || (e as { line?: number })?.line !== undefined) {
        const err = e as InstanceType<typeof CompileError>;
        const file = err.file || 'maze_solver.ino';
        this.addOutput({ kind: 'error', file, line: err.line || 0, col: err.col || 0, text: err.message, sub: err.kind === 'link' ? 'This is a linker error: the code compiled, but a required part is missing.' : '' });
        mark(file, err.line, 'e');
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        this.addOutput({ kind: 'error', text: 'The simulator hit an internal problem compiling this sketch: ' + msg, sub: 'This is a bug in the simulator, not in your code.' });
        console.error(e);
      }
      this.addOutput({ kind: 'note', text: mode === 'run' ? 'Upload cancelled: fix the error above and try again.' : 'Compilation failed.' });
      return false;
    }
    const program = res.program;
    for (const w of program.warnings || []) { this.addOutput({ kind: 'warning', file: w.file, line: w.line, col: w.col, text: w.msg }); mark(w.file, w.line, 'w'); }
    const ram = program.ram;
    this.addOutput({ kind: 'ok', text: `Done compiling in ${Math.max(1, Math.round(res.ms ?? 0))} ms.`, sub: `Global variables use ${ram} bytes (${Math.round(ram / 2048 * 100)}%) of dynamic memory, leaving ${2048 - ram} bytes for local variables. Maximum is 2048 bytes.` });
    for (const text of mismatchNotes(findMismatches(this.files['config.h'] ?? '', { cell: this.mz.cell, robot: this.robot, wiring: this.wiring }))) this.addOutput({ kind: 'note', text });
    if (mode === 'run') this.addOutput({ kind: 'ok', text: 'Uploaded. The sketch is running on the simulated Uno.' });
    return true;
  }

  verify(): void {
    const res = this.compile(this.files);
    const ok = this.report(res, 'verify');
    if (this.run.state === 'idle' || this.run.state === 'error') this.run.state = ok ? 'idle' : 'error';
    this.emit();
  }

  uploadAndRun(): void {
    const files = clone(this.files);
    const res = this.compile(files);
    if (!this.report(res, 'run')) { if (!['running', 'paused'].includes(this.run.state)) this.run.state = 'error'; this.emit(); return; }
    this.run.files = files;
    this.start(res, false);
  }

  /** Press the Uno's reset button: restart the uploaded sketch, optionally from the start square. */
  restart(toStart: boolean): void {
    if (!this.run.files) return;
    const res = this.compile(this.run.files);
    if (!res.ok) { this.report(res, 'run'); this.emit(); return; }
    this.serial.endLine();
    this.start(res, toStart);
  }

  start(res: CompileOk, toStart: boolean): void {
    const w = this.world;
    if (toStart || w.goalReached || this.insideGoal()) w.resetPose();
    if (toStart) w.trail = [];
    w.goalReached = false; w.contacts = 0; w.odo = 0; w.lastContactT = w.t;
    Object.assign(this.run, { state: 'running', mcu: res.mcu, program: res.program.main(), startT: w.t, solved: null, overloaded: false });
    w.mcu = res.mcu;
    this.fire('started');
    this.emit();
  }

  togglePause(): void {
    if (this.run.state === 'running') this.run.state = 'paused';
    else if (this.run.state === 'paused') this.run.state = 'running';
    this.emit();
  }

  onGoal(t: number): void {
    if (this.run.state !== 'running') return;
    this.run.state = 'solved';
    this.run.solved = { seconds: (t - this.run.startT) / 1e6, contacts: this.world.contacts, metres: this.world.odo / 100 };
    this.world.mcu = null;
    this.emit();
  }

  fault(e: unknown): void {
    const mcu = this.run.mcu;
    const isFault = e instanceof RuntimeFault || (e as { kind?: string })?.kind === 'fault';
    this.run.state = 'fault'; this.world.mcu = null;
    const msg = e instanceof Error ? e.message : String(e);
    this.addOutput({ kind: 'fault', text: isFault ? msg : 'Simulator error: ' + msg, sub: `After ${formatTime(mcu ? mcu.t - mcu.t0 : 0)} of running. The Uno would reset or lock up here.` });
    if (!isFault) console.error(e);
    this.emit();
  }

  runtimeLog(kind: string, msg: string, t: number): void {
    const at = this.run.mcu ? formatTime(t - this.run.mcu.t0) : '';
    const m = /^([\w.]+\.(?:ino|h)):(\d+):\s*(.*)$/.exec(msg);
    const entry: OutputEntry = { id: 0, kind: kind === 'note' ? 'note' : 'warning', text: msg, sub: `Seen while running, at ${at}.` };
    if (m) { entry.file = m[1]!; entry.line = +m[2]!; entry.text = m[3]!; }
    this.addOutput(entry);
    this.emit();
  }

  sendSerial(text: string, lineEnd: UiState['lineEnd']): boolean {
    const mcu = this.run.mcu;
    if (!mcu || !['running', 'paused'].includes(this.run.state)) return false;
    const s = text + (lineEnd === 'nl' ? '\n' : lineEnd === 'crlf' ? '\r\n' : '');
    for (const ch of s) mcu.rx.push(ch.charCodeAt(0) & 255);
    if (mcu.rx.length > 64) mcu.rx.splice(0, mcu.rx.length - 64);
    return true;
  }

  /* ---------- per-frame step ---------- */
  /**
   * Advance the simulation by `dt` seconds of real time (times the speed setting).
   * The sketch runs until its virtual clock reaches the end of the frame, then the
   * physics catches up to the same moment.
   */
  tick(dt: number): void {
    const simUs = dt * this.ui.speed * 1e6;
    const w = this.world;
    if (this.run.state === 'running') {
      // 'running' implies both are set together by start(); see the invariant there.
      const mcu = this.run.mcu!, program = this.run.program!;
      mcu.frameEnd = w.t + simUs;
      mcu.deadline = performance.now() + 12;   // real-time budget per frame, in ms
      let over = false;
      try {
        while (mcu.t < mcu.frameEnd) {
          if (program.next().done) { this.run.state = 'idle'; w.mcu = null; this.emit(); return; }
          if (performance.now() > mcu.deadline) { over = true; break; }
          if (this.run.state !== 'running') return;
        }
      } catch (e) { this.fault(e); return; }
      w.syncTo(Math.min(mcu.frameEnd, mcu.t));
      this.run.overloaded = over;
    } else if (this.run.state !== 'paused') {
      w.syncTo(w.t + simUs);
      this.idleScan(dt);
    } else if (this.dragging) this.idleScan(dt);
  }

  /** With no sketch running, keep the sonars sampling so the beams show what the robot would see. */
  idleScan(dt: number): void {
    this.idleScanAcc += dt;
    if (this.idleScanAcc >= 0.07) this.scanNow();
  }
  scanNow(): void { this.idleScanAcc = 0; for (let i = 0; i < 3; i++) this.world.measureSonar(i, this.world.t); }

  /** Live numbers for the telemetry card, read a few times a second. */
  telemetry(): TelemetrySnapshot {
    const w = this.world, mcu = w.mcu;
    const motors = ([0, 1] as const).map(side => (mcu ? mcu.motorCmd(side) : { duty: 0, brake: 0, coast: true }));
    const pins: { state: string | null; level: number }[] = [];
    for (let p = 0; p < 20; p++) {
      let state: string | null = null, level = 1;
      if (mcu) {
        const P = mcu.pins[p]!;
        if (P.mode === 1) { if (P.pwm >= 0) { state = 'high'; level = Math.max(0.2, P.pwm / 255); } else if (P.out) state = 'high'; }
        else { const s = mcu.echoMap.get(p); if (s && mcu.t >= s.echoStart && mcu.t < s.echoEnd) state = 'echo'; }
      }
      pins.push({ state, level });
    }
    const r = w.cfg.wheelD / 2;
    return {
      t: w.t, readings: w.readings, motors, pins,
      speed: w.held ? 0 : Math.abs(r * (w.wl + w.wr) / 2),
      heading: ((90 - w.pose.th * 180 / Math.PI) % 360 + 360) % 360,
      contacts: w.contacts, metres: w.odo / 100,
      runState: this.run.state, runTime: w.t - this.run.startT, overloaded: this.run.overloaded,
      solvedSeconds: this.run.solved?.seconds,
      led13: !!(mcu && mcu.pins[13]!.mode === 1 && (mcu.pins[13]!.out || mcu.pins[13]!.pwm > 0)),
      tx: !!(mcu && mcu.serialOn && mcu.txEnd > mcu.t - 30000),
      baud: mcu && mcu.serialOn ? mcu.baud : null,
    };
  }
}
