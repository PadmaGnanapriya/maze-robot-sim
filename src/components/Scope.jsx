import { useEffect, useRef } from 'react';

const COLOURS = ['--sF', '--sL', '--sR'];
const SPAN = 8e6;   // eight seconds of virtual time

/** Rolling plot of the three sonar distances, on a square-root scale so short ranges get more room. */
export default function Scope({ readings, now }) {
  const canvasRef = useRef(null);
  const history = useRef([[], [], []]), lastT = useRef([-1, -1, -1]);

  useEffect(() => {
    readings.forEach((rd, i) => {
      if (!rd || rd.t === lastT.current[i]) return;
      lastT.current[i] = rd.t;
      const h = history.current[i];
      if (h.length && rd.t < h[h.length - 1][0]) h.length = 0;   // time went backwards: new run
      h.push([rd.t, rd.d]);
      if (h.length > 900) h.splice(0, 300);
    });
    const cv = canvasRef.current; if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
    if (!w) return;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext('2d');
    const css = getComputedStyle(cv);
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const y = d => h - 3 - Math.sqrt(Math.min(150, d) / 150) * (h - 8);
    const t0 = now - SPAN;
    g.font = '10px Barlow, sans-serif'; g.fillStyle = css.getPropertyValue('--faint'); g.strokeStyle = css.getPropertyValue('--line'); g.lineWidth = 1;
    for (const d of [10, 30, 80, 150]) { const yy = Math.round(y(d)) + 0.5; g.beginPath(); g.moveTo(26, yy); g.lineTo(w, yy); g.stroke(); g.fillText(String(d), 4, yy + 3); }
    history.current.forEach((series, i) => {
      g.strokeStyle = css.getPropertyValue(COLOURS[i]); g.lineWidth = 1.6; g.beginPath();
      let pen = false;
      for (const [t, d] of series) {
        if (t < t0) continue;
        if (d == null) { pen = false; continue; }
        const x = 26 + (t - t0) / SPAN * (w - 26);
        if (pen) g.lineTo(x, y(d)); else { g.moveTo(x, y(d)); pen = true; }
      }
      g.stroke();
    });
  }, [readings, now]);

  return <canvas ref={canvasRef} className="scope" aria-label="Sonar distance history, last 8 seconds" />;
}
