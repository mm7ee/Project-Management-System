import { useEffect, useState } from "react";
import { api } from "../data/api";
import type { System } from "../data/systems";
import { formatDate, timeAgo } from "../time";
import { isDone, type WorkItemPage } from "../data/workitems";
import Panel from "./Panel";
import { ItemPriority, ItemStatusPill, TypeIcon, itemHref } from "./WorkItemBits";

type Show = "open" | "week" | "overdue" | "done";
const SHOWS: { key: Show; label: string; query: string }[] = [
  { key: "open", label: "Open", query: "state=open&sort=priority&dir=asc" },
  { key: "week", label: "Due this week", query: "state=open&due=week&sort=due&dir=asc" },
  { key: "overdue", label: "Overdue", query: "due=overdue&sort=due&dir=asc" },
  { key: "done", label: "Done", query: "state=done&sort=updated&dir=desc" },
];

/** The Dashboard's "My work": work items assigned to you, across every project. */
export default function MyWork({ systems, now }: { systems: System[]; now: number }) {
  const [show, setShow] = useState<Show>("open");
  const [page, setPage] = useState<WorkItemPage | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setError("");
    api<WorkItemPage>(`/items?assignee=me&limit=10&${SHOWS.find((s) => s.key === show)!.query}`)
      .then((p) => live && setPage(p))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Couldn't load your work"));
    return () => {
      live = false;
    };
  }, [show]);
  const project = (id: string) => systems.find((s) => s.id === id)?.name ?? "";
  return (
    <Panel
      title="My work"
      className="my-work"
      action={
        <div className="seg sm" role="radiogroup" aria-label="Which of your work items">
          {SHOWS.map((s) => (
            <button key={s.key} role="radio" aria-checked={show === s.key} className={show === s.key ? "on" : ""} onClick={() => setShow(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
      }
    >
      {error ? (
        <p className="form-error">{error}</p>
      ) : !page ? (
        <p className="lead-none">Loading…</p>
      ) : page.items.length ? (
        <>
          <ul className="wi-children my-work-list">
            {page.items.map((i) => {
              const late = !!i.dueDate && !isDone(i) && new Date(i.dueDate).setHours(23, 59, 59, 999) < now;
              return (
                <li key={i.id}>
                  <a href={itemHref(i.systemId, i.key)}>
                    <TypeIcon type={i.type} />
                    <span className="mono">{i.key}</span>
                    <span className="wi-child-summary">
                      {i.summary}
                      <small>{project(i.systemId)}</small>
                    </span>
                    <ItemPriority priority={i.priority} />
                    <ItemStatusPill item={i} />
                    <small className={late ? "text-red strong" : "muted"}>
                      {show === "done" ? timeAgo(i.resolvedAt ?? i.updatedAt, now) : i.dueDate ? `due ${formatDate(i.dueDate)}` : "no due date"}
                    </small>
                  </a>
                </li>
              );
            })}
          </ul>
          {page.total > page.items.length && (
            <p className="d-hint">
              {page.total - page.items.length} more. Open a project's Work items tab and choose "My work" to see them all.
            </p>
          )}
        </>
      ) : (
        <p className="lead-none">
          {show === "open" ? "Nothing assigned to you. Nice." : show === "done" ? "You haven't finished any work items yet." : "Nothing here."}
        </p>
      )}
    </Panel>
  );
}
