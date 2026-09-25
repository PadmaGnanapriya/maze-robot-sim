/**
 * Public API of the simulation engine. Everything here is plain JavaScript with
 * no DOM or React dependency, so it also runs headless in Node (see scripts/bench.js).
 */
export { CompileError } from './parser.js';
export { compileSketch } from './compiler.js';
export { PWM_PINS } from './types.js';
export { MCU, RuntimeFault } from './mcu.js';
export { mulberry32 } from './random.js';
export { Maze, generateMaze, placeGoal } from './maze.js';
export { World, DEFAULT_ROBOT, DEFAULT_WIRING, robotGeometry } from './world.js';
