// TabPanel — a tabbed section used on both the left and right column of every page.
// - Renders an IonSegment tab bar from a list of tab definitions
// - Shows the active tab's content below the bar
// - Optional per-tab actions strip rendered between the bar and the content
import React, { useState } from 'react';
import { IonSegment, IonSegmentButton, IonLabel } from '@ionic/react';

export interface TabDef {
  label: string;
  content: React.ReactNode;
  /** Buttons or controls shown below the tab bar, specific to this tab */
  actions?: React.ReactNode;
  /** Keep this tab's content in the DOM even when it is not active (use for components with imperative refs) */
  keepMounted?: boolean;
}

interface TabPanelProps {
  tabs: TabDef[];
  /** Index of the initially active tab (default 0) — ignored when activeTab is provided */
  defaultTab?: number;
  /** Controlled active tab index */
  activeTab?: number;
  /** Called when the user clicks a tab — required when activeTab is provided */
  onTabChange?: (index: number) => void;
}

const TabPanel: React.FC<TabPanelProps> = ({ tabs, defaultTab = 0, activeTab, onTabChange }) => {
  const [internalActive, setInternalActive] = useState(defaultTab);
  const controlled = activeTab !== undefined;
  // Clamp so a shrinking tabs array (e.g. a mode-gated tab disappearing) never
  // leaves the active index pointing past the end, which would render nothing.
  const active = Math.max(0, Math.min(controlled ? activeTab : internalActive, tabs.length - 1));
  const handleChange = (i: number) => { if (controlled) onTabChange?.(i); else setInternalActive(i); };
  const tab = tabs[active] ?? tabs[0];

  return (
    <>
      <IonSegment
        value={String(active)}
        onIonChange={e => handleChange(Number(e.detail.value))}
        style={{ marginBottom: 8 }}
      >
        {tabs.map((t, i) => (
          <IonSegmentButton key={t.label} value={String(i)}>
            <IonLabel>{t.label}</IonLabel>
          </IonSegmentButton>
        ))}
      </IonSegment>

      {tab.actions && (
        <div style={{ padding: '4px 0 8px' }}>{tab.actions}</div>
      )}

      {tabs.map((t, i) =>
        t.keepMounted
          ? <div key={t.label} style={{ display: active === i ? 'block' : 'none' }}>{t.content}</div>
          : active === i ? <React.Fragment key={t.label}>{t.content}</React.Fragment> : null
      )}
    </>
  );
};

export default TabPanel;
