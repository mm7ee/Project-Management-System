/** @import { System } from '../data/systems' */
/** @import { User } from '../data/roles' */
import { useState } from "react";
import BoardView from "./BoardView";
import TimelineView from "./TimelineView";
import { workspaceKey } from "../data/tenant";
/**
 * Boards: a workspace's board across its projects, or one project's.
 * @param {{
 *   workspaces: string[];
 *   systems: System[];
 *   users: User[];
 *   me: User;
 *   now: number;
 *   readOnly: boolean;
 *   canAssignOthers: boolean;
 * }} props
 */
export default function BoardsPage({ workspaces, systems, users, me, now, readOnly, canAssignOthers }) {
  const remembered = (() => {
    try {
      return localStorage.getItem(workspaceKey("pulse:board")) ?? "";
    } catch {
      return "";
    }
  })();
  const valid = /** @param {string} v */ (v) => (v.startsWith("ws:") ? workspaces.includes(v.slice(3)) : systems.some((s) => `p:${s.id}` === v));
  const [pick, setPickState] = useState(valid(remembered) ? remembered : `ws:${workspaces[0] ?? ""}`);
  const setPick = /** @param {string} v */ (v) => {
    setPickState(v);
    try {
      localStorage.setItem(workspaceKey("pulse:board"), v);
    } catch {
      // Only a convenience.
    }
  };
  const live = systems.filter((s) => s.status !== "IDEA");
  const [view, setView] = useState(/** @type {"board" | "timeline" | (() => "board" | "timeline")} */ ("board"));
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h2>Boards</h2>
          <p>Work items as cards in columns, or on a timeline. Drag a card, or use its Move list, to move it on through its project's workflow.</p>
        </div>
        <div className="seg" role="radiogroup" aria-label="Board or timeline">
          {/** @type {const} */ (["board", "timeline"]).map((v) => (
            <button key={v} role="radio" aria-checked={view === v} className={view === v ? "on" : ""} onClick={() => setView(v)}>
              {v === "board" ? "Board" : "Timeline"}
            </button>
          ))}
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
      {view === "timeline" ? (
        <TimelineView key={`t${pick}`} scope={pick.startsWith("ws:") ? { workspace: pick.slice(3) } : { systemId: pick.slice(2) }} users={users} now={now} readOnly={readOnly} />
      ) : (
        <BoardView key={pick} scope={pick.startsWith("ws:") ? { workspace: pick.slice(3) } : { systemId: pick.slice(2) }} users={users} me={me} now={now} readOnly={readOnly} canAssignOthers={canAssignOthers} />
      )}
    </div>
  );
}
