// Menu — the hamburger slide-out drawer.
// - Links to every major section of the app
// - Shows the logged-in user's name and email
// - Logout button (dark mode toggle lives in Settings)
//
// The area groups are rendered from NAV_AREAS (constants.ts), the single nav
// source shared with AppHeader and AreaShell — adding an area needs no edit
// here. Only the Navigation header and Logout are hand-written, because
// neither belongs to an area.
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
} from '@ionic/react';

import { useLocation } from 'react-router-dom';
import { logOutOutline, homeOutline } from 'ionicons/icons';
import { useAuth } from '../../contexts/AuthContext';
import { ROUTE, NAV_AREAS } from '../../constants';
import { ICON_MAP } from './icons';
import './Menu.css';

const Menu: React.FC = () => {
  const location = useLocation();
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

  // An 'admin' area is admin-only; a 'user' area needs any signed-in account.
  const visibleAreas = user
    ? NAV_AREAS.filter(area => area.tier !== 'admin' || isAdmin)
    : [];

  return (
    <IonMenu contentId="main" type="overlay">
      <IonContent>

        <IonList id="inbox-list">
          <IonListHeader>Navigation</IonListHeader>
          {user && <IonNote>{user.email}</IonNote>}
          {navItem(ROUTE.LANDING, homeOutline, 'Home')}
        </IonList>

        {visibleAreas.map(area => (
          <IonList key={area.key} id={area.key === 'USER' ? 'labels-list' : undefined}>
            <IonListHeader>{area.title}</IonListHeader>
            {area.items.map(item => navItem(item.route, ICON_MAP[item.icon], item.label))}

            {/* Logout closes the account group — it is not a navigable area item. */}
            {area.key === 'USER' && (
              <IonItem lines="none" button detail={false} onClick={handleLogout}>
                <IonIcon aria-hidden="true" slot="start" icon={logOutOutline} />
                <IonLabel>Logout</IonLabel>
              </IonItem>
            )}
          </IonList>
        ))}

      </IonContent>
    </IonMenu>
  );
};

export default Menu;
