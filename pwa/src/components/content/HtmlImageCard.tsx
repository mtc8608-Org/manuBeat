// HtmlImageCard — a two-column content card: text beside an image.
// - Rich HTML on the left, image on the right; stacks vertically on small screens
// - Extracts the first <h2> as a collapsible header
import React from 'react';
import { IonGrid, IonRow, IonCol } from '@ionic/react';
import { ContentCardProps } from './HtmlCard';
import CollapsibleCard, { extractH2 } from './CollapsibleCard';

const HtmlImageCard: React.FC<ContentCardProps> = ({ card, isAdmin, onEdit, onDelete }) => {
  const { title, body } = extractH2(card.data?.html ?? '');
  return (
    <CollapsibleCard title={title} isAdmin={isAdmin} onEdit={onEdit} onDelete={onDelete}>
      <IonGrid style={{ padding: 0 }}>
        <IonRow>
          <IonCol size="12" sizeMd="7" style={{ paddingRight: 16 }}>
            {/* eslint-disable-next-line react/no-danger */}
            <div dangerouslySetInnerHTML={{ __html: body }} />
          </IonCol>
          <IonCol size="12" sizeMd="5">
            {card.data?.src
              ? <img
                  src={card.data.src}
                  alt={card.data?.alt ?? ''}
                  style={{ maxWidth: '100%', display: 'block', margin: '0 auto', borderRadius: 6 }}
                />
              : <div style={{ height: '100%', minHeight: 120, display: 'flex',
                              alignItems: 'center', justifyContent: 'center',
                              color: 'var(--ion-color-medium)', border: '1px dashed var(--ion-border-color)',
                              borderRadius: 6 }}>
                  No image set
                </div>
            }
          </IonCol>
        </IonRow>
      </IonGrid>
    </CollapsibleCard>
  );
};

export default HtmlImageCard;
