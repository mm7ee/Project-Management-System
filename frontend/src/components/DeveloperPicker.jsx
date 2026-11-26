/** @import { System } from '../data/systems' */
/** @import { User } from '../data/roles' */
import { useRef, useState } from "react";
import { AlertOctagon, Layers, Search, X } from "lucide-react";
import { initials } from "../data/systems";
/**
 * Type-to-find box for developer accounts. A developer can be on several projects, up to `limit`;
 * each suggestion says what else they're on, and anyone already at the limit can't be picked.
 * @param {SearchProps} props
 */
export function DeveloperSearch({ users, systems, systemId, exclude, disabled, overloaded = () => [], limit, onPick }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef(/** @type {HTMLInputElement | null} */ (null));
  const developers = users.filter((u) => u.role === "developer");
  const others = /** @param {User} d */ (d) =>
    (d.projectIds ?? [])
      .filter((id) => id !== systemId)
      .map((id) => systems.find((s) => s.id === id)?.name)
      .filter(/** @returns {n is string} */ (n) => !!n);
  // Projects that still exist; deleted ones don't count against the limit.
  const count = /** @param {User} d */ (d) => (d.projectIds ?? []).filter((id) => systems.some((s) => s.id === id)).length;
  const isFull = /** @param {User} d */ (d) => limit !== undefined && count(d) >= limit;
  const q = query.trim().toLowerCase();
  const matches = developers
    .filter((d) => !exclude.includes(d.id))
    .filter((d) => !q || d.name.toLowerCase().includes(q) || d.title.toLowerCase().includes(q) || d.username.toLowerCase().includes(q))
    // Least busy first: they are the likeliest pick. Full and overloaded developers go last.
    .sort((a, b) => Number(isFull(a)) - Number(isFull(b)) || overloaded(a).length - overloaded(b).length || others(a).length - others(b).length);
  const pick = /** @param {string} id */ (id) => {
    onPick(id);
    setQuery("");
    setActive(0);
    input.current?.focus();
  };
  if (!developers.length) return <p className="lead-none">No developer accounts yet. Create them on the Users page.</p>;
  return (
    <div className="dev-search" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <label className="dev-search-box">
        <Search size={15} />
        <input
          ref={input}
          value={query}
          disabled={disabled}
          placeholder={exclude.length ? "Add another developer…" : "Search developers by name…"}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(i + 1, matches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              // Inside a form, Enter picks a developer instead of submitting.
              e.preventDefault();
              if (open && matches[active] && !isFull(matches[active])) pick(matches[active].id);
            } else if (e.key === "Escape" && open) {
              e.stopPropagation();
              setOpen(false);
            }
          }}
        />
      </label>
      {open && !disabled && (
        <ul className="dev-menu" role="listbox">
          {matches.length ? (
            matches.map((d, i) => {
              const elsewhere = others(d);
              const full = isFull(d);
              return (
                <li key={d.id} role="option" aria-selected={i === active} aria-disabled={full}>
                  <button
                    type="button"
                    className={`dev-option ${i === active ? "active" : ""} ${full ? "full" : ""}`}
                    disabled={full}
                    title={full ? `${d.name} already has ${count(d)} projects, the most a developer can have` : undefined}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()} // keep focus in the box
                    onClick={() => pick(d.id)}
                  >
                    <span className="avatar md">{initials(d.name)}</span>
                    <span className="dev-option-text">
                      <b>{d.name}</b>
                      <span>{d.title || d.username}</span>
                    </span>
                    {full ? (
                      <span className="dev-tag overload">
                        <AlertOctagon size={12} /> Full · {count(d)}/{limit}
                      </span>
                    ) : overloaded(d).length ? (
                      <span className="dev-tag overload" title={`Overloaded: ${overloaded(d).join("; ")}`}>
                        <AlertOctagon size={12} /> Overloaded
                      </span>
                    ) : elsewhere.length ? (
                      <span className="dev-tag busy" title={`Also on ${elsewhere.join(", ")}`}>
                        <Layers size={12} /> {elsewhere.length === 1 ? `On ${elsewhere[0]}` : `On ${elsewhere.length} projects`}
                      </span>
                    ) : (
                      <span className="dev-tag free">Available</span>
                    )}
                  </button>
                </li>
              );
            })
          ) : (
            <li className="dev-menu-empty">{q ? `No developer matches "${query.trim()}"` : "Every developer is already on this project"}</li>
          )}
        </ul>
      )}
    </div>
  );
}
/**
 * Chips for the chosen developers plus the search box, for forms that save everything at once.
 * @param {PickerProps} arg4
 */
export default function DeveloperPicker({ users, systems, value, limit, onChange }) {
  const chosen = value.map((id) => users.find((u) => u.id === id)).filter(/** @returns {u is User} */ (u) => !!u);
  return (
    <div className="dev-picker">
      {chosen.length > 0 && (
        <div className="dev-chips">
          {chosen.map((d) => (
            <span key={d.id} className="dev-chip" title={d.title}>
              <span className="avatar">{initials(d.name)}</span>
              {d.name}
              <button type="button" aria-label={`Remove ${d.name}`} onClick={() => onChange(value.filter((x) => x !== d.id))}>
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      )}
      <DeveloperSearch users={users} systems={systems} exclude={value} limit={limit} onPick={(id) => onChange([...value, id])} />
    </div>
  );
}
/**
 * @typedef {Object} SearchProps
 * @property {User[]} users
 * @property {System[]} systems
 * @property {string} [systemId]
 * @property {string[]} exclude
 * @property {boolean} [disabled]
 * @property {(u: User) => string[]} [overloaded]
 * @property {number} [limit]
 * @property {(id: string) => void} onPick
 */
/**
 * @typedef {Object} PickerProps
 * @property {User[]} users
 * @property {System[]} systems
 * @property {string[]} value
 * @property {number} [limit]
 * @property {(ids: string[]) => void} onChange
 */
