// SplitPageLayout — the full-page skeleton for every data or admin page.
// - Mounts the top bar, section sidebar, and two-column grid together
// - Left column for a list or panel; right column for detail or a table
// - Left column width is configurable (default ¼ of the page)
// - rightHeader: strip always present above the right column for page-level controls (empty zone when nothing passed)
// - Left column collapses to a thin vertical rail (opt-out via collapsibleLeft={false});
//   collapsed state is persisted per-page in localStorage and starts expanded
// - Hidden slot for always-mounted elements that need a live DOM node
import React, { useEffect, useState } from 'react';
import { IonPage, IonGrid, IonRow, IonCol, IonButton, IonIcon } from '@ionic/react';
import { chevronBackOutline, chevronForwardOutline } from 'ionicons/icons';
import { useLocation } from 'react-router-dom';
import AppHeader from './AppHeader';
import AreaShell, { AreaNavItem } from './AreaShell';
import TabPanel, { TabDef } from './TabPanel';

interface SplitPageLayoutBase {
  navItems: readonly AreaNavItem[];
  title?: string;
  /** Left column size out of 12 (default "3") */
  leftSize?: string;
  /** Allow collapsing the left column to a vertical rail (default true) */
  collapsibleLeft?: boolean;
  right: React.ReactNode;
  /** Strip rendered above the right column — page-level controls, config toggles, etc. */
  rightHeader?: React.ReactNode;
  /** Always-mounted but invisible elements, e.g. library TreeEditors that need a live ref */
  hidden?: React.ReactNode;
  /** Modals and other IonPage-level elements rendered outside AreaShell */
  children?: React.ReactNode;
}

type SplitPageLayoutProps = SplitPageLayoutBase & (
  /** Standard case: pass tab definitions and the layout renders the TabPanel */
  | { leftTabs: TabDef[]; left?: never }
  /** Escape hatch: pass a fully controlled node (e.g. a controlled TabPanel) */
  | { left: React.ReactNode; leftTabs?: never }
);

export const RIGHT_HEADER_STYLE: React.CSSProperties = {
  padding: '4px 0 8px', borderBottom: '1px solid var(--ion-border-color)', marginBottom: 12, minHeight: 40,
};

const SplitPageLayout: React.FC<SplitPageLayoutProps> = ({
  navItems,
  title,
  leftSize = '3',
  collapsibleLeft = true,
  left,
  leftTabs,
  right,
  rightHeader,
  hidden,
  children,
}) => {
  const rightSize = String(12 - Number(leftSize));

  // Per-page persisted collapse state; starts expanded.
  const { pathname } = useLocation();
  const storageKey = `splitLeftCollapsed:${pathname}`;
  const [collapsed, setCollapsed] = useState(() => {
    if (!collapsibleLeft) return false;
    try { return localStorage.getItem(storageKey) === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(storageKey, collapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [storageKey, collapsed]);

  const railLabel = leftTabs?.map(t => t.label).join(' · ') || title || '';

  return (
    <IonPage>
      <AppHeader />
      {hidden && <div style={{ display: 'none' }}>{hidden}</div>}
      <AreaShell navItems={navItems} title={title}>
        {/* ═══════════════════════════════════════════════════════════
             Collapsed — left rail + full-width right                  */}
        {collapsibleLeft && collapsed ? (
          <div style={{ display: 'flex', alignItems: 'stretch' }}>
            <div
              onClick={() => setCollapsed(false)}
              title="Expand"
              style={{
                width: 44, flex: '0 0 44px', cursor: 'pointer',
                borderRight: '1px solid var(--ion-border-color)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, paddingTop: 8,
              }}
            >
              <IonButton fill="clear" size="small" onClick={e => { e.stopPropagation(); setCollapsed(false); }}>
                <IonIcon slot="icon-only" icon={chevronForwardOutline} />
              </IonButton>
              <div style={{
                writingMode: 'vertical-rl', transform: 'rotate(180deg)',
                fontWeight: 600, color: 'var(--ion-color-medium)', whiteSpace: 'nowrap',
              }}>
                {railLabel}
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0, paddingLeft: 12 }}>
              <div style={RIGHT_HEADER_STYLE}>{rightHeader}</div>
              {right}
            </div>
          </div>
        ) : (
          /* ═══════════════════════════════════════════════════════════
               Expanded — two-column grid                              */
          <IonGrid style={{ paddingTop: 0 }}>
            <IonRow>
              <IonCol size={leftSize} style={{ borderRight: '1px solid var(--ion-border-color)', paddingTop: 0 }}>
                {collapsibleLeft && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <IonButton fill="clear" size="small" title="Collapse" onClick={() => setCollapsed(true)}>
                      <IonIcon slot="icon-only" icon={chevronBackOutline} />
                    </IonButton>
                  </div>
                )}
                {leftTabs ? <TabPanel tabs={leftTabs} /> : left}
              </IonCol>
              <IonCol size={rightSize}>
                <div style={RIGHT_HEADER_STYLE}>{rightHeader}</div>
                {right}
              </IonCol>
            </IonRow>
          </IonGrid>
        )}
      </AreaShell>
      {children}
    </IonPage>
  );
};

export default SplitPageLayout;
