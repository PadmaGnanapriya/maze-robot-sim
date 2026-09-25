/**
 * Things drawn on top of the maze: the three sonar beams with their echo points,
 * the path the robot has driven, and the preview box used when editing walls.
 */
import * as THREE from 'three';
import { col, SENSOR_HEX, YELLOW } from './materials.js';
import type { WallEdge } from '../sim/SimController.js';
import type { World } from '../engine';

interface BeamItem {
  holder: THREE.Group; cone: THREE.Mesh; mat: THREE.MeshBasicMaterial; line: THREE.Line; dot: THREE.Mesh;
}

export class SonarBeams {
  items: BeamItem[];

  constructor(scene: THREE.Scene) {
    this.items = SENSOR_HEX.map(hex => {
      const coneGeo = new THREE.ConeGeometry(1, 1, 28, 1, true);
      coneGeo.translate(0, -0.5, 0); coneGeo.rotateZ(Math.PI / 2);   // apex at origin, opening along +x
      const mat = new THREE.MeshBasicMaterial({ color: col(hex), transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide });
      const cone = new THREE.Mesh(coneGeo, mat); cone.renderOrder = 5;
      const holder = new THREE.Group(); holder.add(cone);
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3));
      const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: col(hex), transparent: true, opacity: 0.7 }));
      line.frustumCulled = false;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.75, 14, 10), new THREE.MeshBasicMaterial({ color: col(hex) }));
      scene.add(holder, line, dot);
      return { holder, cone, mat, line, dot };
    });
  }

  /** Draw each beam from the latest reading the sketch (or the idle scan) took. */
  update(world: World, sensorHeight: number, { show, pov }: { show: boolean; pov: boolean }): void {
    const half = world.cfg.beamHalf * Math.PI / 180;
    this.items.forEach((B, i) => {
      const rd = world.readings[i];
      const age = rd ? (world.t - rd.t) / 1e6 : Infinity;
      const visible = show && rd && age < 0.6;
      B.holder.visible = B.line.visible = B.dot.visible = !!visible;
      if (!visible) return;
      if (pov && i === 0) B.holder.visible = false;
      const sp = world.sensorPose(i);
      const len = rd.d == null ? 90 : Math.max(1, rd.d);
      const radius = Math.tan(half) * len;
      B.holder.position.set(sp.x, sensorHeight, -sp.y);
      B.holder.rotation.y = sp.a;
      B.cone.scale.set(len, radius, radius);
      B.mat.opacity = (rd.d == null ? 0.05 : 0.13) * Math.max(0.25, 1 - age * 1.5);
      const pos = (B.line.geometry as THREE.BufferGeometry).attributes.position as THREE.BufferAttribute;
      pos.setXYZ(0, sp.x, sensorHeight, -sp.y);
      if (rd.raw != null) {
        const hx = sp.x + Math.cos(rd.a) * rd.raw, hy = sp.y + Math.sin(rd.a) * rd.raw;
        pos.setXYZ(1, hx, sensorHeight, -hy);
        B.dot.position.set(hx, sensorHeight, -hy);
        B.dot.visible = rd.d != null;
        B.dot.scale.setScalar(pov ? Math.max(0.15, Math.min(1, rd.raw / 60)) : 1);
      } else {
        pos.setXYZ(1, sp.x + Math.cos(sp.a) * len, sensorHeight, -(sp.y + Math.sin(sp.a) * len));
        B.dot.visible = false;
      }
      pos.needsUpdate = true;
    });
  }
}

export class Trail {
  max: number;
  geo: THREE.BufferGeometry;
  line: THREE.Line;
  n = 0;
  first: { x: number; y: number } | null = null;

  constructor(scene: THREE.Scene, max = 8000) {
    this.max = max;
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    this.geo.setDrawRange(0, 0);
    this.line = new THREE.Line(this.geo, new THREE.LineBasicMaterial({ color: col(YELLOW), transparent: true, opacity: 0.75 }));
    this.line.frustumCulled = false; this.line.renderOrder = 3;
    scene.add(this.line);
  }

  /** Append only the new points; start over when the world's trail was cleared. */
  update(points: { x: number; y: number }[], show: boolean): void {
    this.line.visible = show;
    if (points.length < this.n || points[0] !== this.first) this.n = 0;
    if (points.length === this.n) return;
    const pos = this.geo.attributes.position as THREE.BufferAttribute, end = Math.min(points.length, this.max);
    for (let i = this.n; i < end; i++) pos.setXYZ(i, points[i]!.x, 0.12, -points[i]!.y);
    this.n = end; this.first = points[0] ?? null;
    this.geo.setDrawRange(0, end); pos.needsUpdate = true;
  }
}

export interface WallGhostDims { cell: number; wallT: number; wallH: number }

export class WallGhost {
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: col(YELLOW), transparent: true, opacity: 0.5, depthWrite: false }));
    this.mesh.visible = false; this.mesh.renderOrder = 6;
    scene.add(this.mesh);
  }

  /** Show where a click would add (yellow) or remove (red) a wall. */
  show(edge: WallEdge | null, dims?: WallGhostDims, removing?: boolean): void {
    const m = this.mesh;
    m.visible = !!edge;
    if (!edge || !dims) return;
    const { cell, wallT, wallH } = dims;
    m.material.color.set(removing ? 0xff6b5e : YELLOW);
    m.material.opacity = removing ? 0.6 : 0.5;
    if (edge.kind === 'h') { m.position.set((edge.c + 0.5) * cell, wallH / 2 + 0.1, -edge.r * cell); m.scale.set(cell, wallH + 0.4, wallT + 0.8); }
    else { m.position.set(edge.c * cell, wallH / 2 + 0.1, -(edge.r + 0.5) * cell); m.scale.set(wallT + 0.8, wallH + 0.4, cell); }
  }
}
