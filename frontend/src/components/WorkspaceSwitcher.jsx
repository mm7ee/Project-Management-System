/** @import { Tenant } from '../data/api' */
/** @import { WorkspaceIcon } from '../data/orgAdmin' */
import { useState } from "react";
import { Layers } from "lucide-react";
import { api } from "../data/api";
import { rememberWorkspace } from "../data/tenant";
import { WORKSPACE_ICON } from "./OrgAdmin";

/** The workspace's icon in its colour. @param {{ icon?: string; colour?: string | null }} w */
function WorkspaceIconOf({ icon, colour }) {
  const Icon = WORKSPACE_ICON[/** @type {WorkspaceIcon} */ (icon)] ?? Layers;
  return (
    <span className="ws-switch-icon" style={colour ? { color: colour } : undefined} aria-hidden="true">
      <Icon size={15} />
    </span>
  );
}

/**
 * The open workspace, in the top bar. With more than one, choosing another switches to it without signing in
 * again: the server checks membership, then the page reloads so nothing from the last workspace stays on screen.
 * Organisation-wide workspaces you aren't in are listed too, marked "view only": opening one makes you its Viewer.
 * @param {{ tenant?: Tenant }} p
 */
export default function WorkspaceSwitcher({ tenant }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!tenant?.workspace) return null;
  const current = tenant.workspace;
  const choices = tenant.workspaces;
  if (choices.length < 2) {
    return (
      <span className="ws-switch" title={tenant.organization ? `${tenant.organization.name} · ${current.name}` : current.name}>
        <WorkspaceIconOf icon={current.icon} colour={current.colour} /> <span className="ws-switch-name">{current.name}</span>
      </span>
    );
  }
  const mine = choices.filter((w) => !w.open);
  const open = choices.filter((w) => w.open);
  return (
    <label className="ws-switch" title={tenant.organization ? `${tenant.organization.name}: switch workspace` : "Switch workspace"}>
      <WorkspaceIconOf icon={current.icon} colour={current.colour} />
      <span className="sr-only">Workspace</span>
      <select
        value={current.id}
        disabled={busy}
        aria-describedby={error ? "ws-switch-error" : undefined}
        onChange={async (e) => {
          setBusy(true);
          setError("");
          try {
            await api("/me/workspace", "POST", { workspaceId: e.target.value });
            if (tenant.organization) rememberWorkspace(tenant.organization.id, e.target.value);
            window.location.hash = "";
            window.location.reload();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't switch workspace");
            setBusy(false);
          }
        }}
      >
        {mine.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
            {w.role === "reader" ? " (view only)" : ""}
          </option>
        ))}
        {open.length > 0 && (
          <optgroup label="Open to everyone (view only)">
            {open.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {error && (
        <span id="ws-switch-error" role="alert" className="ws-switch-error">
          {error}
        </span>
      )}
    </label>
  );
}
