// AreaShell — the inner layout used by every section of the app.
// - Left sidebar with nav links for that section
// - Highlights the currently active link
// - Main content area to the right where the page renders
import React from 'react';
import { IonContent, IonItem, IonLabel, IonIcon, IonList, IonListHeader } from '@ionic/react';
import { useLocation } from 'react-router-dom';
import {
  trendingUpOutline, barChartOutline,
  clipboardOutline,
  documentTextOutline, folderOutline, constructOutline,
  walletOutline, pulseOutline, gitNetworkOutline, statsChartOutline,
  optionsOutline, layersOutline, bedOutline, hardwareChipOutline,
} from 'ionicons/icons';
import './AreaShell.css';

const ICON_MAP: Record<string, string> = {
  'trending-up':   trendingUpOutline,
  'bar-chart':     barChartOutline,
  'clipboard':     clipboardOutline,
  'document-text': documentTextOutline,
  'folder':        folderOutline,
  'construct':     constructOutline,
  'wallet':        walletOutline,
  'pulse':         pulseOutline,
  'git-network':   gitNetworkOutline,
  'stats-chart':   statsChartOutline,
  'options-outline': optionsOutline,
  'layers-outline':  layersOutline,
  'bed':             bedOutline,
  'hardware-chip':   hardwareChipOutline,
};

export interface AreaNavItem {
  readonly label: string;
  readonly route: string;
  readonly icon:  string;
}

interface AreaShellProps {
  navItems: readonly AreaNavItem[];
  title?:   string;
  children: React.ReactNode;
}

const AreaShell: React.FC<AreaShellProps> = ({ navItems, title, children }) => {
  const location = useLocation();

  return (
    <IonContent fullscreen>
      <div className="area-shell">

        {/* ── Left sidebar ── */}
        <aside className="area-shell-sidebar">
          <IonList lines="none">
            {title && <IonListHeader>{title}</IonListHeader>}
            {navItems.map(item => (
              <IonItem
                key={item.route}
                routerLink={item.route}
                routerDirection="none"
                detail={false}
                className={location.pathname === item.route ? 'area-shell-active' : ''}
              >
                <IonIcon slot="start" icon={ICON_MAP[item.icon]} />
                <IonLabel>{item.label}</IonLabel>
              </IonItem>
            ))}
          </IonList>
        </aside>

        {/* ── Main content ── */}
        <main className="area-shell-main">
          {children}
        </main>

      </div>
    </IonContent>
  );
};

export default AreaShell;
