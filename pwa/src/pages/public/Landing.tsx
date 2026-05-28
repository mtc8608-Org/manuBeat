import React, { useEffect, useState } from 'react';
import { IonPage, IonContent, IonHeader, IonSpinner, IonItem, IonLabel } from '@ionic/react';
import { CONTENT_MENU_ID, CONTENT_TYPE } from '../../constants';
import ApiService from '../../services/Api';
import AppHeader from '../../components/shell/AppHeader';
import ContentNav from '../../components/content/ContentNav';
import ContentRenderer from '../../components/content/ContentRenderer';
import { Component } from '../../interfaces/types';

const Landing: React.FC = () => {
  const [pages, setPages]                 = useState<Component[]>([]);
  const [activeTopPage, setActiveTopPage] = useState<Component | null>(null);
  const [activePage, setActivePage]       = useState<Component | null>(null);
  const [loading, setLoading]             = useState(true);

  useEffect(() => {
    ApiService.getComponentByName(CONTENT_MENU_ID)
      .then(menu => {
        const children: Component[] = ((menu?.children ?? []) as Component[])
          .filter(c => c.type === CONTENT_TYPE.PAGE);
        setPages(children);
        if (children[0]) {
          setActiveTopPage(children[0]);
          const subs = (children[0].children ?? [])
            .filter((c: Component) => c.type === CONTENT_TYPE.PAGE);
          setActivePage(subs[0] ?? children[0]);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handlePageChange = (page: Component) => {
    const isTop = pages.some(p => p.id === page.id);
    if (isTop) {
      setActiveTopPage(page);
      const subs = (page.children ?? [])
        .filter((c: Component) => c.type === CONTENT_TYPE.PAGE);
      setActivePage(subs[0] ?? page);
    } else {
      setActivePage(page);
    }
  };

  return (
    <IonPage>
      <AppHeader />
      <IonHeader>
        <ContentNav
          pages={pages}
          activePage={activeTopPage}
          activeSubPage={activePage}
          onPageChange={p => handlePageChange(p as Component)}
        />
      </IonHeader>
      <IonContent fullscreen>
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 32,
                        color: 'var(--ion-color-medium)' }}>
            <IonSpinner name="dots" />
            <span>Loading…</span>
          </div>
        )}
        {!loading && activePage && (
          <ContentRenderer page={activePage} isAdmin={false} />
        )}
        {!loading && !activePage && (
          <IonItem lines="none">
            <IonLabel color="medium">No content configured.</IonLabel>
          </IonItem>
        )}
      </IonContent>
    </IonPage>
  );
};

export default Landing;
