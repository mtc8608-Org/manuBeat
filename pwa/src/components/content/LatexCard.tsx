// LatexCard — a content card for mathematical notation.
// - Accepts HTML that may contain inline or display LaTeX expressions
// - Runs KaTeX on mount (and on content change) to typeset the equations
// - Body stays in DOM when collapsed (display:none) so KaTeX runs even before the card is opened
import React, { useEffect, useRef } from 'react';
import renderMathInElement from 'katex/contrib/auto-render';
import 'katex/dist/katex.min.css';
import type { ContentCardProps } from './HtmlCard';
import CollapsibleCard, { extractH2 } from './CollapsibleCard';

const LatexCard: React.FC<ContentCardProps> = ({ card, isAdmin, onEdit, onDelete }) => {
  const ref = useRef<HTMLDivElement>(null);
  const { title, body } = extractH2(card.data?.html ?? '');

  useEffect(() => {
    if (!ref.current) return;
    renderMathInElement(ref.current, {
      delimiters: [
        { left: '$$', right: '$$', display: true  },
        { left: '$',  right: '$',  display: false },
        { left: '\\[', right: '\\]', display: true  },
        { left: '\\(', right: '\\)', display: false },
      ],
      throwOnError: false,
    });
  }, [body]);

  return (
    <CollapsibleCard title={title} isAdmin={isAdmin} onEdit={onEdit} onDelete={onDelete}>
      {/* eslint-disable-next-line react/no-danger */}
      <div ref={ref} dangerouslySetInnerHTML={{ __html: body }} />
    </CollapsibleCard>
  );
};

export default LatexCard;
