// Page: Roles — role catalogue management (backoffice).
// Reads/writes: roles table via GraphQL (roleList / createRole / updateRole / deleteRole).
// Admin-only. A role aliases a name onto a permissions tier ('registered' |
// 'user' | 'admin'); the tier ladder itself is code (nodejs/permissions.js).

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
import { AREA_NAV, PANEL_CONFIG, ROLE_FORM } from '../../constants';


/*
 ██    ██  ████████  ██        ██████    ████████  ██████      ██████
 ██    ██  ██        ██        ██    ██  ██        ██    ██  ██
 ████████  ██████    ██        ██████    ██████    ██████      ████
 ██    ██  ██        ██        ██        ██        ██    ██        ██
 ██    ██  ████████  ████████  ██        ████████  ██    ██  ██████
                                                                       */


const TIER_COLOR: Record<string, string> = {
  admin:      'warning',
  user:       'primary',
  registered: 'medium',
};


const Roles: React.FC = () => {


/*
   ██████  ██████████    ████    ██████████  ████████
 ██            ██      ██    ██      ██      ██
   ████        ██      ████████      ██      ██████
       ██      ██      ██    ██      ██      ██
 ██████        ██      ██    ██      ██      ████████
                                                       */


  const [listVersion, setListVersion] = useState(0);
  const [selected, setSelected]       = useState<Role | null>(null);

  // Seeded FormRenderer forms
  const [editorForm, setEditorForm] = useState<ComponentResults | null>(null);
  const [createForm, setCreateForm] = useState<ComponentResults | null>(null);

  // New-role modal
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
    ApiService.getComponentByName(ROLE_FORM.EDITOR).then(f => setEditorForm((f ?? null) as ComponentResults | null));
    ApiService.getComponentByName(ROLE_FORM.CREATE).then(f => setCreateForm((f ?? null) as ComponentResults | null));
  }, []);

  const rolesFetcher = () => ApiService.getRoles();


/*
 ██    ██    ████    ██      ██  ██████    ██        ████████  ██████      ██████
 ██    ██  ██    ██  ████    ██  ██    ██  ██        ██        ██    ██  ██
 ████████  ████████  ██  ██  ██  ██    ██  ██        ██████    ██████      ████
 ██    ██  ██    ██  ██    ████  ██    ██  ██        ██        ██    ██        ██
 ██    ██  ██    ██  ██      ██  ██████    ████████  ████████  ██    ██  ██████
                                                                                   */


  const selectRole = (r: Role) => { setSelected(r); setEditorMsg(''); setEditorError(''); };

  // Detail editor (FormRenderer over form_role_editor). Name is immutable;
  // system roles additionally have a fixed tier (also enforced server-side).
  const handleSaveRole = async (values: any) => {
    if (!selected) return;
    setEditorMsg('');
    setEditorError('');
    try {
      const updated = await ApiService.updateRole(selected.id, { tier: values.tier, description: values.description });
      setSelected(updated);
      setListVersion(v => v + 1);
      setEditorMsg('Role updated. Tier changes reach each user on their next login.');
    } catch (e: any) {
      setEditorError(e?.message ?? 'Update failed');
    }
  };

  // New role (FormRenderer over form_role_create).
  const openCreate = () => { setCreateError(''); setCreateOpen(true); };
  const handleCreateRole = async (values: any) => {
    if (!values.name || !values.tier) { setCreateError('Name and tier are required.'); return; }
    setCreateError('');
    try {
      const created = await ApiService.createRole(values.name, values.tier, values.description);
      setCreateOpen(false);
      setListVersion(v => v + 1);
      setSelected(created);
    } catch (e: any) {
      setCreateError(e?.message ?? 'Failed to create role');
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
      title="Roles"
      leftTabs={[
        {
          label: 'Roles',
          content: (
            /* ═══════════════════════════════════════════════════════════
                 Component list
                 No delete — roles are create/edit only (deleteRole exists
                 server-side but is deliberately unexposed). Keep the item
                 end slot to the single tier badge (page-template.md rule 5). */
            <ResourcePanel<Role>
              fetcher={rolesFetcher}
              refreshToken={listVersion}
              config={PANEL_CONFIG.ROLES}
              selectedId={selected?.id}
              getLabel={r => r.name}
              getSubLabel={r => `${r.users} user(s)`}
              getBadge={r => ({ label: r.tier, color: TIER_COLOR[r.tier] ?? 'primary' })}
              onSelect={selectRole}
              onAdd={openCreate}
            />
          ),
        },
      ]}
      right={
        <TabPanel tabs={[
          {
            label: 'Detail',
            content: !selected ? (
              <EmptyState message="Select a role to edit" />
            ) : (
              <>
                {/* ═══════════════════════════════════════════════════════════
                     Edit form                                                 */}
                <IonItem lines="full">
                  <IonLabel>
                    <p style={{ fontSize: 12, color: 'var(--ion-color-medium)' }}>Name</p>
                    <p>{selected.name}{selected.is_system ? ' (system role — tier is fixed)' : ''}</p>
                  </IonLabel>
                </IonItem>
                {editorMsg   && <IonItem lines="none"><IonText color="success" style={{ fontSize: 13 }}>{editorMsg}</IonText></IonItem>}
                {editorError && <IonItem lines="none"><IonText color="danger" style={{ fontSize: 13 }}>{editorError}</IonText></IonItem>}
                {editorForm && (
                  <FormRenderer
                    key={selected.id}
                    component={editorForm}
                    defaultValues={{ tier: selected.tier, description: selected.description ?? '' }}
                    // System roles: pin the tier select to its current value.
                    injectedOptions={selected.is_system
                      ? { tier: [{ value: selected.tier, label: selected.tier }] }
                      : undefined}
                    onSubmit={handleSaveRole}
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
      <ModalShell isOpen={createOpen} onDismiss={() => setCreateOpen(false)} title="New Role">
        {createError && <IonItem lines="none"><IonText color="danger">{createError}</IonText></IonItem>}
        {createForm && (
          <FormRenderer
            component={createForm}
            defaultValues={{ tier: 'registered' }}
            onSubmit={handleCreateRole}
            submitLabel="Create Role"
          />
        )}
      </ModalShell>
    </SplitPageLayout>
  );
};

export default Roles;
