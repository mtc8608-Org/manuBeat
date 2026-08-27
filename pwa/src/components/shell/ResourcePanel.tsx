// ResourcePanel — the standard left-column item list.
// - Accepts either a fetcher (async, DB-backed) or a data array (local state)
// - Highlights the selected item, add button at top, delete button per item
// - Optional free-text search and type filter
// - Refreshes automatically when refreshToken changes (fetcher mode only)
// - Re-fetches on every Ionic page entry so stale data is never shown after navigation
import React, { useEffect, useMemo, useState } from 'react';
import {
  IonCard, IonCardContent, IonCardHeader, IonCardTitle,
  IonItem, IonLabel, IonList, IonButton, IonIcon, IonBadge,
  IonSpinner, IonSearchbar, IonSelect, IonSelectOption,
  useIonViewWillEnter,
} from '@ionic/react';
import { addOutline, chevronDownOutline, chevronUpOutline } from 'ionicons/icons';
import EmptyState from './EmptyState';
import { PanelConfig } from '../../interfaces/types';

export interface ResourceBadge { label: string; color?: string }

export interface ResourcePanelFilter {
  text?:            string;
  onTextChange?:    (v: string) => void;
  textPlaceholder?: string;
  types?:           readonly string[];
  typeValue?:       string;
  onTypeChange?:    (v: string) => void;
  typeAllLabel?:    string;   // label for the empty ("all") option, default 'All types'
}

interface ResourcePanelBase<T extends { id: string }> {
  title?:      string;
  selectedId?: string | null;

  getLabel:     (item: T) => string;
  getSubLabel?: (item: T) => string | undefined;
  getBadge?:    (item: T) => ResourceBadge | ResourceBadge[] | null;
  getIcon?:     (item: T) => string | undefined;

  onSelect:  (item: T) => void;
  onDelete?: (item: T) => void;
  onAdd?:    () => void;
  addLabel?: string;
  headerActions?: React.ReactNode;

  collapsible?:       boolean;
  defaultCollapsed?:  boolean;

  filter?:   ResourcePanelFilter;
  filterFn?: (item: T, text: string, typeValue: string) => boolean;

  config?:       PanelConfig;
  emptyMessage?: string;
}

// Discriminated union — pass exactly one of fetcher or data, never both.
type ResourcePanelProps<T extends { id: string }> = ResourcePanelBase<T> & (
  | { fetcher: () => Promise<T[]>; refreshToken?: number | string; data?: never  }
  | { data: T[];                   fetcher?: never;                refreshToken?: never }
);

function ResourcePanel<T extends { id: string }>({
  fetcher, data, refreshToken,
  title, selectedId,
  getLabel, getSubLabel, getBadge, getIcon,
  onSelect, onDelete, onAdd, addLabel,
  collapsible = false, defaultCollapsed = false,
  filter, filterFn, config,
  emptyMessage = 'No items yet',
  headerActions,
}: ResourcePanelProps<T>) {

  const [fetchedItems, setFetchedItems] = useState<T[]>([]);
  const [loading, setLoading]           = useState(false);
  const [collapsed, setCollapsed]       = useState(defaultCollapsed);
  const [viewVersion, setViewVersion]   = useState(0);

  useIonViewWillEnter(() => { if (fetcher) setViewVersion(v => v + 1); });

  useEffect(() => {
    if (!fetcher) return;
    let cancelled = false;
    setLoading(true);
    fetcher()
      .then(d    => { if (!cancelled) setFetchedItems(d); })
      .catch(e   => console.error('ResourcePanel fetch error:', e))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshToken, viewVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = data ?? fetchedItems;

  const displayItems = useMemo(() => {
    if (!filterFn) return items;
    const text      = filter?.text      ?? '';
    const typeValue = filter?.typeValue ?? '';
    if (!text && !typeValue) return items;
    return items.filter(item => filterFn(item, text, typeValue));
  }, [items, filter?.text, filter?.typeValue, filterFn]); // eslint-disable-line react-hooks/exhaustive-deps

  const effectiveTitle    = config?.title        ?? title ?? '';
  const effectiveEmptyMsg = config?.emptyMessage ?? emptyMessage;
  const effectiveAddLabel = config?.add?.label   ?? addLabel;
  const effectiveOnAdd    = config?.add?.enabled === false ? undefined : onAdd;

  const effectiveFilter: ResourcePanelFilter | undefined = filter ? {
    ...(config?.filter?.text?.enabled !== false
      ? filter
      : { ...filter, onTextChange: undefined, text: undefined }),
    ...(config?.filter?.text?.placeholder
      ? { textPlaceholder: config.filter.text.placeholder }
      : {}),
    ...(config?.filter?.type?.enabled === false
      ? { types: undefined, typeValue: undefined, onTypeChange: undefined }
      : {}),
    ...(config?.filter?.type?.options?.length
      ? { types: config.filter.type.options as string[] }
      : {}),
    ...(config?.filter?.type?.allLabel
      ? { typeAllLabel: config.filter.type.allLabel }
      : {}),
  } : filter;

  return (
    <IonCard>
      <IonCardHeader style={{ padding: '8px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <IonCardTitle style={{ fontSize: '1rem' }}>
            {`${effectiveTitle} (${displayItems.length})`}
          </IonCardTitle>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {headerActions}
            {effectiveOnAdd && !collapsed && (
              <IonButton size="small" color="success" onClick={effectiveOnAdd}>
                <IonIcon slot="start" icon={addOutline} />
                {effectiveAddLabel ?? 'New'}
              </IonButton>
            )}
            {collapsible && (
              <IonButton fill="clear" size="small" onClick={() => setCollapsed(c => !c)}>
                <IonIcon slot="icon-only" icon={collapsed ? chevronDownOutline : chevronUpOutline} />
              </IonButton>
            )}
          </div>
        </div>
      </IonCardHeader>

      {!collapsed && (
      <IonCardContent style={{ '--padding-start': 0, '--padding-end': 0 } as React.CSSProperties}>
        {effectiveFilter?.types && (
          <IonItem lines="full">
            <IonSelect
              label="Type"
              labelPlacement="stacked"
              placeholder="All types"
              value={effectiveFilter.typeValue ?? ''}
              onIonChange={e => effectiveFilter.onTypeChange?.(e.detail.value ?? '')}
            >
              <IonSelectOption value="">{effectiveFilter.typeAllLabel ?? 'All types'}</IonSelectOption>
              {effectiveFilter.types.map(t => (
                <IonSelectOption key={t} value={t}>{t}</IonSelectOption>
              ))}
            </IonSelect>
          </IonItem>
        )}

        {effectiveFilter?.onTextChange && (
          <IonSearchbar
            autocapitalize="off"
            value={effectiveFilter.text ?? ''}
            onIonInput={e => effectiveFilter.onTextChange!(e.detail.value ?? '')}
            placeholder={effectiveFilter.textPlaceholder ?? 'Search…'}
            debounce={200}
          />
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 24 }}><IonSpinner /></div>
        ) : displayItems.length === 0 ? (
          <EmptyState message={effectiveEmptyMsg} />
        ) : (
          <IonList>
            {displayItems.map(item => (
              <IonItem
                key={item.id}
                button
                detail={false}
                lines="full"
                color={selectedId === item.id ? 'primary' : undefined}
                onClick={() => onSelect(item)}
              >
                {getIcon?.(item) && <IonIcon slot="start" icon={getIcon!(item)} />}
                <IonLabel>
                  {(() => {
                    const sub = getSubLabel?.(item);
                    return sub ? (
                      <>
                        <p style={{ margin: 0 }}>{getLabel(item)}</p>
                        <p style={{ margin: 0, fontSize: 12, color: 'var(--ion-color-medium)' }}>{sub}</p>
                      </>
                    ) : getLabel(item);
                  })()}
                </IonLabel>
                {getBadge?.(item) && (() => {
                  const badge = getBadge!(item);
                  if (!badge) return null;
                  if (!Array.isArray(badge)) {
                    return <IonBadge slot="end" color={badge.color ?? 'medium'}>{badge.label}</IonBadge>;
                  }
                  // Stacked vertically and smaller — side by side they starve the
                  // label of width in the narrow left column (it collapses to 0).
                  return (
                    <div slot="end" style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
                      {badge.map((b, i) => (
                        <IonBadge key={i} color={b.color ?? 'medium'} style={{ fontSize: 10 }}>{b.label}</IonBadge>
                      ))}
                    </div>
                  );
                })()}
                {onDelete && (
                  <IonButton
                    slot="end" fill="clear" color="danger" size="small"
                    onClick={e => { e.stopPropagation(); onDelete(item); }}
                  >
                    Delete
                  </IonButton>
                )}
              </IonItem>
            ))}
          </IonList>
        )}
      </IonCardContent>
      )}
    </IonCard>
  );
}

export default ResourcePanel;
