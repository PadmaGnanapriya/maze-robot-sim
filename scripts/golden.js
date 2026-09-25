/**
 * Regression oracle for engine/ beyond what bench.js checks. bench.js only ever runs the
 * default solver sketch (src/sketch/maze_solver.ino), so a bug in, say, struct field
 * layout, overload resolution, or String.replace() could regress silently while bench
 * still reports every maze solved. This compiles (and, where marked, actually runs) each
 * sketch in golden-sketches.js and snapshots {ram, warnings, compile error, serial output,
 * runtime log lines, final pin states} to scripts/golden/snapshot.json.
 *
 *   npm run golden          compute and diff against the committed snapshot; exits 1 on mismatch
 *   npm run golden -- --update   regenerate the committed snapshot (review the diff before committing!)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileSketch, MCU, World, generateMaze, DEFAULT_ROBOT, DEFAULT_WIRING, CompileError } from '../src/engine/index.js';
import { GOLDEN_SKETCHES } from './golden-sketches.js';

const SNAPSHOT_PATH = fileURLToPath(new URL('./golden/snapshot.json', import.meta.url));

function makeHarness() {
  const world = new World();
  world.setRobot({ ...DEFAULT_ROBOT });
  world.setMaze(generateMaze('backtracker', 6, 6, 1, 'corner'), 40, 1.2);
  world.resetPose();
  const mcu = new MCU({ world, wiring: structuredClone(DEFAULT_WIRING) });
  world.mcu = mcu;
  return { world, mcu };
}

function serializeError(e) {
  if (e instanceof CompileError) return { message: e.message, file: e.file, line: e.line, col: e.col, kind: e.kind };
  return { message: e instanceof Error ? e.message : String(e), unexpected: true };
}

function pinSnapshot(mcu) {
  return mcu.pins.slice(0, 14).map(p => ({ mode: p.mode, out: p.out, pwm: p.pwm }));
}

function snapshotSketch(sketch) {
  const { mcu } = makeHarness();
  let program;
  try {
    program = compileSketch({ 'test.ino': sketch.src }, 'test.ino', mcu);
  } catch (e) {
    return { name: sketch.name, ok: false, error: serializeError(e) };
  }
  const warnings = (program.warnings || []).map(w => ({ msg: w.msg, file: w.file, line: w.line, kind: w.kind }));
  const result = { name: sketch.name, ok: true, ram: program.ram, warnings };
  if (!sketch.run) return result;

  let serial = '';
  const logs = [];
  mcu.onSerial = text => { serial += text; };
  mcu.onLog = (kind, msg) => { logs.push({ kind, msg }); };
  const main = program.main();
  mcu.frameEnd = sketch.runUs || 200_000;
  let guard = 0;
  while (mcu.t < mcu.frameEnd) {
    if (main.next().done) break;
    if (++guard > 2_000_000) { result.runawayLoop = true; break; }
  }
  result.serial = serial;
  result.runtimeLogs = logs;
  result.finalT = mcu.t;
  result.pins = pinSnapshot(mcu);
  return result;
}

function computeSnapshot() {
  return GOLDEN_SKETCHES.map(snapshotSketch);
}

function loadCommitted() {
  try { return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')); } catch { return null; }
}

const current = computeSnapshot();
const update = process.argv.includes('--update');

if (update) {
  mkdirSync(new URL('./golden/', import.meta.url), { recursive: true });
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(current, null, 2) + '\n');
  console.log(`Wrote ${SNAPSHOT_PATH} (${current.length} sketches). Review the diff before committing.`);
  process.exit(0);
}

const committed = loadCommitted();
if (!committed) {
  console.error(`No committed snapshot at ${SNAPSHOT_PATH}. Run "npm run golden -- --update" first.`);
  process.exit(1);
}

const currentJSON = JSON.stringify(current, null, 2);
const committedJSON = JSON.stringify(committed, null, 2);
if (currentJSON === committedJSON) {
  console.log(`golden: ${current.length} sketches match the committed snapshot.`);
  process.exit(0);
}

console.error('golden: mismatch against the committed snapshot.');
const byName = new Map(committed.map(r => [r.name, r]));
for (const c of current) {
  const prev = byName.get(c.name);
  if (JSON.stringify(c) !== JSON.stringify(prev)) {
    console.error(`\n--- ${c.name} ---`);
    console.error('committed:', JSON.stringify(prev));
    console.error('current:  ', JSON.stringify(c));
  }
}
process.exit(1);
