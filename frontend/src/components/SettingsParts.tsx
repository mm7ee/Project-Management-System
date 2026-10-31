import type { ReactNode } from "react";

export function Section({ icon, title, sub, children }: { icon: ReactNode; title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="set-card">
      <header className="set-head">
        <span className="set-icon">{icon}</span>
        <div>
          <h3>{title}</h3>
          {sub && <p>{sub}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

export function Choice<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="choice" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? "on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.icon} {o.label}
        </button>
      ))}
    </div>
  );
}
