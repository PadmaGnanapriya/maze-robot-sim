/**
 * Robot geometry, differential-drive physics with motor lag, wall collisions and the sonar cone raycaster.
 */
import { mulberry32, type Rng } from './random.js';
import type { Maze } from './maze.js';
import type { MCU } from './mcu.js';

/* ===================== Robot geometry ===================== */
export interface Robot {
  chassisL: number; chassisW: number; wheelD: number; wheelW: number; track: number; axleX: number;
  frontX: number; sideX: number; sideY: number; sideAngle: number;
  beamHalf: number; maxInc: number; noise: 'ideal' | 'realistic' | 'harsh';
  battery: number; drop: number; rpm6: number; deadband: number; tauMs: number; mismatch: number;
}
export interface Sonar { id: 'F' | 'L' | 'R'; trig: number; echo: number }
export interface Wiring {
  ENA: number; IN1: number; IN2: number; IN3: number; IN4: number; ENB: number;
  sonars: [Sonar, Sonar, Sonar];
  invertL: boolean; invertR: boolean; jumpers: boolean;
}

export const DEFAULT_ROBOT: Robot = {
  chassisL: 20, chassisW: 15, wheelD: 6.5, wheelW: 2.6, track: 16.6, axleX: -2.5,
  frontX: 10.4, sideX: 4.5, sideY: 7.5, sideAngle: 90,
  beamHalf: 12, maxInc: 65, noise: 'realistic',
  battery: 12.0, drop: 2.0, rpm6: 170, deadband: 1.3, tauMs: 90, mismatch: 3,
};
export const DEFAULT_WIRING: Wiring = {
  ENA: 5, IN1: 6, IN2: 7, IN3: 8, IN4: 9, ENB: 10,
  sonars: [{ id: 'F', trig: 2, echo: 3 }, { id: 'L', trig: 4, echo: 11 }, { id: 'R', trig: 12, echo: 13 }],
  invertL: false, invertR: false, jumpers: false,
};

export interface SensorPoint { id: 'F' | 'L' | 'R'; x: number; y: number; a: number }
export interface Circle { x: number; y: number; r: number }
export interface RobotGeometry { cx: number; sensors: SensorPoint[]; circles: Circle[]; reach: number; width: number; casterX: number }

export function robotGeometry(cfg: Robot): RobotGeometry {
  const cx = -cfg.axleX; // chassis centre relative to the axle midpoint (robot frame: +x forward, +y left)
  const sa = cfg.sideAngle * Math.PI / 180;
  const sensors: SensorPoint[] = [
    { id: 'F', x: cx + cfg.frontX, y: 0, a: 0 },
    { id: 'L', x: cx + cfg.sideX, y: cfg.sideY, a: sa },
    { id: 'R', x: cx + cfg.sideX, y: -cfg.sideY, a: -sa },
  ];
  const circles: Circle[] = [];
  const L = cfg.chassisL, W = cfg.chassisW;
  const r0 = Math.min(L, W) / 2;
  const span = Math.max(0, L / 2 - r0);
  const n = Math.max(1, Math.ceil(span * 2 / 2.5) + 1);
  for (let i = 0; i < n; i++) circles.push({ x: cx - span + (n === 1 ? span : (2 * span * i) / (n - 1)), y: 0, r: r0 });
  for (const s of [-1, 1]) {
    const rr = cfg.wheelW / 2, h = cfg.wheelD / 2 - rr;
    for (const k of [-1, 0, 1]) circles.push({ x: k * h, y: s * cfg.track / 2, r: rr });
  }
  circles.push({ x: cx + cfg.frontX - 0.6, y: 1.8, r: 0.9 }, { x: cx + cfg.frontX - 0.6, y: -1.8, r: 0.9 });
  let reach = 0; for (const c of circles) reach = Math.max(reach, Math.hypot(c.x, c.y) + c.r);
  const width = Math.max(W, cfg.track + cfg.wheelW);
  const casterX = cfg.axleX <= 0 ? cx + L / 2 - 3 : cx - L / 2 + 3;
  return { cx, sensors, circles, reach, width, casterX };
}

/* ===================== Physics world ===================== */
export interface Pose { x: number; y: number; th: number }
interface Wall { x0: number; x1: number; y0: number; y1: number }
interface RayHit { d: number; nx: number; ny: number }
export interface SensorReading { d: number | null; t: number; x: number; y: number; a: number; a0: number; raw: number | null }

export class World {
  cfg: Robot;
  geo: RobotGeometry;
  pose: Pose;
  wl = 0; wr = 0; angL = 0; angR = 0;
  t = 0;
  mcu: MCU | null = null;
  held = false;
  contacts = 0; inContact = false; lastContactT = -1e12; contactFlash = 0;
  trail: { x: number; y: number }[] = []; trailDist = 0;
  goalReached = false;
  onGoal: ((t: number) => void) | null = null;
  onContact: ((contacts: number) => void) | null = null;
  readings: (SensorReading | null)[] = [null, null, null];
  walls: Wall[] = [];
  buckets: number[][] | null = null;
  casterAng = 0; odo = 0;
  rng: Rng;
  maze!: Maze;
  cell!: number;
  wallT!: number;

  constructor() {
    this.cfg = Object.assign({}, DEFAULT_ROBOT);
    this.geo = robotGeometry(this.cfg);
    this.pose = { x: 0, y: 0, th: 0 };
    this.rng = mulberry32(99);
  }
  setRobot(cfg: Partial<Robot>): void { this.cfg = Object.assign({}, DEFAULT_ROBOT, cfg); this.geo = robotGeometry(this.cfg); }
  setMaze(maze: Maze, cell: number, wallT: number): void {
    this.maze = maze; this.cell = cell; this.wallT = wallT;
    const walls: Wall[] = []; const C = maze.cols, R = maze.rows, h = wallT / 2;
    for (let r = 0; r <= R; r++) for (let c = 0; c < C; c++) if (maze.h[r * C + c]) walls.push({ x0: c * cell - h, x1: (c + 1) * cell + h, y0: r * cell - h, y1: r * cell + h });
    for (let r = 0; r < R; r++) for (let c = 0; c <= C; c++) if (maze.v[r * (C + 1) + c]) walls.push({ x0: c * cell - h, x1: c * cell + h, y0: r * cell - h, y1: (r + 1) * cell + h });
    this.walls = walls;
    const reach = 14;
    const buckets: number[][] = [];
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      const bx0 = c * cell - cell * 0.5 - reach, bx1 = (c + 1) * cell + cell * 0.5 + reach, by0 = r * cell - cell * 0.5 - reach, by1 = (r + 1) * cell + cell * 0.5 + reach;
      const list: number[] = [];
      walls.forEach((w, i) => { if (w.x1 >= bx0 && w.x0 <= bx1 && w.y1 >= by0 && w.y0 <= by1) list.push(i); });
      buckets.push(list);
    }
    this.buckets = buckets;
  }
  nearWalls(x: number, y: number): number[] | null {
    const c = Math.floor(x / this.cell), r = Math.floor(y / this.cell);
    if (!this.buckets || c < 0 || r < 0 || c >= this.maze.cols || r >= this.maze.rows || this.geo.reach > this.cell * 0.9) return null;
    return this.buckets[r * this.maze.cols + c] ?? null;
  }
  startPose(): Pose {
    const m = this.maze, s = m.start;
    const th = [Math.PI / 2, 0, -Math.PI / 2, Math.PI][s.dir]!;
    const ccx = (s.c + 0.5) * this.cell, ccy = (s.r + 0.5) * this.cell;
    // place the axle so that the robot sits centred in the cell
    const back = this.geo.cx * 0.6;
    return { x: ccx - Math.cos(th) * back, y: ccy - Math.sin(th) * back, th };
  }
  resetPose(): void {
    const p = this.startPose();
    this.pose = p; this.wl = this.wr = 0; this.trail = [{ x: p.x, y: p.y }]; this.trailDist = 0;
    this.goalReached = false; this.contacts = 0; this.inContact = false; this.lastContactT = -1e12; this.odo = 0;
    this.readings = [null, null, null];
  }
  chassisCenter(p?: Pose): { x: number; y: number } { p = p || this.pose; const c = this.geo.cx; return { x: p.x + Math.cos(p.th) * c, y: p.y + Math.sin(p.th) * c }; }
  setChassisCenter(x: number, y: number, th: number): void { const c = this.geo.cx; this.pose = { x: x - Math.cos(th) * c, y: y - Math.sin(th) * c, th }; }
  syncTo(t: number): void {
    let guard = 0;
    while (this.t < t - 1e-6 && guard++ < 200000) {
      const dt = Math.min(1000, t - this.t);
      this.step(dt * 1e-6);
      this.t += dt;
    }
    if (this.t < t) this.t = t;
  }
  motorStep(dt: number): void {
    const cfg = this.cfg;
    const kw = (cfg.rpm6 / Math.max(0.5, 6 - cfg.deadband)) * 2 * Math.PI / 60;
    const vmax = Math.max(0, cfg.battery - cfg.drop);
    for (let side = 0; side < 2; side++) {
      const cmd = this.mcu ? this.mcu.motorCmd(side as 0 | 1) : { duty: 0, brake: 0, coast: true };
      const V = cmd.duty * vmax;
      let target = 0, tau;
      const trim = side === 1 ? (1 - cfg.mismatch / 100) : 1;
      if (Math.abs(V) > cfg.deadband) { target = Math.sign(V) * (Math.abs(V) - cfg.deadband) * kw * trim; tau = cfg.tauMs / 1000; }
      else if (cmd.brake > 0) tau = 0.035;
      else if (V !== 0) tau = 0.1;
      else tau = cmd.coast ? 0.28 : 0.12;
      const a = 1 - Math.exp(-dt / Math.max(0.005, tau));
      if (side === 0) this.wl += (target - this.wl) * a; else this.wr += (target - this.wr) * a;
    }
  }
  step(dt: number): void {
    this.motorStep(dt);
    const r = this.cfg.wheelD / 2;
    this.angL += this.wl * dt; this.angR += this.wr * dt;
    if (this.held) return;
    const v = r * (this.wl + this.wr) / 2, w = r * (this.wr - this.wl) / this.cfg.track;
    const p = this.pose;
    const thm = p.th + w * dt / 2;
    p.x += v * Math.cos(thm) * dt; p.y += v * Math.sin(thm) * dt; p.th += w * dt;
    if (p.th > Math.PI) p.th -= 2 * Math.PI; else if (p.th < -Math.PI) p.th += 2 * Math.PI;
    this.odo += Math.abs(v * dt);
    // caster swivel follows the local velocity at the caster
    const vx = v, vy = w * this.geo.casterX;
    if (Math.abs(vx) + Math.abs(vy) > 0.5) {
      const target = Math.atan2(vy, vx);
      let d = target - this.casterAng; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      this.casterAng += d * Math.min(1, dt * 12);
    }
    const hit = this.collide();
    if (hit) {
      if (!this.inContact && this.t - this.lastContactT > 250000) { this.contacts++; this.contactFlash = 1; if (this.onContact) this.onContact(this.contacts); }
      this.lastContactT = this.t;
    }
    this.inContact = hit;
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1.5) { this.trail.push({ x: p.x, y: p.y }); if (this.trail.length > 8000) this.trail.splice(0, 2000); }
    this.checkGoal();
  }
  checkGoal(): void {
    if (this.goalReached || !this.maze) return;
    const g = this.maze.goal, c = this.cell, cc = this.chassisCenter();
    if (cc.x > g.c * c && cc.x < (g.c + g.w) * c && cc.y > g.r * c && cc.y < (g.r + g.h) * c) {
      this.goalReached = true; if (this.onGoal) this.onGoal(this.t);
    }
  }
  collide(): boolean {
    let any = false;
    const walls = this.walls, near = this.nearWalls(this.pose.x, this.pose.y);
    const list = near || null;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const p = this.pose, cs = Math.cos(p.th), sn = Math.sin(p.th);
      for (const ci of this.geo.circles) {
        const px = p.x + cs * ci.x - sn * ci.y, py = p.y + sn * ci.x + cs * ci.y, rad = ci.r;
        const n = list ? list.length : walls.length;
        for (let k = 0; k < n; k++) {
          const w = walls[list ? list[k]! : k]!;
          if (px + rad < w.x0 || px - rad > w.x1 || py + rad < w.y0 || py - rad > w.y1) continue;
          const qx = px < w.x0 ? w.x0 : px > w.x1 ? w.x1 : px, qy = py < w.y0 ? w.y0 : py > w.y1 ? w.y1 : py;
          const dx = px - qx, dy = py - qy; const d2 = dx * dx + dy * dy;
          if (d2 >= rad * rad) continue;
          let nx, ny, pen;
          if (d2 > 1e-10) { const d = Math.sqrt(d2); nx = dx / d; ny = dy / d; pen = rad - d; }
          else {
            const l = px - w.x0, rr = w.x1 - px, b = py - w.y0, t = w.y1 - py, m = Math.min(l, rr, b, t);
            if (m === l) { nx = -1; ny = 0; } else if (m === rr) { nx = 1; ny = 0; } else if (m === b) { nx = 0; ny = -1; } else { nx = 0; ny = 1; }
            pen = m + rad;
          }
          const push = pen + 0.001;
          p.x += nx * push; p.y += ny * push;
          // gentle rotation from off-centre contacts (robot aligns with the wall it scrapes)
          const rx = px - p.x, ry = py - p.y;
          const torque = (rx * ny - ry * nx) * push;
          p.th += 0.12 * torque / (rx * rx + ry * ry + 30);
          any = true; moved = true;
          this.wl *= 0.985; this.wr *= 0.985;
          break;
        }
        if (moved) break;
      }
      if (!moved) break;
    }
    return any;
  }
  resolveOverlap(): void { this.collide(); this.collide(); this.collide(); }
  rayCast(ox: number, oy: number, dx: number, dy: number, maxD: number): RayHit | null {
    if (Math.abs(dx) < 1e-9) dx = 1e-9; if (Math.abs(dy) < 1e-9) dy = 1e-9;
    const ix = 1 / dx, iy = 1 / dy;
    let best = maxD, bnx = 0, bny = 0, found = false;
    const walls = this.walls;
    for (let k = 0; k < walls.length; k++) {
      const w = walls[k]!;
      let t1 = (w.x0 - ox) * ix, t2 = (w.x1 - ox) * ix;
      const txn = t1 < t2 ? t1 : t2, txf = t1 < t2 ? t2 : t1;
      t1 = (w.y0 - oy) * iy; t2 = (w.y1 - oy) * iy;
      const tyn = t1 < t2 ? t1 : t2, tyf = t1 < t2 ? t2 : t1;
      const tn = txn > tyn ? txn : tyn, tf = txf < tyf ? txf : tyf;
      if (tn > tf || tf < 0) continue;
      const t = tn > 0 ? tn : 0;
      if (t < best) { best = t; found = true; if (txn > tyn) { bnx = dx > 0 ? -1 : 1; bny = 0; } else { bnx = 0; bny = dy > 0 ? -1 : 1; } }
    }
    return found ? { d: best, nx: bnx, ny: bny } : null;
  }
  sensorPose(i: number): { x: number; y: number; a: number } {
    const s = this.geo.sensors[i]!, p = this.pose, cs = Math.cos(p.th), sn = Math.sin(p.th);
    return { x: p.x + cs * s.x - sn * s.y, y: p.y + sn * s.x + cs * s.y, a: p.th + s.a };
  }
  measureSonar(i: number, t: number, noNoise?: boolean): number | null {
    const sp = this.sensorPose(i), cfg = this.cfg;
    const mode = noNoise ? 'ideal' : cfg.noise;
    const half = cfg.beamHalf * Math.PI / 180, maxInc = Math.cos(cfg.maxInc * Math.PI / 180);
    const N = mode === 'ideal' ? 1 : 9;
    let best: number | null = null, bestA = 0;
    for (let k = 0; k < N; k++) {
      const off = N === 1 ? 0 : -half + (2 * half * k) / (N - 1);
      const a = sp.a + off, dx = Math.cos(a), dy = Math.sin(a);
      const h = this.rayCast(sp.x, sp.y, dx, dy, 420);
      if (!h) continue;
      if (mode !== 'ideal' && h.d > 0.3) { const ci = Math.abs(dx * h.nx + dy * h.ny); if (ci < maxInc) continue; }
      if (best === null || h.d < best) { best = h.d; bestA = a; }
    }
    let d = best;
    if (d !== null) {
      if (d > 400) d = null;
      else {
        if (mode !== 'ideal') {
          const g = (this.rng() + this.rng() + this.rng() - 1.5) * 1.41;
          const sigma = mode === 'harsh' ? 0.6 + 0.012 * d : 0.25 + 0.005 * d;
          d += g * sigma;
          const drop = mode === 'harsh' ? 0.02 : 0.004;
          if (this.rng() < drop) d = null;
        }
        if (d !== null && d < 2) d = 2 + this.rng() * 0.6;
      }
    }
    this.readings[i] = { d, t, x: sp.x, y: sp.y, a: best !== null ? bestA : sp.a, a0: sp.a, raw: best };
    return d;
  }
}
