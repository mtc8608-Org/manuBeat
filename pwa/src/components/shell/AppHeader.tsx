// AppHeader — the strip that runs across the top of every page.
// - Shows which section of the app you're currently in
// - Link to the user area (person icon)
// - Logged-in user name and logout button
// - Optional page-level action buttons injected by the parent page
import React from 'react';
import {
  IonHeader, IonToolbar, IonButtons, IonButton, IonMenuButton,
  IonIcon,
} from '@ionic/react';
import { useLocation } from 'react-router-dom';
import { personCircleOutline, logOutOutline, homeOutline } from 'ionicons/icons';
import { useAuth } from '../../contexts/AuthContext';
import { ROUTE, NAV_SECTIONS } from '../../constants';
import './AppHeader.css';

export interface AppHeaderProps {
  /** Extra buttons rendered in the end slot, before user controls */
  pageActions?: React.ReactNode;
}

const AppHeader: React.FC<AppHeaderProps> = ({ pageActions }) => {
  const location = useLocation();
  const { user, isAdmin, logout } = useAuth();

  const handleLogout = () => {
    logout();
    // No push needed: public pages stay put and re-render with signed-out header;
    // private pages are redirected to / by PrivateRoute automatically.
  };

  const activeSectionLabel = NAV_SECTIONS.find(s =>
    s.routes.some(r => location.pathname === r || location.pathname.startsWith(r + '/'))
  )?.label;

  return (
    <IonHeader>
      <IonToolbar>

        {/* ── Left: hamburger (mobile) + logo ── */}
        <IonButtons slot="start">
          <IonMenuButton className="app-header-hamburger" />
          <IonButton
            className="app-header-logo"
            routerLink={ROUTE.LANDING}
            fill="clear"
            title="Home"
          >
            <IonIcon icon={homeOutline} />
          </IonButton>
        </IonButtons>

        {/* ── Center: section nav (desktop, authenticated only) ── */}
        {user && (
          <div className="app-header-nav">
            {NAV_SECTIONS
              .filter(s => !s.adminOnly || isAdmin)
              .map(s => (
                <IonButton
                  key={s.label}
                  className={`app-header-nav-btn${activeSectionLabel === s.label ? ' active' : ''}`}
                  routerLink={s.link}
                  fill="clear"
                  size="small"
                >
                  {s.label}
                </IonButton>
              ))
            }
          </div>
        )}

        {/* ── Right: page actions + user controls ── */}
        <IonButtons slot="end">
          {pageActions}

          {!user ? (
            <IonButton fill="clear" routerLink={ROUTE.SIGNIN} title="Sign In">
              Sign In
            </IonButton>
          ) : (
            <>
              <span className="app-header-email">{user.email}</span>

              <IonButton fill="clear" routerLink={ROUTE.PROFILE} title="My Account">
                <IonIcon icon={personCircleOutline} />
              </IonButton>

              <IonButton fill="clear" onClick={handleLogout} title="Logout">
                <IonIcon icon={logOutOutline} />
              </IonButton>
            </>
          )}
        </IonButtons>

      </IonToolbar>
    </IonHeader>
  );
};

export default AppHeader;
