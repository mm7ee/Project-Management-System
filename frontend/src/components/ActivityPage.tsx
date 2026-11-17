import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Download, LogIn, RefreshCw, Search } from "lucide-react";
import { api } from "../data/api";
import { STATUS_META, initials, type Status, type System } from "../data/systems";
import { FEATURE_STATUS_META, PRIORITY_META, type FeatureStatus, type Priority } from "../data/features";
import { PERMISSIONS, ROLE_LABEL, type ActivityEntry, type Role, type User } from "../data/roles";
import { STATUS_META as ITEM_STATUS, TYPE_META, WORK_PRIORITY_META, formatMinutes, type WorkItemType, type WorkPriority, type WorkStatus } from "../data/workitems";
import { timeAgo } from "../time";

interface Props {
  users: User[];
  systems: System[];
  now: number;
}

type Kind = "" | "signin" | "failed" | "account" | "systems" | "features" | "items" | "workflows" | "sprints" | "project" | "admin";
const KINDS: { key: Kind; label: string }[] = [
  { key: "", label: "Everything" },
  { key: "signin", label: "Sign-ins" },
  { key: "failed", label: "Failed sign-ins" },
  { key: "systems", label: "Systems" },
  { key: "features", label: "Feature requests" },
  { key: "items", label: "Work items" },
  { key: "workflows", label: "Workflows & boards" },
  { key: "sprints", label: "Sprints" },
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

const FIELD_WORDS: Record<string, string> = {
  summary: "summary",
  description: "description",
  type: "type",
  status: "status",
  resolution: "resolution",
  onHold: "on hold",
  priority: "priority",
  assignee: "assignee",
  parent: "parent",
  labels: "labels",
  component: "component",
  storyPoints: "story points",
  originalEstimate: "original estimate",
  remainingEstimate: "remaining estimate",
  startDate: "start date",
  dueDate: "due date",
  client: "requested by",
  notes: "notes",
  systemId: "project",
};
const itemType = (v: unknown) => TYPE_META[v as WorkItemType]?.label.toLowerCase() ?? "work item";
const itemStatus = (v: unknown) => ITEM_STATUS[v as WorkStatus]?.label ?? (v ? String(v) : "none");
const itemPriority = (v: unknown) => WORK_PRIORITY_META[v as WorkPriority]?.label ?? String(v);

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
    case "account_locked":
      return `Account locked after ${str(d.failures)} failed sign-ins, for ${str(d.minutes)} minutes`;
    case "account_unlocked":
      return `Unlocked ${str(d.name)}'s account`;
    case "signin_ip_blocked":
      return `Refused sign-ins from ${str(d.ip)} after ${str(d.failures)} failures in ${str(d.minutes)} minutes`;
    case "signin_rules_updated": {
      const to = d.to as { attempts: number; lockMinutes: number; ipAttempts: number } | undefined;
      return to
        ? `Set sign-in security: lock after ${to.attempts} wrong passwords for ${to.lockMinutes} minutes; refuse an address after ${to.ipAttempts} failures`
        : "Changed sign-in security";
    }
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
      return d.pcn
        ? `Proposed ${name} with a Project Concept Note`
        : `Added system ${name} (${statusLabel(d.status)}, ${str(d.progress)}%)${d.template ? ` from the "${str(d.template)}" template` : ""}`;
    case "pcn_signed": {
      const verb = d.decision === "APPROVED" ? "approved" : d.decision === "DECLINED" ? "declined" : "withdrew a decision on";
      const who = d.recordedFor ? `Recorded that ${str(d.signatory)} ${verb}` : `Signed: ${verb}`;
      return `${who} the Project Concept Note for ${name}${d.from !== d.to ? `; now ${String(d.to).toLowerCase()}` : ""}`;
    }
    case "pcn_updated": {
      const signoffs = (d.signoffs as string[] | undefined) ?? [];
      const moved = d.from !== d.to ? `; now ${String(d.to).toLowerCase()}` : "";
      return signoffs.length
        ? `Recorded PCN approvals on ${name}: ${signoffs.join(", ")}${moved}`
        : `${d.from ? "Edited" : "Added"} the Project Concept Note for ${name}${moved}`;
    }
    case "template_created":
      return `Saved project template "${str(d.template)}"${d.from ? ` from ${sysName(d.from)}` : ""}`;
    case "template_deleted":
      return `Deleted project template "${str(d.template)}"`;
    case "system_progress": {
      const from = (d.from ?? {}) as Record<string, unknown>;
      const to = (d.to ?? {}) as Record<string, unknown>;
      const parts: string[] = [];
      if (from.progress !== to.progress) parts.push(`progress ${str(from.progress)}% → ${str(to.progress)}%`);
      if (from.status !== to.status) parts.push(`status ${statusLabel(from.status)} → ${statusLabel(to.status)}`);
      if (from.health !== to.health) parts.push(to.health === "Maintenance" ? "put under maintenance" : "maintenance ended");
      if (d.note) parts.push(`note "${str(d.note)}"`);
      if (d.fromWorkItems) return `${name}'s progress moved with its work items: ${parts.join(", ") || "no change"}`;
      return `Updated ${name}: ${parts.join(", ") || "no change"}`;
    }
    case "system_updated": {
      if (d.key) {
        const k = d.key as { from: unknown; to: unknown };
        return `Changed ${name}'s key from ${str(k.from)} to ${str(k.to)}`;
      }
      if (d.agileMode) {
        return (d.agileMode as { to: unknown }).to === "scrum" ? `Set ${name} to plan in sprints` : `Set ${name} to Kanban only`;
      }
      if (d.progressFromItems) {
        return (d.progressFromItems as { to: unknown }).to
          ? `Set ${name} to take its progress from its work items`
          : `Set ${name}'s progress by hand again`;
      }
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
    case "work_item_created":
      return d.clonedFrom
        ? `Cloned ${str(d.clonedFrom)} as ${str(d.key)} on ${name}`
        : `Created ${itemType(d.type)} ${str(d.key)} "${str(d.summary)}" on ${name}${d.assignee ? `, assigned to ${userName(d.assignee)}` : ""}`;
    case "work_item_updated": {
      const fields = (d.fields as string[] | undefined) ?? [];
      const change = (k: string) => d[k] as { from: unknown; to: unknown } | undefined;
      const parts = fields.map((f) => {
        const c = change(f);
        if (!c) return FIELD_WORDS[f] ?? f;
        if (f === "status") {
          const names = d.statusNames as { from: unknown; to: unknown } | undefined;
          return `status ${names ? str(names.from) : itemStatus(c.from)} → ${names ? str(names.to) : itemStatus(c.to)}${d.transition ? ` (${str(d.transition)})` : ""}`;
        }
        if (f === "priority") return `priority ${itemPriority(c.from)} → ${itemPriority(c.to)}`;
        if (f === "assignee") return `assignee ${c.from ? userName(c.from) : "nobody"} → ${c.to ? userName(c.to) : "nobody"}`;
        if (f === "type") return `type ${itemType(c.from)} → ${itemType(c.to)}`;
        if (f === "summary") return `summary "${str(c.from)}" → "${str(c.to)}"`;
        if (f === "systemId") return `moved to ${sysName(c.to)}${d.key && typeof d.key === "object" ? ` as ${str((d.key as { to: unknown }).to)}` : ""}`;
        if (f === "onHold") return c.to ? "put on hold" : "taken off hold";
        if (f === "description" || f === "notes") return `${FIELD_WORDS[f]} changed`;
        if (f === "originalEstimate" || f === "remainingEstimate") return `${FIELD_WORDS[f]} ${formatMinutes(c.from as number)} → ${formatMinutes(c.to as number)}`;
        if (f === "labels") return `labels ${(c.from as string[]).join(", ") || "none"} → ${(c.to as string[]).join(", ") || "none"}`;
        return `${FIELD_WORDS[f] ?? f} ${c.from == null || c.from === "" ? "none" : str(c.from)} → ${c.to == null || c.to === "" ? "none" : str(c.to)}`;
      });
      const key = typeof d.key === "string" ? d.key : str((d.key as { to?: unknown } | undefined)?.to);
      return `Updated ${key} "${str(d.summary)}" on ${name}: ${parts.join("; ")}`;
    }
    case "sprint_created":
      return `Planned ${str(d.sprint)} on ${name}, starting ${str(d.start)} for ${str(d.weeks)} week${d.weeks === 1 ? "" : "s"}`;
    case "sprint_updated": {
      const from = (d.from ?? {}) as Record<string, unknown>;
      const to = (d.to ?? {}) as Record<string, unknown>;
      const parts = (["name", "goal", "start", "end"] as const).filter((k) => from[k] !== to[k]).map((k) => `${k} ${str(from[k]) || "none"} → ${str(to[k]) || "none"}`);
      return `Edited ${str(d.sprint)} on ${name}: ${parts.join("; ") || "no change"}`;
    }
    case "sprint_deleted":
      return `Deleted ${str(d.sprint)} on ${name}; ${str(d.itemsToBacklog)} items went back to the backlog`;
    case "sprint_started":
      return `Started ${str(d.sprint)} on ${name}, ending ${str(d.end)}`;
    case "sprint_completed":
      return `Completed ${str(d.sprint)} on ${name}: ${str(d.completedPoints)} of ${str(d.committedPoints)} committed points done; unfinished work to ${str(d.unfinishedTo)}`;
    case "sprint_scope_changed":
      return `Moved ${((d.keys as string[]) ?? []).join(", ")} to ${str(d.to)} on ${name}`;
    case "backlog_ranked":
      return `Re-ranked ${((d.keys as string[]) ?? []).join(", ")} in ${name}'s backlog${d.before ? `, above ${str(d.before)}` : ""}`;
    case "workflow_created":
      return `Created the workflow ${str(d.workflow)}, a copy of ${str(d.copiedFrom)}`;
    case "workflow_updated": {
      const to = (d.to ?? {}) as { statuses?: string[]; moves?: string[] };
      const from = (d.from ?? {}) as { statuses?: string[]; moves?: string[] };
      const parts = [
        ...(d.renamed ? [`renamed from ${str((d.renamed as { from: unknown }).from)}`] : []),
        ...(JSON.stringify(from.statuses) !== JSON.stringify(to.statuses) ? [`statuses now ${(to.statuses ?? []).join(", ")}`] : []),
        ...(JSON.stringify(from.moves) !== JSON.stringify(to.moves) ? [`${(to.moves ?? []).length} moves: ${(to.moves ?? []).join("; ")}`] : []),
      ];
      return `Edited the ${str(d.workflow)} workflow${parts.length ? `: ${parts.join("; ")}` : ""}`;
    }
    case "workflow_deleted":
      return `Deleted the workflow ${str(d.workflow)}`;
    case "workflow_assigned": {
      const changed = (d.changed as string[] | undefined) ?? [];
      const ws = Object.entries((d.workspaces ?? {}) as Record<string, { to: unknown }>).map(([w, v]) => `${w} workspace → ${str(v.to)}`);
      const pr = Object.entries((d.projects ?? {}) as Record<string, { to: unknown }>).map(([p, v]) => `${p} → ${str(v.to)}`);
      return `Changed which workflow is used: ${[...ws, ...pr].join("; ") || "no change"}${changed.length ? ` (${changed.length} project${changed.length === 1 ? "" : "s"} affected)` : ""}`;
    }
    case "status_created":
      return `Added the status ${str(d.status)} (${str(d.category).replace("_", " ").toLowerCase()})`;
    case "status_updated": {
      const from = (d.from ?? {}) as { name?: unknown; category?: unknown };
      const to = (d.to ?? {}) as { name?: unknown; category?: unknown };
      return `Changed the status ${str(from.name)}${from.name !== to.name ? ` to ${str(to.name)}` : ""}${from.category !== to.category ? `, now ${str(to.category).replace("_", " ").toLowerCase()}` : ""}`;
    }
    case "status_deleted":
      return `Deleted the status ${str(d.status)}${d.movedTo ? `; its work items moved to ${str(d.movedTo)}` : ""}`;
    case "work_items_moved":
      return `Moved ${str(d.count)} work item${d.count === 1 ? "" : "s"} from ${str(d.from)} to ${str(d.to)}: ${str(d.reason)}`;
    case "board_updated": {
      const parts = [
        ...(d.renamed ? [`renamed to ${str((d.renamed as { to: unknown }).to)}`] : []),
        ...(d.swimlanes ? [`swimlanes ${str((d.swimlanes as { to: unknown }).to)}`] : []),
        ...(d.columns ? [`columns: ${((d.columns as { to: string[] }).to ?? []).join("; ")}`] : []),
      ];
      return `Changed the board ${str(d.board)}${parts.length ? `: ${parts.join("; ")}` : ""}`;
    }
    case "work_item_deleted":
      return `Deleted ${itemType(d.type)} ${str(d.key)} "${str(d.summary)}" from ${name}${d.subtasks ? ` with ${str(d.subtasks)} sub-task${d.subtasks === 1 ? "" : "s"}` : ""}`;
    case "comment_added":
      return `Commented on ${str(d.key)} "${str(d.summary)}": "${str(d.comment).slice(0, 120)}"`;
    case "comment_edited":
      return `Edited a comment on ${str(d.key)}: "${str(d.from).slice(0, 60)}" → "${str(d.to).slice(0, 60)}"`;
    case "comment_deleted":
      return `Deleted a comment on ${str(d.key)}: "${str(d.comment).slice(0, 120)}"`;
    case "link_added":
      return `Linked work items: ${str(d.link)}`;
    case "link_removed":
      return `Removed the link ${str(d.link)}`;
    case "attachment_added":
      return `Attached "${str(d.document)}" to ${str(d.key)}`;
    case "attachment_removed":
      return `Removed the attachment "${str(d.document)}" from ${str(d.key)}`;
    case "time_logged":
      return `Logged ${formatMinutes(Number(d.minutes))} on ${str(d.key)} for ${str(d.date)}${d.note ? `: "${str(d.note)}"` : ""}`;
    case "time_log_deleted":
      return `Removed ${formatMinutes(Number(d.minutes))} logged on ${str(d.key)} for ${str(d.date)}`;
    case "work_item_watched":
      return `Started watching ${str(d.key)} "${str(d.summary)}"`;
    case "work_item_unwatched":
      return `Stopped watching ${str(d.key)} "${str(d.summary)}"`;
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
    a.download = `pulse-activity-${new Date(now).toISOString().slice(0, 10)}.csv`;
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
              const failed = e.action === "login_failed" || e.action === "account_locked" || e.action === "signin_ip_blocked";
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
