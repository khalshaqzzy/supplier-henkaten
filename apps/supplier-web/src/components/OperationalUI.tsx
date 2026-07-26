import type { ReactNode } from 'react';

export function SummaryStrip({
  children,
  label,
  className,
}: {
  children: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <section
      className={`operational-summary${className ? ` ${className}` : ''}`}
      aria-label={label}
    >
      {children}
    </section>
  );
}

export function SummaryMetric({
  label,
  value,
  detail,
  icon,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
}) {
  return (
    <div className={`operational-metric is-${tone}`}>
      {icon && <span className="operational-metric__icon">{icon}</span>}
      <span>
        <small>{label}</small>
        <strong>{value}</strong>
        {detail && <em>{detail}</em>}
      </span>
    </div>
  );
}

export function ContextRail({
  title,
  eyebrow,
  children,
  footer,
  className,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <aside className={`operational-rail${className ? ` ${className}` : ''}`} aria-label={title}>
      <header>
        {eyebrow && <span>{eyebrow}</span>}
        <h2>{title}</h2>
      </header>
      <div className="operational-rail__body">{children}</div>
      {footer && <footer>{footer}</footer>}
    </aside>
  );
}

export function FactStrip({ children, label }: { children: ReactNode; label: string }) {
  return (
    <section className="operational-facts" aria-label={label}>
      {children}
    </section>
  );
}

export function FactItem({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}
