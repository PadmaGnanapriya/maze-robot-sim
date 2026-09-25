/**
 * SceneView draws the simulation and turns pointer input into actions:
 * drag the robot or the goal, paint walls, orbit / pan / zoom the camera.
 * It runs the frame loop and calls controller.tick(dt) before each render.
 */
import * as THREE from 'three';
import { buildMazeGroup, placeGoalMesh, type MazeParts } from './mazeMesh.js';
import { buildRobotModel, type RobotModel } from './robotModel.js';
import { SonarBeams, Trail, WallGhost } from './overlays.js';
import { CameraRig } from './CameraRig.js';
import { col, disposeTree } from './materials.js';
import type { SimController, WallEdge } from '../sim/SimController.js';
import type { CameraView } from '../sim/settings.js';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

interface SceneViewOptions { reduceMotion: boolean; reservedLeft: () => number }
type PointerMode = 'orbit' | 'pan' | 'robot' | 'goal' | 'paint' | 'pinch' | null;
interface PointerState {
  mode: PointerMode; x: number; y: number; pointers: Map<number, { x: number; y: number }>;
  offset: { x: number; y: number } | null; paint: number; lastEdge: string | null;
  pinchD: number; pinchMid: { x: number; y: number } | null;
}

export class SceneView {
  canvas: HTMLCanvasElement;
  sim: SimController;
  reservedLeft: () => number;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  rig: CameraRig;
  sun: THREE.DirectionalLight;
  beams: SonarBeams;
  trail: Trail;
  ghost: WallGhost;
  theme: { stage: string; dark: boolean };
  mazeParts!: MazeParts;
  robot!: RobotModel;
  offs: (() => void)[];
  resizeObserver: ResizeObserver;
  last = 0;
  raf: number;
  lastAspect: number | undefined;
  unbindPointer!: () => void;

  constructor(canvas: HTMLCanvasElement, sim: SimController, { reduceMotion, reservedLeft }: SceneViewOptions) {
    this.canvas = canvas;
    this.sim = sim;
    this.reservedLeft = reservedLeft;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 9000);
    this.rig = new CameraRig(this.camera, reduceMotion);
    this.rig.setMode(sim.ui.view);

    // light intensities are in three's physical units (hence the factors of pi)
    scene.add(new THREE.HemisphereLight(col(0xeaf3ff), col(0x243038), 0.9 * Math.PI));
    const sun = new THREE.DirectionalLight(col(0xfff6ea), 1.05 * Math.PI);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.35;
    scene.add(sun, sun.target);
    this.sun = sun;
    const fill = new THREE.DirectionalLight(col(0xa8c8ff), 0.28 * Math.PI);
    fill.position.set(-400, 260, 500);
    scene.add(fill);
    scene.fog = new THREE.Fog(0x07161f, 800, 2400);

    this.beams = new SonarBeams(scene);
    this.trail = new Trail(scene);
    this.ghost = new WallGhost(scene);
    this.theme = { stage: '#07161F', dark: true };

    this.buildMaze();
    this.buildRobot();

    this.offs = [
      sim.on('maze', () => this.buildMaze()),
      sim.on('robot', () => this.buildRobot()),
      sim.on('goal', () => placeGoalMesh(this.mazeParts.goal, sim.maze.goal, sim.mz.cell, sim.mz.wallT)),
      sim.on('fit', () => this.fit()),
    ];
    this.bindPointer();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement!);
    this.resize();
    this.fit();

    this.frame = this.frame.bind(this);
    this.raf = requestAnimationFrame(this.frame);
  }

  setTheme(stageColour: string, dark: boolean): void {
    this.theme = { stage: stageColour, dark };
    this.scene.background = col(stageColour);
    (this.scene.fog as THREE.Fog).color.copy(col(stageColour));
    if (this.mazeParts) {
      this.mazeParts.floorMat.color.copy(col(dark ? 0x22323c : 0x3a4c57));
      this.mazeParts.gridMat.color.copy(col(dark ? 0x2f4452 : 0x4b6170));
    }
  }

  setView(mode: CameraView): void { this.rig.setMode(mode); }

  buildMaze(): void {
    if (this.mazeParts) { this.scene.remove(this.mazeParts.group); disposeTree(this.mazeParts.group); }
    const { cell, wallT, wallH } = this.sim.mz;
    this.mazeParts = buildMazeGroup(this.sim.maze, { cell, wallT, wallH, floorHex: this.theme.dark ? 0x22323c : 0x3a4c57, gridHex: this.theme.dark ? 0x2f4452 : 0x4b6170 });
    this.scene.add(this.mazeParts.group);
    // fit the sun's shadow camera around the maze
    const { width: W, height: H } = this.mazeParts;
    const ext = Math.max(W, H) * 0.75 + 60, cx = W / 2, cz = -H / 2;
    this.sun.position.set(cx - ext * 0.55, ext * 1.6, cz + ext * 0.9);
    this.sun.target.position.set(cx, 0, cz);
    Object.assign(this.sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: ext * 4.5 });
    (this.sun.shadow.camera as THREE.OrthographicCamera).updateProjectionMatrix();
  }

  buildRobot(): void {
    if (this.robot) { this.scene.remove(this.robot.group); disposeTree(this.robot.group); }
    this.robot = buildRobotModel(this.sim.robot, this.sim.wiring);
    this.scene.add(this.robot.group);
  }

  fit(): void {
    const { width, height } = this.mazeParts;
    const el = this.canvas.parentElement!;
    const fog = this.rig.fit(width, height, el.clientWidth || 900, el.clientHeight || 600, this.reservedLeft());
    (this.scene.fog as THREE.Fog).near = fog.fogNear; (this.scene.fog as THREE.Fog).far = fog.fogFar;
    this.rig.snapNext = true;
  }

  resize(): void {
    const el = this.canvas.parentElement!, w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (Math.abs(w / h - (this.lastAspect || 0)) > 0.15) { this.lastAspect = w / h; this.fit(); }
  }

  frame(now: number): void {
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.last ? clamp((now - this.last) / 1000, 0, 0.25) : 1 / 60;
    this.last = now;
    const sim = this.sim, world = sim.world, R = this.robot;
    sim.tick(dt);
    this.rig.update(dt, world, R.sensorH);
    // robot pose, wheel spin and caster swivel
    R.group.position.set(world.pose.x, 0, -world.pose.y);
    R.group.rotation.y = world.pose.th;
    R.wheels[0]!.rotation.z = -world.angL;
    R.wheels[1]!.rotation.z = -world.angR;
    R.swivel.rotation.y = world.casterAng;
    const mcu = world.mcu;
    R.leds.l13.emissive.set(mcu && mcu.pins[13]!.mode === 1 && (mcu.pins[13]!.out || mcu.pins[13]!.pwm > 0) ? 0xffc23a : 0x000000);
    R.leds.tx.emissive.set(mcu && mcu.serialOn && mcu.txEnd > mcu.t - 30000 ? 0xffd24d : 0x000000);
    this.beams.update(world, R.sensorH, { show: sim.ui.beams, pov: this.rig.mode === 'pov' });
    this.trail.update(world.trail, sim.ui.trail);
    this.renderer.render(this.scene, this.camera);
  }

  /* ---------------- pointer interaction ---------------- */
  bindPointer(): void {
    const c = this.canvas, sim = this.sim;
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitPt = new THREE.Vector3();
    const P: PointerState = { mode: null, x: 0, y: 0, pointers: new Map(), offset: null, paint: 0, lastEdge: null, pinchD: 0, pinchMid: null };
    const aim = (e: PointerEvent) => { const r = c.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(ndc, this.camera); };
    const floorAt = (e: PointerEvent) => { aim(e); return ray.ray.intersectPlane(ground, hitPt) ? { x: hitPt.x, y: -hitPt.z } : null; };
    const pick = (e: PointerEvent): 'robot' | 'goal' | null => {
      aim(e);
      if (ray.intersectObject(this.robot.proxy, false).length) return 'robot';
      if (!sim.editWalls && ray.intersectObject(this.mazeParts.goal, false).length) return 'goal';
      return null;
    };
    const bounds = () => ({ w: sim.maze.cols * sim.mz.cell, h: sim.maze.rows * sim.mz.cell });
    const setCursor = (cur: string) => { c.style.cursor = cur; };
    const ghost = (edge: WallEdge | null) => this.ghost.show(edge, sim.mz, edge ? (P.mode === 'paint' ? P.paint === 0 : sim.edgeValue(edge) === 1) : false);

    const down = (e: PointerEvent) => {
      c.focus({ preventScroll: true });
      P.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (P.pointers.size === 2) {
        if (P.mode === 'robot') sim.endDrag();
        const [a, b] = [...P.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        P.mode = 'pinch'; P.pinchD = Math.hypot(a.x - b.x, a.y - b.y); P.pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        return;
      }
      if (P.pointers.size > 2) return;
      try { c.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      P.x = e.clientX; P.y = e.clientY;
      const hit = pick(e);
      if (e.button === 1 || e.button === 2 || (e.shiftKey && hit !== 'robot')) P.mode = 'pan';
      else if (hit === 'robot') {
        const f = floorAt(e), cc = sim.world.chassisCenter();
        P.mode = 'robot'; P.offset = f ? { x: cc.x - f.x, y: cc.y - f.y } : { x: 0, y: 0 };
        sim.beginDrag(); setCursor('grabbing');
      } else if (sim.editWalls && sim.edgeAt(floorAt(e))) {
        const edge = sim.edgeAt(floorAt(e))!;
        P.mode = 'paint'; P.paint = sim.edgeValue(edge) ? 0 : 1; P.lastEdge = edge.kind + edge.idx;
        sim.setEdge(edge, P.paint); ghost(edge);
      } else if (hit === 'goal') { P.mode = 'goal'; setCursor('grabbing'); }
      else P.mode = this.rig.mode === 'top' ? 'pan' : 'orbit';
    };

    const move = (e: PointerEvent) => {
      if (P.pointers.has(e.pointerId)) P.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!P.mode) {   // hover feedback
        const hit = pick(e);
        (this.robot.ring.material as THREE.MeshBasicMaterial).opacity = hit === 'robot' ? 0.55 : 0;
        if (sim.editWalls && hit !== 'robot') { ghost(sim.edgeAt(floorAt(e))); setCursor('crosshair'); }
        else { this.ghost.show(null); setCursor(hit ? 'grab' : ''); }
        return;
      }
      const dx = e.clientX - P.x, dy = e.clientY - P.y;
      P.x = e.clientX; P.y = e.clientY;
      switch (P.mode) {
        case 'orbit': this.rig.rotate(dx, dy); break;
        case 'pan': this.rig.pan(dx, dy, c.clientHeight, bounds()); break;
        case 'robot': { const f = floorAt(e); if (f) sim.dragTo(f.x + P.offset!.x, f.y + P.offset!.y); break; }
        case 'goal': { const f = floorAt(e); if (f) sim.moveGoalTo(f); break; }
        case 'paint': {
          const edge = sim.edgeAt(floorAt(e));
          if (edge && edge.kind + edge.idx !== P.lastEdge) { P.lastEdge = edge.kind + edge.idx; sim.setEdge(edge, P.paint); }
          ghost(edge);
          break;
        }
        case 'pinch': {
          if (P.pointers.size < 2) break;
          const [a, b] = [...P.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
          const d = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          if (P.pinchD > 0 && d > 0) this.rig.zoom(P.pinchD / d);
          this.rig.pan(mid.x - P.pinchMid!.x, mid.y - P.pinchMid!.y, c.clientHeight, bounds());
          P.pinchD = d; P.pinchMid = mid;
          break;
        }
      }
    };

    const up = (e: PointerEvent) => {
      P.pointers.delete(e.pointerId);
      if (P.mode === 'pinch') { if (P.pointers.size < 2) P.mode = null; return; }
      if (P.mode === 'robot') sim.endDrag();
      if (P.mode === 'paint') sim.finishEdit();
      P.mode = null; setCursor(sim.editWalls ? 'crosshair' : '');
    };

    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (P.mode === 'robot') { sim.rotateRobot(e.deltaY > 0 ? -15 : 15, e.shiftKey); return; }
      this.rig.zoom(Math.exp(clamp(e.deltaY, -120, 120) * 0.0015));
    };
    const leave = () => { if (!P.mode) { this.ghost.show(null); (this.robot.ring.material as THREE.MeshBasicMaterial).opacity = 0; } };
    const noMenu = (e: Event) => e.preventDefault();

    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', leave);
    c.addEventListener('wheel', wheel, { passive: false });
    c.addEventListener('contextmenu', noMenu);
    this.unbindPointer = () => {
      c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up); c.removeEventListener('pointercancel', up);
      c.removeEventListener('pointerleave', leave); c.removeEventListener('wheel', wheel); c.removeEventListener('contextmenu', noMenu);
    };
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.unbindPointer();
    this.offs.forEach(off => off());
    disposeTree(this.scene);
    this.renderer.dispose();
  }
}
