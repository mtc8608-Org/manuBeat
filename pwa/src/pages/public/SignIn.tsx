import React, { useState } from 'react';
import {
  IonPage, IonContent,
  IonCard, IonCardContent, IonCardHeader, IonCardTitle,
  IonItem, IonLabel, IonInput, IonButton, IonText, IonSpinner,
} from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { ROUTE } from '../../constants';
import AppHeader from '../../components/shell/AppHeader';

const SignIn: React.FC = () => {
  const { login, register } = useAuth();
  const history             = useHistory();

  const PREFILL_KEY = 'signin_prefill_email';

  const [mode, setMode]         = useState<'signin' | 'register'>('signin');
  const [email, setEmail]       = useState(() => localStorage.getItem(PREFILL_KEY) ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const isRegister = mode === 'register';

  const handleSubmit = async () => {
    setError('');
    if (isRegister && password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await (isRegister ? register(email, password) : login(email, password));
      localStorage.setItem(PREFILL_KEY, email);
      history.push(ROUTE.LANDING);
    } catch (e: any) {
      setError(e.message ?? (isRegister ? 'Registration failed' : 'Login failed'));
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setMode(isRegister ? 'signin' : 'register');
    setConfirm('');
    setError('');
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
  };

  return (
    <IonPage>
      <AppHeader />
      <IonContent fullscreen>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          minHeight: '80vh', padding: '24px 16px',
        }}>
          <IonCard style={{ width: '100%', maxWidth: 420 }}>
            <IonCardHeader>
              <IonCardTitle>{isRegister ? 'Register' : 'Sign In'}</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              {error && (
                <IonItem lines="none" style={{ marginBottom: 8 }}>
                  <IonText color="danger">{error}</IonText>
                </IonItem>
              )}
              <IonItem lines="full">
                <IonInput
                  label="Email" labelPlacement="stacked"
                  type="email" placeholder="you@example.com"
                  value={email}
                  onIonInput={e => setEmail(e.detail.value ?? '')}
                  onKeyDown={handleKey}
                />
              </IonItem>
              {localStorage.getItem(PREFILL_KEY) && (
                <div style={{ textAlign: 'right', marginTop: 2, marginBottom: 4 }}>
                  <IonButton
                    fill="clear" size="small" color="medium"
                    style={{ fontSize: 11, height: 'auto', '--padding-top': '2px', '--padding-bottom': '2px' }}
                    onClick={() => { localStorage.removeItem(PREFILL_KEY); setEmail(''); }}
                  >
                    clear saved email
                  </IonButton>
                </div>
              )}
              <IonItem lines="full">
                <IonInput
                  label="Password" labelPlacement="stacked"
                  type="password" placeholder="••••••••"
                  value={password}
                  onIonInput={e => setPassword(e.detail.value ?? '')}
                  onKeyDown={handleKey}
                />
              </IonItem>
              {isRegister && (
                <IonItem lines="full">
                  <IonInput
                    label="Confirm password" labelPlacement="stacked"
                    type="password" placeholder="••••••••"
                    value={confirm}
                    onIonInput={e => setConfirm(e.detail.value ?? '')}
                    onKeyDown={handleKey}
                  />
                </IonItem>
              )}
              <IonButton
                expand="block"
                style={{ marginTop: 16 }}
                disabled={loading || !email || !password || (isRegister && !confirm)}
                onClick={handleSubmit}
              >
                {loading ? <IonSpinner name="dots" /> : (isRegister ? 'Register' : 'Sign In')}
              </IonButton>
              <div style={{ textAlign: 'center', marginTop: 16 }}>
                <IonButton fill="clear" size="small" onClick={toggleMode}>
                  {isRegister ? 'Already have an account? Sign in' : 'No account? Register'}
                </IonButton>
                <IonButton fill="clear" size="small" routerLink={ROUTE.LANDING}>
                  Browse without signing in
                </IonButton>
              </div>
            </IonCardContent>
          </IonCard>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default SignIn;
