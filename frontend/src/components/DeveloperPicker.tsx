import { useRef, useState } from "react";
import { ArrowRightLeft, Search, X } from "lucide-react";
import { initials, type System } from "../data/systems";
import type { User } from "../data/roles";

interface SearchProps {
  users: User[];
  systems: System[];
  systemId?: string; // the project being edited; unset while adding a new one
  exclude: string[]; // already on the project
  disabled?: boolean;
  onPick: (id: string) => void;
}

/**
 * Type-to-find box for developer accounts. A developer works on one project, so picking one who is
 * already on another moves them; the suggestion says so before they are picked.
 */
export function DeveloperSearch({ users, systems, systemId, exclude, disabled, onPick }: SearchProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const developers = users.filter((u) => u.role === "developer");
  const q = query.trim().toLowerCase();
  const matches = developers
    .filter((d) => !exclude.includes(d.id))
    .filter((d) => !q || d.name.toLowerCase().includes(q) || d.title.toLowerCase().includes(q) || d.username.toLowerCase().includes(q))
    // Free developers first: they are the likeliest pick.
    .sort((a, b) => Number(!!a.projectId && a.projectId !== systemId) - Number(!!b.projectId && b.projectId !== systemId));
  const projectName = (id?: string) => (id && id !== systemId ? systems.find((s) => s.id === id)?.name : undefined);

  const pick = (id: string) => {
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
              if (open && matches[active]) pick(matches[active].id);
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
              const elsewhere = projectName(d.projectId);
              return (
                <li key={d.id} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    className={`dev-option ${i === active ? "active" : ""}`}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()} // keep focus in the box
                    onClick={() => pick(d.id)}
                  >
                    <span className="avatar md">{initials(d.name)}</span>
                    <span className="dev-option-text">
                      <b>{d.name}</b>
                      <span>{d.title || d.username}</span>
                    </span>
                    {elsewhere ? (
                      <span className="dev-tag busy" title={`Picking ${d.name} moves them off ${elsewhere}`}>
                        <ArrowRightLeft size={12} /> On {elsewhere}
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

interface PickerProps {
  users: User[];
  systems: System[];
  value: string[];
  onChange: (ids: string[]) => void;
}

/** Chips for the chosen developers plus the search box, for forms that save everything at once. */
export default function DeveloperPicker({ users, systems, value, onChange }: PickerProps) {
  const chosen = value.map((id) => users.find((u) => u.id === id)).filter((u): u is User => !!u);
  return (
    <div className="dev-picker">
      {chosen.length > 0 && (
        <div className="dev-chips">
          {chosen.map((d) => {
            const from = d.projectId ? systems.find((s) => s.id === d.projectId)?.name : undefined;
            return (
              <span key={d.id} className="dev-chip" title={from ? `Moves off ${from}` : d.title}>
                <span className="avatar">{initials(d.name)}</span>
                {d.name}
                {from && <small>from {from}</small>}
                <button type="button" aria-label={`Remove ${d.name}`} onClick={() => onChange(value.filter((x) => x !== d.id))}>
                  <X size={13} />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <DeveloperSearch users={users} systems={systems} exclude={value} onPick={(id) => onChange([...value, id])} />
    </div>
  );
}
