// DataTable — a data grid for the right-hand panel of any page.
// - Fetches and displays rows from whatever source you give it
// - Toggle columns on/off to focus on what matters
// - Add key-value filters to narrow down the rows
// - One-click CSV export of the current view
import React, { useEffect, useMemo, useState } from 'react';
import {
  IonCard, IonCardContent, IonCardHeader, IonCardTitle,
  IonItem, IonLabel, IonInput, IonButton, IonButtons, IonIcon, IonSpinner,
} from '@ionic/react';
import { addOutline, trashOutline, createOutline, downloadOutline } from 'ionicons/icons';

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
}: DataTableProps<R>): React.ReactElement {
  const [rows, setRows]               = useState<R[]>([]);
  const [loading, setLoading]         = useState(false);
  const [filterRows, setFilterRows]   = useState<{ key: string; value: string }[]>([]);
  const [visibleCols, setVisibleCols] = useState<Set<string>>(new Set());

  const flatRows = useMemo(() =>
    rows.map(r => ({ row: r, flat: flattenRow ? flattenRow(r) : (r as unknown as Record<string, string>) })),
    [rows] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const displayedFlatRows = useMemo(() => {
    const active = filterRows.filter(f => f.key.trim() && f.value.trim());
    if (active.length === 0) return flatRows;
    return flatRows.filter(({ flat }) =>
      active.every(f => (flat[f.key.trim()] ?? '').toLowerCase().includes(f.value.trim().toLowerCase()))
    );
  }, [flatRows, filterRows]);

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
    const filter = filterRows.reduce((acc, { key, value }) => {
      if (key.trim() && value.trim()) acc[key.trim()] = value.trim();
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

  const addFilter    = () => setFilterRows(prev => [...prev, { key: '', value: '' }]);
  const removeFilter = (i: number) => setFilterRows(prev => prev.filter((_, j) => j !== i));
  const updateFilter = (i: number, field: 'key' | 'value', val: string) =>
    setFilterRows(prev => prev.map((r, j) => j === i ? { ...r, [field]: val } : r));

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
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${exportFilename}.csv`;
    link.click();
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

        {filterRows.map((row, i) => (
          <IonItem key={i} lines="none">
            <IonInput placeholder="Field key" value={row.key}
              onIonInput={e => updateFilter(i, 'key', e.detail.value ?? '')}
              style={{ marginRight: 8 }}
            />
            <IonInput placeholder="Value" value={row.value}
              onIonInput={e => updateFilter(i, 'value', e.detail.value ?? '')}
            />
            <IonButton slot="end" fill="clear" color="danger" onClick={() => removeFilter(i)}>
              <IonIcon icon={trashOutline} />
            </IonButton>
          </IonItem>
        ))}

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
