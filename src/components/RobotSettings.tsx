import { useSimController, useSimState } from '../hooks/useSim.js';
import { NumberField, SelectField, Section, SyncCallout } from './Field.js';
import type { Robot } from '../sim/settings.js';

type NumericRobotKey = { [K in keyof Robot]: Robot[K] extends number ? K : never }[keyof Robot];

export default function RobotSettings() {
  const sim = useSimController();
  const { robot: R, mismatch } = useSimState();
  const num = (key: NumericRobotKey, label: string, unit: string | undefined, min: number, max: number, step?: number) => (
    <NumberField key={key} label={label} unit={unit} min={min} max={max} step={step} value={R[key]} onCommit={v => sim.setRobot({ [key]: v } as Partial<Robot>)} />
  );
  const parts: React.ReactNode[] = [];
  if (mismatch.track) parts.push(<span key="t"><b>TRACK_CM {mismatch.track.config}</b> (robot: {mismatch.track.actual} cm)</span>);
  if (mismatch.span) parts.push(<span key="s"><b>SENSOR_SPAN {mismatch.span.config}</b> (robot: {mismatch.span.actual} cm)</span>);

  return (
    <div className="scroll form">
      <Section title="Chassis" help="The two clear acrylic plates. The axle position is measured from the chassis centre; negative means behind it.">
        {num('chassisL', 'Length', 'cm', 12, 32, 0.5)}{num('chassisW', 'Width', 'cm', 9, 26, 0.5)}{num('axleX', 'Axle position', 'cm', -10, 10, 0.5)}
      </Section>
      <Section title="Wheels and caster">
        {num('wheelD', 'Wheel diameter', 'cm', 3, 12, 0.1)}{num('wheelW', 'Tyre width', 'cm', 1, 5, 0.1)}{num('track', 'Track (wheel centre to centre)', 'cm', 8, 30, 0.1)}
      </Section>
      <Section title="Sonars" help="Positions are measured from the chassis centre to each sensor face. The beam angle and the steepest angle a wall still echoes from decide what the robot can see.">
        {num('frontX', 'Front sonar forward', 'cm', 2, 20, 0.1)}{num('sideX', 'Side sonars forward', 'cm', -10, 14, 0.1)}{num('sideY', 'Side sonars out', 'cm', 3, 14, 0.1)}
        {num('sideAngle', 'Side sonar angle', '°', 30, 90, 1)}{num('beamHalf', 'Beam half-angle', '°', 1, 30, 1)}{num('maxInc', 'Steepest echo angle', '°', 15, 89, 1)}
        <SelectField label="Sensor behaviour" value={R.noise} onChange={v => sim.setRobot({ noise: v })}
          options={[['ideal', 'Ideal (single ray, no noise)'], ['realistic', 'Realistic HC-SR04'], ['harsh', 'Harsh (noisy, dropouts)']]} />
      </Section>
      <Section title="Motors and power" help="Two yellow TT gear motors on an L298N, powered by 8 AA cells. The L298N loses about 2 V; motors below the start-up voltage just hum.">
        {num('battery', 'Battery', 'V', 4, 14, 0.1)}{num('drop', 'Driver voltage drop', 'V', 0, 4, 0.1)}{num('rpm6', 'Motor speed at 6 V', 'rpm', 40, 400, 1)}
        {num('deadband', 'Start-up voltage', 'V', 0, 4, 0.1)}{num('tauMs', 'Motor response time', 'ms', 10, 400, 1)}{num('mismatch', 'Right motor weaker by', '%', -20, 20, 0.5)}
      </Section>
      {parts.length > 0 && <SyncCallout onSync={() => sim.syncConfig('robot')}>config.h has {parts.reduce<React.ReactNode[]>((a, p, i) => (i ? [...a, ' and ', p] : [p]), [])}.</SyncCallout>}
      <div className="row-btns"><button className="btn" onClick={() => sim.resetRobot()}>Reset to the robot in the photo</button></div>
    </div>
  );
}
