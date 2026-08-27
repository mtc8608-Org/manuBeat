// DataTable — a data grid for the right-hand panel of any page.
// - Fetches and displays rows from whatever source you give it
// - Toggle columns on/off to focus on what matters
// - Add key-value filters to narrow down the rows
// - One-click CSV export of the current view
import React, { useEffect, useMemo, useState } from 'react';
import {
  IonCard, IonCardContent, IonCardHeader, IonCardTitle,
  IonItem, IonLabel, IonInput, IonButton, IonButtons, IonIcon, IonSpinner,
  IonSelect, IonSelectOption,
} from '@ionic/react';
import { addOutline, trashOutline, createOutline, downloadOutline } from 'ionicons/icons';
import { downloadBlob } from '../../utils/download';

export const flattenObject = (obj: Record<string, any>, prefix = ''): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}_${key}` : key;
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      Object.assign(result, flattenObject(val, fullKey));
    } else {
      result[fullKey] = val === null || val === undefined ? '' : String(val);
    }
  }
  return result;
};

type Op = 'contains' | '=' | '≥' | '≤';
type ColType = 'text' | 'enum' | 'number' | 'date';

export interface DataTableLeadingCol<R> {
  label: string;
  format: (row: R) => string;
}

interface DataTableProps<R extends { id: string }> {
  fetcher: (filter: Record<string, string>) => Promise<R[]>;
  flattenRow?: (row: R) => Record<string, string>;
  leadingCols?: DataTableLeadingCol<R>[];
  labelMap?: Map<string, string>;
  title?: string;
  exportFilename?: string;
  refreshToken?: number;
  onEdit?: (row: R) => void;
  onDelete?: (id: string) => Promise<void>;
  /** Columns with a fixed value set → the filter value becomes a dropdown (implies enum). */
  filterOptions?: Record<string, string[]>;
  /** Per-column type → drives the filter operator (text=contains/=, enum==, number/date=/≥/≤). */
  columnTypes?: Record<string, 'text' | 'enum' | 'number' | 'date'>;
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  borderBottom: '2px solid var(--ion-color-medium)',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderBottom: '1px solid var(--ion-border-color)',
  verticalAlign: 'top',
  whiteSpace: 'nowrap',
};

function DataTable<R extends { id: string }>({
  fetcher,
  flattenRow,
  leadingCols = [],
  labelMap,
  title = 'Data',
  exportFilename = 'export',
  refreshToken,
  onEdit,
  onDelete,
  filterOptions,
  columnTypes,
}: DataTableProps<R>): React.ReactElement {
  const [rows, setRows]               = useState<R[]>([]);
  const [loading, setLoading]         = useState(false);
  const [filterRows, setFilterRows]   = useState<{ key: string; op: Op; value: string }[]>([]);
  const [visibleCols, setVisibleCols] = useState<Set<string>>(new Set());

  // ── Column-aware filtering (op depends on the column's type) ──────────────────
  const colTypeOf = (key: string): ColType =>
    columnTypes?.[key] ?? (filterOptions?.[key] ? 'enum' : 'text');
  const opsForType = (t: ColType): Op[] =>
    t === 'enum' ? ['='] : (t === 'number' || t === 'date') ? ['=', '≥', '≤'] : ['contains', '='];
  const defaultOp = (t: ColType): Op => (t === 'text' ? 'contains' : '=');
  const matchCell = (cell: string, op: Op, val: string, t: ColType): boolean => {
    if (!val.trim()) return true;
    if (op === 'contains') return cell.toLowerCase().includes(val.toLowerCase());
    if (t === 'number') {
      const a = parseFloat(cell), b = parseFloat(val);
      if (isNaN(a) || isNaN(b)) return false;
      return op === '=' ? a === b : op === '≥' ? a >= b : a <= b;
    }
    if (t === 'date') {
      const a = new Date(cell).getTime(), b = new Date(val).getTime();
      if (isNaN(a) || isNaN(b)) return false;
      if (op === '=') return new Date(cell).toDateString() === new Date(val).toDateString();
      return op === '≥' ? a >= b : a <= b;
    }
    return cell.toLowerCase() === val.toLowerCase();   // text '=' / enum
  };

  const flatRows = useMemo(() =>
    rows.map(r => ({ row: r, flat: flattenRow ? flattenRow(r) : (r as unknown as Record<string, string>) })),
    [rows] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const displayedFlatRows = useMemo(() => {
    const active = filterRows.filter(f => f.key.trim() && f.value.trim());
    if (active.length === 0) return flatRows;
    return flatRows.filter(({ flat }) =>
      active.every(f => matchCell(flat[f.key] ?? '', f.op, f.value.trim(), colTypeOf(f.key)))
    );
  }, [flatRows, filterRows]); // eslint-disable-line react-hooks/exhaustive-deps

  const allCols = useMemo(() => {
    const keys = new Set<string>();
    flatRows.forEach(({ flat }) => Object.keys(flat).forEach(k => keys.add(k)));
    return [...keys];
  }, [flatRows]);

  useEffect(() => {
    if (allCols.length > 0) setVisibleCols(new Set(allCols));
  }, [allCols.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const shownCols = allCols.filter(c => visibleCols.has(c));
  const colLabel  = (key: string) => labelMap?.get(key) ?? key;

  const load = async () => {
    setLoading(true);
    // Only contains/= go to the server as key→value; ≥/≤ are refined client-side.
    const filter = filterRows.reduce((acc, { key, op, value }) => {
      if (key.trim() && value.trim() && (op === 'contains' || op === '=')) acc[key.trim()] = value.trim();
      return acc;
    }, {} as Record<string, string>);
    try { setRows(await fetcher(filter)); }
    catch (e) { console.error('DataTable fetch error:', e); }
    finally { setLoading(false); }
  };

  // Reload when parent signals a refresh (e.g. after an edit)
  useEffect(() => {
    if (refreshToken !== undefined && refreshToken > 0) load();
  }, [refreshToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const addFilter    = () => setFilterRows(prev => [...prev, { key: '', op: 'contains', value: '' }]);
  const removeFilter = (i: number) => setFilterRows(prev => prev.filter((_, j) => j !== i));
  const updateFilter = (i: number, field: 'key' | 'op' | 'value', val: string) =>
    setFilterRows(prev => prev.map((r, j) => {
      if (j !== i) return r;
      // Changing the column resets the operator to that type's default and clears the value.
      if (field === 'key') return { key: val, op: defaultOp(colTypeOf(val)), value: '' };
      return { ...r, [field]: field === 'op' ? (val as Op) : val };
    }));

  const toggleCol = (col: string) =>
    setVisibleCols(prev => {
      const next = new Set(prev);
      next.has(col) ? next.delete(col) : next.add(col);
      return next;
    });

  const handleDelete = async (id: string) => {
    if (!onDelete) return;
    await onDelete(id);
    setRows(prev => prev.filter(r => r.id !== id));
  };

  const downloadCSV = () => {
    const header = [
      ...leadingCols.map(c => c.label),
      ...shownCols.map(colLabel),
    ].join(',');
    const lines = displayedFlatRows.map(({ row, flat }) =>
      [
        ...leadingCols.map(c => `"${c.format(row).replace(/"/g, '""')}"`),
        ...shownCols.map(c => `"${(flat[c] ?? '').replace(/"/g, '""')}"`),
      ].join(',')
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, `${exportFilename}.csv`);
  };

  const hasActions = !!(onEdit || onDelete);

  return (
    <IonCard>
      <IonCardHeader>
        <IonItem lines="none">
          <IonCardTitle slot="start">{title}</IonCardTitle>
          {flatRows.length > 0 && (
            <IonButtons slot="end">
              <IonButton size="small" color="success" onClick={downloadCSV}>
                <IonIcon slot="start" icon={downloadOutline} />
                CSV
              </IonButton>
            </IonButtons>
          )}
        </IonItem>
      </IonCardHeader>
      <IonCardContent>

        {filterRows.map((row, i) => {
          const t        = colTypeOf(row.key);
          const ops      = opsForType(t);
          const enumOpts = filterOptions?.[row.key];
          return (
            <IonItem key={i} lines="none">
              <IonSelect placeholder="Column" value={row.key} interface="popover"
                onIonChange={e => updateFilter(i, 'key', e.detail.value)}
                style={{ marginRight: 8, minWidth: 130 }}>
                {allCols.map(c => <IonSelectOption key={c} value={c}>{colLabel(c)}</IonSelectOption>)}
              </IonSelect>
              {ops.length > 1 && (
                <IonSelect value={row.op} interface="popover"
                  onIonChange={e => updateFilter(i, 'op', e.detail.value)}
                  style={{ marginRight: 8, maxWidth: 120 }}>
                  {ops.map(o => <IonSelectOption key={o} value={o}>{o}</IonSelectOption>)}
                </IonSelect>
              )}
              {enumOpts ? (
                <IonSelect placeholder="Value" value={row.value} interface="popover"
                  onIonChange={e => updateFilter(i, 'value', e.detail.value)}>
                  {enumOpts.map(v => <IonSelectOption key={v} value={v}>{v}</IonSelectOption>)}
                </IonSelect>
              ) : t === 'date' ? (
                <input type="date" value={row.value}
                  onChange={e => updateFilter(i, 'value', e.target.value)}
                  style={{ flex: 1, background: 'transparent', color: 'var(--ion-text-color)', border: 'none' }} />
              ) : (
                <IonInput placeholder="Value" type={t === 'number' ? 'number' : 'text'} value={row.value}
                  onIonInput={e => updateFilter(i, 'value', e.detail.value ?? '')} />
              )}
              <IonButton slot="end" fill="clear" color="danger" onClick={() => removeFilter(i)}>
                <IonIcon icon={trashOutline} />
              </IonButton>
            </IonItem>
          );
        })}

        <IonButtons style={{ marginTop: 8 }}>
          <IonButton size="small" onClick={addFilter}>
            <IonIcon slot="start" icon={addOutline} />Add Filter
          </IonButton>
          <IonButton size="small" color="primary" disabled={loading} onClick={load}>
            {loading ? <IonSpinner name="dots" /> : 'Search'}
          </IonButton>
        </IonButtons>

        {allCols.length > 0 && (
          <div style={{ marginTop: 16, marginBottom: 8 }}>
            <IonLabel color="medium" style={{ fontSize: 12 }}>Visible columns:</IonLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
              {allCols.map(col => (
                <IonButton key={col} size="small"
                  fill={visibleCols.has(col) ? 'solid' : 'outline'}
                  color="medium"
                  onClick={() => toggleCol(col)}
                  style={{ '--padding-start': '8px', '--padding-end': '8px' } as any}
                >
                  {colLabel(col)}
                </IonButton>
              ))}
            </div>
          </div>
        )}

        {flatRows.length === 0 && !loading && (
          <IonItem lines="none" style={{ marginTop: 16 }}>
            <IonLabel color="medium">No results — click Search to load.</IonLabel>
          </IonItem>
        )}

        {flatRows.length > 0 && displayedFlatRows.length === 0 && !loading && (
          <IonItem lines="none" style={{ marginTop: 16 }}>
            <IonLabel color="medium">No rows match the current filter.</IonLabel>
          </IonItem>
        )}

        {displayedFlatRows.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {leadingCols.map((c, i) => <th key={i} style={thStyle}>{c.label}</th>)}
                  {shownCols.map(col => <th key={col} style={thStyle}>{colLabel(col)}</th>)}
                  {hasActions && <th style={thStyle}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {displayedFlatRows.map(({ row, flat }) => (
                  <tr key={row.id}>
                    {leadingCols.map((c, i) => <td key={i} style={tdStyle}>{c.format(row)}</td>)}
                    {shownCols.map(col => <td key={col} style={tdStyle}>{flat[col] ?? ''}</td>)}
                    {hasActions && (
                      <td style={tdStyle}>
                        {onEdit && (
                          <IonButton size="small" fill="clear" color="primary" onClick={() => onEdit(row)}>
                            <IonIcon icon={createOutline} />
                          </IonButton>
                        )}
                        {onDelete && (
                          <IonButton size="small" fill="clear" color="danger" onClick={() => handleDelete(row.id)}>
                            <IonIcon icon={trashOutline} />
                          </IonButton>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      </IonCardContent>
    </IonCard>
  );
}

export default DataTable;
