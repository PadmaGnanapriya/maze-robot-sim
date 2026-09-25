/**
 * Typed shapes for everything the app persists (localStorage today; the same
 * validators are meant to guard any future shared/URL-borne settings payload).
 *
 * Every `sanitize*` function takes `unknown` and returns a value that is always
 * safe to hand to the engine and to three.js: finite numbers clamped to the
 * range the settings UI itself allows, known enum values only, correct shapes.
 * Anything that doesn't fit falls back to the matching field in DEFAULTS
 * instead of failing the whole load - one bad field should not blank the app.
 */
import { DEFAULT_ROBOT, DEFAULT_WIRING, type Robot, type Wiring, type Sonar } from '../engine/world.js';
import type { MazeJSON, MazeType, GoalMode } from '../engine/maze.js';

// Robot/Wiring/Sonar/MazeType/GoalMode are engine/world.ts's and engine/maze.ts's
// canonical shapes (world.ts owns DEFAULT_ROBOT/DEFAULT_WIRING); re-exported here so
// sim/ and components/ can import them from settings.ts alongside the sanitize*
// functions that validate them, without reaching into engine/ directly.
export type { Robot, Wiring, Sonar, MazeType, GoalMode };

export interface MazeCfg {
  type: MazeType; seed: number; cols: number; rows: number;
  cell: number; wallT: number; wallH: number;
  goalMode: GoalMode; goalSize: 1 | 2;
}

export type CameraView = 'orbit' | 'top' | 'follow' | 'pov';
export type PanelTab = 'sketch' | 'serial' | 'robot' | 'maze' | 'wiring';
export type LineEnd = 'nl' | 'crlf' | 'none';

export interface UiState {
  speed: number; view: CameraView; hud: boolean; hudSet: boolean; beams: boolean; trail: boolean;
  baud: number; timestamps: boolean; autoscroll: boolean; panelW: number; tab: PanelTab;
  lineEnd: LineEnd; introSeen: boolean;
}

export type SketchFiles = Record<string, string>;

export const DEFAULT_MAZE_CFG: MazeCfg = {
  type: 'backtracker', seed: 1, cols: 6, rows: 6, cell: 40, wallT: 1.2, wallH: 15, goalMode: 'corner', goalSize: 1,
};
export const DEFAULT_UI: UiState = {
  speed: 1, view: 'orbit', hud: true, hudSet: false, beams: true, trail: true, baud: 115200,
  timestamps: false, autoscroll: true, panelW: 500, tab: 'sketch', lineEnd: 'nl', introSeen: false,
};

/* ------------------------------ primitive guards ------------------------------ */

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function num(v: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
function int(v: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  return Math.round(num(v, fallback, min, max));
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}
function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : fallback;
}

/* ------------------------------ per-domain sanitizers ------------------------------ */

/** Ranges mirror the <NumberField min max> props in RobotSettings.jsx. */
export function sanitizeRobot(raw: unknown): Robot {
  const r = isRecord(raw) ? raw : {};
  const d = DEFAULT_ROBOT;
  return {
    chassisL: num(r.chassisL, d.chassisL, 12, 32), chassisW: num(r.chassisW, d.chassisW, 9, 26),
    wheelD: num(r.wheelD, d.wheelD, 3, 12), wheelW: num(r.wheelW, d.wheelW, 1, 5),
    track: num(r.track, d.track, 8, 30), axleX: num(r.axleX, d.axleX, -10, 10),
    frontX: num(r.frontX, d.frontX, 2, 20), sideX: num(r.sideX, d.sideX, -10, 14), sideY: num(r.sideY, d.sideY, 3, 14),
    sideAngle: num(r.sideAngle, d.sideAngle, 30, 90),
    beamHalf: num(r.beamHalf, d.beamHalf, 1, 30), maxInc: num(r.maxInc, d.maxInc, 15, 89),
    noise: oneOf(r.noise, ['ideal', 'realistic', 'harsh'], d.noise),
    battery: num(r.battery, d.battery, 4, 14), drop: num(r.drop, d.drop, 0, 4),
    rpm6: num(r.rpm6, d.rpm6, 40, 400), deadband: num(r.deadband, d.deadband, 0, 4),
    tauMs: num(r.tauMs, d.tauMs, 10, 400), mismatch: num(r.mismatch, d.mismatch, -20, 20),
  };
}

function sanitizeSonar(raw: unknown, fallback: Sonar): Sonar {
  const r = isRecord(raw) ? raw : {};
  return { id: fallback.id, trig: int(r.trig, fallback.trig, 0, 19), echo: int(r.echo, fallback.echo, 0, 19) };
}

/** Pins are Uno digital/analog pins, 0-19 (D0-D13, A0-A5); everything else is a boolean or a fixed-length sonar triplet. */
export function sanitizeWiring(raw: unknown): Wiring {
  const r = isRecord(raw) ? raw : {};
  const d = DEFAULT_WIRING;
  const sonars = Array.isArray(r.sonars) ? r.sonars : [];
  return {
    ENA: int(r.ENA, d.ENA, 0, 19), IN1: int(r.IN1, d.IN1, 0, 19), IN2: int(r.IN2, d.IN2, 0, 19),
    IN3: int(r.IN3, d.IN3, 0, 19), IN4: int(r.IN4, d.IN4, 0, 19), ENB: int(r.ENB, d.ENB, 0, 19),
    sonars: [
      sanitizeSonar(sonars[0], d.sonars[0]), sanitizeSonar(sonars[1], d.sonars[1]), sanitizeSonar(sonars[2], d.sonars[2]),
    ],
    invertL: bool(r.invertL, d.invertL), invertR: bool(r.invertR, d.invertR), jumpers: bool(r.jumpers, d.jumpers),
  };
}

/** Ranges mirror the <NumberField min max> props in MazeSettings.jsx. */
export function sanitizeMazeCfg(raw: unknown): MazeCfg {
  const r = isRecord(raw) ? raw : {};
  const d = DEFAULT_MAZE_CFG;
  return {
    type: oneOf(r.type, ['backtracker', 'prim', 'braid', 'arena'], d.type),
    seed: int(r.seed, d.seed, 1, 99999),
    cols: int(r.cols, d.cols, 3, 14), rows: int(r.rows, d.rows, 3, 14),
    cell: num(r.cell, d.cell, 22, 90), wallT: num(r.wallT, d.wallT, 0.4, 4), wallH: num(r.wallH, d.wallH, 5, 40),
    goalMode: oneOf(r.goalMode, ['corner', 'center', 'random'], d.goalMode),
    goalSize: int(r.goalSize, d.goalSize, 1, 2) === 2 ? 2 : 1,
  };
}

/** Ranges mirror the controls in TopBar.jsx / SerialMonitor.jsx / Panel.jsx. */
export function sanitizeUi(raw: unknown): UiState {
  const r = isRecord(raw) ? raw : {};
  const d = DEFAULT_UI;
  return {
    speed: num(r.speed, d.speed, 0.1, 20),
    view: oneOf(r.view, ['orbit', 'top', 'follow', 'pov'], d.view),
    hud: bool(r.hud, d.hud), hudSet: bool(r.hudSet, d.hudSet), beams: bool(r.beams, d.beams), trail: bool(r.trail, d.trail),
    baud: int(r.baud, d.baud, 300, 2000000),
    timestamps: bool(r.timestamps, d.timestamps), autoscroll: bool(r.autoscroll, d.autoscroll),
    panelW: int(r.panelW, d.panelW, 340, 4000),
    tab: oneOf(r.tab, ['sketch', 'serial', 'robot', 'maze', 'wiring'], d.tab),
    lineEnd: oneOf(r.lineEnd, ['nl', 'crlf', 'none'], d.lineEnd),
    introSeen: bool(r.introSeen, d.introSeen),
  };
}

/** Every entry must be a string (the editor renders it directly); anything else falls back per-file. */
export function sanitizeFiles(raw: unknown, fileNames: readonly string[], defaults: SketchFiles): SketchFiles {
  const r = isRecord(raw) ? raw : {};
  return Object.fromEntries(fileNames.map(name => [name, typeof r[name] === 'string' ? (r[name] as string) : (defaults[name] ?? '')]));
}

/** A saved Maze.toJSON() blob: only trusted once cols/rows match the (already-sanitized) MazeCfg. */
export function sanitizeMazeJSON(raw: unknown, cols: number, rows: number): MazeJSON | null {
  if (!isRecord(raw) || raw.cols !== cols || raw.rows !== rows) return null;
  const hLen = (rows + 1) * cols, vLen = rows * (cols + 1);
  const h = typeof raw.h === 'string' && raw.h.length === hLen && /^[01]*$/.test(raw.h) ? raw.h : null;
  const v = typeof raw.v === 'string' && raw.v.length === vLen && /^[01]*$/.test(raw.v) ? raw.v : null;
  if (!h || !v) return null;
  const s = isRecord(raw.start) ? raw.start : {};
  const g = isRecord(raw.goal) ? raw.goal : {};
  return {
    cols, rows, h, v,
    start: { c: int(s.c, 0, 0, cols - 1), r: int(s.r, 0, 0, rows - 1), dir: int(s.dir, 0, 0, 3) },
    goal: {
      c: int(g.c, cols - 1, 0, cols - 1), r: int(g.r, rows - 1, 0, rows - 1),
      w: int(g.w, 1, 1, cols), h: int(g.h, 1, 1, rows),
    },
  };
}
