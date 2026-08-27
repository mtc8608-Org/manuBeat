// Page: Profile — the user's profile details (name, contact, links, picture).
// Reads/writes: user_profile via userProfile/upsertUserProfile (GraphQL); form tree from components.
// Authenticated.

import React, { useEffect, useState } from 'react';
import { IonItem, IonLabel, IonText } from '@ionic/react';
import { ComponentResults } from '../../interfaces/types';
import ApiService from '../../services/Api';
import SinglePanelLayout from '../../components/shell/SinglePanelLayout';
import FormRenderer from '../../components/forms/FormRenderer';
import { AREA_NAV, USER_PROFILE_FORM } from '../../constants';


const Profile: React.FC = () => {


/*
   ██████  ██████████    ████    ██████████  ████████
 ██            ██      ██    ██      ██      ██
   ████        ██      ████████      ██      ██████
       ██      ██      ██    ██      ██      ██
 ██████        ██      ██    ██      ██      ████████
                                                       */


  const [profileForm, setProfileForm] = useState<ComponentResults | null>(null);
  const [profileData, setProfileData] = useState<Record<string, any>>({});
  const [profileMsg, setProfileMsg]   = useState('');


/*
 ██          ████      ████    ██████
 ██        ██    ██  ██    ██  ██    ██
 ██        ██    ██  ████████  ██    ██
 ██        ██    ██  ██    ██  ██    ██
 ████████    ████    ██    ██  ██████
                                         */


  useEffect(() => {
    ApiService.getComponentByName(USER_PROFILE_FORM).then(f => setProfileForm((f ?? null) as ComponentResults | null));
    ApiService.getUserProfile().then(p => setProfileData(p?.data ?? {}));
  }, []);


/*
 ██    ██    ████    ██      ██  ██████    ██        ████████  ██████      ██████
 ██    ██  ██    ██  ████    ██  ██    ██  ██        ██        ██    ██  ██
 ████████  ████████  ██  ██  ██  ██    ██  ██        ██████    ██████      ████
 ██    ██  ██    ██  ██    ████  ██    ██  ██        ██        ██    ██        ██
 ██    ██  ██    ██  ██      ██  ██████    ████████  ████████  ██    ██  ██████
                                                                                   */


  const handleSaveProfile = async (values: any) => {
    setProfileMsg('');
    const saved = await ApiService.upsertUserProfile(values);
    setProfileData(saved?.data ?? values);
    setProfileMsg('Profile saved.');
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
          label: 'Profile',
          content: (
            /* ═══════════════════════════════════════════════════════════
                 Edit form                                                  */
            <>
              <IonItem lines="none">
                <IonLabel style={{ whiteSpace: 'normal', fontSize: 13, color: 'var(--ion-color-medium)' }}>
                  Your name, contact details and links.
                </IonLabel>
              </IonItem>
              {profileMsg && <IonItem lines="none"><IonText color="success" style={{ fontSize: 13 }}>{profileMsg}</IonText></IonItem>}
              {profileForm && (
                <FormRenderer
                  component={profileForm}
                  defaultValues={profileData}
                  onSubmit={handleSaveProfile}
                  submitLabel="Save Profile"
                />
              )}
            </>
          ),
        },
      ]}
    />
  );
};

export default Profile;
