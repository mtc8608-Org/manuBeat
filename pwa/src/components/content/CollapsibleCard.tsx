// CollapsibleCard — shared wrapper for all content card types.
// - Extracts the first <h2> from the card HTML and renders it as a clickable header
// - Toggles the body content on click; body stays in DOM (hidden via display:none)
//   so KaTeX and other imperative renderers still work when the card is collapsed
import React, { useState } from 'react';
import { IonCard, IonCardContent, IonIcon } from '@ionic/react';
import { chevronDownOutline, chevronUpOutline } from 'ionicons/icons';
import { AdminControls } from './HtmlCard';

interface CollapsibleCardProps {
  title: string;
  isAdmin?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  children: React.ReactNode;
}

export const extractH2 = (html: string): { title: string; body: string } => {
  const match = html.match(/^<h2>([\s\S]*?)<\/h2>/);
  if (match) return { title: match[1], body: html.slice(match[0].length).trimStart() };
  return { title: '', body: html };
};

const CollapsibleCard: React.FC<CollapsibleCardProps> = ({
  title,
  isAdmin,
  onEdit,
  onDelete,
  children,
}) => {
  const [collapsed, setCollapsed] = useState(false);

  if (!title) {
    return (
      <IonCard style={{ marginBottom: 16 }}>
        {isAdmin && <AdminControls onEdit={onEdit} onDelete={onDelete} />}
        <IonCardContent>{children}</IonCardContent>
      </IonCard>
    );
  }

  return (
    <IonCard style={{ marginBottom: 16 }}>
      {isAdmin && <AdminControls onEdit={onEdit} onDelete={onDelete} />}
      <div
        onClick={() => setCollapsed(c => !c)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          cursor: 'pointer',
          userSelect: 'none',
          borderBottom: collapsed ? 'none' : '1px solid var(--ion-border-color, rgba(0,0,0,0.1))',
        }}
      >
        {/* eslint-disable-next-line react/no-danger */}
        <h2
          style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600 }}
          dangerouslySetInnerHTML={{ __html: title }}
        />
        <IonIcon
          icon={collapsed ? chevronDownOutline : chevronUpOutline}
          style={{ flexShrink: 0, marginLeft: 12, color: 'var(--ion-color-medium)' }}
        />
      </div>
      <div style={{ display: collapsed ? 'none' : 'block' }}>
        <IonCardContent>{children}</IonCardContent>
      </div>
    </IonCard>
  );
};

export default CollapsibleCard;
