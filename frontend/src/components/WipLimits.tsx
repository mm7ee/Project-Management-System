import { useEffect, useState } from "react";
import { AlertOctagon } from "lucide-react";
import { api } from "../data/api";

interface WipBoard {
  id: string;
  name: string;
  systemId: string | null;
  workspace: string | null;
  columns: { name: string; wipLimit: number; count: number; over: boolean }[];
}

/** Board work-in-progress limits, beside the developer workload limits: each limited column and how full it is. */
export default function WipLimits() {
  const [boards, setBoards] = useState<WipBoard[] | null>(null);
  useEffect(() => {
    api<{ boards: WipBoard[] }>("/boards/wip")
      .then((r) => setBoards(r.boards))
      .catch(() => setBoards([]));
  }, []);
  const over = (boards ?? []).flatMap((b) => b.columns.filter((c) => c.over).map((c) => `${b.name}: ${c.name}`));
  return (
    <section className="set-card wip-limits" aria-label="Board work-in-progress limits">
      <h3>Board work-in-progress limits</h3>
      <p className="field-hint">
        Set on each board's columns (Board → Columns) by anyone who can edit systems. A column over its limit turns amber on the board.
      </p>
      {boards === null ? (
        <p className="lead-none">Loading…</p>
      ) : boards.length ? (
        <>
          {over.length > 0 && (
            <p className="wip-over" role="status">
              <AlertOctagon size={15} /> Over the limit: {over.join("; ")}
            </p>
          )}
          <ul className="wip-list">
            {boards.map((b) => (
              <li key={b.id}>
                <a href={b.systemId ? `#/projects/${b.systemId}/board` : undefined}>
                  <b>{b.name}</b>
                </a>
                <span>
                  {b.columns.map((c) => (
                    <span key={c.name} className={`wip-chip ${c.over ? "over" : ""}`}>
                      {c.name} {c.count}/{c.wipLimit}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="lead-none">No board has a work-in-progress limit yet.</p>
      )}
    </section>
  );
}
