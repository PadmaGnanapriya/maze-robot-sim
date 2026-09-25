/**
 * Shared colours and materials. three.js treats hex colours as sRGB, so the
 * values here match the CSS palette directly.
 */
import * as THREE from 'three';

export const col = hex => new THREE.Color(hex);
export const std = (hex, opts = {}) => new THREE.MeshStandardMaterial({ color: col(hex), roughness: 0.6, metalness: 0, ...opts });

/** Sensor colours used for beams, HUD bars and the scope: front, left, right. */
export const SENSOR_HEX = [0x4fd1e8, 0xff8a3d, 0xb98cff];
export const YELLOW = 0xf2c230;

export const WALL = std(0xd6bf93, { roughness: 0.78 });
export const WALL_TOP = std(0xe9d6ae, { roughness: 0.7 });
export const POST = std(0xc6aa7a, { roughness: 0.72 });

/** Materials for the robot model, named after the parts in the photo. */
export const RM = {
  acrylic: new THREE.MeshPhysicalMaterial({ color: col(0xd7e9ef), roughness: 0.06, metalness: 0, transparent: true, opacity: 0.3, clearcoat: 1, clearcoatRoughness: 0.08, side: THREE.DoubleSide, depthWrite: false }),
  acrylicEdge: new THREE.LineBasicMaterial({ color: col(0xcdeef8), transparent: true, opacity: 0.55 }),
  brass: std(0xc9a15b, { metalness: 0.85, roughness: 0.32 }),
  steel: std(0x9aa3a9, { metalness: 0.8, roughness: 0.35 }),
  yellow: std(0xf2c12e, { roughness: 0.5 }),
  hubYellow: std(0xf5c518, { roughness: 0.45 }),
  rubber: std(0x151719, { roughness: 0.92 }),
  black: std(0x1b1d20, { roughness: 0.6 }),
  blackGloss: std(0x16181a, { roughness: 0.3 }),
  white: std(0xf1f1ee, { roughness: 0.55 }),
  can: std(0xc4c9cd, { metalness: 0.9, roughness: 0.28 }),
  uno: std(0x0f7f93, { roughness: 0.55 }),
  l298: std(0xb8281f, { roughness: 0.55 }),
  sonarPcb: std(0x1f5ea8, { roughness: 0.55 }),
  mesh: std(0x2a2e33, { roughness: 0.9, metalness: 0.2 }),
  terminal: std(0x2a6fd6, { roughness: 0.5 }),
  header: std(0x131416, { roughness: 0.5 }),
  chip: std(0x191a1c, { roughness: 0.4 }),
  breadboard: std(0xf3f3ef, { roughness: 0.7 }),
};

/** Rainbow jumper wire colours. */
export const WIRE_COLORS = [0xe53935, 0xfb8c00, 0xfdd835, 0x43a047, 0x1e88e5, 0x8e24aa, 0x9e9e9e, 0xf5f5f5, 0x6d4c41, 0x00acc1, 0xec407a, 0x7cb342, 0x3949ab, 0xffb300];

for (const m of [WALL, WALL_TOP, POST, ...Object.values(RM)]) m.userData.shared = true;

/** Dispose geometries and non-shared materials of a subtree. */
export function disposeTree(root) {
  root.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) if (!m.userData.shared) m.dispose();
  });
}
