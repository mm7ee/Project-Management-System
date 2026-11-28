/** @import { ReactNode, RefObject } from 'react' */
/** @import { System } from '../data/systems' */
/** @import { ActivityEntry, UpdateRequest, User } from '../data/roles' */
/** @import { Feature } from '../data/features' */
/** @import { Blocker, Limits, ProjectDocument, Suggestion } from '../data/project' */
/** @import { Pcn, SignoffStatus } from '../data/pcn' */
/** @import { ChannelAvailability, RequestChannel, RequestDelivery } from '../data/updateRequests' */
import { useEffect, useRef, useState } from "react";
import { AlertOctagon, ArrowLeft, BellRing, CheckCircle2, Download, ExternalLink, FileText, History, LayoutTemplate, Link2, Plus, RotateCcw, Trash2, Upload, UserMinus, Wrench, X } from "lucide-react";
import { HEALTH_META, initials } from "../data/systems";
import { byUrgency, isLate, isOpen } from "../data/features";
import { MAX_DOCUMENT_BYTES, formatBytes } from "../data/project";
import { HandoverSuggestions } from "./Rebalance";
import { PcnCard, PcnForm } from "./Pcn";
import { emptyPcn } from "../data/pcn";
import { api, uploadDocument } from "../data/api";
import { formatDate, timeAgo } from "../time";
import { describe } from "./ActivityPage";
import { DeveloperSearch } from "./DeveloperPicker";
import { FeatureStatusPill, PriorityBadge } from "./FeatureModal";
import LeadContact from "./LeadContact";
import RequestChannels, { deliveryNote, savedChannels } from "./RequestChannels";
import { channelList } from "../data/updateRequests";
import WorkItemsTab from "./WorkItemsTab";
import WorkItemPage from "./WorkItemPage";
import BoardView from "./BoardView";
import BacklogView from "./BacklogView";
import TimelineView from "./TimelineView";
import LifecyclePage from "./LifecyclePage";
import { CockpitHeader, KpiTiles, Stepper, useOverview } from "./ProjectCockpit";
import { AttentionPanel, NextDays, SummaryCard } from "./ProjectOverview";
import ProjectCharts from "./ProjectCharts";
import ProjectKeys from "./ProjectKeys";
import OnePager from "./OnePager";
import { PAGE_PREF_LIMITS, remember } from "../data/pagePrefs";
import { ActivityTab, ProjectChat, ProjectFiles, RisksTab, TeamTab, TestingTab } from "./ProjectTabs";
import DocumentsTab from "./DocumentsTab";
import { DateLine, ProgressBar, ScheduleChip, updatedText } from "./SystemCard";
/**
 * @param {{ id?: string; title: string; icon?: ReactNode; count?: ReactNode; action?: ReactNode; children: ReactNode; tone?: "alert" }} props
 */
function Card({ id, title, icon, count, action, children, tone }) {
  return (
    <section id={id} className={`p-card ${tone === "alert" ? "p-card-alert" : ""}`}>
      <header className="p-card-head">
        <h3>
          {icon} {title} {count !== undefined && <span className="p-count">{count}</span>}
        </h3>
        {action}
      </header>
      {children}
    </section>
  );
}
/**
 * @param {Props} p
 */
export default function ProjectPage(p) {
  const { system, now, me, users } = p;
  const [editingPcn, setEditingPcn] = useState(/** @type {Pcn | null | (() => Pcn | null)} */ (null));
  const [confirming, setConfirming] = useState(false);
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState("");
  const [via, setVia] = useState(/** @type {RequestChannel[] | (() => RequestChannel[])} */ (() => savedChannels(p.requestChannels)));
  const [sentNote, setSentNote] = useState(/** @type {{ text: string; chatId?: string } | null | (() => { text: string; chatId?: string } | null)} */ (null));
  const [saving, setSaving] = useState(false); // a developer change is on its way to the server
  const [error, setError] = useState("");
  const [history, setHistory] = useState(/** @type {ActivityEntry[] | null | (() => ActivityEntry[] | null)} */ (null));
  const blockerInput = useRef(/** @type {HTMLTextAreaElement | null} */ (null));
  // A different project starts with a clean page.
  useEffect(() => {
    setConfirming(false);
    setAsking(false);
    setMessage("");
    setError("");
    window.scrollTo({ top: 0 });
  }, [system.id]);
  // The project's history refreshes whenever its data does.
  const stamp = `${system.updatedAt}|${p.documents.length}|${p.blockers.map((b) => b.resolvedAt ?? "").join()}|${p.features.map((f) => f.updatedAt).join()}`;
  useEffect(() => {
    let live = true;
    /** @type {Promise<Array<ActivityEntry>>} */ (/** @type {unknown} */ (api(`/systems/${system.id}/history`))).then((h) => live && setHistory(h)).catch(() => live && setHistory([]));
    return () => {
      live = false;
    };
  }, [system.id, stamp]);
  // The header, the stepper and the KPI tiles (GET /api/systems/:id/overview), refreshed with the project's data.
  const overviewStamp = `${stamp}|${p.requests.length}|${system.progress}|${system.status}`;
  const overview = useOverview(system.id, overviewStamp);
  const lead = users.find((u) => u.id === system.lead);
  const developers = users.filter((u) => u.role === "developer" && u.projectIds?.includes(system.id));
  const nameOf = /** @param {string} [id] */ (id) => users.find((u) => u.id === id)?.name ?? "Someone";
  const openBlockers = p.blockers.filter((b) => !b.resolvedAt);
  const resolved = p.blockers.filter((b) => b.resolvedAt);
  const onHold = p.features.filter((f) => f.status === "ON_HOLD");
  const attempt = /** @param {() => Promise<unknown>} fn */ async (fn) => {
    setError("");
    try {
      await fn();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      return false;
    }
  };
  const saveDevelopers = /** @param {string[]} ids */ (ids) =>
    attempt(async () => {
      setSaving(true);
      try {
        await p.onChangeDevelopers(system.id, ids);
      } finally {
        setSaving(false);
      }
    });
  // The tab last open on this project, for the next time this person opens it (their preferences).
  const prefsRef = useRef(p.prefs);
  prefsRef.current = p.prefs;
  const section = p.itemKey && p.section === "items" ? "items" : p.section;
  useEffect(() => {
    if (!p.onPrefs || p.readOnly) return;
    const t = setTimeout(() => {
      const prefs = prefsRef.current;
      if (!prefs || prefs.lastTabs?.[system.id] === section) return;
      p.onPrefs?.({ ...prefs, lastTabs: remember(prefs.lastTabs ?? {}, system.id, section, PAGE_PREF_LIMITS.tabs) }).catch(() => undefined);
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [system.id, section]);
  const [onePager, setOnePager] = useState(false);
  useEffect(() => setOnePager(false), [system.id]);
  // Request update from the header: the form lives in the Overview's side column.
  const askForUpdate = () => {
    if (p.section !== "overview") window.location.hash = `#/projects/${system.id}`;
    setSentNote(null);
    setAsking(true);
    setTimeout(() => document.getElementById("p-requests")?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
  };
  return (
    <div className="page project-page">
      <CockpitHeader
        system={system}
        data={overview.data}
        section={p.section}
        me={me}
        readOnly={p.readOnly}
        canUpdate={p.canUpdate}
        canRequest={p.canRequest}
        canCreateItems={p.canCreateItems && !p.readOnly}
        canManage={p.canManage}
        users={users}
        onChanged={() => {
          p.onChanged();
          overview.reload();
        }}
        onOnePager={overview.data ? () => setOnePager(true) : undefined}
        onBack={p.onBack}
        onUpdate={p.onUpdate}
        onRequest={askForUpdate}
        onAdvanced={() => {
          overview.reload();
          p.onChanged();
        }}
      />

      {error && <p className="form-error banner">{error}</p>}
      <ProjectKeys system={system} readOnly={p.readOnly} canCreate={p.canCreateItems} />
      {onePager && overview.data && <OnePager system={system} data={overview.data} me={me} onClose={() => setOnePager(false)} />}

      {p.section === "risks" ? (
        <RisksTab system={system} now={now} />
      ) : p.section === "testing" ? (
        <TestingTab system={system} now={now} />
      ) : p.section === "team" ? (
        <TeamTab system={system} capacityHours={overview.data?.series.workload.capacityHours ?? p.limits.capacityHours ?? 30} />
      ) : p.section === "activity" ? (
        <ActivityTab history={history} users={users} systems={p.systems} now={now} />
      ) : p.section === "chat" && !p.readOnly ? (
        <ProjectChat system={system} me={me} users={users} />
      ) : p.section === "docs" ? (
        <>
          <DocumentsTab system={system} me={me} users={users} doc={p.itemKey} readOnly={p.readOnly} onChanged={p.onChanged} />
          {!p.itemKey && <ProjectFiles system={system} documents={p.documents} users={users} now={now} />}
        </>
      ) : p.section === "lifecycle" ? (
        <LifecyclePage system={system} me={me} users={users} now={now} readOnly={p.readOnly} onChanged={p.onChanged} />
      ) : null}
      {(p.section === "items" || p.section === "board" || p.section === "backlog") && !p.itemKey && (
        <nav className="ck-work-switch seg" aria-label="Work views">
          {/** @type {const} */ ([
            ["items", "List", "/items"],
            ["board", "Board", "/board"],
            ...(system.agileMode === "scrum" ? /** @type {const} */ ([["backlog", "Backlog", "/backlog"]]) : []),
          ]).map(([k, label, path]) => (
            <a key={k} href={`#/projects/${system.id}${path}`} className={p.section === k ? "on" : ""} aria-current={p.section === k ? "page" : undefined}>
              {label}
            </a>
          ))}
        </nav>
      )}
      {p.section === "risks" || p.section === "testing" || p.section === "team" || p.section === "activity" || (p.section === "chat" && !p.readOnly) || p.section === "docs" || p.section === "lifecycle" ? null : p.section === "backlog" ? (
        <BacklogView system={system} users={users} now={now} readOnly={p.readOnly} canEditPoints={p.canAssignOthers} onChanged={p.onChanged} />
      ) : p.section === "timeline" ? (
        <TimelineView scope={{ systemId: system.id }} users={users} now={now} readOnly={p.readOnly} />
      ) : p.section === "board" ? (
        <BoardView scope={{ systemId: system.id }} users={users} me={me} now={now} readOnly={p.readOnly} canAssignOthers={p.canAssignOthers} />
      ) : p.section === "items" ? (
        p.itemKey ? (
          <WorkItemPage system={system} itemKey={p.itemKey} users={users} me={me} now={now} readOnly={p.readOnly} canCreate={p.canCreateItems} onChanged={p.onChanged} />
        ) : (
          <WorkItemsTab system={system} users={users} now={now} canCreate={p.canCreateItems} canManage={p.canManage} readOnly={p.readOnly} onChanged={p.onChanged} prefs={p.prefs} onPrefs={p.onPrefs} canBulk={p.canAssignOthers} />
        )
      ) : (
        <>
          {overview.data ? (
            <>
              <Stepper data={overview.data} system={system} users={users} now={now} readOnly={p.readOnly} />
              <KpiTiles data={overview.data} system={system} onSearch={p.onSearch} onBlockers={() => document.getElementById("p-blockers")?.scrollIntoView({ behavior: "smooth", block: "start" })} />
              <div className="ck-first">
                <AttentionPanel data={overview.data} system={system} readOnly={p.readOnly} canContribute={p.canContribute} canUpdate={p.canUpdate} onUpdate={p.onUpdate} onSearch={p.onSearch} onChanged={p.onChanged} />
                <div className="ck-first-side">
                  <SummaryCard system={system} stamp={overviewStamp} readOnly={p.readOnly} now={now} />
                  <NextDays data={overview.data} />
                </div>
              </div>
              <ProjectCharts data={overview.data} system={system} onSearch={p.onSearch} />
            </>
          ) : overview.error ? (
            <p className="form-error banner" role="alert">
              {overview.error}{" "}
              <button className="link-btn" onClick={overview.reload}>
                Try again
              </button>
            </p>
          ) : (
            <div className="ck-skeleton" aria-busy="true" aria-label="Loading the project's figures">
              <span />
              <span />
            </div>
          )}
          {onHold.length > 0 && (
            <p className="ck-onhold" role="status">
              <b>On hold:</b> {onHold.map((f) => `"${f.title}"${f.notes ? ` (${f.notes})` : ""}`).join("; ")}
            </p>
          )}

          <div className="project-grid">
            <div className="project-main">
              {system.pcn ? (
                <PcnCard
                  system={{ ...system, pcn: system.pcn }}
                  me={me}
                  canRecord={p.canManage}
                  canEdit={p.canEditPcn}
                  canMoveOn={p.canManage}
                  onSign={(i, d, r) => attempt(() => p.onSignPcn(i, d, r)).then(() => undefined)}
                  onEdit={() => setEditingPcn(/** @type {NonNullable<typeof system.pcn>} */ (system.pcn))}
                  onMoveOn={() => attempt(() => api(`/systems/${system.id}`, "PATCH", { status: "UPCOMING" }).then(p.onChanged)).then(() => undefined)}
                />
              ) : (
                p.canManage &&
                system.status === "IDEA" && (
                  <button
                    className="btn btn-ghost block-sm pcn-add"
                    onClick={() =>
                      setEditingPcn({
                        ...emptyPcn(
                          me.name,
                          new Date().toISOString().slice(0, 10),
                          users.filter((u) => u.role === "manager"),
                        ),
                        title: system.name,
                        concept: system.description,
                      })
                    }
                  >
                    <FileText size={15} /> Add a Project Concept Note
                  </button>
                )
              )}
              {editingPcn && (
                <div className="backdrop modal-backdrop" onClick={() => setEditingPcn(null)}>
                  <form
                    className="modal modal-wide pcn-modal"
                    role="dialog"
                    aria-label="Edit Project Concept Note"
                    onClick={(e) => e.stopPropagation()}
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const pcn = { ...editingPcn, proposedDates: editingPcn.proposedDates.filter((d) => d) };
                      if (await attempt(() => api(`/systems/${system.id}`, "PATCH", { pcn }).then(p.onChanged))) setEditingPcn(null);
                    }}
                  >
                    <button type="button" className="close-btn" onClick={() => setEditingPcn(null)} aria-label="Close">
                      <X size={18} />
                    </button>
                    <button type="button" className="modal-back" onClick={() => setEditingPcn(null)} aria-label="Back to the previous page (nothing is saved)">
                      <ArrowLeft size={16} aria-hidden="true" /> Back
                    </button>
                    <h2>{system.pcn ? "Edit Project Concept Note" : "Add a Project Concept Note"}</h2>
                    <PcnForm value={editingPcn} onChange={setEditingPcn} users={users} />
                    {error && <p className="form-error">{error}</p>}
                    <div className="modal-actions">
                      <button type="button" className="btn btn-ghost" onClick={() => setEditingPcn(null)}>
                        Cancel
                      </button>
                      <button type="submit" className="btn btn-amber" disabled={!editingPcn.title.trim()}>
                        Save PCN
                      </button>
                    </div>
                  </form>
                </div>
              )}
              <Card title="Overview">
                {system.description ? <p className="drawer-desc flush">{system.description}</p> : <p className="lead-none">No description yet.</p>}
                {system.health === "Maintenance" && (
                  <section className="maint-panel">
                    <Wrench size={18} />
                    <div>
                      <b>
                        Under maintenance
                        {system.maintenanceSince ? ` since ${formatDate(system.maintenanceSince)}` : ""}
                      </b>
                      <p>{system.maintenanceNote || "Updates or improvements are in progress. The app may be briefly unavailable."}</p>
                    </div>
                  </section>
                )}
                <div className="panel flush">
                  <ProgressBar value={system.progress} />
                  <div className="card-row">
                    <DateLine system={system} now={now} />
                    <ScheduleChip system={system} now={now} />
                  </div>
                </div>
                <dl className="facts">
                  <dt>Workspace</dt>
                  <dd>
                    {p.canManage ? (
                      <select className="facts-select" value={system.workspace && p.workspaces.includes(system.workspace) ? system.workspace : p.workspaces[0]} aria-label="Workspace" onChange={(e) => p.onChangeWorkspace(system.id, e.target.value).catch(() => undefined)}>
                        {p.workspaces.map((w) => (
                          <option key={w} value={w}>
                            {w}
                          </option>
                        ))}
                      </select>
                    ) : system.workspace && p.workspaces.includes(system.workspace) ? (
                      system.workspace
                    ) : (
                      p.workspaces[0]
                    )}
                  </dd>
                  <dt>Team</dt>
                  <dd>{system.owner}</dd>
                  {system.template && (
                    <>
                      <dt>Template</dt>
                      <dd>{system.template}</dd>
                    </>
                  )}
                  <dt>Started</dt>
                  <dd>{formatDate(system.startedAt)}</dd>
                  {system.dueAt && (
                    <>
                      <dt>Due</dt>
                      <dd>{formatDate(system.dueAt)}</dd>
                    </>
                  )}
                  {system.finishedAt && (
                    <>
                      <dt>Delivered</dt>
                      <dd>{formatDate(system.finishedAt)}</dd>
                    </>
                  )}
                  <dt>Last update</dt>
                  <dd>
                    {updatedText(system, now)} · {system.updatedBy ?? initials(system.owner)}
                  </dd>
                  <dt>Engagement</dt>
                  <dd>{system.engagement.toLocaleString()} visits / 30 days</dd>
                  <dt>Address</dt>
                  <dd className="mono">{system.url || "—"}</dd>
                </dl>
                {system.health && <p className="health-note">{HEALTH_META[system.health]}</p>}
              </Card>

              <BlockersCard id="p-blockers" system={system} open={openBlockers} resolved={resolved} now={now} nameOf={nameOf} me={me} canContribute={p.canContribute} canManage={p.canManage} inputRef={blockerInput} attempt={attempt} onChanged={p.onChanged} />

              <Card
                title="Feature requests"
                count={`${p.features.filter(isOpen).length} open`}
                action={
                  p.canLogFeatures && (
                    <button className="btn btn-ghost sm" onClick={p.onNewFeature}>
                      <Plus size={15} strokeWidth={3} /> Log request
                    </button>
                  )
                }
              >
                {p.features.length ? (
                  <ul className="feature-mini">
                    {[...p.features]
                      .sort((a, b) => Number(!isOpen(a)) - Number(!isOpen(b)) || byUrgency(a, b))
                      .map((f) => (
                        <li key={f.id}>
                          <button type="button" onClick={() => p.onOpenFeature(f)}>
                            <span className="feature-mini-title">
                              <b>
                                {f.key && <span className="mono wi-key-inline">{f.key}</span>} {f.title}
                              </b>
                              <small className={isLate(f, now) ? "text-red" : ""}>
                                {users.find((u) => u.id === f.assignee)?.name ?? "Unassigned"}
                                {f.client ? ` · for ${f.client}` : ""}
                                {f.dueAt && !f.completedAt ? ` · due ${formatDate(f.dueAt)}` : ""}
                              </small>
                            </span>
                            <PriorityBadge priority={f.priority} />
                            <FeatureStatusPill status={f.status} />
                          </button>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className="lead-none">No feature requests on this project.</p>
                )}
              </Card>

              <DocumentsCard system={system} documents={p.documents} now={now} me={me} nameOf={nameOf} canContribute={p.canContribute} canManage={p.canManage} attempt={attempt} onChanged={p.onChanged} />

              <Card title="History" icon={<History size={17} />}>
                {history === null ? (
                  <p className="lead-none">Loading…</p>
                ) : history.length ? (
                  <ol className="timeline">
                    {history.map((e) => (
                      <li key={e.id}>
                        <span className="avatar">{initials(e.actor)}</span>
                        <div>
                          <p>{describe(e, users, p.systems)}</p>
                          <small title={new Date(e.at).toLocaleString("en-GB")}>
                            {e.actor} · {timeAgo(e.at, now)}
                          </small>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="lead-none">Nothing recorded yet.</p>
                )}
              </Card>
            </div>

            <aside className="project-side">
              {(p.requests.length > 0 || p.canRequest) && (
                <section className="requests flush" id="p-requests">
                  {p.requests.map((r) => (
                    <div key={r.id} className="request">
                      <BellRing size={16} />
                      <div>
                        <b>
                          {r.requestedByName ?? nameOf(r.requestedBy)} requested an update · {timeAgo(r.createdAt, now)}
                        </b>
                        {r.via?.length ? <small className="request-via">Sent by {channelList(r.via)}</small> : null}
                        {r.message && <p>“{r.message}”</p>}
                      </div>
                      {(r.requestedBy === me.id || me.projectIds?.includes(system.id) || p.canManage) && (
                        <button className="link-btn" onClick={() => attempt(() => p.onDismiss(r.id))}>
                          Dismiss
                        </button>
                      )}
                    </div>
                  ))}
                  {p.canRequest &&
                    (asking ? (
                      <form
                        className="request-form"
                        onSubmit={(e) => {
                          e.preventDefault();
                          attempt(async () => {
                            const sent = await p.onRequest(system.id, message.trim(), via);
                            setSentNote(deliveryNote(sent));
                            setAsking(false);
                            setMessage("");
                          });
                        }}
                      >
                        <textarea rows={2} autoFocus value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What do you need to know? (optional)" />
                        <RequestChannels available={p.requestChannels} value={via} onChange={setVia} />
                        <div className="confirm-actions">
                          <button type="button" className="btn btn-ghost" onClick={() => setAsking(false)}>
                            Cancel
                          </button>
                          <button type="submit" className="btn btn-navy" disabled={!via.length}>
                            Send request
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        {sentNote && (
                          <p className="request-sent" role="status">
                            {sentNote.text}
                            {sentNote.chatId && (
                              <>
                                {" "}
                                <a href={`#/chat/${sentNote.chatId}`}>Open the chat</a>
                              </>
                            )}
                          </p>
                        )}
                        <button
                          className="btn btn-ghost block-sm"
                          onClick={() => {
                            setSentNote(null);
                            setAsking(true);
                          }}
                        >
                          <BellRing size={15} /> Request update
                        </button>
                      </>
                    ))}
                </section>
              )}

              <section className="lead-card flush">
                <div className="lead-head">
                  <span className="avatar lg">{lead ? initials(lead.name) : "?"}</span>
                  <div className="lead-who">
                    <span className="lead-label">Project lead</span>
                    <b>{lead ? lead.name : "Not assigned"}</b>
                    {lead?.title && <span className="lead-title">{lead.title}</span>}
                  </div>
                </div>
                {lead && <LeadContact person={lead} about={system.name} />}
                {p.canManage && (
                  <label className="lead-change">
                    <span>{lead ? "Change lead" : "Assign a lead"}</span>
                    <select value={system.lead ?? ""} onChange={(e) => attempt(() => p.onChangeLead(system.id, e.target.value))}>
                      {!lead && <option value="">Choose…</option>}
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                          {u.title ? ` · ${u.title}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </section>

              <section className="lead-card">
                <span className="lead-label">Developers · {developers.length}</span>
                {developers.length ? (
                  developers.map((d) => {
                    const reasons = p.overloaded(d);
                    return (
                      <div key={d.id} className="dev-row">
                        <div className="lead-head">
                          <span className="avatar md">{initials(d.name)}</span>
                          <div className="lead-who">
                            <b>{d.name}</b>
                            {d.title && <span className="lead-title">{d.title}</span>}
                          </div>
                          {p.canAssign && (
                            <button className="dev-remove" disabled={saving} title={`Remove ${d.name} from ${system.name}`} aria-label={`Remove ${d.name}`} onClick={() => saveDevelopers(developers.filter((x) => x.id !== d.id).map((x) => x.id))}>
                              <UserMinus size={16} />
                            </button>
                          )}
                        </div>
                        {reasons.length > 0 && (
                          <div className="overload-callout">
                            <span className="flag flag-overload" title={reasons.join("; ")}>
                              <AlertOctagon size={13} /> Too many projects: {reasons.join("; ")}
                            </span>
                            {p.canAssign && (
                              <>
                                <p className="overload-hint">Developers with room to take this on:</p>
                                <HandoverSuggestions system={system} from={d} suggestions={p.suggestions} teamIds={developers.map((x) => x.id)} busy={saving} onSave={saveDevelopers} />
                              </>
                            )}
                          </div>
                        )}
                        <LeadContact person={d} about={system.name} />
                      </div>
                    );
                  })
                ) : (
                  <p className="lead-none">No developers assigned yet.</p>
                )}
                {p.canAssign && <DeveloperSearch users={users} systems={p.systems} systemId={system.id} exclude={developers.map((d) => d.id)} disabled={saving} overloaded={p.overloaded} limit={p.limits.projects} onPick={(id) => saveDevelopers([...developers.map((d) => d.id), id])} />}
              </section>

              {p.canManage && <SaveAsTemplate system={system} attempt={attempt} onChanged={p.onChanged} />}
              {p.canManage &&
                (confirming ? (
                  <div className="confirm" role="alertdialog" aria-label="Confirm delete">
                    <p>
                      Delete <b>{system.name}</b>? It will be removed for everyone, with its update requests, feature requests, documents and blockers.
                    </p>
                    <div className="confirm-actions">
                      <button className="btn btn-ghost" onClick={() => setConfirming(false)}>
                        Cancel
                      </button>
                      <button className="btn btn-danger" onClick={() => attempt(() => p.onDelete(system.id))}>
                        <Trash2 size={16} /> Delete
                      </button>
                    </div>
                  </div>
                ) : (
                  <button className="delete-link" onClick={() => setConfirming(true)}>
                    <Trash2 size={15} /> Delete project
                  </button>
                ))}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
/**
 * @param {SectionProps & {
 *   id?: string;
 *   open: Blocker[];
 *   resolved: Blocker[];
 *   inputRef: RefObject<HTMLTextAreaElement>;
 * }} arg4
 */
function BlockersCard({ id, system, open, resolved, now, me, nameOf, canContribute, canManage, inputRef, attempt, onChanged }) {
  const [text, setText] = useState("");
  const [resolving, setResolving] = useState(/** @type {string | null | (() => string | null)} */ (null));
  const [resolution, setResolution] = useState("");
  return (
    <Card id={id} title="Blockers" icon={<AlertOctagon size={17} />} count={`${open.length} open`} tone={open.length ? "alert" : undefined}>
      {open.length ? (
        <ul className="blocker-list">
          {open.map((b) => (
            <li key={b.id} className="blocker open">
              <div className="blocker-text">
                <p>{b.text}</p>
                <small>
                  Raised by {nameOf(b.raisedBy)} · {timeAgo(b.raisedAt, now)} ({formatDate(b.raisedAt)})
                </small>
              </div>
              {resolving === b.id ? (
                <form
                  className="request-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (await attempt(() => api(`/blockers/${b.id}`, "PATCH", { resolved: true, resolution: resolution.trim() }).then(onChanged))) {
                      setResolving(null);
                      setResolution("");
                    }
                  }}
                >
                  <textarea rows={2} autoFocus value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="How was it resolved? (optional)" />
                  <div className="confirm-actions">
                    <button type="button" className="btn btn-ghost sm" onClick={() => setResolving(null)}>
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-navy sm">
                      <CheckCircle2 size={15} /> Mark resolved
                    </button>
                  </div>
                </form>
              ) : (
                <div className="blocker-actions">
                  {canContribute && (
                    <button className="btn btn-ghost sm" onClick={() => setResolving(b.id)}>
                      <CheckCircle2 size={15} /> Resolve
                    </button>
                  )}
                  {(b.raisedBy === me.id || canManage) && (
                    <button className="icon-link danger" title="Delete (for blockers added by mistake)" aria-label="Delete blocker" onClick={() => attempt(() => api(`/blockers/${b.id}`, "DELETE").then(onChanged))}>
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="lead-none">Nothing is blocking this project.</p>
      )}

      {canContribute && (
        <form
          className="blocker-add"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await attempt(() => api(`/systems/${system.id}/blockers`, "POST", { text: text.trim() }).then(onChanged))) setText("");
          }}
        >
          <textarea ref={inputRef} rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="What's stopping progress? e.g. Waiting for the client's API keys" required />
          <button type="submit" className="btn btn-danger sm" disabled={!text.trim()}>
            <AlertOctagon size={15} /> Raise blocker
          </button>
        </form>
      )}

      {resolved.length > 0 && (
        <details className="resolved">
          <summary>{resolved.length} resolved</summary>
          <ul className="blocker-list">
            {resolved.map((b) => (
              <li key={b.id} className="blocker">
                <div className="blocker-text">
                  <p>{b.text}</p>
                  <small>
                    Raised by {nameOf(b.raisedBy)} {formatDate(b.raisedAt)} · resolved by {nameOf(b.resolvedBy)} {formatDate(/** @type {NonNullable<typeof b.resolvedAt>} */ (b.resolvedAt))}
                  </small>
                  {b.resolution && <small className="resolution">“{b.resolution}”</small>}
                </div>
                {canContribute && (
                  <button className="icon-link" title="Reopen" aria-label="Reopen blocker" onClick={() => attempt(() => api(`/blockers/${b.id}`, "PATCH", { resolved: false }).then(onChanged))}>
                    <RotateCcw size={15} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
/**
 * @param {SectionProps & { documents: ProjectDocument[] }} props
 */
function DocumentsCard({ system, documents, now, me, nameOf, canContribute, canManage, attempt, onChanged }) {
  const [adding, setAdding] = useState(false);
  const [link, setLink] = useState({ name: "", url: "" });
  const [uploading, setUploading] = useState(false);
  const file = useRef(/** @type {HTMLInputElement | null} */ (null));
  const upload = /** @param {File} f */ async (f) => {
    if (f.size > MAX_DOCUMENT_BYTES) {
      await attempt(() => Promise.reject(new Error(`${f.name} is ${formatBytes(f.size)}. Files can be up to ${formatBytes(MAX_DOCUMENT_BYTES)}; add a link instead.`)));
      return;
    }
    setUploading(true);
    await attempt(() => uploadDocument(system.id, f).then(onChanged));
    setUploading(false);
  };
  return (
    <Card
      title="Documents"
      icon={<FileText size={17} />}
      count={documents.length}
      action={
        canContribute && (
          <div className="page-actions">
            <button className="btn btn-ghost sm" onClick={() => setAdding((v) => !v)}>
              <Link2 size={15} /> Add link
            </button>
            <button className="btn btn-navy sm" disabled={uploading} onClick={() => file.current?.click()}>
              <Upload size={15} /> {uploading ? "Uploading…" : "Upload"}
            </button>
            <input
              ref={file}
              type="file"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) upload(f);
              }}
            />
          </div>
        )
      }
    >
      {adding && (
        <form
          className="doc-link-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await attempt(() => api(`/systems/${system.id}/documents`, "POST", { name: link.name.trim(), url: link.url.trim() }).then(onChanged))) {
              setAdding(false);
              setLink({ name: "", url: "" });
            }
          }}
        >
          <input value={link.name} onChange={(e) => setLink((l) => ({ ...l, name: e.target.value }))} placeholder="Name, e.g. Requirements (Google Doc)" />
          <input type="url" required value={link.url} onChange={(e) => setLink((l) => ({ ...l, url: e.target.value }))} placeholder="https://…" />
          <button type="submit" className="btn btn-navy sm">
            Add
          </button>
        </form>
      )}
      {documents.length ? (
        <ul className="doc-list">
          {documents.map((d) => (
            <li key={d.id}>
              <span className="doc-icon">{d.kind === "link" ? <Link2 size={16} /> : <FileText size={16} />}</span>
              <span className="doc-text">
                <a href={d.kind === "link" ? d.url : `/api/documents/${d.id}`} target="_blank" rel="noreferrer noopener">
                  {d.name}
                </a>
                <small>
                  {d.kind === "link" ? hostOf(d.url) : formatBytes(d.size ?? 0)} · {nameOf(d.uploadedBy)} · {timeAgo(d.uploadedAt, now)}
                </small>
              </span>
              {d.kind === "file" ? (
                <a className="icon-link" href={`/api/documents/${d.id}?download`} title="Download" aria-label={`Download ${d.name}`}>
                  <Download size={15} />
                </a>
              ) : (
                <a className="icon-link" href={d.url} target="_blank" rel="noreferrer noopener" title="Open link" aria-label={`Open ${d.name}`}>
                  <ExternalLink size={15} />
                </a>
              )}
              {(d.uploadedBy === me.id || canManage) && (
                <button className="icon-link danger" title="Remove" aria-label={`Remove ${d.name}`} onClick={() => attempt(() => api(`/documents/${d.id}`, "DELETE").then(onChanged))}>
                  <Trash2 size={15} />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="lead-none">No documents yet.{canContribute ? ` Upload files up to ${formatBytes(MAX_DOCUMENT_BYTES)} (specs, contracts, designs) or link to Google Drive or SharePoint.` : ""}</p>
      )}
    </Card>
  );
}
/**
 * @param {string} [url]
 * @returns {string}
 */
function hostOf(url) {
  try {
    return new URL(url ?? "").hostname;
  } catch {
    return "link";
  }
}
/**
 * Saves this project's set-up (description, status, duration) as a template for new projects.
 * @param {{ system: System; attempt: (fn: () => Promise<unknown>) => Promise<boolean>; onChanged: () => Promise<void> }} arg2
 */
function SaveAsTemplate({ system, attempt, onChanged }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [done, setDone] = useState("");
  if (!open) {
    return (
      <>
        {done && <p className="form-ok">Saved "{done}". Pick it under Add project → Start from a template.</p>}
        <button
          className="btn btn-ghost block-sm"
          onClick={() => {
            setName(`${system.name} template`);
            setSummary("");
            setDone("");
            setOpen(true);
          }}
        >
          <LayoutTemplate size={15} /> Save as template
        </button>
      </>
    );
  }
  return (
    <form
      className="lead-card template-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await attempt(() => api("/templates", "POST", { fromSystem: system.id, name: name.trim(), summary: summary.trim() }).then(onChanged))) {
          setDone(name.trim());
          setOpen(false);
        }
      }}
    >
      <span className="lead-label">Save as template</span>
      <p className="set-note">New projects made from it start with this description, the same status (or Upcoming, if this one is delivered) and the same length of time to the due date. People and dates aren't copied.</p>
      <label className="field">
        <span>Template name</span>
        <input required autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>What kind of project is it for? (optional)</span>
        <input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="e.g. A staff portal with sign-in and reports" />
      </label>
      <div className="confirm-actions">
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="submit" className="btn btn-navy" disabled={!name.trim()}>
          Save template
        </button>
      </div>
    </form>
  );
}
/**
 * @typedef {Object} Props
 * @property {System} system
 * @property {System[]} systems
 * @property {number} now
 * @property {User} me
 * @property {User[]} users
 * @property {UpdateRequest[]} requests
 * @property {Feature[]} features
 * @property {ProjectDocument[]} documents
 * @property {Blocker[]} blockers
 * @property {Limits} limits
 * @property {(u: User) => string[]} overloaded
 * @property {boolean} canUpdate
 * @property {boolean} canManage
 * @property {boolean} canAssign
 * @property {Suggestion[]} suggestions
 * @property {boolean} canRequest
 * @property {boolean} canContribute
 * @property {boolean} canLogFeatures
 * @property {() => void} onBack
 * @property {() => void} onUpdate
 * @property {(id: string) => Promise<void>} onDelete
 * @property {(id: string, lead: string) => Promise<void>} onChangeLead
 * @property {string[]} workspaces
 * @property {(id: string, workspace: string) => Promise<void>} onChangeWorkspace
 * @property {(id: string, developers: string[]) => Promise<void>} onChangeDevelopers
 * @property {(id: string, message: string, via: RequestChannel[]) => Promise<RequestDelivery>} onRequest
 * @property {ChannelAvailability} [requestChannels]
 * @property {(requestId: string) => Promise<void>} onDismiss
 * @property {(f: Feature) => void} onOpenFeature
 * @property {() => void} onNewFeature
 * @property {() => Promise<void>} onChanged
 * @property {boolean} canEditPcn
 * @property {"overview" | "items" | "board" | "backlog" | "timeline" | "lifecycle" | "docs" | "risks" | "testing" | "team" | "activity" | "chat"} section
 * @property {boolean} canAssignOthers
 * @property {string} [itemKey]
 * @property {boolean} canCreateItems
 * @property {boolean} readOnly
 * @property {(index: number, decision: SignoffStatus, remarks?: string) => Promise<void>} onSignPcn
 * @property {(pql: string) => void} [onSearch] Opens Search with this PQL (the KPI tiles' drill-down).
 * @property {import("../data/roles").Prefs} [prefs] The person's preferences (saved views, remembered filters and tabs).
 * @property {(p: import("../data/roles").Prefs) => Promise<void>} [onPrefs]
 */
/**
 * @typedef {Object} SectionProps
 * @property {System} system
 * @property {number} now
 * @property {User} me
 * @property {(id?: string) => string} nameOf
 * @property {boolean} canContribute
 * @property {boolean} canManage
 * @property {(fn: () => Promise<unknown>) => Promise<boolean>} attempt
 * @property {() => Promise<void>} onChanged
 */
