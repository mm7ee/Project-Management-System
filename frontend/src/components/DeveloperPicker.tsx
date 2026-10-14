import { initials, type System } from "../data/systems";
import type { User } from "../data/roles";

interface Props {
  users: User[];
  systems: System[];
  systemId?: string; // the project being edited; unset while adding a new one
  value: string[];
  onChange: (ids: string[]) => void;
}

/** Tick-list of developer accounts. A developer works on one project, so ticking one already on another moves them. */
export default function DeveloperPicker({ users, systems, systemId, value, onChange }: Props) {
  const developers = users.filter((u) => u.role === "developer");
  if (!developers.length) return <p className="lead-none">No developer accounts yet. Create them on the Users page.</p>;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="dev-picker">
      {developers.map((d) => {
        const elsewhere = d.projectId && d.projectId !== systemId ? systems.find((s) => s.id === d.projectId)?.name : undefined;
        const checked = value.includes(d.id);
        return (
          <label key={d.id} className={`dev-option ${checked ? "on" : ""}`}>
            <input type="checkbox" checked={checked} onChange={() => toggle(d.id)} />
            <span className="avatar">{initials(d.name)}</span>
            <span className="dev-option-text">
              <b>{d.name}</b>
              {elsewhere ? (
                <span className={checked ? "dev-move" : undefined}>
                  {checked ? `Moves off ${elsewhere}` : `On ${elsewhere}`}
                </span>
              ) : (
                d.title && <span>{d.title}</span>
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
}
