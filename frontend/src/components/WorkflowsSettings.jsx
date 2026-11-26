/** @import { User } from '../data/roles' */
/** @import { StatusCategory } from '../data/workitems' */
/** @import { Rule, RuleKind, StatusDef, Transition, Workflow } from '../data/workflows' */
import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, History, Plus, RotateCcw, Save, Send, Table2, Trash2, Waypoints, X } from "lucide-react";
import { api, ApiError } from "../data/api";
import { ROLES, ROLE_LABEL, assignable } from "../data/roles";
import { CATEGORY_META, FIELD_RULE_LABEL, KIND_LABEL, RULES, describeRule } from "../data/workflows";
import { formatDate } from "../time";
// The canvas library is large: it loads only when this page opens.
const WorkflowCanvas = lazy(() => import("./WorkflowCanvas"));
/**
 * Settings → This workspace → Workflows. The workspace's workflows (and the organisation's templates, to copy), each
 * edited as a draft and then published; which workflow the workspace, each project and each item type uses; and
 * the status list.
 * @param {{ users: User[]; workspaces?: string[]; canEdit: boolean }} props
 */
export default function WorkflowsSettings({ users, canEdit }) {
  const [data, setData] = useState(/** @type {Overview | null | (() => Overview | null)} */ (null));
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [moves, setMoves] = useState(/** @type {MovesNeeded | null | (() => MovesNeeded | null)} */ (null));
  const load = useCallback(async () => {
    try {
      setData(await /** @type {Promise<Overview>} */ (/** @type {unknown} */ (api("/workflows"))));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load workflows");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  /** Runs a change; a "needs_moves" refusal asks where the items should go, then tries again. */
  const attempt = /** @param {(moves?: Record<string, string>) => Promise<unknown>} fn @param {string} done @param {StatusDef[]} options */ async (fn, done, options) => {
    setError("");
    setSaved("");
    try {
      await fn();
      await load();
      setSaved(done);
    } catch (e) {
      if (e instanceof ApiError && e.code === "needs_moves") {
        setMoves({
          statuses: /** @type {MovesNeeded["statuses"]} */ (e.payload.statuses) ?? [],
          options,
          retry: async (m) => {
            await fn(m);
            setMoves(null);
            await load();
            setSaved(done);
          },
        });
      } else setError(e instanceof Error ? e.message : "Couldn't save");
    }
  };
  if (!data) return <p className="lead-none">{error || "Loading workflows…"}</p>;
  const wf = data.workflows.find((w) => w.id === selected) ?? data.workflows.find((w) => w.id === data.workspace) ?? data.workflows[0];
  const byId = new Map(data.statuses.map((s) => [s.id, s]));
  const own = data.workflows.filter((w) => !w.template);
  const templates = data.workflows.filter((w) => w.template);
  // A template is changed by the organisation's administrators only; everyone else reads and copies it.
  const editable = canEdit && (!wf.template || data.canEditTemplates);
  return (
    <section className="wf-settings">
      <header className="page-head">
        <div>
          <h2>Workflows</h2>
          <p>
            A workflow is the statuses a work item goes through and the moves allowed between them. This workspace has its own; a project or an item type can use a different one of this workspace's. Changes are made as a draft and take effect when you publish them; every
            published version is kept.
          </p>
        </div>
      </header>
      {error && (
        <p className="form-error banner" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="form-ok banner" role="status">
          {saved}
        </p>
      )}

      <Assignments data={data} canEdit={canEdit} attempt={attempt} />

      <div className="wf-tabs" role="tablist" aria-label="Workflows">
        {own.map((w) => (
          <button key={w.id} role="tab" aria-selected={w.id === wf.id} className={w.id === wf.id ? "on" : ""} onClick={() => setSelected(w.id)}>
            {w.name}
            {w.id === data.workspace && <small> · this workspace's</small>}
            {w.draftSavedAt && <small className="wf-draft-dot"> · draft</small>}
          </button>
        ))}
        {templates.length > 0 && <span className="wf-tabs-label">Organisation templates:</span>}
        {templates.map((w) => (
          <button key={w.id} role="tab" aria-selected={w.id === wf.id} className={`${w.id === wf.id ? "on" : ""} wf-template-tab`} onClick={() => setSelected(w.id)}>
            {w.name}
            {w.isDefault && <small> · default</small>}
          </button>
        ))}
        {canEdit && <NewWorkflow workflows={data.workflows} canTemplate={data.canEditTemplates} onCreated={async (id) => (await load(), setSelected(id))} onError={setError} />}
      </div>
      {wf.template && (
        <p className="field-hint wf-template-note">
          {data.canEditTemplates
            ? "This is one of your organisation's templates: new workspaces start from it. Changing it doesn't change any workspace's own workflow."
            : "This is one of your organisation's templates: only its administrators change it. Use New workflow to make this workspace a copy of it."}
        </p>
      )}

      <WorkflowEditor
        key={wf.id + JSON.stringify(wf)}
        wf={wf}
        statuses={data.statuses}
        usage={data.usage[wf.id] ?? {}}
        users={users}
        canEdit={editable}
        inUse={wf.id === data.workspace || data.projects.some((p) => p.workflowId === wf.id) || data.itemTypes.some((t) => t.workflowId === wf.id)}
        onPublish={(body, note) =>
          attempt(
            async (m) => {
              await api(`/workflows/${wf.id}/draft`, "PUT", body);
              await api(`/workflows/${wf.id}/publish`, "POST", { note, ...(m ? { moves: m } : {}) });
            },
            `Published ${body.name}.`,
            body.statuses.map((s) => /** @type {StatusDef} */ (byId.get(s.id))).filter(Boolean),
          )
        }
        onRestore={(version, statuses) =>
          attempt(
            (m) => api(`/workflows/${wf.id}/versions/${version}/restore`, "POST", m ? { moves: m } : {}),
            `Restored version ${version} of ${wf.name}.`,
            statuses.map((s) => /** @type {StatusDef} */ (byId.get(s))).filter(Boolean),
          )
        }
        onSaved={load}
        onDelete={async () => {
          await attempt(() => api(`/workflows/${wf.id}`, "DELETE"), `Deleted ${wf.name}.`, []);
          setSelected("");
        }}
      />

      <StatusList data={data} canEdit={canEdit} attempt={attempt} />

      {moves && <MovesDialog need={moves} onCancel={() => setMoves(null)} />}
    </section>
  );
}
/**
 * Which of this workspace's workflows the workspace, each project and each item type uses.
 * @param {{
 *   data: Overview;
 *   canEdit: boolean;
 *   attempt: (fn: (moves?: Record<string, string>) => Promise<unknown>, done: string, options: StatusDef[]) => Promise<void>;
 * }} arg3
 */
function Assignments({ data, canEdit, attempt }) {
  // A workspace, project or item type uses this workspace's own workflows (or, as before, a template).
  const choices = [...data.workflows.filter((w) => !w.template), ...data.workflows.filter((w) => w.template)];
  const [ws, setWs] = useState(data.workspace ?? "");
  const [projects, setProjects] = useState(/** @type {Record<string, string> | (() => Record<string, string>)} */ (() => Object.fromEntries(data.projects.map((p) => [p.id, p.workflowId ?? ""]))));
  const [types, setTypes] = useState(/** @type {Record<string, string> | (() => Record<string, string>)} */ (() => Object.fromEntries(data.itemTypes.map((t) => [t.id, t.workflowId ?? ""]))));
  const [showMore, setShowMore] = useState(data.projects.some((p) => p.workflowId) || data.itemTypes.some((t) => t.workflowId));
  const dirty = ws !== (data.workspace ?? "") || data.projects.some((p) => (p.workflowId ?? "") !== projects[p.id]) || data.itemTypes.some((t) => (t.workflowId ?? "") !== types[t.id]);
  const name = /** @param {string} id */ (id) => data.workflows.find((w) => w.id === id)?.name ?? id;
  const option = /** @param {ListedWorkflow} x */ (x) => (
    <option key={x.id} value={x.id}>
      {x.name}
      {x.template ? " (organisation template)" : ""}
    </option>
  );
  return (
    <section className="set-card wf-assign" aria-label="Which workflow this workspace, its projects and its item types use">
      <h3>Who uses which workflow</h3>
      <div className="wf-assign-grid">
        <label className="field">
          <span>This workspace</span>
          <select value={ws} disabled={!canEdit} onChange={(e) => setWs(e.target.value)}>
            {choices.map(option)}
          </select>
        </label>
      </div>
      <button className="link-btn" onClick={() => setShowMore(!showMore)} aria-expanded={showMore}>
        {showMore ? "Hide projects and item types" : "Give a project or an item type its own workflow"}
      </button>
      {showMore && (
        <div className="table-wrap">
          <table className="table wf-project-table">
            <caption className="sr-only">Item types and projects, and the workflow each uses</caption>
            <thead>
              <tr>
                <th scope="col">Item type or project</th>
                <th scope="col">Workflow</th>
              </tr>
            </thead>
            <tbody>
              {data.itemTypes
                .filter((t) => t.active || t.workflowId)
                .map((t) => (
                  <tr key={`t-${t.id}`}>
                    <td>
                      {t.name} <span className="muted">item type</span>
                    </td>
                    <td>
                      <select value={types[t.id]} disabled={!canEdit} onChange={(e) => setTypes({ ...types, [t.id]: e.target.value })} aria-label={`${t.name}'s workflow`}>
                        <option value="">Its project's (or the workspace's)</option>
                        {choices.map(option)}
                      </select>
                    </td>
                  </tr>
                ))}
              {data.projects.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="mono">{p.key}</span> {p.name}
                  </td>
                  <td>
                    <select value={projects[p.id]} disabled={!canEdit} onChange={(e) => setProjects({ ...projects, [p.id]: e.target.value })} aria-label={`${p.name}'s workflow`}>
                      <option value="">The workspace's ({name(ws)})</option>
                      {choices.map(option)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="field-hint">An item type's workflow comes first, then its project's, then the workspace's.</p>
        </div>
      )}
      {canEdit && (
        <button
          className="btn btn-navy"
          disabled={!dirty}
          onClick={() =>
            attempt(
              (m) =>
                api("/workflow-assignments", "PUT", {
                  ...(ws !== (data.workspace ?? "") ? { workspace: ws || null } : {}),
                  projects: Object.fromEntries(data.projects.filter((p) => (p.workflowId ?? "") !== projects[p.id]).map((p) => [p.id, projects[p.id] || null])),
                  itemTypes: Object.fromEntries(data.itemTypes.filter((t) => (t.workflowId ?? "") !== types[t.id]).map((t) => [t.id, types[t.id] || null])),
                  ...(m ? { moves: m } : {}),
                }),
              "Saved which workflow each uses.",
              data.statuses,
            )
          }
        >
          <Save size={15} /> Save
        </button>
      )}
    </section>
  );
}
/**
 * @param {{ workflows: ListedWorkflow[]; canTemplate?: boolean; onCreated: (id: string) => Promise<void>; onError: (m: string) => void }} arg1
 */
function NewWorkflow({ workflows, canTemplate = false, onCreated, onError }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [copyFrom, setCopyFrom] = useState(workflows[0]?.id ?? "");
  const [template, setTemplate] = useState(false);
  if (!open)
    return (
      <button className="btn btn-ghost sm" onClick={() => setOpen(true)}>
        <Plus size={14} strokeWidth={3} /> New workflow
      </button>
    );
  return (
    <form
      className="wf-new"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          const wf = await /** @type {Promise<Workflow>} */ (/** @type {unknown} */ (api("/workflows", "POST", { name, copyFrom, ...(template ? { template: true } : {}) })));
          setOpen(false);
          setName("");
          await onCreated(wf.id);
        } catch (err) {
          onError(err instanceof Error ? err.message : "Couldn't create it");
        }
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="New workflow's name" autoFocus maxLength={60} required />
      <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} aria-label="Start as a copy of">
        {workflows.map((w) => (
          <option key={w.id} value={w.id}>
            Copy of {w.name}
            {w.template ? " (template)" : ""}
          </option>
        ))}
      </select>
      {canTemplate && (
        <label className="wi-check">
          <input type="checkbox" checked={template} onChange={(e) => setTemplate(e.target.checked)} /> As an organisation template
        </label>
      )}
      <button className="btn btn-navy sm" type="submit" disabled={!name.trim()}>
        Create
      </button>
      <button className="btn btn-ghost sm" type="button" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}
/**
 * @param {{
 *   wf: ListedWorkflow;
 *   statuses: StatusDef[];
 *   usage: Record<string, number>;
 *   users: User[];
 *   canEdit: boolean;
 *   inUse: boolean;
 *   onPublish: (d: Draft, note: string) => Promise<void>;
 *   onRestore: (version: number, statuses: string[]) => Promise<void>;
 *   onSaved: () => Promise<void>;
 *   onDelete: () => Promise<void>;
 * }} props
 */
function WorkflowEditor({ wf, statuses, usage, users, canEdit, inUse, onPublish, onRestore, onSaved, onDelete }) {
  /** What's published, as a draft looks. */
  const published = /** @type {Draft} */ ({ name: wf.name, description: wf.description, statuses: wf.statuses, transitions: wf.transitions.map((t) => ({ name: t.name, from: t.from, to: t.to, rules: t.rules })) });
  const [d, setD] = useState(/** @type {Draft | (() => Draft)} */ (published));
  // The draft as last saved (null: none): editing starts from it, so work in progress isn't lost.
  const [saved, setSavedDraft] = useState(/** @type {{ draft: Draft; savedBy: string; savedAt: string } | null} */ (null));
  const [view, setView] = useState(/** @type {"canvas" | "table"} */ ("canvas"));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState("");
  const [showVersions, setShowVersions] = useState(false);
  useEffect(() => {
    if (!canEdit) return;
    api(`/workflows/${wf.id}/draft`)
      .then((r) => {
        const x = /** @type {{ draft: Draft | null; savedBy?: string; savedAt?: string }} */ (r);
        if (x.draft) {
          setSavedDraft({ draft: x.draft, savedBy: x.savedBy ?? "someone", savedAt: x.savedAt ?? "" });
          setD(x.draft);
        }
      })
      .catch(() => undefined);
  }, [wf.id, canEdit]);
  const byId = new Map(statuses.map((s) => [s.id, s]));
  const nameOf = /** @param {string | null} id */ (id) => (id ? (byId.get(id)?.name ?? id) : "Any status");
  const inWf = new Set(d.statuses.map((s) => s.id));
  const userName = /** @param {string} id */ (id) => users.find((u) => u.id === id)?.name ?? id;
  const same = /** @param {Draft} a @param {Draft} b */ (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // Differs from what's published (so there's something to publish), and from the saved draft (so something to save).
  const dirty = !same(d, published);
  const unsaved = saved ? !same(d, saved.draft) : dirty;
  const saveDraft = async () => {
    setBusy(true);
    setNotice("");
    try {
      await api(`/workflows/${wf.id}/draft`, "PUT", d);
      setSavedDraft({ draft: d, savedBy: "you", savedAt: new Date().toISOString() });
      setNotice("Draft saved. Nothing changes for anyone until you publish it.");
      await onSaved();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Couldn't save the draft");
    } finally {
      setBusy(false);
    }
  };
  const setT = /** @param {number} i @param {Partial<Draft["transitions"][number]>} patch */ (i, patch) => setD({ ...d, transitions: d.transitions.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const moveStatus = /** @param {number} i @param {number} by */ (i, by) => {
    const next = [...d.statuses];
    const [s] = next.splice(i, 1);
    next.splice(i + by, 0, s);
    setD({ ...d, statuses: next });
  };
  return (
    <section className="set-card wf-editor" aria-label={`${wf.name} workflow`}>
      <div className="wf-version-bar">
        <span>
          {wf.version ? `Published version ${wf.version}` : "Published"}
          {saved && (
            <b className="wf-draft-badge">
              {" "}
              · Draft saved by {saved.savedBy}
              {saved.savedAt ? `, ${formatDate(saved.savedAt)}` : ""}
            </b>
          )}
        </span>
        <button className="btn btn-ghost sm" onClick={() => setShowVersions(!showVersions)} aria-expanded={showVersions}>
          <History size={14} /> Versions
        </button>
      </div>
      {showVersions && <Versions wf={wf} canEdit={canEdit} onRestore={onRestore} />}
      {notice && (
        <p className="form-ok banner" role="status">
          {notice}
        </p>
      )}
      <div className="field-row">
        <label className="field">
          <span>Name</span>
          <input value={d.name} disabled={!canEdit} onChange={(e) => setD({ ...d, name: e.target.value })} maxLength={60} />
        </label>
        <label className="field">
          <span>Description</span>
          <input value={d.description} disabled={!canEdit} onChange={(e) => setD({ ...d, description: e.target.value })} maxLength={300} />
        </label>
      </div>

      <h3>Statuses</h3>
      <p className="field-hint">In board order. New work items start in the one marked "Start". The number is how many work items are in it now.</p>
      <ol className="wf-statuses">
        {d.statuses.map((s, i) => {
          const st = byId.get(s.id);
          return (
            <li key={s.id}>
              <span className={`pill sm fill-${CATEGORY_META[st?.category ?? "TODO"].tone}`}>{st?.name ?? s.id}</span>
              <small className="muted">{CATEGORY_META[st?.category ?? "TODO"].label}</small>
              <small className="wf-usage">{usage[s.id] ?? 0} items</small>
              <label className="wi-check">
                <input type="radio" name={`initial-${wf.id}`} checked={s.initial} disabled={!canEdit} onChange={() => setD({ ...d, statuses: d.statuses.map((x) => ({ ...x, initial: x.id === s.id })) })} />
                Start
              </label>
              {canEdit && (
                <span className="wf-row-actions">
                  <button className="icon-link" onClick={() => moveStatus(i, -1)} disabled={i === 0} aria-label={`Move ${st?.name} up`}>
                    <ArrowUp size={14} />
                  </button>
                  <button className="icon-link" onClick={() => moveStatus(i, 1)} disabled={i === d.statuses.length - 1} aria-label={`Move ${st?.name} down`}>
                    <ArrowDown size={14} />
                  </button>
                  <button
                    className="icon-link danger-text"
                    disabled={s.initial || d.statuses.length === 1}
                    title={s.initial ? "Choose another starting status first" : "Remove from this workflow"}
                    aria-label={`Remove ${st?.name} from this workflow`}
                    onClick={() => setD({ ...d, statuses: d.statuses.filter((x) => x.id !== s.id), transitions: d.transitions.filter((t) => t.from !== s.id && t.to !== s.id) })}
                  >
                    <Trash2 size={14} />
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {canEdit && (
        <div className="wf-add-status">
          <select value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Add a status to this workflow">
            <option value="">Add a status…</option>
            {statuses
              .filter((s) => !inWf.has(s.id))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({CATEGORY_META[s.category].label})
                </option>
              ))}
          </select>
          <button
            className="btn btn-ghost sm"
            disabled={!adding}
            onClick={() => {
              setD({ ...d, statuses: [...d.statuses, { id: adding, initial: false }] });
              setAdding("");
            }}
          >
            <Plus size={14} strokeWidth={3} /> Add
          </button>
          <small className="muted">New statuses are made in "All statuses" below.</small>
        </div>
      )}

      <div className="wf-moves-head">
        <h3>Moves</h3>
        <div className="seg" role="group" aria-label="Show the moves as">
          <button className={view === "canvas" ? "on" : ""} aria-pressed={view === "canvas"} onClick={() => setView("canvas")}>
            <Waypoints size={14} /> Diagram
          </button>
          <button className={view === "table" ? "on" : ""} aria-pressed={view === "table"} onClick={() => setView("table")}>
            <Table2 size={14} /> Table only
          </button>
        </div>
      </div>
      {view === "canvas" ? (
        <Suspense fallback={<WorkflowDiagram statuses={d.statuses.map((s) => /** @type {StatusDef} */ (byId.get(s.id))).filter(Boolean)} transitions={d.transitions} />}>
          <WorkflowCanvas
            statuses={d.statuses}
            catalogue={byId}
            moves={d.transitions}
            usage={usage}
            canEdit={canEdit}
            onAdd={(from, to) => {
              if (d.transitions.some((t) => t.from === from && t.to === to)) return;
              setD({ ...d, transitions: [...d.transitions, { name: `To ${nameOf(to)}`, from, to, rules: [] }] });
            }}
            onRemove={(i) => setD((x) => ({ ...x, transitions: x.transitions.filter((_, j) => j !== i) }))}
          />
        </Suspense>
      ) : (
        <WorkflowDiagram statuses={d.statuses.map((s) => /** @type {StatusDef} */ (byId.get(s.id))).filter(Boolean)} transitions={d.transitions} />
      )}
      <div className="table-wrap">
        <table className="table wf-moves">
          <thead>
            <tr>
              <th scope="col">Move</th>
              <th scope="col">From</th>
              <th scope="col" aria-label="to" />
              <th scope="col">To</th>
              <th scope="col">Rules</th>
              {canEdit && <th scope="col" aria-label="Remove" />}
            </tr>
          </thead>
          <tbody>
            {d.transitions.map((t, i) => (
              <tr key={t.id ?? `new-${i}`}>
                <td>
                  <input value={t.name} disabled={!canEdit} onChange={(e) => setT(i, { name: e.target.value })} aria-label={`Move ${i + 1} name`} maxLength={60} />
                </td>
                <td>
                  <select value={t.from ?? ""} disabled={!canEdit} onChange={(e) => setT(i, { from: e.target.value || null })} aria-label={`${t.name}: from`}>
                    <option value="">Any status</option>
                    {d.statuses.map((s) => (
                      <option key={s.id} value={s.id}>
                        {nameOf(s.id)}
                      </option>
                    ))}
                  </select>
                </td>
                <td aria-hidden="true">
                  <ArrowRight size={14} />
                </td>
                <td>
                  <select value={t.to} disabled={!canEdit} onChange={(e) => setT(i, { to: e.target.value })} aria-label={`${t.name}: to`}>
                    {d.statuses.map((s) => (
                      <option key={s.id} value={s.id}>
                        {nameOf(s.id)}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <RulesCell rules={t.rules} users={users} userName={userName} canEdit={canEdit} onChange={(rules) => setT(i, { rules })} label={t.name} />
                </td>
                {canEdit && (
                  <td>
                    <button className="icon-link danger-text" onClick={() => setD({ ...d, transitions: d.transitions.filter((_, j) => j !== i) })} aria-label={`Remove the move ${t.name}`}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <div className="wf-actions">
          <button className="btn btn-ghost sm" onClick={() => setD({ ...d, transitions: [...d.transitions, { name: "New move", from: d.statuses[0]?.id ?? null, to: d.statuses[1]?.id ?? d.statuses[0]?.id, rules: [] }] })}>
            <Plus size={14} strokeWidth={3} /> Add a move
          </button>
          <span className="wf-spacer" />
          {!wf.isDefault && !inUse && (
            <button
              className="btn btn-ghost sm danger-text"
              onClick={() => {
                if (window.confirm(`Delete the ${wf.name} workflow? Its versions go too.`)) onDelete();
              }}
            >
              <Trash2 size={14} /> Delete workflow
            </button>
          )}
          {saved && (
            <button
              className="btn btn-ghost sm"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm("Throw away the draft and go back to what's published?")) return;
                await api(`/workflows/${wf.id}/draft`, "DELETE");
                setSavedDraft(null);
                setD(published);
                setNotice("Draft discarded.");
                await onSaved();
              }}
            >
              Discard draft
            </button>
          )}
          <button className="btn btn-ghost sm" disabled={!unsaved || busy || !d.name.trim()} onClick={saveDraft}>
            <Save size={15} /> Save draft
          </button>
        </div>
      )}
      {canEdit && (
        <div className="wf-publish">
          <label className="field">
            <span>What changed (optional, kept with the version)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. Added a QA step" />
          </label>
          <button
            className="btn btn-amber"
            disabled={!dirty || busy || !d.name.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await onPublish(d, note);
                setSavedDraft(null);
                setNote("");
              } finally {
                setBusy(false);
              }
            }}
          >
            <Send size={15} /> Publish
          </button>
          <small className="muted">Publishing changes it for everyone at once. Items in a status you've taken out are moved where you say.</small>
        </div>
      )}
      {!canEdit && <p className="field-hint">Only people allowed to edit workflows can change this.</p>}
      {canEdit && <small className="muted">{RULE_HELP}</small>}
    </section>
  );
}
/**
 * Every published version of a workflow, newest first. Restoring one publishes it again as a new version, so
 * nothing is lost.
 * @param {{ wf: ListedWorkflow; canEdit: boolean; onRestore: (version: number, statuses: string[]) => Promise<void> }} p
 */
function Versions({ wf, canEdit, onRestore }) {
  const [list, setList] = useState(/** @type {{ version: number; note: string; publishedBy: string; publishedAt: string; statuses: number; moves: number }[] | null} */ (null));
  const [error, setError] = useState("");
  useEffect(() => {
    api(`/workflows/${wf.id}/versions`)
      .then((r) => setList(/** @type {{ versions: NonNullable<typeof list> }} */ (r).versions))
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load the versions"));
  }, [wf.id, wf.version]);
  if (error) return <p className="form-error">{error}</p>;
  if (!list) return <p className="muted">Loading versions…</p>;
  if (!list.length) return <p className="field-hint">No versions yet. The first time you publish, the workflow as it is now is kept as version 1.</p>;
  return (
    <div className="table-wrap wf-versions">
      <table className="table">
        <caption className="sr-only">Published versions of {wf.name}</caption>
        <thead>
          <tr>
            <th scope="col">Version</th>
            <th scope="col">Published</th>
            <th scope="col">What changed</th>
            <th scope="col">Size</th>
            {canEdit && <th scope="col" aria-label="Restore" />}
          </tr>
        </thead>
        <tbody>
          {list.map((v, i) => (
            <tr key={v.version}>
              <td>
                {v.version}
                {i === 0 && <small className="muted"> · current</small>}
              </td>
              <td>
                {formatDate(v.publishedAt)} <span className="muted">by {v.publishedBy}</span>
              </td>
              <td>{v.note}</td>
              <td className="muted">
                {v.statuses} statuses, {v.moves} moves
              </td>
              {canEdit && (
                <td>
                  {i > 0 && (
                    <button
                      className="btn btn-ghost sm"
                      onClick={async () => {
                        if (!window.confirm(`Publish version ${v.version} again? It becomes the current version; the others are kept.`)) return;
                        const detail = /** @type {{ workflow: { statuses: { id: string }[] } }} */ (await api(`/workflows/${wf.id}/versions/${v.version}`));
                        await onRestore(
                          v.version,
                          detail.workflow.statuses.map((s) => s.id),
                        );
                      }}
                    >
                      <RotateCcw size={14} /> Restore
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
const RULE_HELP = 'Rules: "Who may" limits who can make the move (Administrators always can); "Needs first" asks for something before it happens; "Then" happens afterwards.';
/**
 * A simple picture of the workflow: each status, with arrows to where it can go.
 * @param {{ statuses: StatusDef[]; transitions: Draft["transitions"] }} arg6
 */
function WorkflowDiagram({ statuses, transitions }) {
  const anyTo = transitions.filter((t) => !t.from).map((t) => t.to);
  return (
    <ol className="wf-diagram" aria-label="Workflow diagram">
      {statuses.map((s) => {
        const out = transitions.filter((t) => t.from === s.id).map((t) => statuses.find((x) => x.id === t.to)?.name ?? t.to);
        return (
          <li key={s.id} className={`wf-node cat-${s.category.toLowerCase()}`}>
            <b>{s.name}</b>
            {out.length > 0 && (
              <small>
                <ArrowRight size={11} aria-hidden="true" /> {out.join(", ")}
              </small>
            )}
            {anyTo.includes(s.id) && <small className="muted">reachable from any status</small>}
          </li>
        );
      })}
    </ol>
  );
}
/**
 * @param {{ rules: Rule[]; users: User[]; userName: (id: string) => string; canEdit: boolean; onChange: (r: Rule[]) => void; label: string }} props
 */
function RulesCell({ rules, users, userName, canEdit, onChange, label }) {
  const [kind, setKind] = useState(/** @type {RuleKind | "" | (() => RuleKind | "")} */ (""));
  const [rule, setRule] = useState("");
  const [value, setValue] = useState("");
  const def = kind ? RULES[kind].find((r) => r.rule === rule) : undefined;
  const add = () => {
    if (!kind || !def || (def.value && !value)) return;
    onChange([...rules, { kind, rule, value: def.value ? value : null }]);
    setKind("");
    setRule("");
    setValue("");
  };
  return (
    <div className="wf-rules">
      {rules.length === 0 && !canEdit && <span className="muted">None</span>}
      {rules.map((r, i) => (
        <span key={i} className={`wf-rule wf-rule-${r.kind}`}>
          <small>{KIND_LABEL[r.kind]}:</small> {describeRule(r, userName)}
          {canEdit && (
            <button onClick={() => onChange(rules.filter((_, j) => j !== i))} aria-label={`Remove rule: ${describeRule(r, userName)}`}>
              <X size={11} />
            </button>
          )}
        </span>
      ))}
      {canEdit && (
        <span className="wf-rule-add">
          <select
            value={kind ? `${kind}:${rule}` : ""}
            onChange={(e) => {
              const [k, r] = e.target.value.split(":");
              setKind(/** @type {RuleKind} */ (k) || "");
              setRule(r ?? "");
              setValue("");
            }}
            aria-label={`Add a rule to ${label}`}
          >
            <option value="">Add a rule…</option>
            {/** @type {RuleKind[]} */ (Object.keys(RULES)).map((k) => (
              <optgroup key={k} label={KIND_LABEL[k]}>
                {RULES[k].map((r) => (
                  <option key={r.rule} value={`${k}:${r.rule}`}>
                    {r.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {def?.value === "role" && (
            <select value={value} onChange={(e) => setValue(e.target.value)} aria-label="Role">
              <option value="">Role…</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          )}
          {def?.value === "user" && (
            <select value={value} onChange={(e) => setValue(e.target.value)} aria-label="Person">
              <option value="">Person…</option>
              {users
                .filter((u) => assignable(u.role))
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          )}
          {def?.value === "field" && (
            <select value={value} onChange={(e) => setValue(e.target.value)} aria-label="Field">
              <option value="">Field…</option>
              {Object.entries(FIELD_RULE_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          )}
          {def?.value === "resolution" && (
            <select value={value} onChange={(e) => setValue(e.target.value)} aria-label="Resolution">
              <option value="">Resolution…</option>
              <option value="DONE">Done</option>
              <option value="WONT_DO">Won't do</option>
            </select>
          )}
          {def?.value === "notify" && (
            <select value={value} onChange={(e) => setValue(e.target.value)} aria-label="Who to notify">
              <option value="">Who…</option>
              <option value="watchers">Watchers</option>
              <option value="assignee">The assignee</option>
              <option value="reporter">The reporter</option>
              {ROLES.map((r) => (
                <option key={r} value={`role:${r}`}>
                  Every {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          )}
          {def && (
            <button className="btn btn-ghost sm" onClick={add} disabled={!!def.value && !value}>
              Add
            </button>
          )}
        </span>
      )}
    </div>
  );
}
/**
 * @param {{ data: Overview; canEdit: boolean; attempt: (fn: (moves?: Record<string, string>) => Promise<unknown>, done: string, options: StatusDef[]) => Promise<void> }} props
 */
function StatusList({ data, canEdit, attempt }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState(/** @type {StatusCategory | (() => StatusCategory)} */ ("IN_PROGRESS"));
  const [editing, setEditing] = useState(/** @type {StatusDef | null | (() => StatusDef | null)} */ (null));
  const usedIn = /** @param {string} id */ (id) => data.workflows.filter((w) => w.statuses.some((s) => s.id === id)).map((w) => w.name);
  const total = /** @param {string} id */ (id) => Object.values(data.usage).reduce((n, u) => n + (u[id] ?? 0), 0);
  return (
    <section className="set-card wf-all-statuses" aria-label="All statuses">
      <h3>All statuses</h3>
      <p className="field-hint">Statuses are shared, so "Done" is the same in every workflow and boards can line them up. Each is in a category: To Do, In Progress or Done.</p>
      <ul className="wf-status-list">
        {data.statuses.map((s) => (
          <li key={s.id}>
            {editing?.id === s.id ? (
              <form
                className="wf-inline"
                onSubmit={async (e) => {
                  e.preventDefault();
                  await attempt(() => api(`/statuses/${s.id}`, "PATCH", { name: editing.name, category: editing.category }), `Saved ${editing.name}.`, []);
                  setEditing(null);
                }}
              >
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} aria-label="Status name" maxLength={40} autoFocus />
                <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: /** @type {StatusCategory} */ (e.target.value) })} aria-label="Category">
                  {/** @type {StatusCategory[]} */ (Object.keys(CATEGORY_META)).map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_META[c].label}
                    </option>
                  ))}
                </select>
                <button className="btn btn-navy sm" type="submit">
                  Save
                </button>
                <button className="btn btn-ghost sm" type="button" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <span className={`pill sm fill-${CATEGORY_META[s.category].tone}`}>{s.name}</span>
                <small className="muted">
                  {CATEGORY_META[s.category].label} · {usedIn(s.id).join(", ") || "in no workflow"} · {total(s.id)} items
                </small>
                {canEdit && (
                  <span className="wf-row-actions">
                    <button className="link-btn" onClick={() => setEditing(s)}>
                      Edit
                    </button>
                    <button
                      className="link-btn danger-text"
                      onClick={() => {
                        if (!window.confirm(`Delete the status ${s.name} from every workflow and board?`)) return;
                        attempt(
                          (m) => api(`/statuses/${s.id}`, "DELETE", m ? { moveTo: m[s.id] } : {}),
                          `Deleted ${s.name}.`,
                          data.statuses.filter((x) => x.id !== s.id),
                        );
                      }}
                    >
                      Delete
                    </button>
                  </span>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form
          className="wf-inline"
          onSubmit={async (e) => {
            e.preventDefault();
            await attempt(() => api("/statuses", "POST", { name, category }), `Added the status ${name}. Add it to a workflow to use it.`, []);
            setName("");
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New status, such as Waiting for client" aria-label="New status name" maxLength={40} />
          <select value={category} onChange={(e) => setCategory(/** @type {StatusCategory} */ (e.target.value))} aria-label="New status category">
            {/** @type {StatusCategory[]} */ (Object.keys(CATEGORY_META)).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_META[c].label}
              </option>
            ))}
          </select>
          <button className="btn btn-ghost sm" type="submit" disabled={!name.trim()}>
            <Plus size={14} strokeWidth={3} /> Add status
          </button>
        </form>
      )}
    </section>
  );
}
/**
 * Asks where the work items in each listed status should go, then retries the change.
 * @param {{ need: MovesNeeded; onCancel: () => void }} arg2
 */
function MovesDialog({ need, onCancel }) {
  const [choice, setChoice] = useState(/** @type {Record<string, string> | (() => Record<string, string>)} */ ({}));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="backdrop modal-backdrop" onClick={onCancel}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Where should these work items go?"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await need.retry(choice);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't save");
          } finally {
            setBusy(false);
          }
        }}
      >
        <button type="button" className="close-btn" onClick={onCancel} aria-label="Close">
          <X size={18} />
        </button>
        <h2>Where should these work items go?</h2>
        <p className="modal-note">These statuses won't be available any more. Choose a status for the work items in each. Each move is recorded in their history.</p>
        {need.statuses.map((s) => (
          <label key={s.id} className="field">
            <span>
              {s.count} work item{s.count === 1 ? "" : "s"} in {s.name} move to
            </span>
            <select value={choice[s.id] ?? ""} onChange={(e) => setChoice({ ...choice, [s.id]: e.target.value })} required>
              <option value="">Choose…</option>
              {need.options
                .filter((o) => o.id !== s.id)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} ({CATEGORY_META[o.category].label})
                  </option>
                ))}
            </select>
          </label>
        ))}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-amber" disabled={busy || need.statuses.some((s) => !choice[s.id])}>
            Move them and save
          </button>
        </div>
      </form>
    </div>
  );
}
/**
 * @typedef {Object} Draft
 * @property {string} name
 * @property {string} description
 * @property {{ id: string; initial: boolean }[]} statuses
 * @property {(Omit<Transition, "id"> & { id?: string })[]} transitions
 */
/**
 * @typedef {Workflow & { template: boolean; draftSavedAt?: string; version: number }} ListedWorkflow
 */
/**
 * @typedef {Object} Overview
 * @property {ListedWorkflow[]} workflows
 * @property {StatusDef[]} statuses
 * @property {string | null} workspace  the workflow this workspace uses
 * @property {Record<string, string>} workspaces
 * @property {{ id: string; key: string; name: string; workspace: string | null; workflowId: string | null; effective: string }[]} projects
 * @property {{ id: string; name: string; base: string; active: boolean; workflowId: string | null }[]} itemTypes
 * @property {Record<string, Record<string, number>>} usage
 * @property {boolean} canEditTemplates
 */
/**
 * The statuses a refused change needs answers for: where their work items should move.
 * @typedef {Object} MovesNeeded
 * @property {{ id: string; name: string; count: number }[]} statuses
 * @property {StatusDef[]} options
 * @property {(moves: Record<string, string>) => Promise<void>} retry
 */
