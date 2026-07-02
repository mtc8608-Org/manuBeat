// CodeEditor — a lightweight, dependency-free code field.
// - Syntax highlighting via a transparent <textarea> layered over a highlighted
//   <pre> (scroll-synced); no external editor/highlighter library.
// - Language-pluggable: highlighters are registered per `language` in
//   HIGHLIGHTERS; unknown languages fall back to plain (escaped) text.
// - Collapsible section header so long blocks (preamble, header) can be folded.
// - Controlled: give it `value` + `onChange`. Used by FormRenderer's `code` type.
import React, { useEffect, useRef, useState } from 'react';
import { IonIcon } from '@ionic/react';
import { chevronDownOutline, chevronForwardOutline } from 'ionicons/icons';

export interface CodeEditorProps {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  language?: string;
  minHeight?: number;
  defaultOpen?: boolean;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type Highlighter = (code: string) => string;

// LaTeX tokens: comments, commands, braces/brackets, and math `$` delimiters.
const LATEX_TOKEN = /(%[^\n]*)|(\\[a-zA-Z@]+\*?|\\.)|([{}[\]])|(\$)/g;
const LATEX_COLOR = { comment: '#8b949e', cmd: '#4c8dff', brace: '#d29922', math: '#3fb950' } as const;

const highlightLatex: Highlighter = (code) => {
  let out = '', last = 0, m: RegExpExecArray | null;
  LATEX_TOKEN.lastIndex = 0;
  while ((m = LATEX_TOKEN.exec(code)) !== null) {
    out += escapeHtml(code.slice(last, m.index));
    const [tok] = m;
    const color = m[1] ? LATEX_COLOR.comment : m[2] ? LATEX_COLOR.cmd : m[3] ? LATEX_COLOR.brace : LATEX_COLOR.math;
    const italic = m[1] ? 'font-style:italic;' : '';
    out += `<span style="color:${color};${italic}">${escapeHtml(tok)}</span>`;
    last = m.index + tok.length;
  }
  out += escapeHtml(code.slice(last));
  return out + '\n';   // trailing newline keeps the last line visible under the textarea
};

const highlightPlain: Highlighter = (code) => escapeHtml(code) + '\n';

const HIGHLIGHTERS: Record<string, Highlighter> = {
  latex: highlightLatex,
};

const boxStyle: React.CSSProperties = {
  margin: 0,
  padding: '10px 12px',
  fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, Consolas, monospace",
  fontSize: 12.5,
  lineHeight: 1.55,
  tabSize: 2,
  whiteSpace: 'pre',            // no soft-wrap → textarea and <pre> align exactly
  overflow: 'auto',
  border: 'none',
  boxSizing: 'border-box',
  width: '100%',
};

const CodeEditor: React.FC<CodeEditorProps> = ({
  value, onChange, label, language = 'latex', minHeight = 160, defaultOpen = true,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const taRef  = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const highlight = HIGHLIGHTERS[language] ?? highlightPlain;

  const syncScroll = () => {
    if (preRef.current && taRef.current) {
      preRef.current.scrollTop  = taRef.current.scrollTop;
      preRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  };

  // Grow the textarea to fit ALL of its content so the whole code is visible from
  // the start — no inner scrollbar. Runs on open and whenever the value changes
  // (the template loads async, after mount). `minHeight` is the floor; the user
  // can still drag the resize grip afterwards.
  const autoSize = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.max(ta.scrollHeight, minHeight)}px`;
  };
  useEffect(() => { if (open) autoSize(); }, [open, value]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ marginTop: 10, border: '1px solid var(--ion-border-color, #ddd)', borderRadius: 8, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
          padding: '8px 12px', background: 'var(--ion-color-light, #f4f5f8)',
          border: 'none', borderBottom: open ? '1px solid var(--ion-border-color, #ddd)' : 'none',
          cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 600,
          color: 'var(--ion-text-color)', textAlign: 'left',
        }}
      >
        <IonIcon icon={open ? chevronDownOutline : chevronForwardOutline} style={{ fontSize: 14 }} />
        {label}
      </button>

      {open && (
        <div style={{ position: 'relative', background: 'var(--ion-background-color, #fff)' }}>
          <pre
            ref={preRef}
            aria-hidden="true"
            style={{ ...boxStyle, position: 'absolute', inset: 0, pointerEvents: 'none', color: 'var(--ion-text-color)' }}
            dangerouslySetInnerHTML={{ __html: highlight(value ?? '') }}
          />
          <textarea
            ref={taRef}
            value={value ?? ''}
            spellCheck={false}
            wrap="off"
            onChange={e => onChange(e.target.value)}
            onScroll={syncScroll}
            style={{
              ...boxStyle, position: 'relative', display: 'block', resize: 'vertical',
              minHeight, background: 'transparent', color: 'transparent',
              caretColor: 'var(--ion-text-color)', outline: 'none',
            }}
          />
        </div>
      )}
    </div>
  );
};

export default CodeEditor;
