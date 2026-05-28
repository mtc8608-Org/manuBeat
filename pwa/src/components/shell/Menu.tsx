// Menu — the hamburger slide-out drawer.
// - Links to every major section of the app
// - Shows the logged-in user's name and email
// - Dark / light mode toggle
// - Logout button
import {
  IonContent,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonMenu,
  IonMenuToggle,
  IonNote,
  IonToggle,
} from '@ionic/react';

import { useLocation } from 'react-router-dom';
import {
  clipboardOutline,
  documentTextOutline,
  constructOutline, folderOutline,
  personOutline, logOutOutline,
  moonOutline, homeOutline,
  pulseOutline, gitNetworkOutline, statsChartOutline, optionsOutline, layersOutline,
} from 'ionicons/icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { ROUTE } from '../../constants';
import './Menu.css';

const Menu: React.FC = () => {
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { user, isAdmin, logout } = useAuth();

  const handleLogout = () => {
    logout();
  };

  const navItem = (url: string, iosIcon: string, label: string) => (
    <IonMenuToggle key={url} autoHide={false}>
      <IonItem
        className={location.pathname === url ? 'selected' : ''}
        routerLink={url}
        routerDirection="none"
        lines="none"
        detail={false}
      >
        <IonIcon aria-hidden="true" slot="start" icon={iosIcon} />
        <IonLabel>{label}</IonLabel>
      </IonItem>
    </IonMenuToggle>
  );

  return (
    <IonMenu contentId="main" type="overlay">
      <IonContent>

        <IonList id="inbox-list">
          <IonListHeader>Navigation</IonListHeader>
          {user && <IonNote>{user.email}</IonNote>}
          {navItem(ROUTE.LANDING, homeOutline, 'Home')}
        </IonList>

        <IonList>
          <IonListHeader>Surveys</IonListHeader>
          {navItem(ROUTE.SURVEYS, clipboardOutline, 'Surveys')}
        </IonList>

        <IonList>
          <IonListHeader>Physiology Simulator</IonListHeader>
          {navItem(ROUTE.SIMULATOR,     pulseOutline,       'Simulator')}
          {navItem(ROUTE.MODEL_SANDBOX, gitNetworkOutline,  'Model Sandbox')}
          {navItem(ROUTE.PLOT_SANDBOX,  statsChartOutline,  'Plot Sandbox')}
          {navItem(ROUTE.PROC_SANDBOX,  optionsOutline,     'Processing Sandbox')}
          {navItem(ROUTE.HDF_INSPECTOR, layersOutline,      'HDF Inspector')}
        </IonList>

        {isAdmin && (
          <IonList>
            <IonListHeader>Backoffice</IonListHeader>
            {navItem(ROUTE.CONTENT,       documentTextOutline, 'Content')}
            {navItem(ROUTE.FILES,         folderOutline,       'Files')}
            {navItem(ROUTE.CONFIGURATION, constructOutline,    'Configuration')}
          </IonList>
        )}

        <IonList id="labels-list">
          <IonListHeader>Account</IonListHeader>
          {navItem(ROUTE.ACCOUNT, personOutline, 'My Account')}

          {user && (
            <IonItem lines="none" button detail={false} onClick={handleLogout}>
              <IonIcon aria-hidden="true" slot="start" icon={logOutOutline} />
              <IonLabel>Logout</IonLabel>
            </IonItem>
          )}

          <IonItem lines="none">
            <IonIcon aria-hidden="true" slot="start" icon={moonOutline} />
            <IonLabel>Dark Mode</IonLabel>
            <IonToggle slot="end" checked={theme === 'dark'} onIonChange={toggleTheme} />
          </IonItem>
        </IonList>

      </IonContent>
    </IonMenu>
  );
};

export default Menu;
