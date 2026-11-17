import { useState } from "react";
import type { System } from "../data/systems";
import type { User } from "../data/roles";
import BoardView from "./BoardView";

/** Boards: a workspace's board across its projects, or one project's. */
export default function BoardsPage({
  workspaces,
  systems,
  users,
  me,
  now,
  readOnly,
  canAssignOthers,
}: {
  workspaces: string[];
  systems: System[];
  users: User[];
  me: User;
  now: number;
  readOnly: boolean;
  canAssignOthers: boolean;
}) {
  const remembered = (() => {
    try {
      return localStorage.getItem("pulse:board") ?? "";
    } catch {
      return "";
    }
  })();
  const valid = (v: string) => (v.startsWith("ws:") ? workspaces.includes(v.slice(3)) : systems.some((s) => `p:${s.id}` === v));
  const [pick, setPickState] = useState(valid(remembered) ? remembered : `ws:${workspaces[0] ?? ""}`);
  const setPick = (v: string) => {
    setPickState(v);
    try {
      localStorage.setItem("pulse:board", v);
    } catch {
      // Only a convenience.
    }
  };
  const live = systems.filter((s) => s.status !== "IDEA");
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h2>Boards</h2>
          <p>Work items as cards in columns. Drag a card, or use its Move list, to move it on through its project's workflow.</p>
        </div>
        <select className="board-pick" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Which board">
          <optgroup label="Workspaces (every project in it)">
            {workspaces.map((w) => (
              <option key={w} value={`ws:${w}`}>
                {w} workspace
              </option>
            ))}
          </optgroup>
          <optgroup label="Projects">
            {live.map((s) => (
              <option key={s.id} value={`p:${s.id}`}>
                {s.key ? `${s.key} · ` : ""}
                {s.name}
              </option>
            ))}
          </optgroup>
        </select>
      </header>
      <BoardView
        key={pick}
        scope={pick.startsWith("ws:") ? { workspace: pick.slice(3) } : { systemId: pick.slice(2) }}
        users={users}
        me={me}
        now={now}
        readOnly={readOnly}
        canAssignOthers={canAssignOthers}
      />
    </div>
  );
}
