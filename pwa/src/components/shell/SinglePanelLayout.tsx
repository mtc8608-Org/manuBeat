// SinglePanelLayout — the full-page skeleton for pages without a list/detail split.
// - Mounts the top bar, section sidebar, and one centered content column together
// - The column is always a TabPanel (tabs prop), same as SplitPageLayout's columns
// - header: strip always present above the panel for page-level controls
// - Column width is configurable (default ½ of the page, centered; full width on mobile)
// - Hidden slot for always-mounted elements that need a live DOM node
import React from 'react';
import { IonPage, IonGrid, IonRow, IonCol } from '@ionic/react';
import AppHeader from './AppHeader';
import AreaShell, { AreaNavItem } from './AreaShell';
import TabPanel, { TabDef } from './TabPanel';
import { RIGHT_HEADER_STYLE } from './SplitPageLayout';

interface SinglePanelLayoutProps {
  navItems: readonly AreaNavItem[];
  title?: string;
  /** The single column is always a TabPanel — pass tab definitions, never a raw node */
  tabs: TabDef[];
  /** Column size out of 12 (default "6"), centered via computed offset; full width on mobile */
  contentSize?: string;
  /** Strip rendered above the panel — page-level controls, config toggles, etc. */
  header?: React.ReactNode;
  /** Always-mounted but invisible elements, e.g. file inputs that need a live ref */
  hidden?: React.ReactNode;
  /** Modals and other IonPage-level elements rendered outside AreaShell */
  children?: React.ReactNode;
}

const SinglePanelLayout: React.FC<SinglePanelLayoutProps> = ({
  navItems,
  title,
  tabs,
  contentSize = '6',
  header,
  hidden,
  children,
}) => {
  const offset = String(Math.floor((12 - Number(contentSize)) / 2));

  return (
    <IonPage>
      <AppHeader />
      {hidden && <div style={{ display: 'none' }}>{hidden}</div>}
      <AreaShell navItems={navItems} title={title}>
        <IonGrid style={{ paddingTop: 0 }}>
          <IonRow>
            <IonCol size="12" sizeMd={contentSize} offsetMd={offset}>
              <div style={RIGHT_HEADER_STYLE}>{header}</div>
              <TabPanel tabs={tabs} />
            </IonCol>
          </IonRow>
        </IonGrid>
      </AreaShell>
      {children}
    </IonPage>
  );
};

export default SinglePanelLayout;
