/** @import { Tenant } from '../data/api' */
import { useState } from "react";
import { Layers } from "lucide-react";
import { api } from "../data/api";
import { rememberWorkspace } from "../data/tenant";

/**
 * The open workspace, in the top bar. With more than one, choosing another switches to it without signing in
 * again: the server checks membership, then the page reloads so nothing from the last workspace stays on screen.
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
        <Layers size={15} aria-hidden="true" /> <span className="ws-switch-name">{current.name}</span>
      </span>
    );
  }
  return (
    <label className="ws-switch" title={tenant.organization ? `${tenant.organization.name}: switch workspace` : "Switch workspace"}>
      <Layers size={15} aria-hidden="true" />
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
        {choices.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
      {error && (
        <span id="ws-switch-error" role="alert" className="ws-switch-error">
          {error}
        </span>
      )}
    </label>
  );
}
