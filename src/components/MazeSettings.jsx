import { useSimController, useSimState } from '../hooks/useSim.js';
import { NumberField, SelectField, Section, SyncCallout } from './Field.jsx';

export default function MazeSettings() {
  const sim = useSimController();
  const { mz, editWalls, mismatch } = useSimState();
  const set = key => v => sim.setMazeCfg({ [key]: v });
  return (
    <div className="scroll form">
      <Section title="Layout">
        <SelectField label="Maze type" value={mz.type} onChange={set('type')} options={[['backtracker', 'Long corridors'], ['prim', 'Many branches'], ['braid', 'With loops'], ['arena', 'Open arena']]} />
        <NumberField label="Seed" value={mz.seed} min={1} max={99999} onCommit={set('seed')} />
        <NumberField label="Columns" unit="squares" value={mz.cols} min={3} max={14} onCommit={set('cols')} />
        <NumberField label="Rows" unit="squares" value={mz.rows} min={3} max={14} onCommit={set('rows')} />
      </Section>
      <Section title="Walls" help="Changing these keeps the current layout, including walls you have edited.">
        <NumberField label="Wall gap (centre to centre)" unit="cm" value={mz.cell} min={22} max={90} onCommit={set('cell')} />
        <NumberField label="Wall thickness" unit="cm" value={mz.wallT} min={0.4} max={4} step={0.1} onCommit={set('wallT')} />
        <NumberField label="Wall height" unit="cm" value={mz.wallH} min={5} max={40} onCommit={set('wallH')} />
      </Section>
      {mismatch.cell && (
        <SyncCallout onSync={() => sim.syncConfig('cell')}>
          config.h has <b>CELL_CM {mismatch.cell.config}</b>, the maze gap is <b>{mismatch.cell.actual} cm</b>. The default sketch sizes its turns from this value.
        </SyncCallout>
      )}
      <Section title="White goal area" help="The robot has no floor sensor, so the simulator acts as the referee: it stops the run when the chassis centre is over the white area. You can also drag the white area in the 3D view.">
        <SelectField label="Position" value={mz.goalMode} onChange={set('goalMode')} options={[['corner', 'Far corner'], ['center', 'Centre'], ['random', 'Random']]} />
        <SelectField label="Size" value={mz.goalSize} onChange={set('goalSize')} options={[[1, '1 × 1 square'], [2, '2 × 2 squares']]} />
      </Section>
      <h3>Editing</h3>
      <p className="help">Edit walls, then click a gap between squares to add a wall or click a wall to remove it. Drag to paint several. The outer border stays fixed.</p>
      <div className="row-btns">
        <button className="btn" aria-pressed={editWalls} onClick={() => sim.toggleEditWalls()}>Edit walls</button>
        <button className="btn" onClick={() => sim.clearInnerWalls()}>Remove all inner walls</button>
        <button className="btn" onClick={() => sim.regenerate()}>Rebuild from seed</button>
      </div>
    </div>
  );
}
