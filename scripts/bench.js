/**
 * Headless benchmark: runs the default sketch (src/sketch) on many random mazes
 * without a browser and reports how often it reaches the goal.
 *
 *   npm run bench                       # 12 seeds x 2 maze types, 6 x 6, 40 cm gap
 *   npm run bench -- --size 8 --cell 50 --seeds 20 --types backtracker,prim,braid
 *   npm test                            # quick check used by CI; fails if any maze is not solved
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileSketch, MCU, World, generateMaze, DEFAULT_ROBOT, DEFAULT_WIRING } from '../src/engine/index.js';

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const size = +arg('size', 6), cell = +arg('cell', 40), seeds = +arg('seeds', 12);
const types = arg('types', 'backtracker,prim').split(',');
const goal = arg('goal', 'corner');
const noise = arg('noise', 'realistic');

const dir = fileURLToPath(new URL('../src/sketch/', import.meta.url));
const ino = readFileSync(dir + 'maze_solver.ino', 'utf8');
const cfg = readFileSync(dir + 'config.h', 'utf8').replace(/#define CELL_CM\s+[\d.]+/, `#define CELL_CM ${cell.toFixed(1)}`);

function runOnce(type, seed) {
  const world = new World();
  world.setRobot({ ...DEFAULT_ROBOT, noise });
  world.setMaze(generateMaze(type, size, size, seed, goal), cell, 1.2);
  world.resetPose();
  const mcu = new MCU({ world, wiring: structuredClone(DEFAULT_WIRING) });
  world.mcu = mcu;
  const program = compileSketch({ 'maze_solver.ino': ino, 'config.h': cfg }, 'maze_solver.ino', mcu).main();
  let solvedAt = null;
  world.onGoal = t => { solvedAt = t; };
  const limit = size * size * 8e6, frame = 16667;
  while (solvedAt === null && world.t < limit) {
    mcu.frameEnd = world.t + frame;
    while (mcu.t < mcu.frameEnd) if (program.next().done) break;
    world.syncTo(Math.min(mcu.frameEnd, mcu.t));
  }
  return { solved: solvedAt !== null, seconds: (solvedAt ?? world.t) / 1e6, contacts: world.contacts };
}

const started = Date.now();
const results = [];
for (const type of types) for (let s = 1; s <= seeds; s++) results.push({ type, seed: s, ...runOnce(type, s) });
const ok = results.filter(r => r.solved), times = ok.map(r => r.seconds).sort((a, b) => a - b);
const median = times.length ? times[times.length >> 1].toFixed(1) : '-';
console.log(`${size} x ${size} maze, ${cell} cm gap, ${noise} sensors`);
console.log(`solved ${ok.length}/${results.length}, median ${median} s, contacts per run ${(results.reduce((a, r) => a + r.contacts, 0) / results.length).toFixed(2)}, ${((Date.now() - started) / results.length).toFixed(0)} ms CPU per run`);
const failed = results.filter(r => !r.solved);
if (failed.length) console.log('not solved:', failed.map(r => `${r.type} #${r.seed}`).join(', '));
if (process.argv.includes('--strict') && failed.length) process.exit(1);
