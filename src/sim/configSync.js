/**
 * Keeps config.h honest: the default sketch sizes its turns from CELL_CM, TRACK_CM
 * and SENSOR_SPAN and uses #define'd pins, so when the maze, robot or wiring change
 * the UI can offer to update those lines.
 */
export const PIN_DEFINES = [
  ['ENA', w => w.ENA], ['IN1', w => w.IN1], ['IN2', w => w.IN2], ['IN3', w => w.IN3], ['IN4', w => w.IN4], ['ENB', w => w.ENB],
  ['TRIG_F', w => w.sonars[0].trig], ['ECHO_F', w => w.sonars[0].echo],
  ['TRIG_L', w => w.sonars[1].trig], ['ECHO_L', w => w.sonars[1].echo],
  ['TRIG_R', w => w.sonars[2].trig], ['ECHO_R', w => w.sonars[2].echo],
];

export function readDefine(source, name) {
  const m = source.match(new RegExp('#define\\s+' + name + '\\s+(-?[\\d.]+)'));
  return m ? parseFloat(m[1]) : null;
}

export function writeDefine(source, name, value) {
  return source.replace(new RegExp('(#define\\s+' + name + '\\s+)(-?[\\d.]+)'), '$1' + value);
}

/** Differences between config.h and the current settings, grouped by the tab that owns them. */
export function findMismatches(configH, { cell, robot, wiring }) {
  const out = {};
  const c = readDefine(configH, 'CELL_CM');
  if (c != null && Math.abs(c - cell) > 0.05) out.cell = { config: c, actual: cell };
  const t = readDefine(configH, 'TRACK_CM');
  if (t != null && Math.abs(t - robot.track) > 0.05) out.track = { config: t, actual: robot.track };
  const span = +(2 * robot.sideY).toFixed(1), s = readDefine(configH, 'SENSOR_SPAN');
  if (s != null && Math.abs(s - span) > 0.05) out.span = { config: s, actual: span };
  const pins = [];
  for (const [name, get] of PIN_DEFINES) {
    const v = readDefine(configH, name);
    if (v != null && v !== get(wiring)) pins.push({ name, config: v, actual: get(wiring) });
  }
  if (pins.length) out.pins = pins;
  return out;
}

export function mismatchNotes(m) {
  const notes = [];
  if (m.cell) notes.push(`config.h says CELL_CM ${m.cell.config} but the maze's wall gap is ${m.cell.actual} cm. Update it in the Maze tab.`);
  if (m.track) notes.push(`config.h says TRACK_CM ${m.track.config} but the robot's track is ${m.track.actual} cm. Update it in the Robot tab.`);
  if (m.span) notes.push(`config.h says SENSOR_SPAN ${m.span.config} but the side sonars are ${m.span.actual} cm apart. Update it in the Robot tab.`);
  if (m.pins) notes.push(`config.h uses different pins from the Wiring tab (${m.pins.map(p => `${p.name} ${p.config} vs ${p.actual}`).join(', ')}).`);
  return notes;
}
