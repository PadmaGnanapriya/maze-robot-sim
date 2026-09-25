/**
 * Four camera views: orbit around the maze, a straight-down plan, a chase camera
 * and the robot's own view from the front sonar. Moves between views are eased
 * (unless the user prefers reduced motion).
 */
import * as THREE from 'three';
import type { CameraView } from '../sim/settings.js';
import type { World } from '../engine/world.js';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const V_HALF = 21 * Math.PI / 180;   // half of the 42 degree vertical field of view

export class CameraRig {
  camera: THREE.PerspectiveCamera;
  reduceMotion: boolean;
  mode: CameraView = 'orbit';
  target = new THREE.Vector3();      // orbit pivot
  topTarget = new THREE.Vector3();   // plan view centre
  dist = 400; az = -0.5; el = 0.95;
  topDist = 400;
  follow = { az: 0, el: 0.82, dist: 80 };
  pov = { yaw: 0, pitch: -0.12 };
  pos = new THREE.Vector3(); look = new THREE.Vector3(); up = new THREE.Vector3(0, 1, 0);
  snapNext = true;
  private _p = new THREE.Vector3(); private _l = new THREE.Vector3(); private _u = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, reduceMotion: boolean) {
    this.camera = camera;
    this.reduceMotion = reduceMotion;
  }

  setMode(mode: CameraView): void {
    this.mode = mode;
    if (mode === 'pov') this.pov = { yaw: 0, pitch: -0.12 };
  }

  /**
   * Frame the whole maze. `reserveLeft` is the width in pixels covered by the
   * telemetry card, so the maze is centred in the space that is left.
   */
  fit(mazeW: number, mazeH: number, viewW: number, viewH: number, reserveLeft = 0): { fogNear: number; fogFar: number } {
    this.target.set(mazeW / 2, 0, -mazeH / 2);
    this.topTarget.set(mazeW / 2, 0, -mazeH / 2);
    const aspect = Math.max(0.4, (viewW - reserveLeft) / viewH);
    const hHalf = Math.atan(Math.tan(V_HALF) * aspect);
    const radius = Math.hypot(mazeW, mazeH) / 2 + 16;
    this.dist = radius / Math.sin(Math.min(V_HALF, hHalf)) * 0.9;
    this.topDist = Math.max(mazeH / 2 / Math.tan(V_HALF), mazeW / 2 / Math.tan(hHalf)) * 1.1 + 20;
    if (reserveLeft) {
      const shift = reserveLeft / 2 * (2 * this.dist * Math.tan(V_HALF) / viewH);
      this.target.x -= Math.cos(this.az) * shift; this.target.z += Math.sin(this.az) * shift;
      this.topTarget.x -= reserveLeft / 2 * (2 * this.topDist * Math.tan(V_HALF) / viewH);
    }
    return { fogNear: this.dist * 1.4, fogFar: this.dist * 3.2 };
  }

  /** Mouse or finger drag: orbit, look around, or swing the chase camera. */
  rotate(dx: number, dy: number): void {
    if (this.mode === 'follow') { this.follow.az -= dx * 0.006; this.follow.el = clamp(this.follow.el + dy * 0.005, 0.08, 1.45); }
    else if (this.mode === 'pov') { this.pov.yaw = clamp(this.pov.yaw - dx * 0.004, -1.6, 1.6); this.pov.pitch = clamp(this.pov.pitch + dy * 0.003, -0.9, 0.5); }
    else if (this.mode === 'orbit') { this.az -= dx * 0.006; this.el = clamp(this.el + dy * 0.005, 0.1, 1.52); this.snapNext = true; }
  }

  pan(dx: number, dy: number, viewH: number, bounds: { w: number; h: number }): void {
    if (this.mode === 'follow' || this.mode === 'pov') return;
    const dist = this.mode === 'top' ? this.topDist : this.dist;
    const unitsPerPx = 2 * dist * Math.tan(this.camera.fov * Math.PI / 360) / (viewH || 600);
    const T = this.mode === 'top' ? this.topTarget : this.target;
    if (this.mode === 'top') { T.x -= dx * unitsPerPx; T.z -= dy * unitsPerPx; }
    else {
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0); right.y = 0; right.normalize();
      const back = new THREE.Vector3(-right.z, 0, right.x);
      T.addScaledVector(right, -dx * unitsPerPx).addScaledVector(back, -dy * unitsPerPx);
    }
    T.x = clamp(T.x, -bounds.w * 0.5, bounds.w * 1.5); T.z = clamp(T.z, -bounds.h * 1.5, bounds.h * 0.5);
    this.snapNext = true;
  }

  zoom(factor: number): void {
    if (this.mode === 'follow') this.follow.dist = clamp(this.follow.dist * factor, 22, 400);
    else if (this.mode === 'top') { this.topDist = clamp(this.topDist * factor, 40, 4000); this.snapNext = true; }
    else if (this.mode === 'orbit') { this.dist = clamp(this.dist * factor, 25, 4000); this.snapNext = true; }
  }

  desired(world: World, sensorHeight: number, pos: THREE.Vector3, look: THREE.Vector3): void {
    const p = world.pose;
    switch (this.mode) {
      case 'top':
        look.copy(this.topTarget); pos.set(this.topTarget.x, this.topDist, this.topTarget.z);
        break;
      case 'follow': {
        const f = this.follow, a = p.th + Math.PI + f.az;
        look.set(p.x, 7, -p.y);
        pos.set(p.x + Math.cos(a) * f.dist * Math.cos(f.el), 7 + f.dist * Math.sin(f.el), -(p.y + Math.sin(a) * f.dist * Math.cos(f.el)));
        break;
      }
      case 'pov': {
        const sp = world.sensorPose(0), h = sensorHeight + 0.4, a = p.th + this.pov.yaw;
        pos.set(sp.x + Math.cos(p.th) * 0.6, h, -(sp.y + Math.sin(p.th) * 0.6));
        look.set(pos.x + Math.cos(a) * 100, h + Math.tan(this.pov.pitch) * 100, pos.z - Math.sin(a) * 100);
        break;
      }
      default: {
        const T = this.target, d = this.dist;
        look.copy(T);
        pos.set(T.x + d * Math.cos(this.el) * Math.sin(this.az), d * Math.sin(this.el), T.z + d * Math.cos(this.el) * Math.cos(this.az));
      }
    }
  }

  update(dt: number, world: World, sensorHeight: number): void {
    this.desired(world, sensorHeight, this._p, this._l);
    const rate = this.mode === 'pov' ? 22 : this.mode === 'follow' ? 9 : 10;
    const k = this.snapNext || this.reduceMotion ? 1 : 1 - Math.exp(-dt * rate);
    this.pos.lerp(this._p, k); this.look.lerp(this._l, k);
    // looking straight down needs "north" as the up direction, or the view spins
    this._u.set(0, this.mode === 'top' ? 0 : 1, this.mode === 'top' ? -1 : 0);
    this.up.lerp(this._u, k).normalize();
    this.snapNext = false;
    const cam = this.camera;
    cam.up.copy(this.up); cam.position.copy(this.pos); cam.lookAt(this.look);
    const fov = this.mode === 'pov' ? 68 : 42;
    if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }
}
