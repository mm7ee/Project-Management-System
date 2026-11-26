/** @import { User } from '../data/roles' */
/** @import { System } from '../data/systems' */
/** @import { ActionKind, AutomationAction, AutomationRule, AutomationRun, Trigger } from '../data/search' */
import { useCallback, useEffect, useState } from "react";
import { Play, Plus, Trash2, X, Zap } from "lucide-react";
import { api } from "../data/api";
import { ROLES, ROLE_LABEL, assignable } from "../data/roles";
import { LINK_META, LINK_TYPES, WORK_PRIORITIES, WORK_PRIORITY_META } from "../data/workitems";
import { ACTIONS, ACTION_KINDS, MAX_AUTOMATION_DEPTH, PLACEHOLDERS, SETTABLE_FIELDS, TRIGGERS, TRIGGER_KINDS, WEEKDAYS } from "../data/search";
import { timeAgo } from "../time";
/** @type {Draft} */ const BLANK = { name: "", description: "", enabled: false, scope: "global", trigger: "item_created", conditionPql: "", maxPerMinute: 10, actions: [{ kind: "comment", value: "" }] };
/** @type {Trigger[]} */ const BULK = ["schedule", "sprint_started", "sprint_completed"];
/**
 * @param {Pick<AutomationRule, "trigger" | "triggerValue" | "scheduleWeekday" | "scheduleHour">} r
 * @returns {string}
 */
function when(r) {
  if (r.trigger === "schedule") return `${r.scheduleWeekday ? `Every ${WEEKDAYS[r.scheduleWeekday - 1]}` : "Every day"} at ${String(r.scheduleHour ?? 0).padStart(2, "0")}:00`;
  return TRIGGERS[r.trigger].label + (r.triggerValue ? `: ${r.triggerValue}` : "");
}
/**
 * Settings → Automation: rules that act on work items when something happens, or on a schedule.
 * @param {Props} arg1
 */
export default function AutomationSettings({ users, systems, workspaces, now }) {
  const [rules, setRules] = useState(/** @type {AutomationRule[] | null | (() => AutomationRule[] | null)} */ (null));
  const [editing, setEditing] = useState(/** @type {Draft | null | (() => Draft | null)} */ (null));
  const [log, setLog] = useState(/** @type {AutomationRule | null | (() => AutomationRule | null)} */ (null));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    try {
      setRules(await /** @type {Promise<Array<AutomationRule>>} */ (/** @type {unknown} */ (api("/automation/rules"))));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the rules");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const toggle = /** @param {AutomationRule} r */ async (r) => {
    setError("");
    try {
      await api(`/automation/rules/${r.id}`, "PUT", { ...r, enabled: !r.enabled });
      setNotice(`"${r.name}" is ${r.enabled ? "off" : "on"}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't change it");
    }
  };
  const runNow = /** @param {AutomationRule} r */ async (r) => {
    setError("");
    /** @type {string | undefined} */ let itemKey;
    if (!BULK.includes(r.trigger)) {
      const k = window.prompt(`Run "${r.name}" on which work item? Type its key, like INFRA-12.`);
      if (!k) return;
      itemKey = k.trim();
    }
    try {
      const res = await /** @type {Promise<{ status?: string; message?: string; }>} */ (/** @type {unknown} */ (api(`/automation/rules/${r.id}/run`, "POST", itemKey ? { itemKey } : {})));
      setNotice(`"${r.name}": ${res.status ?? "done"}${res.message ? ` · ${res.message}` : ""}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't run it");
    }
  };
  if (editing)
    return (
      <RuleEditor
        draft={editing}
        users={users}
        systems={systems}
        workspaces={workspaces}
        onCancel={() => setEditing(null)}
        onSaved={async (msg) => {
          setEditing(null);
          setNotice(msg);
          await load();
        }}
      />
    );
  return (
    <div className="automation">
      <div className="set-card">
        <div className="set-card-head">
          <div>
            <h3>
              <Zap size={16} aria-hidden="true" /> Automation rules
            </h3>
            <p className="muted">
              Each rule waits for something to happen (or a time), checks a PQL condition, then acts. A rule's own changes can set off other rules up to {MAX_AUTOMATION_DEPTH} levels deep, and each rule has a limit of runs a minute, so rules can't loop forever. Rules act with full rights and show in
              history as "Automation: rule name".
            </p>
          </div>
          <button className="btn btn-amber sm" onClick={() => setEditing({ ...BLANK, actions: [{ kind: "comment", value: "" }] })}>
            <Plus size={14} /> New rule
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}
        {notice && (
          <p className="form-ok" role="status">
            {notice}
          </p>
        )}
        {!rules ? (
          <p className="muted">Loading…</p>
        ) : !rules.length ? (
          <p className="muted">No rules yet.</p>
        ) : (
          <ul className="rule-list">
            {rules.map((r) => (
              <li key={r.id} className={r.enabled ? "" : "off"}>
                <label className="switch" title={r.enabled ? "On" : "Off"}>
                  <input type="checkbox" role="switch" checked={r.enabled} onChange={() => toggle(r)} aria-label={`${r.name}: ${r.enabled ? "on" : "off"}`} />
                  <span aria-hidden="true" />
                </label>
                <div className="rule-main">
                  <button className="rule-name" onClick={() => setEditing({ ...r })}>
                    {r.name}
                  </button>
                  <small>
                    {when(r)} · {r.scope === "global" ? "everywhere" : r.scope === "project" ? (systems.find((s) => s.id === r.scopeValue)?.name ?? "a project") : r.scopeValue}
                    {r.conditionPql ? ` · if ${r.conditionPql}` : ""} · then {r.actions.map((a) => ACTIONS[a.kind].toLowerCase()).join(", ")}
                  </small>
                  {r.lastRunAt && (
                    <small className={`rule-last ${r.lastStatus ?? ""}`}>
                      Last ran {timeAgo(r.lastRunAt, now)}: {r.lastStatus}
                    </small>
                  )}
                </div>
                <span className="rule-actions">
                  <button className="btn btn-ghost sm" onClick={() => runNow(r)}>
                    <Play size={13} /> Run now
                  </button>
                  <button className="btn btn-ghost sm" onClick={() => setLog(r)}>
                    Run log
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {log && <RunLog rule={log} now={now} onClose={() => setLog(null)} />}
    </div>
  );
}
/**
 * @param {{ rule: AutomationRule; now: number; onClose: () => void }} arg2
 */
function RunLog({ rule, now, onClose }) {
  const [runs, setRuns] = useState(/** @type {AutomationRun[] | null | (() => AutomationRun[] | null)} */ (null));
  const [error, setError] = useState("");
  useEffect(() => {
    /** @type {Promise<Array<AutomationRun>>} */ (/** @type {unknown} */ (api(`/automation/rules/${rule.id}/runs?limit=100`))).then(setRuns).catch((e) => setError(e instanceof Error ? e.message : "Couldn't load the log"));
  }, [rule.id]);
  return (
    <div className="backdrop modal-backdrop" onClick={onClose}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label={`Run log: ${rule.name}`} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <h2>Run log: {rule.name}</h2>
        <p className="modal-note">The last 100 runs. Kept for 90 days.</p>
        {error && <p className="form-error">{error}</p>}
        {!runs ? (
          <p className="muted">Loading…</p>
        ) : !runs.length ? (
          <p className="muted">It hasn't run yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">What set it off</th>
                  <th scope="col">Item</th>
                  <th scope="col">Result</th>
                  <th scope="col">Changed</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td title={new Date(r.at).toLocaleString("en-GB")}>{timeAgo(r.at, now)}</td>
                    <td>
                      {r.triggerEvent}
                      {r.depth > 0 && <small className="muted"> (level {r.depth + 1})</small>}
                    </td>
                    <td>{r.itemKey ?? "—"}</td>
                    <td>
                      <span className={`run-status ${r.status}`}>{r.status}</span> {r.message}
                    </td>
                    <td>{r.touched.length ? r.touched.join(", ") : <span className="muted">nothing</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
/**
 * @param {{ draft: Draft; users: User[]; systems: System[]; workspaces: string[]; onCancel: () => void; onSaved: (msg: string) => Promise<void> }} props
 */
function RuleEditor({ draft, users, systems, workspaces, onCancel, onSaved }) {
  const [r, setR] = useState(/** @type {Draft | (() => Draft)} */ (draft));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = /** @param {Partial<Draft>} patch */ (patch) => setR((x) => ({ ...x, ...patch }));
  const setAction = /** @param {number} i @param {Partial<AutomationAction>} patch */ (i, patch) => set({ actions: r.actions.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const people = users.filter((u) => assignable(u.role));
  const save = async () => {
    setError("");
    setBusy(true);
    try {
      if (r.id) await api(`/automation/rules/${r.id}`, "PUT", r);
      else await api("/automation/rules", "POST", r);
      await onSaved(`Saved "${r.name}".`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the rule");
    } finally {
      setBusy(false);
    }
  };
  const valueField = /** @param {AutomationAction} a @param {number} i */ (a, i) => {
    switch (a.kind) {
      case "transition":
        return (
          <label className="field">
            <span>To status</span>
            <input value={a.value ?? ""} onChange={(e) => setAction(i, { value: e.target.value })} placeholder="In review, or category:DONE" list="automation-statuses" required />
          </label>
        );
      case "assign":
        return (
          <label className="field">
            <span>Assign to</span>
            <select value={a.value ?? ""} onChange={(e) => setAction(i, { value: e.target.value })}>
              <option value="">Choose…</option>
              <option value="nobody">Nobody (unassign)</option>
              <option value="reporter">The reporter</option>
              <option value="lead">The project lead</option>
              {ROLES.filter(assignable).map((x) => (
                <option key={x} value={`role:${x}`}>
                  A {ROLE_LABEL[x]} on the project
                </option>
              ))}
              {people.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        );
      case "set_field":
        return (
          <>
            <label className="field">
              <span>Field</span>
              <select value={a.field ?? ""} onChange={(e) => setAction(i, { field: e.target.value })}>
                <option value="">Choose…</option>
                {Object.entries(SETTABLE_FIELDS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            {a.field === "priority" ? (
              <label className="field">
                <span>Value</span>
                <select value={a.value ?? ""} onChange={(e) => setAction(i, { value: e.target.value })}>
                  <option value="">Choose…</option>
                  {WORK_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {WORK_PRIORITY_META[p].label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="field">
                <span>Value</span>
                <input value={a.value ?? ""} onChange={(e) => setAction(i, { value: e.target.value })} placeholder={a.field === "dueDate" ? "2026-12-01 or +3d" : a.field === "onHold" ? "yes or no" : ""} />
              </label>
            )}
          </>
        );
      case "comment":
      case "create_subtask":
        return (
          <label className="field grow">
            <span>{a.kind === "comment" ? "Comment" : "Sub-task summary"}</span>
            <input value={a.value ?? ""} onChange={(e) => setAction(i, { value: e.target.value })} maxLength={500} />
          </label>
        );
      case "link":
        return (
          <>
            <label className="field">
              <span>Link type</span>
              <select value={a.field ?? ""} onChange={(e) => setAction(i, { field: e.target.value })}>
                <option value="">Choose…</option>
                {LINK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {LINK_META[t].outward}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Work item key</span>
              <input value={a.value ?? ""} onChange={(e) => setAction(i, { value: e.target.value })} placeholder="INFRA-12" />
            </label>
          </>
        );
      case "notify": {
        const how = (a.value2 ?? "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
        const flip = /** @param {string} ch */ (ch) => setAction(i, { value2: (how.includes(ch) ? how.filter((x) => x !== ch) : [...how, ch]).join(",") });
        return (
          <>
            <label className="field">
              <span>Who</span>
              <select value={a.field ?? ""} onChange={(e) => setAction(i, { field: e.target.value })}>
                <option value="">Choose…</option>
                <option value="assignee">The assignee</option>
                <option value="reporter">The reporter</option>
                <option value="watchers">Its watchers</option>
                <option value="teams">The Teams channel</option>
                {ROLES.filter(assignable).map((x) => (
                  <option key={x} value={`role:${x}`}>
                    Everyone who is a {ROLE_LABEL[x]}
                  </option>
                ))}
                {people.map((u) => (
                  <option key={u.id} value={`person:${u.id}`}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="field checks">
              <legend>How</legend>
              {["bell", "email", "teams"].map((ch) => (
                <label key={ch} className="wi-check">
                  <input type="checkbox" checked={how.includes(ch)} onChange={() => flip(ch)} /> {ch === "bell" ? "Bell" : ch === "email" ? "Email" : "Teams"}
                </label>
              ))}
            </fieldset>
            <label className="field grow">
              <span>Message</span>
              <input value={a.value ?? ""} onChange={(e) => setAction(i, { value: e.target.value })} placeholder="{key} {summary} needs a look" maxLength={500} />
            </label>
          </>
        );
      }
    }
  };
  return (
    <div className="set-card rule-editor">
      <h3>{r.id ? `Edit "${draft.name}"` : "New rule"}</h3>
      <datalist id="automation-statuses">
        <option value="category:TODO" />
        <option value="category:IN_PROGRESS" />
        <option value="category:DONE" />
      </datalist>
      <div className="field-row">
        <label className="field grow">
          <span>Name</span>
          <input value={r.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} required />
        </label>
        <label className="wi-check">
          <input type="checkbox" checked={r.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> On
        </label>
      </div>
      <label className="field">
        <span>Description</span>
        <input value={r.description} onChange={(e) => set({ description: e.target.value })} maxLength={300} />
      </label>

      <fieldset className="rule-part">
        <legend>When</legend>
        <div className="field-row">
          <label className="field">
            <span>Trigger</span>
            <select value={r.trigger} onChange={(e) => set({ trigger: /** @type {Trigger} */ (e.target.value), triggerValue: undefined, ...(e.target.value === "schedule" ? { scheduleHour: r.scheduleHour ?? 8 } : {}) })}>
              {TRIGGER_KINDS.map((t) => (
                <option key={t} value={t}>
                  {TRIGGERS[t].label}
                </option>
              ))}
            </select>
          </label>
          {TRIGGERS[r.trigger].value === "status" && (
            <label className="field">
              <span>To status (blank: any)</span>
              <input value={r.triggerValue ?? ""} onChange={(e) => set({ triggerValue: e.target.value || undefined })} placeholder="Done" />
            </label>
          )}
          {TRIGGERS[r.trigger].value === "field" && (
            <label className="field">
              <span>Field (blank: any)</span>
              <select value={r.triggerValue ?? ""} onChange={(e) => set({ triggerValue: e.target.value || undefined })}>
                <option value="">Any field</option>
                {["assignee", "priority", "summary", "description", "dueDate", "storyPoints", "labels", "component", "sprint"].map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
          )}
          {r.trigger === "schedule" && (
            <>
              <label className="field">
                <span>Day</span>
                <select value={r.scheduleWeekday ?? ""} onChange={(e) => set({ scheduleWeekday: e.target.value ? Number(e.target.value) : undefined })}>
                  <option value="">Every day</option>
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i + 1}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Time (Harare)</span>
                <select value={r.scheduleHour ?? 8} onChange={(e) => set({ scheduleHour: Number(e.target.value) })}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>
        <div className="field-row">
          <label className="field">
            <span>Where</span>
            <select value={r.scope} onChange={(e) => set({ scope: /** @type {Draft["scope"]} */ (e.target.value), scopeValue: undefined })}>
              <option value="global">Every project</option>
              <option value="workspace">One workspace</option>
              <option value="project">One project</option>
            </select>
          </label>
          {r.scope === "workspace" && (
            <label className="field">
              <span>Workspace</span>
              <select value={r.scopeValue ?? ""} onChange={(e) => set({ scopeValue: e.target.value })}>
                <option value="">Choose…</option>
                {workspaces.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </label>
          )}
          {r.scope === "project" && (
            <label className="field">
              <span>Project</span>
              <select value={r.scopeValue ?? ""} onChange={(e) => set({ scopeValue: e.target.value })}>
                <option value="">Choose…</option>
                {systems.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </fieldset>

      <fieldset className="rule-part">
        <legend>If (optional)</legend>
        <label className="field">
          <span>Condition, in PQL</span>
          <input value={r.conditionPql} onChange={(e) => set({ conditionPql: e.target.value })} placeholder="type = Bug AND priority = Highest" spellCheck={false} className="mono" />
        </label>
        <p className="field-hint">{BULK.includes(r.trigger) ? "The rule acts on every work item this picks." : "The rule acts only when the item matches."} Blank means every item.</p>
      </fieldset>

      <fieldset className="rule-part">
        <legend>Then</legend>
        <ol className="action-list">
          {r.actions.map((a, i) => (
            <li key={i}>
              <div className="field-row">
                <label className="field">
                  <span>Action {i + 1}</span>
                  <select value={a.kind} onChange={(e) => setAction(i, { kind: /** @type {ActionKind} */ (e.target.value), field: undefined, value: "", value2: e.target.value === "notify" ? "bell" : undefined })}>
                    {ACTION_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {ACTIONS[k]}
                      </option>
                    ))}
                  </select>
                </label>
                {valueField(a, i)}
                <button className="icon-link danger" onClick={() => set({ actions: r.actions.filter((_, j) => j !== i) })} disabled={r.actions.length === 1} aria-label={`Remove action ${i + 1}`}>
                  <X size={14} />
                </button>
              </div>
            </li>
          ))}
        </ol>
        <button className="btn btn-ghost sm" onClick={() => set({ actions: [...r.actions, { kind: "comment", value: "" }] })} disabled={r.actions.length >= 10}>
          <Plus size={13} /> Add an action
        </button>
        <p className="field-hint">Comments and messages can use {PLACEHOLDERS.join(" ")}.</p>
      </fieldset>

      <label className="field narrow">
        <span>Most runs a minute</span>
        <input type="number" min={1} max={100} value={r.maxPerMinute} onChange={(e) => set({ maxPerMinute: Number(e.target.value) || 10 })} />
      </label>

      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        {r.id && (
          <button
            className="delete-link inline"
            onClick={async () => {
              if (!window.confirm(`Delete the rule "${r.name}"? Its run log goes too.`)) return;
              try {
                await api(`/automation/rules/${r.id}`, "DELETE");
                await onSaved(`Deleted "${r.name}".`);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Couldn't delete it");
              }
            }}
          >
            <Trash2 size={14} /> Delete rule
          </button>
        )}
        <button className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-amber" onClick={save} disabled={busy || !r.name.trim()}>
          {busy ? "Saving…" : "Save rule"}
        </button>
      </div>
    </div>
  );
}
/** @typedef {Omit<AutomationRule, "id" | "lastRunAt" | "lastStatus"> & { id?: string }} Draft */
/**
 * @typedef {Object} Props
 * @property {User[]} users
 * @property {System[]} systems
 * @property {string[]} workspaces
 * @property {number} now
 */
