// HtmlCard — a content card for rich HTML.
// - Extracts the first <h2> as a collapsible header; body toggles on click
// - Also exports AdminControls, the shared edit/delete toolbar used by every card type
import React from 'react';
import { IonButton, IonButtons, IonIcon } from '@ionic/react';
import { createOutline, trashOutline } from 'ionicons/icons';
import { Component } from '../../interfaces/types';
import CollapsibleCard, { extractH2 } from './CollapsibleCard';

export interface ContentCardProps {
  card: Component;
  isAdmin?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}

export const AdminControls: React.FC<{ onEdit?: () => void; onDelete?: () => void }> = ({ onEdit, onDelete }) => (
  <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '6px 8px 0' }}>
    <IonButtons>
      <IonButton size="small" fill="outline" color="medium" onClick={onEdit}>
        <IonIcon slot="start" icon={createOutline} />Edit
      </IonButton>
      <IonButton size="small" fill="outline" color="danger" onClick={onDelete}>
        <IonIcon slot="start" icon={trashOutline} />Delete
      </IonButton>
    </IonButtons>
  </div>
);

const HtmlCard: React.FC<ContentCardProps> = ({ card, isAdmin, onEdit, onDelete }) => {
  const { title, body } = extractH2(card.data?.html ?? '');
  return (
    <CollapsibleCard title={title} isAdmin={isAdmin} onEdit={onEdit} onDelete={onDelete}>
      {/* eslint-disable-next-line react/no-danger */}
      <div dangerouslySetInnerHTML={{ __html: body }} />
    </CollapsibleCard>
  );
};

export default HtmlCard;
