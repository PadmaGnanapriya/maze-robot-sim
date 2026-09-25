/**
 * Builds the maze: floor, faint grid, plywood walls (instanced), corner posts,
 * the white goal area and the yellow start chevron.
 * Simulation coordinates (x east, y north, cm) map to three.js (x, height, -y).
 */
import * as THREE from 'three';
import { col, std, WALL, WALL_TOP, POST, YELLOW } from './materials.js';

export function buildMazeGroup(maze, { cell, wallT, wallH, floorHex, gridHex }) {
  const g = new THREE.Group();
  const C = maze.cols, R = maze.rows, W = C * cell, H = R * cell;
  const margin = Math.max(W, H) * 1.5 + 200;

  const floorMat = std(floorHex, { roughness: 0.95 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W + margin * 2, H + margin * 2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(W / 2, 0, -H / 2);
  floor.receiveShadow = true;
  g.add(floor);

  const pts = [];
  for (let c = 0; c <= C; c++) pts.push(c * cell, 0.03, 0, c * cell, 0.03, -H);
  for (let r = 0; r <= R; r++) pts.push(0, 0.03, -r * cell, W, 0.03, -r * cell);
  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const gridMat = new THREE.LineBasicMaterial({ color: col(gridHex), transparent: true, opacity: 0.8 });
  g.add(new THREE.LineSegments(gridGeo, gridMat));

  // walls: one instanced box per edge, plus a lighter cap on top
  const edges = [];
  for (let r = 0; r <= R; r++) for (let c = 0; c < C; c++) if (maze.h[r * C + c]) edges.push([c * cell + cell / 2, r * cell, false]);
  for (let r = 0; r < R; r++) for (let c = 0; c <= C; c++) if (maze.v[r * (C + 1) + c]) edges.push([c * cell, r * cell + cell / 2, true]);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const walls = new THREE.InstancedMesh(box, WALL, Math.max(1, edges.length));
  const caps = new THREE.InstancedMesh(box, WALL_TOP, Math.max(1, edges.length));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  edges.forEach(([x, y, vertical], i) => {
    q.setFromAxisAngle(up, vertical ? Math.PI / 2 : 0);
    p.set(x, (wallH - 0.25) / 2, -y); s.set(cell - wallT * 0.2, wallH - 0.25, wallT);
    walls.setMatrixAt(i, m4.compose(p, q, s));
    p.set(x, wallH - 0.125, -y); s.set(cell - wallT * 0.2, 0.25, wallT + 0.06);
    caps.setMatrixAt(i, m4.compose(p, q, s));
  });
  walls.count = caps.count = edges.length;
  walls.castShadow = walls.receiveShadow = caps.castShadow = true;
  g.add(walls, caps);

  // posts wherever walls meet
  const posts = [];
  for (let r = 0; r <= R; r++) for (let c = 0; c <= C; c++) {
    const touches = (c < C && maze.h[r * C + c]) || (c > 0 && maze.h[r * C + c - 1]) || (r < R && maze.v[r * (C + 1) + c]) || (r > 0 && maze.v[(r - 1) * (C + 1) + c]);
    if (touches) posts.push([c * cell, r * cell]);
  }
  const postMesh = new THREE.InstancedMesh(box, POST, Math.max(1, posts.length));
  q.identity();
  posts.forEach(([x, y], i) => { p.set(x, (wallH + 0.3) / 2, -y); s.set(wallT * 1.5, wallH + 0.3, wallT * 1.5); postMesh.setMatrixAt(i, m4.compose(p, q, s)); });
  postMesh.count = posts.length;
  postMesh.castShadow = postMesh.receiveShadow = true;
  g.add(postMesh);

  // the white floor area the robot has to reach
  const goal = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), std(0xf4f6f5, { roughness: 0.85 }));
  goal.rotation.x = -Math.PI / 2;
  goal.receiveShadow = true;
  placeGoalMesh(goal, maze.goal, cell, wallT);
  g.add(goal);

  // start marker: a chevron of yellow floor tape
  const st = maze.start, k = Math.min(cell * 0.18, 9);
  const shape = new THREE.Shape();
  shape.moveTo(k, 0); shape.lineTo(-k * 0.6, k * 0.8); shape.lineTo(-k * 0.25, 0); shape.lineTo(-k * 0.6, -k * 0.8); shape.closePath();
  const chevron = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: col(YELLOW), transparent: true, opacity: 0.85 }));
  chevron.rotation.x = -Math.PI / 2;
  const marker = new THREE.Group(); marker.add(chevron);
  marker.rotation.y = [Math.PI / 2, 0, -Math.PI / 2, Math.PI][st.dir];
  marker.position.set((st.c + 0.5) * cell - Math.cos(marker.rotation.y) * cell * 0.36, 0.05, -(st.r + 0.5) * cell + Math.sin(marker.rotation.y) * cell * 0.36);
  g.add(marker);

  return { group: g, goal, floorMat, gridMat, width: W, height: H };
}

export function placeGoalMesh(mesh, goal, cell, wallT) {
  mesh.scale.set(goal.w * cell - wallT, goal.h * cell - wallT, 1);
  mesh.position.set((goal.c + goal.w / 2) * cell, 0.06, -(goal.r + goal.h / 2) * cell);
}
