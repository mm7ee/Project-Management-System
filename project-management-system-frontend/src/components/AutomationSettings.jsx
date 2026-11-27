/** @import { User } from '../data/roles' */
/** @import { System } from '../data/systems' */
/** @import { StatusDef } from '../data/workflows' */
/** @import { CustomField } from '../data/admin' */
/** @import { ActionKind, AutomationAction, AutomationRule, AutomationRun, Trigger } from '../data/search' */
/** @import { Condition, ConditionField, ConditionGroup, ConditionOp, TriggerConfig } from '../data/automation' */
// Settings → This workspace → Automations: rules laid out as WHEN (the trigger) / IF (conditions, built from
// AND/OR groups with dropdowns, or PQL) / THEN (actions). Each rule can be tested on an item without changing
// anything, switched on or off, and has a run log. Ready-made rules (presets) can be added and edited.
import { useCallback, useEffect, useState } from "react";
import { Copy, FlaskConical, ListChecks, Play, Plus, Sparkles, Trash2, X, Zap } from "lucide-react";
import { api } from "../data/api";
import { ROLES, ROLE_LABEL, assignable } from "../data/roles";
import { LINK_META, LINK_TYPES, WORK_PRIORITIES, WORK_PRIORITY_META } from "../data/workitems";
import { ACTIONS, ACTION_KINDS, BULK_TRIGGERS, MAX_AUTOMATION_DEPTH, PLACEHOLDERS, SETTABLE_FIELDS, TRIGGERS, TRIGGER_KINDS, WEEKDAYS } from "../data/search";
import { CONDITION_FIELDS, CONDITION_OPS, MAX_GROUP_DEPTH, describeSchedule } from "../data/automation";
import { CATEGORY_META } from "../data/workflows";
import { useItemTypes } from "../data/itemTypes";
import { timeAgo } from "../time";
import { Help, ToastProvider, useConfirm, useToast } from "./AdminKit";

/** @type {Draft} */ const BLANK = { name: "", description: "", enabled: false, scope: "global", trigger: "item_created", conditionPql: "", conditions: { op: "and", items: [] }, maxPerMinute: 10, actions: [{ kind: "comment", value: "" }] };
/** Kinds whose settings are kept as JSON in the action's value. */
const JSON_ACTIONS = /** @type {ActionKind[]} */ (["create_item", "email", "message", "webhook", "escalate"]);

/**
 * @param {AutomationRule} r
 * @returns {string}
 */
function when(r) {
  if (r.trigger === "schedule" && r.triggerConfig) return describeSchedule(r.triggerConfig);
  if (r.trigger === "due_soon") return `${r.triggerConfig?.hours ?? 24} hours before the due date`;
  return TRIGGERS[r.trigger].label + (r.triggerValue ? `: ${r.triggerValue}` : "");
}

/** @param {Props} p */
export default function AutomationSettings(p) {
  return (
    <ToastProvider>
      <Automation {...p} />
    </ToastProvider>
  );
}

/** @param {Props} p */
function Automation({ users, systems, now, orgAdmin = false }) {
  const toast = useToast();
  const [rules, setRules] = useState(/** @type {AutomationRule[] | null} */ (null));
  const [editing, setEditing] = useState(/** @type {Draft | null} */ (null));
  const [log, setLog] = useState(/** @type {AutomationRule | null} */ (null));
  const [testing, setTesting] = useState(/** @type {AutomationRule | null} */ (null));
  const [presets, setPresets] = useState(/** @type {{ id: string; name: string; description: string; for: string }[] | null} */ (null));
  const [handover, setHandover] = useState(/** @type {{ webhookUrl?: string; secrets?: { action: number; secret: string }[] } | null} */ (null));
  const statuses = useStatuses();
  const load = useCallback(async () => {
    try {
      setRules(/** @type {AutomationRule[]} */ (await api("/automation/rules")));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't load the rules", false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const toggle = /** @param {AutomationRule} r */ async (r) => {
    try {
      await api(`/automation/rules/${r.id}`, "PUT", { ...r, enabled: !r.enabled });
      toast(`"${r.name}" is ${r.enabled ? "off" : "on"}.`);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't change it", false);
    }
  };
  const runNow = /** @param {AutomationRule} r */ async (r) => {
    /** @type {string | undefined} */ let itemKey;
    if (!BULK_TRIGGERS.includes(r.trigger) && r.trigger !== "webhook") {
      const k = window.prompt(`Run "${r.name}" on which work item? Type its key, like INFRA-12.`);
      if (!k) return;
      itemKey = k.trim();
    }
    try {
      const res = /** @type {{ status?: string; message?: string }} */ (await api(`/automation/rules/${r.id}/run`, "POST", itemKey ? { itemKey } : {}));
      toast(`"${r.name}": ${res.status ?? "done"}${res.message ? ` · ${res.message}` : ""}`, res.status !== "error");
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't run it", false);
    }
  };
  if (editing)
    return (
      <RuleEditor
        draft={editing}
        users={users}
        systems={systems}
        statuses={statuses}
        orgAdmin={orgAdmin}
        onCancel={() => setEditing(null)}
        onSaved={async (msg, extra) => {
          setEditing(null);
          toast(msg);
          if (extra && (extra.webhookUrl || extra.secrets?.length)) setHandover(extra);
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
            <Help>
              <b>When</b> something happens (or at a time), <b>if</b> the conditions hold, <b>then</b> act. Rules act with full rights and show in history as "Automation: rule name". To stop loops, a rule's own changes set off other rules at most {MAX_AUTOMATION_DEPTH} levels deep, and
              a rule runs at most 10 times an hour on one item. A failed step is tried again (after 1, 2, 4 and 8 minutes); if it still fails, the rule's owner is told.
            </Help>
          </div>
          <span className="org-row">
            <button className="btn btn-ghost sm" onClick={() => api("/automation/presets").then((r) => setPresets(/** @type {NonNullable<typeof presets>} */ (r)))}>
              <Sparkles size={14} /> From a preset
            </button>
            <button className="btn btn-amber sm" onClick={() => setEditing({ ...BLANK, conditions: { op: "and", items: [] }, actions: [{ kind: "comment", value: "" }] })}>
              <Plus size={14} /> New rule
            </button>
          </span>
        </div>
        {handover && (
          <div className="org-handover" role="status">
            {handover.webhookUrl && (
              <p>
                The rule's webhook address. Another system sends a POST here (with JSON, such as {`{ "itemKey": "DEV-12" }`}). It's shown only now; treat it as a password.
                <br />
                <code>{handover.webhookUrl}</code>
              </p>
            )}
            {handover.secrets?.map((s) => (
              <p key={s.action}>
                Action {s.action}'s signing secret. Each call carries <code>X-PMS-Signature: sha256=…</code> (and the same as <code>X-Pulse-Signature</code>), the HMAC-SHA256 of the body with this secret. It's shown only now.
                <br />
                <code>{s.secret}</code>
              </p>
            ))}
            <button className="btn btn-ghost sm" onClick={() => setHandover(null)}>
              Done
            </button>
          </div>
        )}
        {presets && (
          <div className="org-boxed" role="group" aria-label="Presets">
            <div className="set-card-head">
              <h4>Ready-made rules</h4>
              <button className="icon-link" onClick={() => setPresets(null)} aria-label="Close the presets">
                <X size={16} />
              </button>
            </div>
            <ul className="tpl-list">
              {presets.map((pr) => (
                <li key={pr.id} className="tpl-card">
                  <div>
                    <b>{pr.name}</b>
                    <p className="muted">{pr.description}</p>
                    <small className="muted">For {pr.for}</small>
                  </div>
                  <button
                    className="btn btn-ghost sm"
                    onClick={async () => {
                      try {
                        const r = /** @type {{ rule: AutomationRule; warnings: string[] }} */ (await api(`/automation/presets/${pr.id}`, "POST"));
                        toast(r.warnings.length ? `Added, switched off. Before turning it on: ${r.warnings.join("; ")}.` : "Added, switched off. Check it, then turn it on.", !r.warnings.length);
                        setPresets(null);
                        await load();
                        setEditing({ ...r.rule });
                      } catch (e) {
                        toast(e instanceof Error ? e.message : "Couldn't add it", false);
                      }
                    }}
                  >
                    <Plus size={14} /> Add
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!rules ? (
          <p className="muted">Loading…</p>
        ) : !rules.length ? (
          <div className="admin-empty">
            <b>No rules yet</b>
            <span>Start from a preset, or make a new rule.</span>
          </div>
        ) : (
          <ul className="rule-list">
            {rules.map((r) => (
              <li key={r.id} className={r.enabled ? "" : "off"}>
                <label className="switch" title={r.enabled ? "On" : "Off"}>
                  <input type="checkbox" role="switch" checked={r.enabled} onChange={() => toggle(r)} aria-label={`${r.name}: ${r.enabled ? "on" : "off"}`} disabled={!!r.sharedScope && !orgAdmin} />
                  <span aria-hidden="true" />
                </label>
                <div className="rule-main">
                  <button className="rule-name" onClick={() => setEditing({ ...r })}>
                    {r.name}
                  </button>
                  <small>
                    <b>When</b> {when(r).toLowerCase()} · <b>if</b> {r.conditions?.items.length || r.conditionPql ? "conditions" : "always"} · <b>then</b> {r.actions.map((a) => ACTIONS[a.kind].toLowerCase()).join(", ")}
                    {r.sharedScope && <span className="pill sm"> organisation rule</span>}
                  </small>
                  <small className="muted">Owner: {r.ownerName}</small>
                  {r.lastRunAt && (
                    <small className={`rule-last ${r.lastStatus ?? ""}`}>
                      Last ran {timeAgo(r.lastRunAt, now)}: {r.lastStatus}
                    </small>
                  )}
                </div>
                <span className="rule-actions">
                  <button className="btn btn-ghost sm" onClick={() => setTesting(r)}>
                    <FlaskConical size={13} /> Test
                  </button>
                  <button className="btn btn-ghost sm" onClick={() => runNow(r)}>
                    <Play size={13} /> Run now
                  </button>
                  <button className="btn btn-ghost sm" onClick={() => setLog(r)}>
                    <ListChecks size={13} /> Run log
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {log && <RunLog rule={log} now={now} onClose={() => setLog(null)} />}
      {testing && <TestDialog rule={testing} onClose={() => setTesting(null)} />}
    </div>
  );
}

/** The organisation's statuses, for status pickers. */
function useStatuses() {
  const [statuses, setStatuses] = useState(/** @type {StatusDef[]} */ ([]));
  useEffect(() => {
    api("/statuses")
      .then((s) => setStatuses(/** @type {StatusDef[]} */ (s)))
      .catch(() => setStatuses([]));
  }, []);
  return statuses;
}

/**
 * The test: what the rule would do to an item, changing nothing.
 * @param {{ rule: AutomationRule | Draft; draft?: boolean; onClose: () => void }} p
 */
function TestDialog({ rule, draft = false, onClose }) {
  const [key, setKey] = useState("");
  const [result, setResult] = useState(/** @type {{ wouldRun: boolean; checks: { label: string; result: boolean }[]; actions: string[]; items?: number } | null} */ (null));
  const [error, setError] = useState("");
  const bulk = BULK_TRIGGERS.includes(rule.trigger) || rule.trigger === "webhook";
  const run = async () => {
    setError("");
    try {
      const r = draft ? await api("/automation/test", "POST", { rule, ...(key ? { itemKey: key } : {}) }) : await api(`/automation/rules/${/** @type {AutomationRule} */ (rule).id}/test`, "POST", key ? { itemKey: key } : {});
      setResult(/** @type {NonNullable<typeof result>} */ (r));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't test it");
    }
  };
  return (
    <div className="backdrop modal-backdrop" onClick={onClose}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label={`Test: ${rule.name || "the rule"}`} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <h2>Test: {rule.name || "the rule"}</h2>
        <p className="modal-note">Shows what the rule would do, without changing anything.</p>
        <form
          className="org-inline"
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          <label className="field">
            Work item{bulk ? " (optional)" : ""}
            <input value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} placeholder="DEV-12" required={!bulk} autoFocus />
          </label>
          <button className="btn btn-navy sm">
            <FlaskConical size={14} /> Test
          </button>
        </form>
        {error && <p className="form-error">{error}</p>}
        {result && (
          <div className="rule-test" role="status">
            <p>
              <b>{result.wouldRun ? "It would run." : "It wouldn't run."}</b>
              {result.items !== undefined && ` It would act on ${result.items} item${result.items === 1 ? "" : "s"}${result.items >= 20 ? " or more" : ""}.`}
            </p>
            {result.checks.length > 0 && (
              <ul className="rule-checks">
                {result.checks.map((c, i) => (
                  <li key={i} className={c.result ? "ok" : "no"}>
                    <span aria-hidden="true">{c.result ? "✓" : "✗"}</span> <span className="sr-only">{c.result ? "Holds:" : "Doesn't hold:"}</span> {c.label}
                  </li>
                ))}
              </ul>
            )}
            <p>{result.wouldRun ? "Then:" : "Had it run:"}</p>
            <ul>
              {result.actions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/** @param {{ rule: AutomationRule; now: number; onClose: () => void }} p */
function RunLog({ rule, now, onClose }) {
  const [runs, setRuns] = useState(/** @type {(AutomationRun & { retrying?: number })[] | null} */ (null));
  const [error, setError] = useState("");
  useEffect(() => {
    api(`/automation/rules/${rule.id}/runs?limit=100`)
      .then((r) => setRuns(/** @type {NonNullable<typeof runs>} */ (r)))
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load the log"));
  }, [rule.id]);
  return (
    <div className="backdrop modal-backdrop" onClick={onClose}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label={`Run log: ${rule.name}`} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <h2>Run log: {rule.name}</h2>
        <p className="modal-note">The last 100 runs, with each condition's result and what each action did. Kept for 90 days.</p>
        {runs?.[0]?.retrying ? <p className="form-ok">{runs[0].retrying} run(s) waiting to be tried again.</p> : null}
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
                  <th scope="col">Conditions</th>
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
                      {r.detail?.conditions?.length ? (
                        <ul className="rule-checks compact">
                          {r.detail.conditions.map((c, i) => (
                            <li key={i} className={c.result ? "ok" : "no"}>
                              {c.result ? "✓" : "✗"} {c.label}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
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
 * The IF block: conditions in AND/OR groups, built with dropdowns.
 * @param {{ group: ConditionGroup; depth: number; onChange: (g: ConditionGroup) => void; onRemove?: () => void; ctx: PickerContext }} p
 */
function ConditionGroupEditor({ group, depth, onChange, onRemove, ctx }) {
  const setItem = /** @param {number} i @param {Condition | ConditionGroup} v */ (i, v) => onChange({ ...group, items: group.items.map((x, j) => (j === i ? v : x)) });
  const remove = /** @param {number} i */ (i) => onChange({ ...group, items: group.items.filter((_, j) => j !== i) });
  return (
    <div className={`cond-group depth-${depth}`} role="group" aria-label={depth === 1 ? "Conditions" : "A group of conditions"}>
      <div className="cond-head">
        <label className="field inline">
          <span className="sr-only">Match</span>
          <select value={group.op} onChange={(e) => onChange({ ...group, op: /** @type {"and" | "or"} */ (e.target.value) })}>
            <option value="and">All of these (AND)</option>
            <option value="or">Any of these (OR)</option>
          </select>
        </label>
        {onRemove && (
          <button className="icon-link danger" onClick={onRemove} aria-label="Remove this group">
            <X size={14} />
          </button>
        )}
      </div>
      {group.items.length === 0 && <p className="field-hint">No conditions: it acts every time.</p>}
      {group.items.map((it, i) =>
        "items" in it ? (
          <ConditionGroupEditor key={i} group={it} depth={depth + 1} ctx={ctx} onChange={(g) => setItem(i, g)} onRemove={() => remove(i)} />
        ) : (
          <ConditionRow key={i} c={/** @type {Condition & { fieldId?: string }} */ (it)} ctx={ctx} onChange={(c) => setItem(i, c)} onRemove={() => remove(i)} />
        ),
      )}
      <div className="org-row">
        <button className="btn btn-ghost sm" onClick={() => onChange({ ...group, items: [...group.items, { field: "type", op: "is", value: ctx.types[0]?.id ?? "TASK" }] })}>
          <Plus size={13} /> Condition
        </button>
        {depth < MAX_GROUP_DEPTH && (
          <button className="btn btn-ghost sm" onClick={() => onChange({ ...group, items: [...group.items, { op: group.op === "and" ? "or" : "and", items: [] }] })}>
            <Plus size={13} /> Group ({group.op === "and" ? "OR" : "AND"})
          </button>
        )}
      </div>
    </div>
  );
}

/** @param {{ c: Condition & { fieldId?: string }; ctx: PickerContext; onChange: (c: Condition & { fieldId?: string }) => void; onRemove: () => void }} p */
function ConditionRow({ c, ctx, onChange, onRemove }) {
  const def = CONDITION_FIELDS[c.field];
  const noValue = c.op === "isEmpty" || c.op === "isNotEmpty";
  const cf = c.field === "custom" ? ctx.fields.find((f) => f.id === c.fieldId) : undefined;
  const value = String(c.value ?? "");
  const set = /** @param {string | number | null} v */ (v) => onChange({ ...c, value: v });
  /** @type {import('react').ReactNode} */ let input = null;
  if (!noValue) {
    const kind = def.value;
    if (kind === "type")
      input = (
        <select aria-label="Item type" value={value} onChange={(e) => set(e.target.value)}>
          {ctx.types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      );
    else if (kind === "priority")
      input = (
        <select aria-label="Priority" value={value} onChange={(e) => set(e.target.value)}>
          {WORK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {WORK_PRIORITY_META[p].label}
            </option>
          ))}
        </select>
      );
    else if (kind === "status")
      input = (
        <select aria-label="Status" value={value} onChange={(e) => set(e.target.value)}>
          <option value="">Choose…</option>
          {ctx.statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      );
    else if (kind === "category")
      input = (
        <select aria-label="Category" value={value} onChange={(e) => set(e.target.value)}>
          {Object.entries(CATEGORY_META).map(([k, m]) => (
            <option key={k} value={k}>
              {m.label}
            </option>
          ))}
        </select>
      );
    else if (kind === "user")
      input = (
        <select aria-label="Person" value={value} onChange={(e) => set(e.target.value)}>
          <option value="">Choose…</option>
          {ctx.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      );
    else if (kind === "role")
      input = (
        <select aria-label="Role" value={value} onChange={(e) => set(e.target.value)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      );
    else if (kind === "custom" && cf && (cf.kind === "select" || cf.kind === "multiselect"))
      input = (
        <select aria-label={cf.name} value={value} onChange={(e) => set(e.target.value)}>
          <option value="">Choose…</option>
          {cf.options.map((o) => (
            <option key={o.id} value={o.label}>
              {o.label}
            </option>
          ))}
        </select>
      );
    else if (kind === "custom" && cf?.kind === "checkbox")
      input = (
        <select aria-label={cf.name} value={value} onChange={(e) => set(e.target.value)}>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      );
    else if (c.op === "within" || kind === "number" || c.op === "gt" || c.op === "lt")
      input = <input type="number" aria-label={c.op === "within" ? "Days" : "Number"} value={value} onChange={(e) => set(e.target.value === "" ? null : Number(e.target.value))} />;
    else if (kind === "date") input = <input type="date" aria-label="Date" value={value} onChange={(e) => set(e.target.value)} />;
    else input = <input aria-label="Value" value={value} onChange={(e) => set(e.target.value)} maxLength={200} />;
  }
  return (
    <div className="cond-row">
      <select
        aria-label="Field"
        value={c.field}
        onChange={(e) => {
          const field = /** @type {ConditionField} */ (e.target.value);
          onChange({ field, op: CONDITION_FIELDS[field].ops[0], value: field === "type" ? (ctx.types[0]?.id ?? "") : field === "priority" ? "HIGH" : field === "statusCategory" ? "DONE" : null });
        }}
      >
        {Object.entries(CONDITION_FIELDS).map(([k, d]) => (
          <option key={k} value={k}>
            {d.label}
          </option>
        ))}
      </select>
      {c.field === "custom" && (
        <select aria-label="Custom field" value={c.fieldId ?? ""} onChange={(e) => onChange({ ...c, fieldId: e.target.value, value: null })}>
          <option value="">Choose the field…</option>
          {ctx.fields.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      )}
      <select aria-label="Test" value={c.op} onChange={(e) => onChange({ ...c, op: /** @type {ConditionOp} */ (e.target.value) })}>
        {def.ops.map((o) => (
          <option key={o} value={o}>
            {CONDITION_OPS[o]}
          </option>
        ))}
      </select>
      {input}
      <button className="icon-link danger" onClick={onRemove} aria-label="Remove this condition">
        <X size={14} />
      </button>
    </div>
  );
}

/**
 * @param {{ draft: Draft; users: User[]; systems: System[]; statuses: StatusDef[]; orgAdmin: boolean; onCancel: () => void; onSaved: (msg: string, extra?: { webhookUrl?: string; secrets?: { action: number; secret: string }[] }) => Promise<void> }} props
 */
function RuleEditor({ draft, users, systems, statuses, orgAdmin, onCancel, onSaved }) {
  const [r, setR] = useState(/** @type {Draft} */ ({ ...draft, conditions: draft.conditions ?? { op: "and", items: [] } }));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPql, setShowPql] = useState(!!draft.conditionPql);
  const [testing, setTesting] = useState(false);
  const [dialog, ask] = useConfirm();
  const types = useItemTypes();
  const [fields, setFields] = useState(/** @type {CustomField[]} */ ([]));
  const [targets, setTargets] = useState(/** @type {{ id: string; name: string; current: boolean; projects: { id: string; name: string; key: string }[] }[]} */ ([]));
  const [workspaces, setWorkspaces] = useState(/** @type {{ id: string; name: string }[]} */ ([]));
  useEffect(() => {
    api("/custom-fields")
      .then((f) => setFields(/** @type {CustomField[]} */ (f)))
      .catch(() => setFields([]));
    api("/automation/targets")
      .then((t) => setTargets(/** @type {typeof targets} */ (t)))
      .catch(() => setTargets([]));
    if (orgAdmin)
      api("/org")
        .then((o) => setWorkspaces((/** @type {{ workspaces: { id: string; name: string; status: string }[] }} */ (o)).workspaces.filter((w) => w.status === "active")))
        .catch(() => setWorkspaces([]));
  }, [orgAdmin]);
  const set = /** @param {Partial<Draft>} patch */ (patch) => setR((x) => ({ ...x, ...patch }));
  const setAction = /** @param {number} i @param {Partial<AutomationAction>} patch */ (i, patch) => set({ actions: r.actions.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const cfgOf = /** @param {AutomationAction} a @returns {Record<string, string>} */ (a) => {
    try {
      return a.value ? JSON.parse(a.value) : {};
    } catch {
      return {};
    }
  };
  const setCfg = /** @param {number} i @param {Record<string, string>} patch */ (i, patch) => setAction(i, { value: JSON.stringify({ ...cfgOf(r.actions[i]), ...patch }) });
  const people = users.filter((u) => assignable(u.role));
  const cfg = r.triggerConfig ?? {};
  const setTrig = /** @param {Partial<TriggerConfig>} patch */ (patch) => set({ triggerConfig: { ...cfg, ...patch } });
  const body = () => ({ ...r, conditions: r.conditions?.items.length ? r.conditions : null });
  const save = async () => {
    setError("");
    setBusy(true);
    try {
      const res = /** @type {{ webhookUrl?: string; secrets?: { action: number; secret: string }[] }} */ (r.id ? await api(`/automation/rules/${r.id}`, "PUT", body()) : await api("/automation/rules", "POST", body()));
      await onSaved(`Saved "${r.name}".`, res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the rule");
    } finally {
      setBusy(false);
    }
  };
  const ctx = /** @type {PickerContext} */ ({ types, statuses, users, fields });
  const statusSelect = /** @param {string} value @param {(v: string) => void} onChange @param {string} label @param {boolean} [any] */ (value, onChange, label, any = false) => (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{any ? "Any status" : "Choose…"}</option>
      {statuses.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
      {!any && (
        <optgroup label="Any status in a category">
          {Object.entries(CATEGORY_META).map(([k, m]) => (
            <option key={k} value={`category:${k}`}>
              {m.label}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
  const valueField = /** @param {AutomationAction} a @param {number} i */ (a, i) => {
    const c = cfgOf(a);
    switch (a.kind) {
      case "transition":
        return (
          <label className="field">
            <span>To status</span>
            {statusSelect(a.value ?? "", (v) => setAction(i, { value: v }), "To status")}
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
              <optgroup label="By role">
                {ROLES.filter(assignable).map((x) => (
                  <option key={x} value={`role:${x}`}>
                    A {ROLE_LABEL[x]} on the project
                  </option>
                ))}
              </optgroup>
              <optgroup label="Share it out between a role">
                {ROLES.filter(assignable).map((x) => (
                  <option key={`rr${x}`} value={`round_robin:role:${x}`}>
                    {ROLE_LABEL[x]}s, in turn (round-robin)
                  </option>
                ))}
                {ROLES.filter(assignable).map((x) => (
                  <option key={`ll${x}`} value={`least_loaded:role:${x}`}>
                    The {ROLE_LABEL[x]} with the fewest open items
                  </option>
                ))}
              </optgroup>
              <optgroup label="A person">
                {people.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </optgroup>
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
                <input value={a.value ?? ""} onChange={(e) => setAction(i, { value: e.target.value })} placeholder={a.field === "dueDate" ? "2026-12-01, +3d, or +2wd (working days)" : a.field === "onHold" ? "yes or no" : ""} />
              </label>
            )}
          </>
        );
      case "add_label":
        return (
          <label className="field">
            <span>Label</span>
            <input value={a.value ?? ""} onChange={(e) => setAction(i, { value: e.target.value })} maxLength={40} />
          </label>
        );
      case "clear_field":
        return (
          <label className="field">
            <span>Field</span>
            <select value={a.field ?? ""} onChange={(e) => setAction(i, { field: e.target.value })}>
              <option value="">Choose…</option>
              {[
                ["dueDate", "Due date"],
                ["startDate", "Start date"],
                ["assignee", "Assignee"],
                ["component", "Component"],
                ["storyPoints", "Story points"],
                ["labels", "Labels"],
                ["description", "Description"],
              ].map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        );
      case "comment":
      case "create_subtask":
        return (
          <label className="field grow">
            <span>{a.kind === "comment" ? "Comment" : "Sub-task summary"}</span>
            <input value={a.value ?? ""} onChange={(e) => setAction(i, { value: e.target.value })} maxLength={500} />
          </label>
        );
      case "create_item": {
        const ws = targets.find((t) => t.id === c.workspaceId) ?? targets.find((t) => t.current);
        return (
          <>
            <label className="field">
              <span>In workspace</span>
              <select value={ws?.id ?? ""} onChange={(e) => setCfg(i, { workspaceId: e.target.value, systemId: "" })}>
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.current ? " (this one)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Project</span>
              <select value={c.systemId ?? ""} onChange={(e) => setCfg(i, { systemId: e.target.value })}>
                <option value="">{ws?.current ? "The triggering item's project" : "Choose…"}</option>
                {(ws?.projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.key} {p.name}
                  </option>
                ))}
              </select>
            </label>
            {ws?.current && (
              <label className="field">
                <span>Type</span>
                <select value={c.itemType ?? "TASK"} onChange={(e) => setCfg(i, { itemType: e.target.value })}>
                  {types
                    .filter((t) => t.active && t.base !== "SUBTASK")
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label className="field grow">
              <span>Summary</span>
              <input value={c.summary ?? ""} onChange={(e) => setCfg(i, { summary: e.target.value })} maxLength={255} placeholder="Landing page for {{item.title}}" />
            </label>
          </>
        );
      }
      case "email":
        return (
          <>
            <label className="field">
              <span>To</span>
              <select value={c.to?.startsWith("emails:") ? "emails:" : (c.to ?? "")} onChange={(e) => setCfg(i, { to: e.target.value })}>
                <option value="">Choose…</option>
                <option value="assignee">The assignee</option>
                <option value="reporter">The reporter</option>
                <option value="watchers">Its watchers</option>
                {ROLES.map((x) => (
                  <option key={x} value={`role:${x}`}>
                    Everyone who is a {ROLE_LABEL[x]}
                  </option>
                ))}
                <option value="emails:">These addresses…</option>
              </select>
            </label>
            {c.to?.startsWith("emails:") && (
              <label className="field">
                <span>Addresses (comma-separated)</span>
                <input value={c.to.slice(7)} onChange={(e) => setCfg(i, { to: `emails:${e.target.value}` })} />
              </label>
            )}
            <label className="field grow">
              <span>Subject</span>
              <input value={c.subject ?? ""} onChange={(e) => setCfg(i, { subject: e.target.value })} maxLength={200} />
            </label>
            <label className="field grow">
              <span>Message</span>
              <textarea rows={3} value={c.body ?? ""} onChange={(e) => setCfg(i, { body: e.target.value })} maxLength={3000} />
            </label>
          </>
        );
      case "message":
        return (
          <>
            <label className="field">
              <span>By</span>
              <select value={c.channel ?? "sms"} onChange={(e) => setCfg(i, { channel: e.target.value })}>
                <option value="sms">SMS</option>
                <option value="whatsapp">WhatsApp</option>
              </select>
            </label>
            <label className="field">
              <span>To</span>
              <select value={c.to?.startsWith("phone:") ? "phone:" : (c.to ?? "assignee")} onChange={(e) => setCfg(i, { to: e.target.value })}>
                <option value="assignee">The assignee (the phone in their profile)</option>
                <option value="reporter">The reporter</option>
                <option value="phone:">This number…</option>
              </select>
            </label>
            {c.to?.startsWith("phone:") && (
              <label className="field">
                <span>Number</span>
                <input value={c.to.slice(6)} onChange={(e) => setCfg(i, { to: `phone:${e.target.value}` })} placeholder="+263 77 123 4567" />
              </label>
            )}
            <label className="field grow">
              <span>Message</span>
              <input value={c.text ?? ""} onChange={(e) => setCfg(i, { text: e.target.value })} maxLength={1000} />
            </label>
            <p className="field-hint">No WhatsApp or SMS provider is connected yet: the run log shows what would have been sent.</p>
          </>
        );
      case "webhook":
        return (
          <>
            <label className="field grow">
              <span>Address (https://)</span>
              <input type="url" value={c.url ?? ""} onChange={(e) => setCfg(i, { url: e.target.value })} placeholder="https://example.com/hooks/pms" />
            </label>
            <label className="field grow">
              <span>JSON to send</span>
              <textarea rows={3} className="mono" value={c.payload ?? '{"key": "{{item.key}}", "title": "{{item.title}}", "status": "{{item.status}}"}'} onChange={(e) => setCfg(i, { payload: e.target.value })} spellCheck={false} />
            </label>
            <p className="field-hint">Each call is signed (X-PMS-Signature, also sent as X-Pulse-Signature). The signing secret is shown once, when you save.</p>
          </>
        );
      case "escalate":
        return (
          <label className="field grow">
            <span>Message to the managers</span>
            <input value={c.message ?? ""} onChange={(e) => setCfg(i, { message: e.target.value })} placeholder="{{item.key}} needs attention: {{item.title}}" maxLength={500} />
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
                {ROLES.map((x) => (
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
              <input value={a.value ?? ""} onChange={(e) => setAction(i, { value: e.target.value })} placeholder="{{item.key}} {{item.title}} needs a look" maxLength={500} />
            </label>
          </>
        );
      }
    }
  };
  return (
    <div className="set-card rule-editor">
      {dialog}
      <h3>{r.id ? `Edit "${draft.name}"` : "New rule"}</h3>
      {r.sharedScope && !orgAdmin && <p className="form-ok">This is one of your organisation's rules: only its administrators change it.</p>}
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

      <fieldset className="rule-part rule-when">
        <legend>When</legend>
        <div className="field-row">
          <label className="field">
            <span>Trigger</span>
            <select value={r.trigger} onChange={(e) => set({ trigger: /** @type {Trigger} */ (e.target.value), triggerValue: undefined, triggerConfig: e.target.value === "schedule" ? { every: "day", time: "08:00" } : e.target.value === "due_soon" ? { hours: 24 } : undefined })}>
              {TRIGGER_KINDS.map((t) => (
                <option key={t} value={t}>
                  {TRIGGERS[t].label}
                </option>
              ))}
            </select>
          </label>
          {TRIGGERS[r.trigger].value === "status" && (
            <label className="field">
              <span>To status</span>
              {statusSelect(r.triggerValue ?? "", (v) => set({ triggerValue: v || undefined }), "To status", true)}
            </label>
          )}
          {TRIGGERS[r.trigger].value === "field" && (
            <label className="field">
              <span>Field</span>
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
                <span>Every</span>
                <select value={cfg.every ?? "day"} onChange={(e) => setTrig({ every: /** @type {TriggerConfig["every"]} */ (e.target.value) })}>
                  <option value="day">Day</option>
                  <option value="weekday">Working day (Mon–Fri)</option>
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                </select>
              </label>
              {cfg.every === "week" && (
                <label className="field">
                  <span>On</span>
                  <select value={cfg.weekday ?? 1} onChange={(e) => setTrig({ weekday: Number(e.target.value) })}>
                    {WEEKDAYS.map((d, i) => (
                      <option key={d} value={i + 1}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {cfg.every === "month" && (
                <label className="field">
                  <span>On day</span>
                  <input type="number" min={1} max={28} value={cfg.day ?? 1} onChange={(e) => setTrig({ day: Number(e.target.value) })} />
                </label>
              )}
              <label className="field">
                <span>At (your organisation's time zone)</span>
                <input type="time" value={cfg.time ?? "08:00"} onChange={(e) => setTrig({ time: e.target.value })} />
              </label>
            </>
          )}
          {r.trigger === "due_soon" && (
            <label className="field">
              <span>Hours before the due date</span>
              <input type="number" min={1} max={720} value={cfg.hours ?? 24} onChange={(e) => setTrig({ hours: Number(e.target.value) })} />
            </label>
          )}
        </div>
        {r.trigger === "webhook" && <p className="field-hint">When you save, the rule gets a secret address for another system to call. {r.hasWebhook && "It has one: tick below to make a new one (the old one stops working)."}</p>}
        {r.trigger === "webhook" && r.id && r.hasWebhook && (
          <label className="wi-check">
            <input type="checkbox" checked={!!r.newWebhookAddress} onChange={(e) => set({ newWebhookAddress: e.target.checked })} /> Make a new address
          </label>
        )}
        {r.trigger === "manual" && <p className="field-hint">A button on each work item it applies to; anyone who works on the item can press it.</p>}
        <div className="field-row">
          <label className="field">
            <span>Where</span>
            <select value={r.sharedScope ?? r.scope} disabled={!!r.id && !!r.sharedScope} onChange={(e) => (e.target.value === "organization" || e.target.value === "workspaces" ? set({ sharedScope: e.target.value, scope: "global" }) : set({ sharedScope: undefined, scope: /** @type {Draft["scope"]} */ (e.target.value), scopeValue: undefined }))}>
              <option value="global">This workspace</option>
              <option value="project">One project</option>
              {orgAdmin && !r.id && <option value="organization">Every workspace in the organisation</option>}
              {orgAdmin && !r.id && <option value="workspaces">Some workspaces…</option>}
              {r.id && r.sharedScope && <option value={r.sharedScope}>{r.sharedScope === "organization" ? "Every workspace" : "Some workspaces"}</option>}
            </select>
          </label>
          {r.scope === "project" && !r.sharedScope && (
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
          <label className="field">
            <span>Owner (told if it keeps failing)</span>
            <select value={r.ownerId ?? ""} onChange={(e) => set({ ownerId: e.target.value || undefined })}>
              <option value="">You</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {r.sharedScope === "workspaces" && !r.id && (
          <fieldset className="field checks">
            <legend>Workspaces</legend>
            {workspaces.map((w) => (
              <label key={w.id} className="wi-check">
                <input
                  type="checkbox"
                  checked={(r.sharedWorkspaces ?? []).includes(w.id)}
                  onChange={(e) => set({ sharedWorkspaces: e.target.checked ? [...(r.sharedWorkspaces ?? []), w.id] : (r.sharedWorkspaces ?? []).filter((x) => x !== w.id) })}
                />{" "}
                {w.name}
              </label>
            ))}
          </fieldset>
        )}
      </fieldset>

      <fieldset className="rule-part rule-if">
        <legend>If</legend>
        <ConditionGroupEditor group={/** @type {ConditionGroup} */ (r.conditions)} depth={1} ctx={ctx} onChange={(g) => set({ conditions: g })} />
        <button className="link-btn" onClick={() => setShowPql(!showPql)} aria-expanded={showPql}>
          {showPql ? "Hide the PQL condition" : "Or write a condition in PQL (advanced)"}
        </button>
        {showPql && (
          <label className="field">
            <span>PQL (as well as the conditions above)</span>
            <input value={r.conditionPql} onChange={(e) => set({ conditionPql: e.target.value })} placeholder="type = Bug AND priority = Highest" spellCheck={false} className="mono" />
          </label>
        )}
        <p className="field-hint">{BULK_TRIGGERS.includes(r.trigger) ? "The rule acts on every work item these pick." : "The rule acts only when the item matches."}</p>
      </fieldset>

      <fieldset className="rule-part rule-then">
        <legend>Then</legend>
        <ol className="action-list">
          {r.actions.map((a, i) => (
            <li key={i}>
              <div className="field-row">
                <label className="field">
                  <span>Action {i + 1}</span>
                  <select
                    value={a.kind}
                    onChange={(e) => {
                      const kind = /** @type {ActionKind} */ (e.target.value);
                      setAction(i, { kind, field: undefined, value: JSON_ACTIONS.includes(kind) ? "{}" : "", value2: kind === "notify" ? "bell" : undefined });
                    }}
                  >
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
        <p className="field-hint">
          Smart values for comments, emails, messages and webhooks:{" "}
          {PLACEHOLDERS.map((p) => (
            <button key={p} type="button" className="smart-value" title="Copy" onClick={() => navigator.clipboard?.writeText(p)}>
              {p} <Copy size={10} aria-hidden="true" />
            </button>
          ))}
          {r.trigger === "webhook" && " and {{webhook.<name>}} for the call's values."}
        </p>
      </fieldset>

      <label className="field narrow">
        <span>Most runs a minute</span>
        <input type="number" min={1} max={100} value={r.maxPerMinute} onChange={(e) => set({ maxPerMinute: Number(e.target.value) || 10 })} />
      </label>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        {r.id && (
          <button
            className="delete-link inline"
            onClick={async () => {
              if (!(await ask({ title: `Delete "${r.name}"?`, body: r.sharedScope ? "It goes from every workspace it's in, with its run logs." : "Its run log goes too.", confirm: "Delete", danger: true }))) return;
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
        <button className="btn btn-ghost" onClick={() => setTesting(true)} disabled={!r.name.trim()}>
          <FlaskConical size={14} /> Test
        </button>
        <button className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-amber" onClick={save} disabled={busy || !r.name.trim()}>
          {busy ? "Saving…" : "Save rule"}
        </button>
      </div>
      {testing && <TestDialog rule={/** @type {Draft} */ (body())} draft onClose={() => setTesting(false)} />}
    </div>
  );
}
/** @typedef {Omit<AutomationRule, "id" | "lastRunAt" | "lastStatus" | "ownerName"> & { id?: string; newWebhookAddress?: boolean }} Draft */
/**
 * @typedef {{ types: { id: string; name: string }[]; statuses: StatusDef[]; users: User[]; fields: CustomField[] }} PickerContext
 * @typedef {Object} Props
 * @property {User[]} users
 * @property {System[]} systems
 * @property {string[]} [workspaces]
 * @property {number} now
 * @property {boolean} [orgAdmin]
 */
