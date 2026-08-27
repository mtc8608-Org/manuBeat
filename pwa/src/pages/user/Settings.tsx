// Page: Settings — app preferences (theme) and integrations (user_secrets keychain).
// Reads/writes: user_secrets via userSecrets/setUserSecret/clearUserSecret (GraphQL); theme in localStorage.
// Authenticated.

import React, { useEffect, useState } from 'react';
import {
  IonItem, IonLabel, IonInput, IonButton, IonText, IonSpinner,
  IonBadge, IonToggle, IonIcon,
} from '@ionic/react';
import { moonOutline } from 'ionicons/icons';
import ApiService, { UserSecret } from '../../services/Api';
import SinglePanelLayout from '../../components/shell/SinglePanelLayout';
import { useTheme } from '../../contexts/ThemeContext';
import { AREA_NAV } from '../../constants';


/*
 ██    ██  ████████  ██        ██████    ████████  ██████      ██████
 ██    ██  ██        ██        ██    ██  ██        ██    ██  ██
 ████████  ██████    ██        ██████    ██████    ██████      ████
 ██    ██  ██        ██        ██        ██        ██    ██        ██
 ██    ██  ████████  ████████  ██        ████████  ██    ██  ██████
                                                                       */


const formatDate = (val: string) => {
  const d = new Date(val);
  return isNaN(d.getTime()) ? val : d.toLocaleDateString();
};


const Settings: React.FC = () => {

  const { theme, toggleTheme } = useTheme();


/*
   ██████  ██████████    ████    ██████████  ████████
 ██            ██      ██    ██      ██      ██
   ████        ██      ████████      ██      ██████
       ██      ██      ██    ██      ██      ██
 ██████        ██      ██    ██      ██      ████████
                                                       */


  const [secrets, setSecrets]           = useState<UserSecret[]>([]);
  const [secretInputs, setSecretInputs] = useState<Record<string, string>>({});
  const [secretBusy, setSecretBusy]     = useState<string | null>(null);
  const [secretError, setSecretError]   = useState('');


/*
 ██          ████      ████    ██████
 ██        ██    ██  ██    ██  ██    ██
 ██        ██    ██  ████████  ██    ██
 ██        ██    ██  ██    ██  ██    ██
 ████████    ████    ██    ██  ██████
                                         */


  const loadSecrets = async () => {
    setSecrets(await ApiService.getUserSecrets());
  };

  useEffect(() => { loadSecrets(); }, []);


/*
 ██    ██    ████    ██      ██  ██████    ██        ████████  ██████      ██████
 ██    ██  ██    ██  ████    ██  ██    ██  ██        ██        ██    ██  ██
 ████████  ████████  ██  ██  ██  ██    ██  ██        ██████    ██████      ████
 ██    ██  ██    ██  ██    ████  ██    ██  ██        ██        ██    ██        ██
 ██    ██  ██    ██  ██      ██  ██████    ████████  ████████  ██    ██  ██████
                                                                                   */


  // Bespoke JSX by design: the keychain is per-item set/clear actions against a
  // server-defined registry, not a collect-then-submit form tree (forms-ui.md).
  const handleSaveSecret = async (name: string) => {
    const value = (secretInputs[name] ?? '').trim();
    if (!value) return;
    setSecretError('');
    setSecretBusy(name);
    try {
      await ApiService.setUserSecret(name, value);
      setSecretInputs(prev => ({ ...prev, [name]: '' }));
      await loadSecrets();
    } catch (e: any) {
      setSecretError(e.message ?? 'Failed to save key');
    } finally {
      setSecretBusy(null);
    }
  };

  const handleClearSecret = async (name: string) => {
    setSecretError('');
    setSecretBusy(name);
    try {
      await ApiService.clearUserSecret(name);
      await loadSecrets();
    } catch (e: any) {
      setSecretError(e.message ?? 'Failed to clear key');
    } finally {
      setSecretBusy(null);
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
          label: 'Appearance',
          content: (
            /* ═══════════════════════════════════════════════════════════
                 Appearance                                                 */
            <IonItem lines="full">
              <IonIcon aria-hidden="true" slot="start" icon={moonOutline} />
              <IonLabel>Dark Mode</IonLabel>
              <IonToggle slot="end" checked={theme === 'dark'} onIonChange={toggleTheme} />
            </IonItem>
          ),
        },
        {
          label: 'Integrations',
          content: (
            /* ═══════════════════════════════════════════════════════════
                 Integrations                                               */
            <>
              <IonItem lines="none">
                <IonLabel style={{ whiteSpace: 'normal', fontSize: 13, color: 'var(--ion-color-medium)' }}>
                  API keys are stored encrypted and used only by the server. Once saved, a key is never shown again — only its last four characters.
                </IonLabel>
              </IonItem>
              {secretError && <IonItem lines="none"><IonText color="danger" style={{ fontSize: 13 }}>{secretError}</IonText></IonItem>}
              {secrets.map(s => (
                <React.Fragment key={s.name}>
                  <IonItem lines="none">
                    <IonLabel>
                      <p style={{ fontWeight: 500 }}>{s.label}</p>
                      {s.isSet && (
                        <p style={{ fontSize: 12, color: 'var(--ion-color-medium)' }}>
                          ····{s.last4}{s.updated_at ? ` · updated ${formatDate(s.updated_at)}` : ''}
                        </p>
                      )}
                    </IonLabel>
                    <IonBadge slot="end" color={s.isSet ? 'success' : 'medium'}>
                      {s.isSet ? 'Set' : 'Not set'}
                    </IonBadge>
                  </IonItem>
                  <IonItem lines="full">
                    <IonInput
                      label={s.isSet ? 'Replace key' : 'Add key'}
                      labelPlacement="stacked"
                      type="password"
                      value={secretInputs[s.name] ?? ''}
                      onIonInput={e => setSecretInputs(prev => ({ ...prev, [s.name]: e.detail.value ?? '' }))}
                    />
                    <IonButton
                      slot="end" size="small"
                      disabled={secretBusy === s.name || !(secretInputs[s.name] ?? '').trim()}
                      onClick={() => handleSaveSecret(s.name)}
                    >
                      {secretBusy === s.name ? <IonSpinner name="dots" /> : 'Save'}
                    </IonButton>
                    {s.isSet && (
                      <IonButton
                        slot="end" size="small" fill="clear" color="danger"
                        disabled={secretBusy === s.name}
                        onClick={() => handleClearSecret(s.name)}
                      >
                        Clear
                      </IonButton>
                    )}
                  </IonItem>
                </React.Fragment>
              ))}
            </>
          ),
        },
      ]}
    />
  );
};

export default Settings;
