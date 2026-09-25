import { useSimController, useSimState } from '../hooks/useSim.js';

/** Shown once, so people arriving from a shared link know what they are looking at. */
export default function WelcomeCard() {
  const sim = useSimController();
  const { ui, runState } = useSimState();
  if (ui.introSeen || runState !== 'idle') return null;
  const close = () => sim.setUi({ introSeen: true });
  return (
    <div className="welcome" role="dialog" aria-labelledby="welcomeTitle">
      <h2 id="welcomeTitle">An Arduino maze robot in your browser</h2>
      <p>This is a real robot's design: an Arduino Uno, an L298N motor driver and three ultrasonic sensors. Its program is ordinary Arduino C++, compiled right here. Press Upload &amp; run and watch it find the white square.</p>
      <p className="muted">Then change the code, drag the robot, or edit the walls and try again.</p>
      <div className="row">
        <button className="btn primary" onClick={() => { close(); sim.uploadAndRun(); }}>Upload &amp; run the solver</button>
        <button className="btn quiet" onClick={close}>Look around first</button>
      </div>
    </div>
  );
}
