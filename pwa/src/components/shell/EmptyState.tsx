// EmptyState — the "nothing here yet" placeholder.
// - Drop it anywhere a list or panel might be empty
// - Shows a muted message passed in as a prop
import React from 'react';
import { IonItem, IonLabel } from '@ionic/react';

interface Props {
  message: string;
}

const EmptyState: React.FC<Props> = ({ message }) => (
  <IonItem lines="none">
    <IonLabel color="medium">{message}</IonLabel>
  </IonItem>
);

export default EmptyState;
