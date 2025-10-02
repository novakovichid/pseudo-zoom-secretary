import type { PropsWithChildren, ReactNode } from 'react';
import React from 'react';

type SectionCardProps = PropsWithChildren<{
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}>;

const SectionCard: React.FC<SectionCardProps> = ({ title, description, actions, children }) => {
  return (
    <section className="section-card">
      <header className="section-card__header">
        <div>
          <h2>{title}</h2>
          {description && <p className="section-card__description">{description}</p>}
        </div>
        {actions && <div className="section-card__actions">{actions}</div>}
      </header>
      <div className="section-card__content">{children}</div>
    </section>
  );
};

export default SectionCard;
