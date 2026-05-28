// SplitPageLayout — the full-page skeleton for every data or admin page.
// - Mounts the top bar, section sidebar, and two-column grid together
// - Left column for a list or panel; right column for detail or a table
// - Left column width is configurable (default ¼ of the page)
// - rightHeader: strip always present above the right column for page-level controls (empty zone when nothing passed)
// - Hidden slot for always-mounted elements that need a live DOM node
import React from 'react';
import { IonPage, IonGrid, IonRow, IonCol } from '@ionic/react';
import AppHeader from './AppHeader';
import AreaShell, { AreaNavItem } from './AreaShell';
import TabPanel, { TabDef } from './TabPanel';

interface SplitPageLayoutBase {
  navItems: readonly AreaNavItem[];
  title?: string;
  /** Left column size out of 12 (default "3") */
  leftSize?: string;
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

const SplitPageLayout: React.FC<SplitPageLayoutProps> = ({
  navItems,
  title,
  leftSize = '3',
  left,
  leftTabs,
  right,
  rightHeader,
  hidden,
  children,
}) => {
  const rightSize = String(12 - Number(leftSize));

  return (
    <IonPage>
      <AppHeader />
      {hidden && <div style={{ display: 'none' }}>{hidden}</div>}
      <AreaShell navItems={navItems} title={title}>
        <IonGrid>
          <IonRow>
            <IonCol size={leftSize} style={{ borderRight: '1px solid var(--ion-border-color)' }}>
              {leftTabs ? <TabPanel tabs={leftTabs} /> : left}
            </IonCol>
            <IonCol size={rightSize}>
              <div style={{ padding: '4px 0 8px', borderBottom: '1px solid var(--ion-border-color)', marginBottom: 12, minHeight: 40 }}>
                {rightHeader}
              </div>
              {right}
            </IonCol>
          </IonRow>
        </IonGrid>
      </AreaShell>
      {children}
    </IonPage>
  );
};

export default SplitPageLayout;
