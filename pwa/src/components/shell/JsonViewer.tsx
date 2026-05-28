// JsonViewer — read-only collapsible JSON tree with validation.
// Accepts a parsed object or a raw JSON string. If the string is invalid,
// renders the parse error (with position) instead of the tree.
import React, { useEffect, useState } from 'react';
import { IonButton, IonButtons, IonIcon } from '@ionic/react';
import { copyOutline, expandOutline, contractOutline } from 'ionicons/icons';


// ── Primitive colour tokens ───────────────────────────────────────────────────

const COLOR = {
  string:  'var(--ion-color-success)',
  number:  'var(--ion-color-primary)',
  boolean: 'var(--ion-color-warning)',
  null:    'var(--ion-color-medium)',
  key:     'var(--ion-text-color)',
  punct:   'var(--ion-color-medium)',
};

const BASE_STYLE: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize:   '0.78rem',
  lineHeight: 1.6,
};


// ── Recursive tree node ───────────────────────────────────────────────────────

interface NodeProps {
  value:        any;
  depth:        number;
  initialDepth: number;
  forceOpen?:   boolean;  // used by expand-all / collapse-all
}

const JsonNode: React.FC<NodeProps> = ({ value, depth, initialDepth, forceOpen }) => {
  const [open, setOpen] = useState(depth < initialDepth);

  useEffect(() => {
    if (forceOpen !== undefined) setOpen(forceOpen);
  }, [forceOpen]);

  const isOpen = open;

  if (value === null)      return <span style={{ color: COLOR.null }}>null</span>;
  if (value === undefined) return <span style={{ color: COLOR.null }}>undefined</span>;

  if (typeof value === 'boolean')
    return <span style={{ color: COLOR.boolean }}>{String(value)}</span>;

  if (typeof value === 'number')
    return <span style={{ color: COLOR.number }}>{String(value)}</span>;

  if (typeof value === 'string')
    return <span style={{ color: COLOR.string }}>"{value}"</span>;

  if (Array.isArray(value)) {
    if (value.length === 0) return <span style={{ color: COLOR.punct }}>[]</span>;
    return (
      <span>
        <span
          style={{ color: COLOR.punct, cursor: 'pointer', userSelect: 'none' }}
          onClick={() => setOpen(o => !o)}
        >
          {isOpen ? '▾' : '▸'} {!isOpen && <span style={{ color: COLOR.null }}>[{value.length}]</span>}
        </span>
        {isOpen && (
          <span>
            {'[\n'}
            {value.map((item, i) => (
              <span key={i} style={{ display: 'block', paddingLeft: 16 }}>
                <JsonNode value={item} depth={depth + 1} initialDepth={initialDepth} forceOpen={forceOpen} />
                {i < value.length - 1 && <span style={{ color: COLOR.punct }}>,</span>}
              </span>
            ))}
            {']'}
          </span>
        )}
      </span>
    );
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return <span style={{ color: COLOR.punct }}>{'{}'}</span>;
    return (
      <span>
        <span
          style={{ color: COLOR.punct, cursor: 'pointer', userSelect: 'none' }}
          onClick={() => setOpen(o => !o)}
        >
          {isOpen ? '▾' : '▸'} {!isOpen && <span style={{ color: COLOR.null }}>{'{' + keys.length + '}'}</span>}
        </span>
        {isOpen && (
          <span>
            {'{\n'}
            {keys.map((k, i) => (
              <span key={k} style={{ display: 'block', paddingLeft: 16 }}>
                <span style={{ color: COLOR.key }}>"{k}"</span>
                <span style={{ color: COLOR.punct }}>: </span>
                <JsonNode value={value[k]} depth={depth + 1} initialDepth={initialDepth} forceOpen={forceOpen} />
                {i < keys.length - 1 && <span style={{ color: COLOR.punct }}>,</span>}
              </span>
            ))}
            {'}'}
          </span>
        )}
      </span>
    );
  }

  return <span>{String(value)}</span>;
};


// ── Public component ──────────────────────────────────────────────────────────

interface JsonViewerProps {
  value:         string | object;
  height?:       string;
  initialDepth?: number;
}

const JsonViewer: React.FC<JsonViewerProps> = ({
  value,
  height       = '60vh',
  initialDepth = 2,
}) => {
  const [forceOpen, setForceOpen] = useState<boolean | undefined>(undefined);
  const [copied,    setCopied]    = useState(false);

  // Parse if given a string
  let parsed: any;
  let parseError: string | null = null;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); }
    catch (e) { parseError = (e as Error).message; }
  } else {
    parsed = value;
  }

  const jsonString = parseError
    ? (value as string)
    : JSON.stringify(parsed, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleExpandAll   = () => { setForceOpen(true);  setTimeout(() => setForceOpen(undefined), 0); };
  const handleCollapseAll = () => { setForceOpen(false); setTimeout(() => setForceOpen(undefined), 0); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height }}>
      {/* toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--ion-border-color)', paddingBottom: 4, marginBottom: 4, flexShrink: 0 }}>
        <IonButtons>
          <IonButton size="small" fill="clear" onClick={handleCopy} disabled={!!parseError}>
            <IonIcon icon={copyOutline} slot="start" />
            {copied ? 'Copied' : 'Copy'}
          </IonButton>
          {!parseError && (
            <>
              <IonButton size="small" fill="clear" onClick={handleExpandAll}>
                <IonIcon icon={expandOutline} slot="start" />
                Expand all
              </IonButton>
              <IonButton size="small" fill="clear" onClick={handleCollapseAll}>
                <IonIcon icon={contractOutline} slot="start" />
                Collapse all
              </IonButton>
            </>
          )}
        </IonButtons>
      </div>

      {/* content */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
        {parseError ? (
          <div style={{ ...BASE_STYLE }}>
            <div style={{
              padding: '8px 12px',
              background: 'rgba(var(--ion-color-danger-rgb), 0.12)',
              border: '1px solid var(--ion-color-danger)',
              borderRadius: 4,
              color: 'var(--ion-color-danger)',
              marginBottom: 8,
              fontSize: '0.75rem',
            }}>
              <strong>Invalid JSON:</strong> {parseError}
            </div>
            <pre style={{ margin: 0, color: 'var(--ion-color-medium)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {value as string}
            </pre>
          </div>
        ) : (
          <div style={{ ...BASE_STYLE, whiteSpace: 'pre' }}>
            <JsonNode value={parsed} depth={0} initialDepth={initialDepth} forceOpen={forceOpen} />
          </div>
        )}
      </div>
    </div>
  );
};

export default JsonViewer;
