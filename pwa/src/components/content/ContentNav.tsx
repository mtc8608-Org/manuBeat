// ContentNav — the tab bar for navigating a content area.
// - One button per top-level page; highlights the active one
// - Shows contentPage children as sub-tabs when a page is selected
// - Hidden entirely when there are no pages yet
import React from 'react';
import { IonButton, IonToolbar } from '@ionic/react';
import { ComponentResults } from '../../interfaces/types';
import './ContentNav.css';

interface ContentNavProps {
  pages: ComponentResults[];
  activePage: ComponentResults | null;
  activeSubPage?: ComponentResults | null;
  onPageChange: (page: ComponentResults) => void;
}

const ContentNav: React.FC<ContentNavProps> = ({ pages, activePage, activeSubPage, onPageChange }) => {
  if (!pages.length) return null;

  const activeSubPages: ComponentResults[] = (activePage?.children ?? [])
    .filter((c: ComponentResults) => c.type === 'contentPage');

  const label = (p: ComponentResults) =>
    p.data?.text || p.data?.label || p.name;

  return (
    <IonToolbar className="content-nav-toolbar">
      <div className="content-nav-row">
        {pages.map(p => (
          <IonButton
            key={p.id ?? p.name}
            fill="clear"
            size="small"
            className={`content-nav-btn${activePage?.id === p.id ? ' active' : ''}`}
            onClick={() => onPageChange(p)}
          >
            {label(p)}
          </IonButton>
        ))}
      </div>

      {activeSubPages.length > 0 && (
        <div className="content-nav-row content-nav-sub">
          {activeSubPages.map((c: ComponentResults) => (
            <IonButton
              key={c.id ?? c.name}
              fill="clear"
              size="small"
              className={`content-nav-btn${(activeSubPage ?? activePage)?.id === c.id ? ' active' : ''}`}
              onClick={() => onPageChange(c)}
            >
              {label(c)}
            </IonButton>
          ))}
        </div>
      )}
    </IonToolbar>
  );
};

export default ContentNav;
