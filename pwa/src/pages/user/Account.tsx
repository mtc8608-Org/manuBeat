// Page: Account — account identity (email / role) and password change.
// Reads/writes: auth user (context) + /change-password (REST).
// Authenticated.

import React, { useState } from 'react';
import {
  IonItem, IonLabel, IonInput, IonButton, IonText, IonSpinner,
} from '@ionic/react';
import ApiService from '../../services/Api';
import SinglePanelLayout from '../../components/shell/SinglePanelLayout';
import { useAuth } from '../../contexts/AuthContext';
import { AREA_NAV } from '../../constants';


const Account: React.FC = () => {

  const { user } = useAuth();


/*
   ██████  ██████████    ████    ██████████  ████████
 ██            ██      ██    ██      ██      ██
   ████        ██      ████████      ██      ██████
       ██      ██      ██    ██      ██      ██
 ██████        ██      ██    ██      ██      ████████
                                                       */


  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw]         = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwError, setPwError]     = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwSaving, setPwSaving]   = useState(false);


/*
 ██    ██    ████    ██      ██  ██████    ██        ████████  ██████      ██████
 ██    ██  ██    ██  ████    ██  ██    ██  ██        ██        ██    ██  ██
 ████████  ████████  ██  ██  ██  ██    ██  ██        ██████    ██████      ████
 ██    ██  ██    ██  ██    ████  ██    ██  ██        ██        ██    ██        ██
 ██    ██  ██    ██  ██      ██  ██████    ████████  ████████  ██    ██  ██████
                                                                                   */


  // Bespoke JSX by design: cross-field validation (confirm must match new) and a
  // fixed REST endpoint don't fit the seeded-FormRenderer contract (forms-ui.md).
  const handleChangePassword = async () => {
    setPwError('');
    setPwSuccess(false);
    if (newPw !== confirmPw) { setPwError('New passwords do not match'); return; }
    if (newPw.length < 8)    { setPwError('New password must be at least 8 characters'); return; }
    setPwSaving(true);
    try {
      await ApiService.changePassword(currentPw, newPw);
      setPwSuccess(true);
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
    } catch (e: any) {
      setPwError(e.message ?? 'Failed to change password');
    } finally {
      setPwSaving(false);
    }
  };


/*
 ██████    ████████  ██      ██  ██████    ████████  ██████
 ██    ██  ██        ████    ██  ██    ██  ██        ██    ██
 ██████    ██████    ██  ██  ██  ██    ██  ██████    ██████
 ██    ██  ██        ██    ████  ██    ██  ██        ██    ██
 ██    ██  ████████  ██      ██  ██████    ████████  ██    ██
                                                               */


  return (
    <SinglePanelLayout
      navItems={AREA_NAV.USER}
      title="My Account"
      tabs={[
        {
          label: 'Account',
          content: (
            <>
              {/* ═══════════════════════════════════════════════════════════
                   Account info                                              */}
              <IonItem lines="full">
                <IonLabel>
                  <p style={{ fontSize: 12, color: 'var(--ion-color-medium)' }}>Email</p>
                  <p>{user?.email}</p>
                </IonLabel>
              </IonItem>
              <IonItem lines="full">
                <IonLabel>
                  <p style={{ fontSize: 12, color: 'var(--ion-color-medium)' }}>Role</p>
                  <p style={{ textTransform: 'capitalize' }}>{user?.role}</p>
                </IonLabel>
              </IonItem>

              {/* ═══════════════════════════════════════════════════════════
                   Change password                                           */}
              {pwError   && <IonItem lines="none"><IonText color="danger">{pwError}</IonText></IonItem>}
              {pwSuccess && <IonItem lines="none"><IonText color="success">Password changed successfully.</IonText></IonItem>}
              <IonItem lines="full">
                <IonInput label="Current password" labelPlacement="stacked" type="password"
                  value={currentPw} onIonInput={e => setCurrentPw(e.detail.value ?? '')} />
              </IonItem>
              <IonItem lines="full">
                <IonInput label="New password" labelPlacement="stacked" type="password"
                  value={newPw} onIonInput={e => setNewPw(e.detail.value ?? '')} />
              </IonItem>
              <IonItem lines="full">
                <IonInput label="Confirm new password" labelPlacement="stacked" type="password"
                  value={confirmPw} onIonInput={e => setConfirmPw(e.detail.value ?? '')} />
              </IonItem>
              <IonButton expand="block" style={{ marginTop: 16 }}
                disabled={pwSaving || !currentPw || !newPw || !confirmPw}
                onClick={handleChangePassword}
              >
                {pwSaving ? <IonSpinner name="dots" /> : 'Update Password'}
              </IonButton>
            </>
          ),
        },
      ]}
    />
  );
};

export default Account;
