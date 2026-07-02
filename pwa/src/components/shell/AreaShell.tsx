// AreaShell — the inner layout used by every section of the app.
// - Left sidebar with nav links for that section
// - Highlights the currently active link
// - Sidebar collapses to a thin rail (rotated title + restore button), persisted per-section
// - Main content area to the right where the page renders
import React, { useEffect, useState } from 'react';
import { IonContent, IonItem, IonLabel, IonIcon, IonList, IonListHeader, IonButton } from '@ionic/react';
import { useLocation } from 'react-router-dom';
import {
  trendingUpOutline, barChartOutline,
  clipboardOutline,
  documentTextOutline, folderOutline, constructOutline,
  walletOutline, pulseOutline, gitNetworkOutline, statsChartOutline,
  optionsOutline, layersOutline, briefcaseOutline, downloadOutline,
  peopleOutline, keyOutline, personOutline, settingsOutline,
  chevronBackOutline, chevronForwardOutline,
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
  'briefcase':       briefcaseOutline,
  'download':        downloadOutline,
  'people':          peopleOutline,
  'key':             keyOutline,
  'person':          personOutline,
  'settings':        settingsOutline,
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

  // Per-section persisted collapse state; starts expanded.
  const storageKey = `areaSidebarCollapsed:${title ?? navItems[0]?.route ?? ''}`;
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(storageKey) === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(storageKey, collapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [storageKey, collapsed]);

  return (
    <IonContent fullscreen>
      <div className="area-shell">

        {/* ── Collapsed: rail with restore button + rotated title ── */}
        {collapsed ? (
          <aside
            className="area-shell-sidebar area-shell-sidebar-collapsed"
            onClick={() => setCollapsed(false)}
            title="Expand"
          >
            <IonButton fill="clear" size="small" onClick={e => { e.stopPropagation(); setCollapsed(false); }}>
              <IonIcon slot="icon-only" icon={chevronForwardOutline} />
            </IonButton>
            {title && (
              <div className="area-shell-rail-label">{title}</div>
            )}
          </aside>
        ) : (
          /* ── Left sidebar ── */
          <aside className="area-shell-sidebar">
            <div className="area-shell-collapse-row">
              <IonButton fill="clear" size="small" title="Collapse" onClick={() => setCollapsed(true)}>
                <IonIcon slot="icon-only" icon={chevronBackOutline} />
              </IonButton>
            </div>
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
        )}

        {/* ── Main content ── */}
        <main className="area-shell-main">
          {children}
        </main>

      </div>
    </IonContent>
  );
};

export default AreaShell;
