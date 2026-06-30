// DetailList — a read-only key/value list for a record's fields.
// - Drop in a list of { label, value } rows; renders a tidy two-column list
// - `value` is any node, so links/badges/JSX work, not just text
// - Optional card title; falsy values render as an em dash
import React from 'react';
import {
  IonCard, IonCardContent, IonCardHeader, IonCardTitle,
  IonItem, IonLabel,
} from '@ionic/react';
import EmptyState from './EmptyState';

export interface DetailRow {
  label: string;
  value: React.ReactNode;
}

interface Props {
  rows:          DetailRow[];
  title?:        string;
  emptyMessage?: string;
}

const DetailList: React.FC<Props> = ({ rows, title, emptyMessage = 'Nothing to show' }) => (
  <IonCard>
    {title && (
      <IonCardHeader style={{ padding: '8px 12px' }}>
        <IonCardTitle style={{ fontSize: '1rem' }}>{title}</IonCardTitle>
      </IonCardHeader>
    )}
    <IonCardContent style={{ '--padding-start': 0, '--padding-end': 0 } as React.CSSProperties}>
      {rows.length === 0 ? (
        <EmptyState message={emptyMessage} />
      ) : (
        rows.map((r, i) => (
          <IonItem key={i} lines="full">
            <IonLabel>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--ion-color-medium)' }}>{r.label}</p>
              <div style={{ margin: 0 }}>
                {r.value === null || r.value === undefined || r.value === '' ? '—' : r.value}
              </div>
            </IonLabel>
          </IonItem>
        ))
      )}
    </IonCardContent>
  </IonCard>
);

export default DetailList;
