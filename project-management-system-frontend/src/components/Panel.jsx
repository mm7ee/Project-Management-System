/** @import { ReactNode } from 'react' */
/** @import { LucideIcon } from 'lucide-react' */
export {}; // the type imports above belong to the file, not to the first declaration
/**
 * A card: a header (optional icon, title, a control on the right), a body, and an optional footer.
 * @param {{ title: string; icon?: LucideIcon; action?: ReactNode; footer?: ReactNode; children: ReactNode; className?: string }} props
 */
export default function Panel({ title, icon: Icon, action, footer, children, className = "" }) {
  return (
    <section className={`d-card ${className}`}>
      <header className="d-card-head">
        <span className="card-title">
          {Icon && (
            <span className="card-icon" aria-hidden="true">
              <Icon size={16} />
            </span>
          )}
          <h3>{title}</h3>
        </span>
        {action}
      </header>
      <div className="d-card-body">{children}</div>
      {footer && <footer className="card-foot">{footer}</footer>}
    </section>
  );
}
