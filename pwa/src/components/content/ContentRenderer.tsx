// ContentRenderer — the dispatcher that draws a content page.
// - Walks the page's child nodes and renders each as a card
// - Routes to HtmlCard, ImageCard, HtmlImageCard, or LatexCard by type
// - When children are contentPage sub-pages, renders them as an inline TabPanel
// - Shows an empty-state message when the page has no cards yet
// - Passes admin edit/delete controls down to each card when in admin mode
import React from 'react';
import { Component } from '../../interfaces/types';
import { CONTENT_TYPE } from '../../constants';
import HtmlCard from './HtmlCard';
import ImageCard from './ImageCard';
import HtmlImageCard from './HtmlImageCard';
import LatexCard from './LatexCard';
import TabPanel from '../shell/TabPanel';

export interface ContentRendererProps {
  page: Component;
  isAdmin?: boolean;
  onEditCard?: (card: Component) => void;
  onDeleteCard?: (cardId: string) => void;
}

const ContentRenderer: React.FC<ContentRendererProps> = ({
  page,
  isAdmin = false,
  onEditCard,
  onDeleteCard,
}) => {
  if (!page.children || page.children.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 48, color: 'var(--ion-color-medium)' }}>
        {isAdmin ? 'No cards yet — use "Add Card" to get started.' : 'No content yet.'}
      </div>
    );
  }

  const subPages = page.children.filter((c: Component) => c.type === CONTENT_TYPE.PAGE);

  if (subPages.length > 0) {
    return (
      <TabPanel
        tabs={subPages.map((sp: Component) => ({
          label: sp.data?.text || sp.data?.title || sp.data?.label || sp.name,
          content: (
            <ContentRenderer
              page={sp}
              isAdmin={isAdmin}
              onEditCard={onEditCard}
              onDeleteCard={onDeleteCard}
            />
          ),
        }))}
      />
    );
  }

  return (
    <div>
      {page.children.map((card: Component) => {
        const adminProps = {
          isAdmin,
          onEdit:   () => onEditCard?.(card),
          onDelete: () => onDeleteCard?.(card.id!),
        };

        switch (card.type) {
          case CONTENT_TYPE.HTML:       return <HtmlCard      key={card.id} card={card} {...adminProps} />;
          case CONTENT_TYPE.IMAGE:      return <ImageCard     key={card.id} card={card} {...adminProps} />;
          case CONTENT_TYPE.HTML_IMAGE: return <HtmlImageCard key={card.id} card={card} {...adminProps} />;
          case CONTENT_TYPE.LATEX:      return <LatexCard     key={card.id} card={card} {...adminProps} />;
          default: return null;
        }
      })}
    </div>
  );
};

export default ContentRenderer;
