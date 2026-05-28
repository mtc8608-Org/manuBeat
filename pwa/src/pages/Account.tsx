import React, { useEffect, useState } from 'react';
import {
  IonPage, IonContent, IonButtons,
  IonGrid, IonRow, IonCol,
  IonCard, IonCardContent, IonCardHeader, IonCardTitle,
  IonItem, IonLabel, IonInput, IonButton, IonText, IonSpinner,
  IonSelect, IonSelectOption, IonBadge, IonToggle,
} from '@ionic/react';
import ApiService from '../services/Api';
import AppHeader from '../components/shell/AppHeader';
import { useAuth } from '../contexts/AuthContext';

interface User {
  id: string;
  email: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

const formatDate = (val: string) => {
  const d = new Date(val);
  return isNaN(d.getTime()) ? val : d.toLocaleDateString();
};

const Account: React.FC = () => {
  const { user, isAdmin } = useAuth();

  // ── change password ──────────────────────────────────────────────────────────
  const [currentPw, setCurrentPw]   = useState('');
  const [newPw, setNewPw]           = useState('');
  const [confirmPw, setConfirmPw]   = useState('');
  const [pwError, setPwError]       = useState('');
  const [pwSuccess, setPwSuccess]   = useState(false);
  const [pwSaving, setPwSaving]     = useState(false);

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

  // ── user management (admin only) ─────────────────────────────────────────────
  const [users, setUsers]           = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [newEmail, setNewEmail]     = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole]       = useState('user');
  const [createError, setCreateError] = useState('');
  const [creating, setCreating]     = useState(false);

  const loadUsers = async () => {
    setUsersLoading(true);
    try {
      const data = await ApiService.getUsers();
      setUsers(data);
    } catch (e) { console.error('Error loading users:', e); }
    finally { setUsersLoading(false); }
  };

  useEffect(() => {
    if (isAdmin) loadUsers();
  }, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreateUser = async () => {
    setCreateError('');
    if (!newEmail || !newPassword) { setCreateError('Email and password required'); return; }
    setCreating(true);
    try {
      await ApiService.createUser(newEmail, newPassword, newRole);
      setNewEmail(''); setNewPassword(''); setNewRole('user');
      await loadUsers();
    } catch (e: any) {
      setCreateError(e.message ?? 'Failed to create user');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (u: User) => {
    try {
      await ApiService.patchUser(u.id, { is_active: !u.is_active });
      await loadUsers();
    } catch (e) { console.error('Error updating user:', e); }
  };

  const handleChangeRole = async (u: User, role: string) => {
    try {
      await ApiService.patchUser(u.id, { role });
      await loadUsers();
    } catch (e) { console.error('Error changing role:', e); }
  };

  return (
    <IonPage>
      <AppHeader />

      <IonContent fullscreen>
        <IonGrid>
          <IonRow>
            <IonCol size="12" sizeMd="6" offsetMd="3">

              {/* ── Profile info ──────────────────────────────────── */}
              <IonCard>
                <IonCardHeader>
                  <IonCardTitle>Profile</IonCardTitle>
                </IonCardHeader>
                <IonCardContent>
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
                </IonCardContent>
              </IonCard>

              {/* ── Change password ───────────────────────────────── */}
              <IonCard style={{ marginTop: 12 }}>
                <IonCardHeader>
                  <IonCardTitle>Change Password</IonCardTitle>
                </IonCardHeader>
                <IonCardContent>
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
                </IonCardContent>
              </IonCard>

              {/* ── User management (admin only) ──────────────────── */}
              {isAdmin && (
                <>
                  <IonCard style={{ marginTop: 12 }}>
                    <IonCardHeader>
                      <IonCardTitle>Create User</IonCardTitle>
                    </IonCardHeader>
                    <IonCardContent>
                      {createError && <IonItem lines="none"><IonText color="danger">{createError}</IonText></IonItem>}
                      <IonItem lines="full">
                        <IonInput label="Email" labelPlacement="stacked" type="email"
                          value={newEmail} onIonInput={e => setNewEmail(e.detail.value ?? '')} />
                      </IonItem>
                      <IonItem lines="full">
                        <IonInput label="Password" labelPlacement="stacked" type="password"
                          value={newPassword} onIonInput={e => setNewPassword(e.detail.value ?? '')} />
                      </IonItem>
                      <IonItem lines="full">
                        <IonSelect label="Role" labelPlacement="stacked"
                          value={newRole} onIonChange={e => setNewRole(e.detail.value)}
                        >
                          <IonSelectOption value="user">User</IonSelectOption>
                          <IonSelectOption value="admin">Admin</IonSelectOption>
                        </IonSelect>
                      </IonItem>
                      <IonButton expand="block" style={{ marginTop: 16 }}
                        disabled={creating || !newEmail || !newPassword}
                        onClick={handleCreateUser}
                      >
                        {creating ? <IonSpinner name="dots" /> : 'Create User'}
                      </IonButton>
                    </IonCardContent>
                  </IonCard>

                  <IonCard style={{ marginTop: 12 }}>
                    <IonCardHeader>
                      <IonItem lines="none">
                        <IonCardTitle slot="start">Users</IonCardTitle>
                        <IonButtons slot="end">
                          <IonButton size="small" onClick={loadUsers} disabled={usersLoading}>
                            {usersLoading ? <IonSpinner name="dots" /> : 'Refresh'}
                          </IonButton>
                        </IonButtons>
                      </IonItem>
                    </IonCardHeader>
                    <IonCardContent>
                      {users.map(u => (
                        <IonItem key={u.id} lines="full">
                          <IonLabel>
                            <p style={{ fontWeight: 500 }}>{u.email}</p>
                            <p style={{ fontSize: 12, color: 'var(--ion-color-medium)' }}>
                              Joined {formatDate(u.created_at)}
                            </p>
                          </IonLabel>
                          <IonSelect
                            slot="end"
                            value={u.role}
                            interface="popover"
                            style={{ minWidth: 80 }}
                            onIonChange={e => handleChangeRole(u, e.detail.value)}
                          >
                            <IonSelectOption value="user">User</IonSelectOption>
                            <IonSelectOption value="admin">Admin</IonSelectOption>
                          </IonSelect>
                          <IonBadge
                            slot="end"
                            color={u.is_active ? 'success' : 'medium'}
                            style={{ marginLeft: 8, marginRight: 8 }}
                          >
                            {u.is_active ? 'Active' : 'Inactive'}
                          </IonBadge>
                          <IonToggle
                            slot="end"
                            checked={u.is_active}
                            onIonChange={() => handleToggleActive(u)}
                          />
                        </IonItem>
                      ))}
                      {!usersLoading && users.length === 0 && (
                        <IonItem lines="none">
                          <IonLabel color="medium">No users found.</IonLabel>
                        </IonItem>
                      )}
                    </IonCardContent>
                  </IonCard>
                </>
              )}

            </IonCol>
          </IonRow>
        </IonGrid>
      </IonContent>
    </IonPage>
  );
};

export default Account;
