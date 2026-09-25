import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { highlight } from './highlight.js';

const LINE_H = 20;

export interface EditorMark { line: number; kind: string }
export interface EditorJump { line: number; col: number }

interface CodeEditorProps {
  value: string; onChange: (text: string) => void; marks?: EditorMark[]; jump?: EditorJump | null; label: string;
}

/**
 * A textarea with a highlighted copy underneath. Tab indents (Esc then Tab moves focus
 * out), Enter keeps the indentation, and error or warning lines get a coloured band.
 */
export default function CodeEditor({ value, onChange, marks, jump, label }: CodeEditorProps) {
  const ta = useRef<HTMLTextAreaElement>(null), pre = useRef<HTMLPreElement>(null), gutter = useRef<HTMLDivElement>(null), flags = useRef<HTMLDivElement>(null);
  const escaped = useRef(false);
  const html = useMemo(() => highlight(value) + '\n', [value]);
  const lineCount = useMemo(() => value.split('\n').length, [value]);
  const byLine = useMemo(() => new Map((marks || []).map(m => [m.line, m.kind])), [marks]);

  const syncScroll = () => {
    const t = ta.current; if (!t || !pre.current || !gutter.current || !flags.current) return;
    pre.current.scrollTop = t.scrollTop; pre.current.scrollLeft = t.scrollLeft;
    gutter.current.scrollTop = t.scrollTop;
    flags.current.style.transform = `translateY(${-t.scrollTop}px)`;
  };
  useLayoutEffect(syncScroll, [html]);

  // jump to a line when an error in the output panel is clicked
  useEffect(() => {
    if (!jump) return;
    const t = ta.current; if (!t) return;
    const lines = t.value.split('\n');
    const line = Math.min(Math.max(1, jump.line | 0), lines.length);
    let pos = 0; for (let i = 0; i < line - 1; i++) pos += (lines[i]?.length ?? 0) + 1;
    const col = Math.min(Math.max(0, (jump.col | 0) - 1), lines[line - 1]?.length ?? 0);
    t.focus({ preventScroll: true });
    t.setSelectionRange(pos + col, pos + (lines[line - 1]?.length ?? 0));
    t.scrollTop = Math.max(0, (line - 1) * LINE_H - t.clientHeight / 2 + LINE_H);
    syncScroll();
  }, [jump]);

  // insert text in a way that keeps the browser's undo history
  const insert = (text: string) => {
    const t = ta.current; if (!t) return;
    if (!document.execCommand || !document.execCommand('insertText', false, text)) {
      t.setRangeText(text, t.selectionStart ?? 0, t.selectionEnd ?? 0, 'end');
      onChange(t.value);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const t = ta.current; if (!t) return;
    const v = t.value, s = t.selectionStart, en = t.selectionEnd;
    if (e.key === 'Escape') { escaped.current = true; return; }
    const mod = e.ctrlKey || e.metaKey || e.altKey;
    if (e.key === 'Tab' && !escaped.current && !mod) {
      e.preventDefault();
      const lineStart = v.lastIndexOf('\n', s - 1) + 1;
      if (s !== en && v.slice(s, en).includes('\n')) {
        const block = v.slice(lineStart, en);
        const next = e.shiftKey ? block.replace(/^ {1,2}/gm, '') : block.replace(/^/gm, '  ');
        t.setSelectionRange(lineStart, en); insert(next); t.setSelectionRange(lineStart, lineStart + next.length);
      } else if (e.shiftKey) {
        const n = v.slice(lineStart, lineStart + 2) === '  ' ? 2 : v[lineStart] === ' ' ? 1 : 0;
        if (n) { t.setSelectionRange(lineStart, lineStart + n); insert(''); t.setSelectionRange(s - n, s - n); }
      } else insert('  ');
      return;
    }
    escaped.current = false;
    if (e.key === 'Enter' && !mod && !e.shiftKey) {
      const lineStart = v.lastIndexOf('\n', s - 1) + 1, before = v.slice(lineStart, s);
      const indent = (before.match(/^[ \t]*/) || [''])[0];
      e.preventDefault(); insert('\n' + indent + (before.trimEnd().endsWith('{') ? '  ' : ''));
      return;
    }
    if (e.key === '}' && !mod && s === en) {
      const lineStart = v.lastIndexOf('\n', s - 1) + 1;
      if (/^ {2,}$/.test(v.slice(lineStart, s))) { e.preventDefault(); t.setSelectionRange(s - 2, s); insert('}'); }
    }
  };

  return (
    <div className="editor">
      <div className="gutter" ref={gutter} aria-hidden="true">
        {Array.from({ length: lineCount }, (_, i) => <div key={i} className={byLine.get(i + 1) || undefined}>{i + 1}</div>)}
      </div>
      <div className="codewrap">
        <div ref={flags}>
          {[...byLine].map(([line, kind]) => <div key={line} className={'lineflag ' + kind} style={{ top: 10 + (line - 1) * LINE_H }} />)}
        </div>
        {/* `html` comes only from highlight()'s escaped output (see its docstring) - never raw source text. */}
        <pre ref={pre} aria-hidden="true"><code dangerouslySetInnerHTML={{ __html: html }} /></pre>
        <textarea ref={ta} value={value} onChange={e => onChange(e.target.value)} onScroll={syncScroll} onKeyDown={onKeyDown}
          spellCheck={false} autoCapitalize="off" autoComplete="off" autoCorrect="off" wrap="off" aria-label={label} />
      </div>
    </div>
  );
}
