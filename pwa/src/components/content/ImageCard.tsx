// ImageCard — a content card for a single image.
// - Displays the image centred inside a card
// - Shows a muted placeholder when no image has been set yet
import React from 'react';
import { IonCard, IonCardContent, IonButton, IonButtons, IonIcon } from '@ionic/react';
import { createOutline, trashOutline } from 'ionicons/icons';
import { ContentCardProps } from './HtmlCard';

const AdminControls: React.FC<{ onEdit?: () => void; onDelete?: () => void }> = ({ onEdit, onDelete }) => (
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

const ImageCard: React.FC<ContentCardProps> = ({ card, isAdmin, onEdit, onDelete }) => (
  <IonCard style={{ marginBottom: 16 }}>
    {isAdmin && <AdminControls onEdit={onEdit} onDelete={onDelete} />}
    <IonCardContent style={{ textAlign: 'center' }}>
      {card.data?.src
        ? <img
            src={card.data.src}
            alt={card.data?.alt ?? ''}
            style={{ maxWidth: '100%', display: 'block', margin: '0 auto', borderRadius: 6 }}
          />
        : <span style={{ color: 'var(--ion-color-medium)' }}>No image set</span>
      }
    </IonCardContent>
  </IonCard>
);

export default ImageCard;
