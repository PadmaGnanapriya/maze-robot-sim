/**
 * Lines received from Serial, with the virtual time each line started.
 * If the monitor baud rate does not match Serial.begin(), text is garbled
 * the way the Arduino IDE shows it.
 */
const MAX_LINES = 3000;

function garble(s: string): string {
  let o = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    o += c === 10 ? '\n' : (c * 7 + i) % 5 === 0 ? String.fromCharCode(0xa1 + (c % 60)) : '⸮';
  }
  return o;
}

export class SerialBuffer {
  lines: string[] = [];
  times: (number | null)[] = [];
  current = '';
  currentTime: number | null = null;
  version = 0;
  unseen = 0;

  clear(): void {
    this.lines = []; this.times = [];
    this.current = ''; this.currentTime = null;
    this.version = 0; this.unseen = 0;
  }

  push(text: string, time: number, garbled?: boolean): void {
    if (garbled) text = garble(text);
    for (const ch of text) {
      if (ch === '\r') continue;
      if (ch === '\n') { this.endLine(); this.unseen++; continue; }
      if (this.currentTime == null) this.currentTime = time;
      this.current += ch;
    }
    if (this.current.length > 4000) this.endLine();
    if (this.lines.length > MAX_LINES) { this.lines.splice(0, 500); this.times.splice(0, 500); }
    this.version++;
  }

  endLine(): void {
    this.lines.push(this.current); this.times.push(this.currentTime);
    this.current = ''; this.currentTime = null;
    this.version++;
  }

  /** The last `limit` lines as text, optionally with IDE-style timestamps. */
  text(withTimes: boolean, limit = 1500): string {
    const from = Math.max(0, this.lines.length - limit);
    const stamp = (us: number | null) => {
      if (us == null) return ' '.repeat(13);
      const ms = Math.floor(us / 1000), m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60;
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')} -> `;
    };
    let out = '';
    for (let i = from; i < this.lines.length; i++) out += (withTimes ? stamp(this.times[i] ?? null) : '') + this.lines[i] + '\n';
    if (this.current) out += (withTimes ? stamp(this.currentTime) : '') + this.current;
    return out;
  }
}
