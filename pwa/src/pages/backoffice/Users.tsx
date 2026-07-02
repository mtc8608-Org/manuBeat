// Page: Users — user management (backoffice).
// Reads/writes: users table via REST /users (list / create / patch).
// Admin-only. Self-service account settings live on the Account page.

import React, { useEffect, useState } from 'react';
import {
  IonItem, IonLabel, IonText,
} from '@ionic/react';
import { ComponentResults } from '../../interfaces/types';
import ApiService, { Role } from '../../services/Api';
import SplitPageLayout from '../../components/shell/SplitPageLayout';
import TabPanel from '../../components/shell/TabPanel';
import EmptyState from '../../components/shell/EmptyState';
import ModalShell from '../../components/shell/ModalShell';
import ResourcePanel from '../../components/shell/ResourcePanel';
import FormRenderer from '../../components/forms/FormRenderer';
import { AREA_NAV, PANEL_CONFIG, USER_FORM } from '../../constants';


/*
 ██    ██  ████████  ██        ██████    ████████  ██████      ██████
 ██    ██  ██        ██        ██    ██  ██        ██    ██  ██
 ████████  ██████    ██        ██████    ██████    ██████      ████
 ██    ██  ██        ██        ██        ██        ██    ██        ██
 ██    ██  ████████  ████████  ██        ████████  ██    ██  ██████
                                                                       */


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


const Users: React.FC = () => {


/*
   ██████  ██████████    ████    ██████████  ████████
 ██            ██      ██    ██      ██      ██
   ████        ██      ████████      ██      ██████
       ██      ██      ██    ██      ██      ██
 ██████        ██      ██    ██      ██      ████████
                                                       */


  const [listVersion, setListVersion] = useState(0);
  const [search, setSearch]           = useState('');
  const [roleFilter, setRoleFilter]   = useState('');
  const [selected, setSelected]       = useState<User | null>(null);

  // Seeded FormRenderer forms
  const [editorForm, setEditorForm] = useState<ComponentResults | null>(null);
  const [createForm, setCreateForm] = useState<ComponentResults | null>(null);

  // Live role catalogue — feeds the role selects (falls back to the seeded
  // options while empty, so custom roles show up without a seed change).
  const [roles, setRoles] = useState<Role[]>([]);

  // New-user modal
  const [createOpen, setCreateOpen]   = useState(false);
  const [createError, setCreateError] = useState('');

  const [editorMsg, setEditorMsg]     = useState('');
  const [editorError, setEditorError] = useState('');


/*
 ██          ████      ████    ██████
 ██        ██    ██  ██    ██  ██    ██
 ██        ██    ██  ████████  ██    ██
 ██        ██    ██  ██    ██  ██    ██
 ████████    ████    ██    ██  ██████
                                         */


  useEffect(() => {
    ApiService.getComponentByName(USER_FORM.EDITOR).then(f => setEditorForm((f ?? null) as ComponentResults | null));
    ApiService.getComponentByName(USER_FORM.CREATE).then(f => setCreateForm((f ?? null) as ComponentResults | null));
    ApiService.getRoles().then(setRoles);
  }, []);

  const usersFetcher = () => ApiService.getUsers();

  const roleOptions = roles.length
    ? { role: roles.map(r => ({ value: r.name, label: r.name })) }
    : undefined;


/*
 ██    ██    ████    ██      ██  ██████    ██        ████████  ██████      ██████
 ██    ██  ██    ██  ████    ██  ██    ██  ██        ██        ██    ██  ██
 ████████  ████████  ██  ██  ██  ██    ██  ██        ██████    ██████      ████
 ██    ██  ██    ██  ██    ████  ██    ██  ██        ██        ██    ██        ██
 ██    ██  ██    ██  ██      ██  ██████    ████████  ████████  ██    ██  ██████
                                                                                   */


  const selectUser = (u: User) => { setSelected(u); setEditorMsg(''); setEditorError(''); };

  // Detail editor (FormRenderer over form_user_editor) — the two PATCHable fields.
  const handleSaveUser = async (values: any) => {
    if (!selected) return;
    setEditorMsg('');
    setEditorError('');
    try {
      const updated = await ApiService.patchUser(selected.id, { role: values.role, is_active: !!values.is_active });
      setSelected(prev => (prev ? { ...prev, ...updated } : prev));
      setListVersion(v => v + 1);
      setEditorMsg('User updated.');
    } catch (e: any) {
      setEditorError(e?.message ?? 'Update failed');
    }
  };

  // New user (FormRenderer over form_user_create).
  const openCreate = () => { setCreateError(''); setCreateOpen(true); };
  const handleCreateUser = async (values: any) => {
    if (!values.email || !values.password) { setCreateError('Email and password are required.'); return; }
    setCreateError('');
    try {
      const created = await ApiService.createUser(values.email, values.password, values.role || 'user');
      setCreateOpen(false);
      setListVersion(v => v + 1);
      setSelected(created);
    } catch (e: any) {
      setCreateError(e?.message ?? 'Failed to create user');
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
    <SplitPageLayout
      navItems={AREA_NAV.BACKOFFICE}
      title="Users"
      leftTabs={[
        {
          label: 'Users',
          content: (
            /* ═══════════════════════════════════════════════════════════
                 Component list                                            */
            <ResourcePanel<User>
              fetcher={usersFetcher}
              refreshToken={listVersion}
              config={PANEL_CONFIG.USERS}
              selectedId={selected?.id}
              getLabel={u => u.email}
              getSubLabel={u => `Joined ${formatDate(u.created_at)}`}
              getBadge={u => [
                { label: u.is_active ? 'active' : 'inactive', color: u.is_active ? 'success' : 'medium' },
                { label: u.role, color: u.role === 'admin' ? 'warning' : 'primary' },
              ]}
              onSelect={selectUser}
              onAdd={openCreate}
              filterFn={(u, text, type) => {
                const t = text.toLowerCase();
                return (!t || u.email.toLowerCase().includes(t))
                    && (!type || u.role === type);
              }}
              filter={{ text: search, onTextChange: setSearch, typeValue: roleFilter, onTypeChange: setRoleFilter }}
            />
          ),
        },
      ]}
      right={
        <TabPanel tabs={[
          {
            label: 'Detail',
            content: !selected ? (
              <EmptyState message="Select a user to edit" />
            ) : (
              <>
                {/* ═══════════════════════════════════════════════════════════
                     Edit form                                                 */}
                <IonItem lines="full">
                  <IonLabel>
                    <p style={{ fontSize: 12, color: 'var(--ion-color-medium)' }}>Email</p>
                    <p>{selected.email}</p>
                  </IonLabel>
                </IonItem>
                {editorMsg   && <IonItem lines="none"><IonText color="success" style={{ fontSize: 13 }}>{editorMsg}</IonText></IonItem>}
                {editorError && <IonItem lines="none"><IonText color="danger" style={{ fontSize: 13 }}>{editorError}</IonText></IonItem>}
                {editorForm && (
                  <FormRenderer
                    key={selected.id}
                    component={editorForm}
                    defaultValues={{ role: selected.role, is_active: selected.is_active }}
                    injectedOptions={roleOptions}
                    onSubmit={handleSaveUser}
                    submitLabel="Save Changes"
                  />
                )}
              </>
            ),
          },
        ]} />
      }
    >
      {/* ═══════════════════════════════════════════════════════════
           Modals                                                    */}
      <ModalShell isOpen={createOpen} onDismiss={() => setCreateOpen(false)} title="New User">
        {createError && <IonItem lines="none"><IonText color="danger">{createError}</IonText></IonItem>}
        {createForm && (
          <FormRenderer
            component={createForm}
            defaultValues={{ role: 'user' }}
            injectedOptions={roleOptions}
            onSubmit={handleCreateUser}
            submitLabel="Create User"
          />
        )}
      </ModalShell>
    </SplitPageLayout>
  );
};

export default Users;
