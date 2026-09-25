/**
 * The robot from the photo: two clear acrylic plates on brass hex standoffs, yellow TT
 * gear motors with black tyres and yellow hubs, a swivel caster with a white wheel, an
 * 8 x AA battery holder between the plates, an Arduino Uno, an L298N driver, a mini
 * breadboard, three HC-SR04 sonars and a rainbow of jumper wires that follow the pins
 * chosen in the Wiring tab.
 *
 * Robot frame: +x forward, +y up, +z to the robot's right (so "left" is -z).
 * The group origin is the midpoint of the wheel axle, on the floor.
 */
import * as THREE from 'three';
import { robotGeometry, mulberry32 } from '../engine/index.js';
import { col, std, RM, WIRE_COLORS, YELLOW } from './materials.js';
import type { Robot, Wiring } from '../sim/settings.js';

function mkBox(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, parent?: THREE.Object3D): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; if (parent) parent.add(m); return m;
}
function mkCyl(r1: number, r2: number, h: number, mat: THREE.Material, seg?: number, parent?: THREE.Object3D): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg || 20), mat); m.castShadow = true; if (parent) parent.add(m); return m;
}

function stadiumShape(L: number, W: number): THREE.Shape {
  const s = new THREE.Shape(); const r = W / 2, a = Math.max(0, L / 2 - r);
  s.moveTo(-a, -r); s.lineTo(a, -r); s.absarc(a, 0, r, -Math.PI / 2, Math.PI / 2, false); s.lineTo(-a, r); s.absarc(-a, 0, r, Math.PI / 2, Math.PI * 1.5, false);
  return s;
}
function insideStadium(x: number, y: number, L: number, W: number, margin: number): boolean {
  const r = W / 2 - margin, a = Math.max(0, L / 2 - W / 2);
  if (r <= 0) return false;
  const dx = Math.max(0, Math.abs(x) - a);
  return dx * dx + y * y <= r * r;
}
function plateGeometry(L: number, W: number, seed: number, avoid: [number, number, number][]): THREE.ExtrudeGeometry {
  const s = stadiumShape(L, W);
  const rng = mulberry32(seed);
  const step = 1.9;
  for (let x = -L / 2 + 1.5; x <= L / 2 - 1.5; x += step) for (let y = -W / 2 + 1.5; y <= W / 2 - 1.5; y += step) {
    if (!insideStadium(x, y, L, W, 1.3)) continue;
    if (avoid.some(p => Math.hypot(p[0] - x, p[1] - y) < p[2])) continue;
    if (rng() < 0.42) continue;
    const h = new THREE.Path(); h.absarc(x, y, rng() < 0.25 ? 0.32 : 0.2, 0, Math.PI * 2, true); s.holes.push(h);
  }
  // two wire slots
  for (const sy of [-1, 1]) {
    const sl = new THREE.Path(), x0 = -1.2, x1 = 1.2, y = sy * (W * 0.18), rr = 0.45;
    sl.moveTo(x0, y - rr); sl.lineTo(x1, y - rr); sl.absarc(x1, y, rr, -Math.PI / 2, Math.PI / 2, false); sl.lineTo(x0, y + rr); sl.absarc(x0, y, rr, Math.PI / 2, Math.PI * 1.5, false);
    s.holes.push(sl);
  }
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: false, curveSegments: 8 });
  geo.rotateX(-Math.PI / 2); // shape y (robot left) -> -z, extrusion -> +y
  return geo;
}

export interface RobotModel {
  group: THREE.Group; wheels: THREE.Group[]; swivel: THREE.Group; ring: THREE.Mesh; proxy: THREE.Mesh;
  leds: Record<'l13' | 'tx' | 'pwr', THREE.MeshStandardMaterial>; sensorH: number; geo: ReturnType<typeof robotGeometry>;
}

export function buildRobotModel(cfg: Robot, wiring: Wiring): RobotModel {
  const geo = robotGeometry(cfg);
  const leds: Partial<Record<'l13' | 'tx' | 'pwr', THREE.MeshStandardMaterial>> = {};
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const r = cfg.wheelD / 2, cx = geo.cx, L = cfg.chassisL, W = cfg.chassisW, T = cfg.track;
  const t = 0.3, pb = r + 1.05, sh = 4.4, ptb = pb + t + sh, pt = ptb + t;
  const P = (x: number, left: number, h: number) => new THREE.Vector3(x, h, -left);
  // plates
  const soPos: [number, number][] = [[L / 2 - 3.5, W / 2 - 2.2], [L / 2 - 3.5, -(W / 2 - 2.2)], [-(L / 2 - 3.5), W / 2 - 2.2], [-(L / 2 - 3.5), -(W / 2 - 2.2)], [0, W / 2 - 1.3], [0, -(W / 2 - 1.3)]];
  const avoid: [number, number, number][] = soPos.map(p => [p[0], p[1], 1.1]);
  for (const [y0, seed] of [[pb, 11], [ptb, 29]] as [number, number][]) {
    const pg = plateGeometry(L, W, seed, avoid);
    const plate = new THREE.Mesh(pg, RM.acrylic); plate.position.set(cx, y0, 0); plate.renderOrder = 2; body.add(plate);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(pg, 30), RM.acrylicEdge); edges.position.copy(plate.position); body.add(edges);
  }
  // brass hex standoffs with screw heads
  for (const [x, y] of soPos) {
    const so = mkCyl(0.32, 0.32, sh, RM.brass, 6, body); so.position.copy(P(cx + x, y, pb + t + sh / 2));
    const sc = mkCyl(0.3, 0.3, 0.16, RM.steel, 12, body); sc.position.copy(P(cx + x, y, pt + 0.08));
    const sb = mkCyl(0.3, 0.3, 0.16, RM.steel, 12, body); sb.position.copy(P(cx + x, y, pb - 0.08));
  }
  // TT gear motors, shafts and wheels
  const wheels: THREE.Group[] = [];
  for (const side of [1, -1]) { // +1 = left (+y sim), -1 = right
    const zW = side * T / 2;                       // wheel centre (left coordinate)
    const gbZ = side * (T / 2 - cfg.wheelW / 2 - 0.35 - 0.95);
    const gb = mkBox(6.8, 2.2, 1.9, RM.yellow, 0, 0, 0, body); gb.position.copy(P(2.3, gbZ, r));
    const clip = mkBox(0.5, 2.4, 2.0, RM.white, 0, 0, 0, body); clip.position.copy(P(4.6, gbZ, r));
    const can = mkCyl(1.0, 1.0, 2.3, RM.can, 18, body); can.rotation.x = Math.PI / 2; can.position.copy(P(5.0, gbZ - side * 2.1, r));
    const cap = mkCyl(1.02, 1.02, 0.35, RM.white, 18, body); cap.rotation.x = Math.PI / 2; cap.position.copy(P(5.0, gbZ - side * 3.35, r));
    const shaft = mkCyl(0.28, 0.28, Math.abs(zW - gbZ) + 0.4, RM.white, 10, body); shaft.rotation.x = Math.PI / 2; shaft.position.copy(P(0, (zW + gbZ) / 2, r));
    const br = mkBox(1.2, 0.8, 1.9, RM.black, 0, 0, 0, body); br.position.copy(P(1.6, gbZ, pb - 0.4));
    // wheel
    const wg = new THREE.Group(); wg.position.copy(P(0, zW, r)); body.add(wg);
    const spin = new THREE.Group(); wg.add(spin);
    const tyre = mkCyl(r, r, cfg.wheelW, RM.rubber, 40, spin); tyre.rotation.x = Math.PI / 2;
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      const tr = mkBox(0.28, 0.14, cfg.wheelW * 0.92, RM.rubber, Math.cos(a) * (r + 0.05), Math.sin(a) * (r + 0.05), 0, spin); tr.rotation.z = a; tr.castShadow = false;
    }
    const hub = mkCyl(r * 0.64, r * 0.64, cfg.wheelW + 0.12, RM.hubYellow, 30, spin); hub.rotation.x = Math.PI / 2;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const hole = mkBox(r * 0.26, r * 0.26, cfg.wheelW + 0.16, RM.black, Math.cos(a) * r * 0.38, Math.sin(a) * r * 0.38, 0, spin); hole.rotation.z = a; hole.castShadow = false;
    }
    const nut = mkCyl(0.45, 0.45, cfg.wheelW + 0.2, RM.black, 12, spin); nut.rotation.x = Math.PI / 2;
    wheels.push(spin);
    // motor leads up to the L298N
  }
  // front/rear swivel caster with white wheel
  const casterG = new THREE.Group(); casterG.position.copy(P(geo.casterX, 0, 0)); body.add(casterG);
  const mount = mkCyl(1.3, 1.3, 0.25, RM.steel, 20, casterG); mount.position.y = pb - 0.15;
  const pivot = mkCyl(0.35, 0.35, 0.6, RM.steel, 10, casterG); pivot.position.y = pb - 0.55;
  const swivel = new THREE.Group(); swivel.position.y = 0; casterG.add(swivel);
  const cr = 1.25, trail = 0.75, armH = pb - 0.95 - cr;
  for (const sz of [-1, 1]) { const arm = mkBox(0.4, armH + 0.5, 0.14, RM.steel, -trail / 2, cr + armH / 2, sz * 0.62, swivel); arm.rotation.z = -Math.atan2(trail, armH); }
  mkBox(1.6, 0.18, 1.4, RM.steel, -0.2, pb - 0.85, 0, swivel);
  const cw = mkCyl(cr, cr, 0.95, RM.white, 26, swivel); cw.rotation.x = Math.PI / 2; cw.position.set(-trail, cr, 0);
  const chub = mkCyl(0.4, 0.4, 1.05, RM.steel, 12, swivel); chub.rotation.x = Math.PI / 2; chub.position.set(-trail, cr, 0);
  // 8 x AA battery holder between the plates
  const bat = new THREE.Group(); bat.position.copy(P(cx - 1.6, 0, pb + t)); body.add(bat);
  mkBox(6.2, 2.9, 5.6, RM.black, 0, 1.45, 0, bat);
  for (let i = 0; i < 4; i++) { const cell = mkCyl(0.7, 0.7, 5.3, RM.black, 14, bat); cell.rotation.x = Math.PI / 2; cell.position.set(-2.3 + i * 1.53, 2.9, 0); cell.castShadow = false; }
  mkBox(0.9, 0.5, 0.6, RM.blackGloss, 2.3, 3.1, 2.2, bat);
  // Arduino Uno (USB and barrel jack facing the back)
  const uno = new THREE.Group(); uno.position.copy(P(cx + 0.4, 0, pt + 0.55)); body.add(uno);
  mkBox(6.86, 0.16, 5.34, RM.uno, 0, 0, 0, uno);
  for (const [x, z] of [[-3.0, -2.3], [-3.0, 2.3], [3.0, -2.3], [3.0, 2.3]] as [number, number][]) { const sp = mkCyl(0.22, 0.22, 0.55, RM.white, 8, body); sp.position.copy(P(cx + 0.4 + x, -z, pt + 0.28)); }
  mkBox(1.65, 1.1, 1.2, RM.can, -3.0, 0.62, -1.6, uno);          // USB-B
  mkBox(1.45, 1.1, 0.9, RM.blackGloss, -3.0, 0.62, 1.75, uno);   // DC jack
  mkBox(3.6, 0.36, 0.95, RM.chip, 0.9, 0.26, 0.6, uno);          // ATmega328P
  for (let i = 0; i < 14; i++) { mkBox(0.08, 0.2, 0.14, RM.steel, 0.9 - 1.62 + i * 0.25, 0.14, 0.6 + 0.52, uno); mkBox(0.08, 0.2, 0.14, RM.steel, 0.9 - 1.62 + i * 0.25, 0.14, 0.6 - 0.52, uno); }
  mkBox(0.9, 0.35, 0.35, RM.can, -1.2, 0.26, -0.2, uno);           // crystal
  mkBox(0.5, 0.25, 0.5, RM.steel, -2.6, 0.2, 0.3, uno);            // reset button
  const digZ = -2.42, anaZ = 2.42;                                  // header rows (board-local)
  mkBox(2.1, 0.85, 0.26, RM.header, 2.05, 0.5, digZ, uno); mkBox(2.6, 0.85, 0.26, RM.header, -0.7, 0.5, digZ, uno);
  mkBox(2.1, 0.85, 0.26, RM.header, -0.15, 0.5, anaZ, uno); mkBox(1.6, 0.85, 0.26, RM.header, 2.25, 0.5, anaZ, uno);
  const ledMat = () => new THREE.MeshStandardMaterial({ color: col(0x3a3320), emissive: col(0x000000), roughness: 0.4 });
  leds.l13 = mkBox(0.22, 0.12, 0.14, ledMat(), -1.6, 0.12, -1.7, uno).material as THREE.MeshStandardMaterial;
  leds.tx = mkBox(0.22, 0.12, 0.14, ledMat(), -1.6, 0.12, -1.3, uno).material as THREE.MeshStandardMaterial;
  leds.pwr = mkBox(0.22, 0.12, 0.14, ledMat(), 2.3, 0.12, 1.7, uno).material as THREE.MeshStandardMaterial;
  leds.pwr.emissive = col(0x3cff7a); leds.pwr.color = col(0x1f6b33);
  // pin position helpers (board-local -> body)
  const unoLocal = (x: number, z: number) => new THREE.Vector3(cx + 0.4 + x, pt + 0.55 + 0.95, z);
  const pinPos = (p: number): THREE.Vector3 => {
    if (p <= 7) return unoLocal(2.95 - p * 0.26, digZ);
    if (p <= 13) return unoLocal(0.55 - (p - 8) * 0.26, digZ);
    return unoLocal(1.6 + (p - 14) * 0.26, anaZ);             // A0..A5
  };
  const powerPin = (k: number) => unoLocal(-0.9 + k * 0.26, anaZ);       // 0 = 5V, 1 = GND, 2 = GND, 3 = Vin
  // L298N motor driver at the back
  const lx = cx - L / 2 + 3.2;
  const drv = new THREE.Group(); drv.position.copy(P(lx, 0, pt + 0.45)); body.add(drv);
  mkBox(4.3, 0.16, 4.3, RM.l298, 0, 0, 0, drv);
  for (const [x, z] of [[-1.8, -1.8], [-1.8, 1.8], [1.8, -1.8], [1.8, 1.8]] as [number, number][]) { const sp = mkCyl(0.2, 0.2, 0.45, RM.brass, 6, body); sp.position.copy(P(lx + x, -z, pt + 0.22)); }
  mkBox(2.4, 0.3, 1.7, RM.blackGloss, -0.3, 0.25, 0, drv);
  for (let i = 0; i < 7; i++) mkBox(0.12, 1.55, 1.7, RM.blackGloss, -1.35 + i * 0.35, 1.15, 0, drv);
  mkBox(0.8, 0.8, 1.05, RM.terminal, -0.1, 0.48, -1.75, drv).castShadow = true;
  mkBox(0.8, 0.8, 1.05, RM.terminal, -0.1, 0.48, 1.75, drv);
  mkBox(0.8, 0.8, 1.6, RM.terminal, -1.75, 0.48, 0, drv);
  mkBox(0.3, 0.7, 1.9, RM.header, 1.85, 0.43, 0, drv);
  if (!wiring.jumpers) { /* jumpers removed: EN pins wired */ } else { mkBox(0.35, 0.35, 0.4, RM.black, 1.85, 0.95, -0.85, drv); mkBox(0.35, 0.35, 0.4, RM.black, 1.85, 0.95, 0.85, drv); }
  mkCyl(0.35, 0.35, 0.9, RM.black, 12, drv).position.set(0.9, 0.55, 1.2);
  const drvPin = (k: number) => new THREE.Vector3(lx + 1.85, pt + 0.45 + 0.85, -(-0.9 + k * 0.36));   // ENA, IN1, IN2, IN3, IN4, ENB
  // mini breadboard at the front
  const bbX = cx + L / 2 - 6.2;
  const bb = mkBox(3.3, 0.85, Math.min(4.6, W * 0.33), RM.breadboard, 0, 0, 0, body); bb.position.copy(P(bbX, 0, pt + 0.43));
  const bbPin = (k: number) => new THREE.Vector3(bbX - 1.0 + (k % 4) * 0.55, pt + 0.9, (k < 4 ? -1 : 1) * 1.2);
  // three HC-SR04 sonars
  const sonarObjs: THREE.Group[] = [];
  const sDefs = geo.sensors;
  sDefs.forEach((s: { x: number; y: number; a: number }) => {
    const sg = new THREE.Group(); sg.position.copy(P(s.x, s.y, pt + 1.35)); sg.rotation.y = s.a; body.add(sg);
    mkBox(0.16, 2.1, 4.5, RM.sonarPcb, -1.25, 0, 0, sg);
    for (const z of [-1.3, 1.3]) {
      const tr = mkCyl(0.8, 0.8, 1.15, RM.can, 22, sg); tr.rotation.z = Math.PI / 2; tr.position.set(-0.6, 0, z);
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.66, 22), RM.mesh); face.rotation.y = Math.PI / 2; face.position.set(0.0, 0, z); sg.add(face);
    }
    mkBox(0.3, 0.45, 0.9, RM.can, -1.0, 0.55, 0, sg);
    mkBox(0.5, 0.25, 1.1, RM.header, -1.45, -0.95, 0, sg);
    mkBox(1.4, 0.18, 2.0, RM.black, -1.6, -1.12, 0, sg); // bracket foot
    sonarObjs.push(sg);
  });
  const sonarPin = (i: number, k: number): THREE.Vector3 => { // k: 0 VCC, 1 TRIG, 2 ECHO, 3 GND (header on the bottom back edge)
    const sg = sonarObjs[i]!; sg.updateMatrix();
    return new THREE.Vector3(-1.6, -0.95, -0.45 + k * 0.3).applyMatrix4(sg.matrix);
  };
  // rainbow jumper wires
  const wrng = mulberry32(7);
  const wires: { curve: THREE.CatmullRomCurve3; colour: number }[] = [];
  const addWire = (a: THREE.Vector3, b: THREE.Vector3, colour: number, lift?: number) => {
    const mid = a.clone().lerp(b, 0.5); mid.y = Math.max(a.y, b.y) + (lift || 1.6) + wrng() * 1.6;
    mid.x += (wrng() - 0.5) * 1.2; mid.z += (wrng() - 0.5) * 1.2;
    const a1 = a.clone(); a1.y += 0.9; const b1 = b.clone(); b1.y += 0.9;
    wires.push({ curve: new THREE.CatmullRomCurve3([a, a1, mid, b1, b], false, 'centripetal'), colour });
  };
  const ci = (i: number) => WIRE_COLORS[i % WIRE_COLORS.length]!;
  const drvPins = [wiring.ENA, wiring.IN1, wiring.IN2, wiring.IN3, wiring.IN4, wiring.ENB];
  drvPins.forEach((p, k) => { if (!(wiring.jumpers && (k === 0 || k === 5))) addWire(pinPos(p), drvPin(k), ci(k), 1.2); });
  wiring.sonars.forEach((s, i) => {
    addWire(pinPos(s.trig), sonarPin(i, 1), ci(6 + i * 2), 1.4);
    addWire(pinPos(s.echo), sonarPin(i, 2), ci(7 + i * 2), 1.8);
    addWire(bbPin(i), sonarPin(i, 0), 0xe53935, 1.0);
    addWire(bbPin(i + 4), sonarPin(i, 3), 0x212121, 1.0);
  });
  addWire(powerPin(0), bbPin(3), 0xe53935, 2.2);
  addWire(powerPin(1), bbPin(7), 0x212121, 2.0);
  addWire(new THREE.Vector3(lx - 1.75, pt + 1.1, 0.4), powerPin(3), 0xff7043, 2.6);
  const tubeMats = new Map<number, THREE.MeshStandardMaterial>();
  const housings = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.8, 0.24), RM.black, wires.length * 2);
  const hm = new THREE.Matrix4();
  wires.forEach((w, i) => {
    if (!tubeMats.has(w.colour)) tubeMats.set(w.colour, std(w.colour, { roughness: 0.45 }));
    const tube = new THREE.Mesh(new THREE.TubeGeometry(w.curve, 26, 0.055, 5, false), tubeMats.get(w.colour));
    body.add(tube);
    const p0 = w.curve.points[0]!, p1 = w.curve.points[w.curve.points.length - 1]!;
    hm.makeTranslation(p0.x, p0.y + 0.35, p0.z); housings.setMatrixAt(i * 2, hm);
    hm.makeTranslation(p1.x, p1.y + 0.35, p1.z); housings.setMatrixAt(i * 2 + 1, hm);
  });
  body.add(housings);
  // thick battery and motor leads under the top plate
  const lead = (pts: [number, number, number][], colour: number, rad: number) => { const c = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], p[1], p[2]))); const m = new THREE.Mesh(new THREE.TubeGeometry(c, 20, rad, 6, false), std(colour, { roughness: 0.5 })); body.add(m); };
  lead([[cx - 1.6 + 2.3, pb + t + 3.2, -2.2], [cx - 3, ptb - 0.6, -1.5], [lx - 1.5, ptb - 0.2, -0.9], [lx - 1.75, pt + 0.9, -0.3]], 0xd32f2f, 0.1);
  lead([[cx - 1.6 + 2.3, pb + t + 3.2, -2.5], [cx - 3.5, ptb - 0.8, -2.2], [lx - 1.3, ptb - 0.3, 0.2], [lx - 1.75, pt + 0.9, 0.1]], 0x202020, 0.1);
  for (const side of [1, -1]) {
    const gbZ = side * (T / 2 - cfg.wheelW / 2 - 0.35 - 0.95), zc = -(gbZ - side * 3.5);
    lead([[5.0, r + 0.6, zc], [4.0, pb + 1.4, zc * 0.8], [lx - 0.2, ptb - 0.3, side * -1.1], [lx - 0.1, pt + 0.95, side * -1.75]], 0xd32f2f, 0.07);
    lead([[5.0, r - 0.6, zc], [3.5, pb + 1.0, zc * 0.85], [lx + 0.2, ptb - 0.4, side * -1.6], [lx + 0.1, pt + 0.95, side * -1.75]], 0x202020, 0.07);
  }
  // hover ring on the floor and an invisible pick proxy
  const ring = new THREE.Mesh(new THREE.RingGeometry(geo.reach + 0.8, geo.reach + 1.8, 48), new THREE.MeshBasicMaterial({ color: col(YELLOW), transparent: true, opacity: 0, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.09; g.add(ring);
  const proxy = new THREE.Mesh(new THREE.BoxGeometry(L + 1.5, pt + 3, Math.max(W, T + cfg.wheelW) + 1), new THREE.MeshBasicMaterial());
  proxy.position.set(cx, (pt + 3) / 2, 0); proxy.visible = false; proxy.name = 'robotProxy'; g.add(proxy);
  body.traverse(o => { if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material !== RM.acrylic) o.receiveShadow = false; });
  return { group: g, wheels, swivel, ring, proxy, leds: leds as Record<'l13' | 'tx' | 'pwr', THREE.MeshStandardMaterial>, sensorH: pt + 1.35, geo };
}
