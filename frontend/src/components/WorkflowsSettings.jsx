/** @import { User } from '../data/roles' */
/** @import { StatusCategory } from '../data/workitems' */
/** @import { Rule, RuleKind, StatusDef, Transition, Workflow } from '../data/workflows' */
import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, Plus, Save, Trash2, X } from "lucide-react";
import { api, ApiError } from "../data/api";
import { ROLES, ROLE_LABEL, assignable } from "../data/roles";
import { CATEGORY_META, FIELD_RULE_LABEL, KIND_LABEL, RULES, describeRule } from "../data/workflows";
/**
 * Settings → Administration → Workflows.
 * @param {{ users: User[]; workspaces: string[]; canEdit: boolean }} props
 */
export default function WorkflowsSettings({ users, workspaces, canEdit }) {
  const [data, setData] = useState(/** @type {Overview | null | (() => Overview | null)} */ (null));
  const [selected, setSelected] = useState("default");
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
  const wf = data.workflows.find((w) => w.id === selected) ?? data.workflows[0];
  const byId = new Map(data.statuses.map((s) => [s.id, s]));
  return (
    <section className="wf-settings">
      <header className="page-head">
        <div>
          <h2>Workflows</h2>
          <p>A workflow is the statuses a work item goes through and the moves allowed between them. Each workspace uses one; a project can use a different one. Every rule is checked when someone moves an item.</p>
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

      <Assignments data={data} workspaces={workspaces} canEdit={canEdit} attempt={attempt} />

      <div className="wf-tabs" role="tablist" aria-label="Workflows">
        {data.workflows.map((w) => (
          <button key={w.id} role="tab" aria-selected={w.id === wf.id} className={w.id === wf.id ? "on" : ""} onClick={() => setSelected(w.id)}>
            {w.name}
            {w.isDefault && <small> · default</small>}
          </button>
        ))}
        {canEdit && <NewWorkflow workflows={data.workflows} onCreated={async (id) => (await load(), setSelected(id))} onError={setError} />}
      </div>

      <WorkflowEditor
        key={wf.id + JSON.stringify(wf)}
        wf={wf}
        statuses={data.statuses}
        usage={data.usage[wf.id] ?? {}}
        users={users}
        canEdit={canEdit}
        onSave={(body) => attempt((m) => api(`/workflows/${wf.id}`, "PUT", { ...body, ...(m ? { moves: m } : {}) }), `Saved ${body.name}.`, body.statuses.map((s) => /** @type {StatusDef} */ (byId.get(s.id))).filter(Boolean))}
        onDelete={async () => {
          await attempt(() => api(`/workflows/${wf.id}`, "DELETE"), `Deleted ${wf.name}.`, []);
          setSelected("default");
        }}
      />

      <StatusList data={data} canEdit={canEdit} attempt={attempt} />

      {moves && <MovesDialog need={moves} onCancel={() => setMoves(null)} />}
    </section>
  );
}
/**
 * @param {{
 *   data: Overview;
 *   workspaces: string[];
 *   canEdit: boolean;
 *   attempt: (fn: (moves?: Record<string, string>) => Promise<unknown>, done: string, options: StatusDef[]) => Promise<void>;
 * }} arg3
 */
function Assignments({ data, workspaces, canEdit, attempt }) {
  const def = /** @type {Workflow} */ (data.workflows.find((w) => w.isDefault));
  const [ws, setWs] = useState(/** @type {Record<string, string> | (() => Record<string, string>)} */ (() => Object.fromEntries(workspaces.map((w) => [w, data.workspaces[w] ?? ""]))));
  const [projects, setProjects] = useState(/** @type {Record<string, string> | (() => Record<string, string>)} */ (() => Object.fromEntries(data.projects.map((p) => [p.id, p.workflowId ?? ""]))));
  const [showProjects, setShowProjects] = useState(data.projects.some((p) => p.workflowId));
  const dirty = workspaces.some((w) => (data.workspaces[w] ?? "") !== ws[w]) || data.projects.some((p) => (p.workflowId ?? "") !== projects[p.id]);
  const name = /** @param {string} id */ (id) => data.workflows.find((w) => w.id === id)?.name ?? id;
  return (
    <section className="set-card wf-assign" aria-label="Which workflow each workspace and project uses">
      <h3>Who uses which workflow</h3>
      <div className="wf-assign-grid">
        {workspaces.map((w) => (
          <label key={w} className="field">
            <span>{w} workspace</span>
            <select value={ws[w]} disabled={!canEdit} onChange={(e) => setWs({ ...ws, [w]: e.target.value })}>
              <option value="">{def.name} (the default)</option>
              {data.workflows
                .filter((x) => !x.isDefault)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </select>
          </label>
        ))}
      </div>
      <button className="link-btn" onClick={() => setShowProjects(!showProjects)} aria-expanded={showProjects}>
        {showProjects ? "Hide projects" : "Give a project its own workflow"}
      </button>
      {showProjects && (
        <div className="table-wrap">
          <table className="table wf-project-table">
            <thead>
              <tr>
                <th scope="col">Project</th>
                <th scope="col">Workspace</th>
                <th scope="col">Workflow</th>
              </tr>
            </thead>
            <tbody>
              {data.projects.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="mono">{p.key}</span> {p.name}
                  </td>
                  <td>{p.workspace ?? "—"}</td>
                  <td>
                    <select value={projects[p.id]} disabled={!canEdit} onChange={(e) => setProjects({ ...projects, [p.id]: e.target.value })} aria-label={`${p.name}'s workflow`}>
                      <option value="">The workspace's ({name(ws[p.workspace ?? ""] || def.id)})</option>
                      {data.workflows.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
                  workspaces: Object.fromEntries(workspaces.filter((w) => (data.workspaces[w] ?? "") !== ws[w]).map((w) => [w, ws[w] || null])),
                  projects: Object.fromEntries(data.projects.filter((p) => (p.workflowId ?? "") !== projects[p.id]).map((p) => [p.id, projects[p.id] || null])),
                  ...(m ? { moves: m } : {}),
                }),
              "Saved which workflow each workspace and project uses.",
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
 * @param {{ workflows: Workflow[]; onCreated: (id: string) => Promise<void>; onError: (m: string) => void }} arg1
 */
function NewWorkflow({ workflows, onCreated, onError }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [copyFrom, setCopyFrom] = useState("default");
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
          const wf = await /** @type {Promise<Workflow>} */ (/** @type {unknown} */ (api("/workflows", "POST", { name, copyFrom })));
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
          </option>
        ))}
      </select>
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
 *   wf: Workflow;
 *   statuses: StatusDef[];
 *   usage: Record<string, number>;
 *   users: User[];
 *   canEdit: boolean;
 *   onSave: (d: Draft) => Promise<void>;
 *   onDelete: () => Promise<void>;
 * }} props
 */
function WorkflowEditor({ wf, statuses, usage, users, canEdit, onSave, onDelete }) {
  const [d, setD] = useState(/** @type {Draft | (() => Draft)} */ ({ name: wf.name, description: wf.description, statuses: wf.statuses, transitions: wf.transitions }));
  const [adding, setAdding] = useState("");
  const byId = new Map(statuses.map((s) => [s.id, s]));
  const nameOf = /** @param {string | null} id */ (id) => (id ? (byId.get(id)?.name ?? id) : "Any status");
  const inWf = new Set(d.statuses.map((s) => s.id));
  const userName = /** @param {string} id */ (id) => users.find((u) => u.id === id)?.name ?? id;
  const dirty = JSON.stringify(d) !== JSON.stringify({ name: wf.name, description: wf.description, statuses: wf.statuses, transitions: wf.transitions });
  const setT = /** @param {number} i @param {Partial<Draft["transitions"][number]>} patch */ (i, patch) => setD({ ...d, transitions: d.transitions.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const moveStatus = /** @param {number} i @param {number} by */ (i, by) => {
    const next = [...d.statuses];
    const [s] = next.splice(i, 1);
    next.splice(i + by, 0, s);
    setD({ ...d, statuses: next });
  };
  return (
    <section className="set-card wf-editor" aria-label={`${wf.name} workflow`}>
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

      <h3>Moves</h3>
      <WorkflowDiagram statuses={d.statuses.map((s) => /** @type {StatusDef} */ (byId.get(s.id))).filter(Boolean)} transitions={d.transitions} />
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
          {!wf.isDefault && (
            <button
              className="btn btn-ghost sm danger-text"
              onClick={() => {
                if (window.confirm(`Delete the ${wf.name} workflow? Only possible when nothing uses it.`)) onDelete();
              }}
            >
              <Trash2 size={14} /> Delete workflow
            </button>
          )}
          <button className="btn btn-ghost sm" disabled={!dirty} onClick={() => setD({ name: wf.name, description: wf.description, statuses: wf.statuses, transitions: wf.transitions })}>
            Undo changes
          </button>
          <button className="btn btn-amber" disabled={!dirty || !d.name.trim()} onClick={() => onSave(d)}>
            <Save size={15} /> Save workflow
          </button>
        </div>
      )}
      {!canEdit && <p className="field-hint">Only people allowed to edit workflows can change this.</p>}
      {canEdit && <small className="muted">{RULE_HELP}</small>}
    </section>
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
 * @typedef {Object} Overview
 * @property {Workflow[]} workflows
 * @property {StatusDef[]} statuses
 * @property {Record<string, string>} workspaces
 * @property {{ id: string; key: string; name: string; workspace: string | null; workflowId: string | null; effective: string }[]} projects
 * @property {Record<string, Record<string, number>>} usage
 */
/**
 * The statuses a refused change needs answers for: where their work items should move.
 * @typedef {Object} MovesNeeded
 * @property {{ id: string; name: string; count: number }[]} statuses
 * @property {StatusDef[]} options
 * @property {(moves: Record<string, string>) => Promise<void>} retry
 */
