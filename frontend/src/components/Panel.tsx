import type { ReactNode } from "react";

/** A card with its title on the left, an optional control on the right and a rule under both. */
export default function Panel({ title, action, children, className = "" }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`d-card ${className}`}>
      <header className="d-card-head">
        <h3>{title}</h3>
        {action}
      </header>
      <div className="d-card-body">{children}</div>
    </section>
  );
}
