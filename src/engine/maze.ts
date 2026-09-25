/**
 * Maze grid (walls on cell edges), maze generators and goal placement.
 */
import { mulberry32, type Rng } from './random.js';

/* ===================== Maze model & generators ===================== */
const DX = [0, 1, 0, -1], DY = [1, 0, -1, 0]; // dir: 0=N(+y) 1=E(+x) 2=S(-y) 3=W(-x)

export type MazeType = 'backtracker' | 'prim' | 'braid' | 'arena';
export type GoalMode = 'corner' | 'center' | 'random';
export interface StartPos { c: number; r: number; dir: number }
export interface GoalRect { c: number; r: number; w: number; h: number }
export interface MazeJSON { cols: number; rows: number; h: string; v: string; start: StartPos; goal: GoalRect }

export class Maze {
  cols: number;
  rows: number;
  h: Uint8Array;   // horizontal edges: h[r*cols+c] is the wall at y=r between x=c..c+1
  v: Uint8Array;   // vertical edges:   v[r*(cols+1)+c] is the wall at x=c between y=r..r+1
  start: StartPos;
  goal: GoalRect;

  constructor(cols: number, rows: number) {
    this.cols = cols; this.rows = rows;
    this.h = new Uint8Array((rows + 1) * cols);
    this.v = new Uint8Array(rows * (cols + 1));
    this.start = { c: 0, r: 0, dir: 0 };
    this.goal = { c: cols - 1, r: rows - 1, w: 1, h: 1 };
  }
  wall(c: number, r: number, d: number): number {
    const C = this.cols;
    switch (d) {
      case 0: return this.h[(r + 1) * C + c]!;
      case 1: return this.v[r * (C + 1) + c + 1]!;
      case 2: return this.h[r * C + c]!;
      default: return this.v[r * (C + 1) + c]!;
    }
  }
  setWall(c: number, r: number, d: number, val: number): void {
    const C = this.cols; val = val ? 1 : 0;
    switch (d) {
      case 0: this.h[(r + 1) * C + c] = val; break;
      case 1: this.v[r * (C + 1) + c + 1] = val; break;
      case 2: this.h[r * C + c] = val; break;
      default: this.v[r * (C + 1) + c] = val;
    }
  }
  inside(c: number, r: number): boolean { return c >= 0 && r >= 0 && c < this.cols && r < this.rows; }
  fill(val: number): void { this.h.fill(val ? 1 : 0); this.v.fill(val ? 1 : 0); }
  border(): void {
    const C = this.cols, R = this.rows;
    for (let c = 0; c < C; c++) { this.h[c] = 1; this.h[R * C + c] = 1; }
    for (let r = 0; r < R; r++) { this.v[r * (C + 1)] = 1; this.v[r * (C + 1) + C] = 1; }
  }
  isBorderEdge(kind: 'h' | 'v', idx: number): boolean {
    const C = this.cols, R = this.rows;
    if (kind === 'h') { const r = Math.floor(idx / C); return r === 0 || r === R; }
    const c = idx % (C + 1); return c === 0 || c === C;
  }
  toJSON(): MazeJSON { return { cols: this.cols, rows: this.rows, h: Array.from(this.h).join(''), v: Array.from(this.v).join(''), start: this.start, goal: this.goal }; }
  static fromJSON(o: MazeJSON): Maze {
    const m = new Maze(o.cols, o.rows);
    for (let i = 0; i < m.h.length; i++) m.h[i] = o.h[i] === '1' ? 1 : 0;
    for (let i = 0; i < m.v.length; i++) m.v[i] = o.v[i] === '1' ? 1 : 0;
    if (o.start) m.start = Object.assign({}, o.start);
    if (o.goal) m.goal = Object.assign({}, o.goal);
    return m;
  }
  deadEnds(): [number, number][] {
    const out: [number, number][] = [];
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) { let n = 0; for (let d = 0; d < 4; d++) n += this.wall(c, r, d); if (n === 3) out.push([c, r]); }
    return out;
  }
}

function genBacktracker(m: Maze, rng: Rng): void {
  m.fill(1);
  const seen = new Uint8Array(m.cols * m.rows);
  const stack: [number, number][] = [[0, 0]]; seen[0] = 1;
  while (stack.length) {
    const [c, r] = stack[stack.length - 1]!;
    const opts: number[] = [];
    for (let d = 0; d < 4; d++) { const nc = c + DX[d]!, nr = r + DY[d]!; if (m.inside(nc, nr) && !seen[nr * m.cols + nc]) opts.push(d); }
    if (!opts.length) { stack.pop(); continue; }
    const d = opts[Math.floor(rng() * opts.length)]!;
    m.setWall(c, r, d, 0);
    const nc = c + DX[d]!, nr = r + DY[d]!; seen[nr * m.cols + nc] = 1; stack.push([nc, nr]);
  }
}
function genPrim(m: Maze, rng: Rng): void {
  m.fill(1);
  const inMaze = new Uint8Array(m.cols * m.rows);
  const frontier: [number, number, number][] = [];
  const add = (c: number, r: number) => { inMaze[r * m.cols + c] = 1; for (let d = 0; d < 4; d++) { const nc = c + DX[d]!, nr = r + DY[d]!; if (m.inside(nc, nr) && !inMaze[nr * m.cols + nc]) frontier.push([c, r, d]); } };
  add(Math.floor(rng() * m.cols), Math.floor(rng() * m.rows));
  while (frontier.length) {
    const i = Math.floor(rng() * frontier.length);
    const [c, r, d] = frontier[i]!; frontier[i] = frontier[frontier.length - 1]!; frontier.pop();
    const nc = c + DX[d]!, nr = r + DY[d]!;
    if (inMaze[nr * m.cols + nc]) continue;
    m.setWall(c, r, d, 0); add(nc, nr);
  }
}
function braidMaze(m: Maze, rng: Rng, p: number): void {
  for (const [c, r] of m.deadEnds()) {
    if (rng() > p) continue;
    const opts: number[] = [];
    for (let d = 0; d < 4; d++) { const nc = c + DX[d]!, nr = r + DY[d]!; if (m.inside(nc, nr) && m.wall(c, r, d)) opts.push(d); }
    if (opts.length) m.setWall(c, r, opts[Math.floor(rng() * opts.length)]!, 0);
  }
}
export function generateMaze(type: MazeType, cols: number, rows: number, seed: number, goalMode?: GoalMode): Maze {
  const rng = mulberry32(seed >>> 0);
  const m = new Maze(cols, rows);
  if (type === 'prim') genPrim(m, rng);
  else if (type === 'arena') { m.fill(0); }
  else { genBacktracker(m, rng); if (type === 'braid') braidMaze(m, rng, 0.6); }
  m.border();
  m.start = { c: 0, r: 0, dir: m.wall(0, 0, 0) ? 1 : 0 };
  placeGoal(m, goalMode || 'corner', rng);
  return m;
}
export function placeGoal(m: Maze, mode: GoalMode, rng?: Rng): void {
  if (mode === 'center') {
    const w = m.cols % 2 === 0 ? 2 : 1, h = m.rows % 2 === 0 ? 2 : 1;
    m.goal = { c: Math.floor((m.cols - w) / 2), r: Math.floor((m.rows - h) / 2), w, h };
  } else if (mode === 'random') {
    let c = 0, r = 0, guard = 0;
    do { c = Math.floor((rng ? rng() : Math.random()) * m.cols); r = Math.floor((rng ? rng() : Math.random()) * m.rows); } while (c + r < Math.min(m.cols, m.rows) && guard++ < 50);
    m.goal = { c, r, w: 1, h: 1 };
  } else m.goal = { c: m.cols - 1, r: m.rows - 1, w: 1, h: 1 };
}

export { DX, DY, genBacktracker, genPrim, braidMaze };
