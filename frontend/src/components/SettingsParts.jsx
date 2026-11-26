/** @import { ReactNode } from 'react' */
export {}; // the type imports above belong to the file, not to the first declaration
/**
 * @param {{ icon: ReactNode; title: string; sub?: string; id?: string; flash?: boolean; children: ReactNode }} props
 */
export function Section({ icon, title, sub, id, flash, children }) {
  return (
    <section id={id} className={`set-card ${flash ? "flash" : ""}`}>
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
/**
 * @template {string} T
 * @param {{
 *   value: T;
 *   options: { value: T; label: string; icon?: ReactNode }[];
 *   onChange: (v: T) => void;
 *   label: string;
 * }} props
 */
export function Choice({ value, options, onChange, label }) {
  return (
    <div className="choice" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.icon} {o.label}
        </button>
      ))}
    </div>
  );
}
