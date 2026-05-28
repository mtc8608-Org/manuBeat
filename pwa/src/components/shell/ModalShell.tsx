// ModalShell — the standard popup dialog wrapper.
// - Consistent title bar across all modals
// - Close / cancel button wired up automatically
// - Drop any content inside; it handles the chrome
import React from 'react';
import {
  IonModal, IonHeader, IonToolbar, IonTitle,
  IonButtons, IonButton, IonContent,
} from '@ionic/react';

interface Props {
  isOpen: boolean;
  onDismiss: () => void;
  title: string;
  dismissLabel?: string;
  children: React.ReactNode;
}

const ModalShell: React.FC<Props> = ({ isOpen, onDismiss, title, dismissLabel = 'Cancel', children }) => (
  <IonModal isOpen={isOpen} onDidDismiss={onDismiss}>
    <IonHeader>
      <IonToolbar>
        <IonTitle>{title}</IonTitle>
        <IonButtons slot="end">
          <IonButton onClick={onDismiss}>{dismissLabel}</IonButton>
        </IonButtons>
      </IonToolbar>
    </IonHeader>
    <IonContent className="ion-padding">
      {children}
    </IonContent>
  </IonModal>
);

export default ModalShell;
