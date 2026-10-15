import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Download, LogIn, RefreshCw, Search } from "lucide-react";
import { api } from "../data/api";
import { STATUS_META, initials, type Status, type System } from "../data/systems";
import { FEATURE_STATUS_META, PRIORITY_META, type FeatureStatus, type Priority } from "../data/features";
import { PERMISSIONS, ROLE_LABEL, type ActivityEntry, type Role, type User } from "../data/roles";
import { timeAgo } from "../time";

interface Props {
  users: User[];
  systems: System[];
  now: number;
}

type Kind = "" | "signin" | "failed" | "account" | "systems" | "features" | "project" | "admin";
const KINDS: { key: Kind; label: string }[] = [
  { key: "", label: "Everything" },
  { key: "signin", label: "Sign-ins" },
  { key: "failed", label: "Failed sign-ins" },
  { key: "systems", label: "Systems" },
  { key: "features", label: "Feature requests" },
  { key: "project", label: "Documents & blockers" },
  { key: "admin", label: "Users & roles" },
  { key: "account", label: "Own account" },
];

interface Page {
  items: ActivityEntry[];
  next: number | null;
  stats?: { signins24h: number; failed24h: number; active7d: number; changes7d: number };
}

const str = (v: unknown) => (v == null ? "" : String(v));
const statusLabel = (s: unknown) => STATUS_META[s as Status]?.label ?? str(s);
const roleLabel = (r: unknown) => ROLE_LABEL[r as Role] ?? str(r);
const prioLabel = (p: unknown) => PRIORITY_META[p as Priority]?.label ?? str(p);
const featureStatusLabel = (s: unknown) => FEATURE_STATUS_META[s as FeatureStatus]?.label ?? str(s);
const permLabel = (p: string) => PERMISSIONS.find((x) => x.key === p)?.label.toLowerCase() ?? p;

/** "Edge on Windows" from a user-agent string; good enough to recognise a device. */
export function device(agent: string | null): string {
  if (!agent) return "Unknown device";
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /OPR\//.test(agent)
      ? "Opera"
      : /Firefox\//.test(agent)
        ? "Firefox"
        : /Chrome\//.test(agent)
          ? "Chrome"
          : /Safari\//.test(agent)
            ? "Safari"
            : /node|curl|python|wget/i.test(agent)
              ? "Script"
              : "Browser";
  const os = /Windows/.test(agent)
    ? "Windows"
    : /Android/.test(agent)
      ? "Android"
      : /iPhone|iPad|iOS/.test(agent)
        ? "iOS"
        : /Mac OS X|Macintosh/.test(agent)
          ? "macOS"
          : /Linux/.test(agent)
            ? "Linux"
            : "";
  return os ? `${browser} on ${os}` : browser;
}

/** Plain-language sentence for one entry. Names come from the entry, so deleted things still read well. */
export function describe(e: ActivityEntry, users: User[], systems: System[]): string {
  const d = e.detail;
  const userName = (id: unknown) => users.find((u) => u.id === id)?.name ?? (id ? str(id) : "nobody");
  const sysName = (id: unknown) => systems.find((s) => s.id === id)?.name ?? (id ? str(id) : "none");
  const name = str(d.name) || sysName(e.target);
  switch (e.action) {
    case "login":
      return d.temporaryPassword
        ? "Signed in with a temporary password"
        : d.twoStep === "recovery"
          ? "Signed in with a recovery code"
          : d.twoStep
            ? "Signed in with two-step verification"
            : "Signed in";
    case "login_failed":
      return d.reason
        ? `Failed sign-in: ${str(d.reason)}`
        : e.userId
          ? "Failed sign-in: wrong password"
          : `Failed sign-in: unknown username "${str(d.username)}"`;
    case "mfa_enabled":
      return "Turned on two-step verification";
    case "mfa_disabled":
      return "Turned off two-step verification";
    case "mfa_recovery_regenerated":
      return "Made new two-step recovery codes";
    case "mfa_reset":
      return `Reset two-step verification for ${str(d.name)}`;
    case "mfa_policy_updated": {
      const to = (d.to as string[] | undefined) ?? [];
      return to.length ? `Required two-step verification for: ${to.map(roleLabel).join(", ")}` : "Made two-step verification optional for everyone";
    }
    case "logout":
      return "Signed out";
    case "logout_all":
      return "Signed out of all devices";
    case "password_changed":
      return "Changed their password";
    case "password_set_after_reset":
      return "Set a new password after a reset";
    case "profile_updated":
      return `Updated their ${(d.fields as string[] | undefined)?.join(" and ") ?? "contact details"}`;
    case "system_created":
      return `Added system ${name} (${statusLabel(d.status)}, ${str(d.progress)}%)`;
    case "system_progress": {
      const from = (d.from ?? {}) as Record<string, unknown>;
      const to = (d.to ?? {}) as Record<string, unknown>;
      const parts: string[] = [];
      if (from.progress !== to.progress) parts.push(`progress ${str(from.progress)}% → ${str(to.progress)}%`);
      if (from.status !== to.status) parts.push(`status ${statusLabel(from.status)} → ${statusLabel(to.status)}`);
      if (from.health !== to.health) parts.push(to.health === "Maintenance" ? "put under maintenance" : "maintenance ended");
      if (d.note) parts.push(`note "${str(d.note)}"`);
      return `Updated ${name}: ${parts.join(", ") || "no change"}`;
    }
    case "system_updated": {
      const lead = d.lead as { from: unknown; to: unknown } | undefined;
      const fields = ((d.fields as string[] | undefined) ?? []).filter((f) => f !== "lead");
      const parts = [
        ...(fields.length ? [`changed ${fields.join(", ")}`] : []),
        ...(lead ? [`lead ${userName(lead.from)} → ${userName(lead.to)}`] : []),
      ];
      return `Edited ${name}: ${parts.join("; ")}`;
    }
    case "system_developers": {
      const added = (d.added as { name: string; from: string | null }[] | undefined) ?? [];
      const removed = (d.removed as string[] | undefined) ?? [];
      const parts = [
        // `from` only appears on entries logged when a developer could be on one project at a time.
        ...added.map((a) => `added ${a.name}${a.from ? ` (moved from ${sysName(a.from)})` : ""}`),
        ...removed.map((n) => `removed ${n}`),
      ];
      return `Developers on ${name}: ${parts.join(", ") || "no change"}`;
    }
    case "system_deleted":
      return `Deleted system ${name}`;
    case "request_created":
      return `Requested an update on ${name}${d.message ? `: "${str(d.message)}"` : ""}`;
    case "feature_created":
      return `Logged feature request "${str(d.title)}" on ${name} (${prioLabel(d.priority)}${d.client ? `, for ${str(d.client)}` : ""}${
        d.assignee ? `, assigned to ${userName(d.assignee)}` : ""
      })`;
    case "feature_updated": {
      const status = d.status as { from: unknown; to: unknown } | undefined;
      const priority = d.priority as { from: unknown; to: unknown } | undefined;
      const assignee = d.assignee as { from: unknown; to: unknown } | undefined;
      const fields = ((d.fields as string[] | undefined) ?? []).filter((f) => !["status", "priority", "assignee"].includes(f));
      const parts = [
        ...(status ? [`status ${featureStatusLabel(status.from)} → ${featureStatusLabel(status.to)}`] : []),
        ...(priority ? [`priority ${prioLabel(priority.from)} → ${prioLabel(priority.to)}`] : []),
        ...(assignee ? [`developer ${userName(assignee.from)} → ${userName(assignee.to)}`] : []),
        ...(fields.length ? [`changed ${fields.join(", ")}`] : []),
      ];
      return `Updated feature request "${str(d.title)}" on ${name}: ${parts.join("; ")}`;
    }
    case "document_added":
      return `Added ${d.link ? "link" : "document"} "${str(d.document)}" to ${name}`;
    case "document_removed":
      return `Removed document "${str(d.document)}" from ${name}`;
    case "blocker_raised":
      return `Raised a blocker on ${name}: "${str(d.blocker)}"`;
    case "blocker_resolved":
      return `Resolved a blocker on ${name}: "${str(d.blocker)}"${d.resolution ? `, ${str(d.resolution)}` : ""}`;
    case "blocker_reopened":
      return `Reopened a blocker on ${name}: "${str(d.blocker)}"`;
    case "blocker_deleted":
      return `Deleted a blocker on ${name}: "${str(d.blocker)}"`;
    case "limits_updated": {
      const to = d.to as { projects: number; features: number; stallDays: number } | undefined;
      return to
        ? `Set workload limits: ${to.projects} projects, ${to.features} open requests per developer; stalled after ${to.stallDays} days`
        : "Changed workload limits";
    }
    case "feature_deleted":
      return `Deleted feature request "${str(d.title)}" on ${name}`;
    case "request_dismissed":
      return `Dismissed an update request on ${name}`;
    case "user_created":
      return `Created user ${str(d.name)} (${str(d.username)}, ${roleLabel(d.role)})`;
    case "user_password_reset":
      return `Reset the password for ${str(d.name)}`;
    case "user_updated": {
      const parts: string[] = [];
      const role = d.role as { from: unknown; to: unknown } | undefined;
      const project = d.project as { from: unknown; to: unknown } | undefined; // older, one-project entries
      const projects = d.projects as { added: string[]; removed: string[] } | undefined;
      if (role) parts.push(`role ${roleLabel(role.from)} → ${roleLabel(role.to)}`);
      if (project) parts.push(`project ${sysName(project.from)} → ${sysName(project.to)}`);
      if (projects?.added.length) parts.push(`assigned to ${projects.added.map(sysName).join(", ")}`);
      if (projects?.removed.length) parts.push(`taken off ${projects.removed.map(sysName).join(", ")}`);
      if (d.fields) parts.push(`changed ${(d.fields as string[]).join(", ")}`);
      if (d.passwordSet) parts.push("set a temporary password");
      return `Edited user ${str(d.name)}: ${parts.join("; ")}`;
    }
    case "user_deleted":
      return `Deleted user ${str(d.name)} (${str(d.username)})`;
    case "roles_updated": {
      const changes = (d.changes ?? {}) as Record<string, { added: string[]; removed: string[] }>;
      return `Changed permissions: ${Object.entries(changes)
        .map(([r, c]) =>
          [
            ...c.added.map((p) => `${roleLabel(r)} can now ${permLabel(p)}`),
            ...c.removed.map((p) => `${roleLabel(r)} can no longer ${permLabel(p)}`),
          ].join("; "),
        )
        .join("; ")}`;
    }
    default:
      return e.action;
  }
}

const csvCell = (v: unknown) => {
  const s = str(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export default function ActivityPage({ users, systems, now }: Props) {
  const [kind, setKind] = useState<Kind>("");
  const [user, setUser] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Search waits for a pause in typing.
  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(id);
  }, [search]);

  const load = useCallback(
    async (before?: number) => {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({ limit: "100" });
      if (kind) params.set("kind", kind);
      if (user) params.set("user", user);
      if (query) params.set("q", query);
      if (before) params.set("before", String(before));
      try {
        const res = await api<Page>(`/activity?${params}`);
        setPage((prev) =>
          before && prev ? { items: [...prev.items, ...res.items], next: res.next, stats: prev.stats } : res,
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load the activity log");
      } finally {
        setLoading(false);
      }
    },
    [kind, user, query],
  );

  useEffect(() => {
    load();
  }, [load]);

  const items = page?.items ?? [];
  const stats = page?.stats;

  const downloadCsv = () => {
    const header = ["Time (UTC)", "Person", "Action", "What happened", "IP address", "Device"];
    const lines = items.map((e) =>
      [e.at, e.actor, e.action, describe(e, users, systems), e.ip ?? "", device(e.agent)].map(csvCell).join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `omnitrack-activity-${new Date(now).toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h2>Activity log</h2>
          <p>Who signed in, failed to sign in, and changed what. Kept for 12 months.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => load()} disabled={loading}>
            <RefreshCw size={16} /> Refresh
          </button>
          <button className="btn btn-navy" onClick={downloadCsv} disabled={!items.length}>
            <Download size={16} /> CSV
          </button>
        </div>
      </header>

      {stats && (
        <section className="stats">
          <div className="stat">
            <span className="stat-value text-navy">{stats.signins24h}</span>
            <span className="stat-label">Sign-ins, last 24 h</span>
          </div>
          <div className="stat">
            <span className={`stat-value ${stats.failed24h ? "text-red" : "text-green"}`}>{stats.failed24h}</span>
            <span className="stat-label">Failed sign-ins, 24 h</span>
          </div>
          <div className="stat">
            <span className="stat-value text-cyan">{stats.active7d}</span>
            <span className="stat-label">People active, 7 days</span>
          </div>
          <div className="stat">
            <span className="stat-value text-navy">{stats.changes7d}</span>
            <span className="stat-label">Changes, 7 days</span>
          </div>
        </section>
      )}

      <div className="viz-filters" role="group" aria-label="Activity filters">
        <div className="seg" role="radiogroup" aria-label="Kind of activity">
          {KINDS.map((k) => (
            <button key={k.key} role="radio" aria-checked={kind === k.key} className={kind === k.key ? "on" : ""} onClick={() => setKind(k.key)}>
              {k.label}
            </button>
          ))}
        </div>
        <select value={user} onChange={(e) => setUser(e.target.value)} aria-label="Person">
          <option value="">Everyone</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <label className="search act-search">
          <Search size={16} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, detail or IP" aria-label="Search activity" />
        </label>
      </div>

      {error && <p className="form-error banner">{error}</p>}

      <div className="table-wrap">
        <table className="table act-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>What happened</th>
              <th>From</th>
            </tr>
          </thead>
          <tbody>
            {items.map((e) => {
              const failed = e.action === "login_failed";
              const signin = e.action === "login";
              return (
                <tr key={e.id} className={failed ? "act-failed" : ""}>
                  <td className="act-when" title={new Date(e.at).toLocaleString("en-GB")}>
                    <b>{timeAgo(e.at, now)}</b>
                    <small>{new Date(e.at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</small>
                  </td>
                  <td>
                    <span className="user-cell">
                      <span className={`avatar ${e.userId ? "" : "unknown"}`}>{e.userId ? initials(e.actor) : "?"}</span>
                      <span>
                        <b>{e.actor}</b>
                        {!e.userId && <small>not a user</small>}
                      </span>
                    </span>
                  </td>
                  <td>
                    <span className="act-what">
                      {failed && <AlertTriangle size={15} className="text-red" aria-hidden="true" />}
                      {signin && <LogIn size={15} className="text-green" aria-hidden="true" />}
                      {describe(e, users, systems)}
                    </span>
                  </td>
                  <td className="act-from">
                    <span>{e.ip ?? "—"}</span>
                    <small>{device(e.agent)}</small>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && !items.length && <p className="viz-empty act-empty">No activity matches these filters.</p>}
      </div>
      {page?.next && (
        <button className="btn btn-ghost act-more" onClick={() => load(page.next!)} disabled={loading}>
          {loading ? "Loading…" : "Load older activity"}
        </button>
      )}
    </div>
  );
}
