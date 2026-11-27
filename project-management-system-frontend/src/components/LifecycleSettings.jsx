/** @import { User } from '../data/roles' */
/** @import { Actor, Criterion, CriterionKind, Signatory, Stage, StageType, TemplateDefinition } from '../data/lifecycle' */
// Settings → Organisation → Project Lifecycle (Organisation Administrators): the organisation's lifecycle templates.
// A template is edited as a draft (drag stages to reorder; each stage's type, phase, responsible roles, target,
// weight, exit criteria, deliverables, sign-offs and moves), then published as a new version. Projects stay on the
// version they started with. The Worker checks every template again (src/data/lifecycle.js cleanTemplate).
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Copy, GripVertical, Milestone, Plus, Star, Trash2 } from "lucide-react";
import { api } from "../data/api";
import { ACTOR_LABEL, CRITERION_KINDS, STAGE_TYPES, STAGE_TYPE_LABEL, cleanTemplate } from "../data/lifecycle";
import Panel from "./Panel";
import { Help, useToast } from "./AdminKit";

/** @typedef {{ id: string; familyId: string; version: number; status: "draft" | "published" | "archived"; isDefault: boolean; name: string; definition: TemplateDefinition; projects: number; publishedAt: string | null }} TemplateView */

const KIND_LABEL = /** @type {Record<CriterionKind, string>} */ ({
  checklist: "Checklist item",
  deliverable: "Document attached",
  linked: "Document linked to another",
  signoffs: "All signatories approve",
  pcn_complete: "Concept Note complete",
  risk_register: "Risk register has entries",
  risks_mitigated: "High/Critical risks mitigated",
  work_items_done: "Work items done",
  environments: "Environments verified",
  security_clear: "No open security findings",
  test_pass_rate: "Test pass rate",
  no_open_bugs: "No open bugs",
  change_approved: "Change request approved",
  deployment_recorded: "Deployment recorded",
});
const ACTORS = /** @type {Actor[]} */ (["lead", "manager", "admin", "team_lead", "assistant", "developer", "stageOwner"]);

/** @param {{ users: User[] }} p */
export default function LifecycleSettings({ users }) {
  const toast = useToast();
  const [list, setList] = useState(/** @type {TemplateView[] | null} */ (null));
  const [open, setOpen] = useState(/** @type {TemplateView | null} */ (null));
  const [def, setDef] = useState(/** @type {TemplateDefinition | null} */ (null));
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () =>
    api("/lifecycle/templates")
      .then((r) => setList(/** @type {{ templates: TemplateView[] }} */ (r).templates))
      .catch((e) => toast(e instanceof Error ? e.message : "Couldn't load the lifecycles", false));
  useEffect(() => void load(), []);
  const edit = (/** @type {TemplateView} */ t) => {
    setOpen(t);
    setDef(structuredClone(t.definition));
    setName(t.name);
  };
  /** @param {string} path @param {string} method @param {unknown} [body] @param {string} [done] */
  const call = async (path, method, body, done) => {
    setBusy(true);
    try {
      const r = /** @type {{ template: TemplateView }} */ (await api(path, method, body));
      await load();
      if (r.template) edit(r.template);
      if (done) toast(done);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't do that", false);
    } finally {
      setBusy(false);
    }
  };
  /** The draft as the server would check it: the first problem, or null. */
  let problem = null;
  try {
    if (def) cleanTemplate(def);
  } catch (e) {
    problem = e instanceof Error ? e.message : "Not valid";
  }
  const families = [...new Set((list ?? []).map((t) => t.familyId))];

  return (
    <Panel title="Project Lifecycle" icon={Milestone}>
      <Help>
        The stages every project goes through, with their gates, sign-offs and targets (in business days). The default lifecycle is given to new projects; a
        project keeps the version it started with. Edit a draft, then publish it as a new version.
      </Help>
      {!list ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <table className="lc-table lcs-list">
            <thead>
              <tr>
                <th>Lifecycle</th>
                <th>Versions</th>
                <th>Projects</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {families.map((f) => {
                const versions = /** @type {TemplateView[]} */ (list).filter((t) => t.familyId === f).sort((a, b) => b.version - a.version);
                const live = versions.find((t) => t.status === "published");
                const draft = versions.find((t) => t.status === "draft");
                return (
                  <tr key={f}>
                    <td>
                      <b>{(live ?? draft ?? versions[0]).name}</b> {live?.isDefault && <span className="lc-pill ok">Default</span>}
                    </td>
                    <td>
                      {live ? `v${live.version} published` : "Not published"}
                      {draft ? ` · v${draft.version} draft` : ""}
                    </td>
                    <td>{versions.reduce((a, t) => a + t.projects, 0)}</td>
                    <td className="lc-row">
                      {draft ? (
                        <button className="btn btn-ghost sm" onClick={() => edit(draft)}>
                          Edit draft
                        </button>
                      ) : (
                        live && (
                          <button className="btn btn-ghost sm" disabled={busy} onClick={() => call(`/lifecycle/templates/${live.id}/draft`, "POST", {})}>
                            <Copy size={13} aria-hidden="true" /> New draft
                          </button>
                        )
                      )}
                      {live && !live.isDefault && (
                        <button className="btn btn-ghost sm" disabled={busy} onClick={() => call(`/lifecycle/templates/${live.id}/default`, "POST", {}, `${live.name} is now the default for new projects.`)}>
                          <Star size={13} aria-hidden="true" /> Make default
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="lc-row">
            <button className="btn btn-ghost sm" disabled={busy} onClick={() => call("/lifecycle/templates", "POST", { name: "Standard project lifecycle", from: "standard" }, "A draft of the standard 16 stages is ready to edit.")}>
              <Plus size={14} aria-hidden="true" /> New, from the standard 16 stages
            </button>
          </div>
        </>
      )}

      {open && def && (
        <section className="lcs-editor" aria-label={`Editing ${name}`}>
          <header className="lc-row">
            <label className="field grow">
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </label>
            <span className="lc-pill info">
              v{open.version} {open.status}
            </span>
          </header>
          <Settings def={def} setDef={setDef} />
          <Stages def={def} setDef={setDef} users={users} />
          {problem && <p className="form-error">{problem}</p>}
          <div className="lc-row">
            <button className="btn btn-ghost sm" disabled={busy || !!problem || open.status !== "draft"} onClick={() => call(`/lifecycle/templates/${open.id}`, "PUT", { name, definition: def }, "The draft is saved.")}>
              Save draft
            </button>
            <button
              className="btn btn-navy sm"
              disabled={busy || !!problem || open.status !== "draft"}
              onClick={async () => {
                await call(`/lifecycle/templates/${open.id}`, "PUT", { name, definition: def });
                await call(`/lifecycle/templates/${open.id}/publish`, "POST", {}, `Version ${open.version} is published. New projects get it; existing ones keep their version.`);
              }}
            >
              Publish v{open.version}
            </button>
            <button className="btn btn-ghost sm" onClick={() => setOpen(null)}>
              Close
            </button>
          </div>
        </section>
      )}
    </Panel>
  );
}

/** @param {{ def: TemplateDefinition; setDef: (d: TemplateDefinition) => void }} p */
function Settings({ def, setDef }) {
  const s = def.settings;
  const set = (/** @type {Partial<TemplateDefinition["settings"]>} */ x) => setDef({ ...def, settings: { ...s, ...x } });
  return (
    <div className="lcs-settings org-grid">
      <label className="lc-check">
        <input type="checkbox" checked={!s.selfSignoff} onChange={(e) => set({ selfSignoff: !e.target.checked })} />
        <span>
          Segregation of duties
          <small>Whoever submitted a document can't sign it off.</small>
        </span>
      </label>
      <label className="field">
        Remind pending signatories after (business days)
        <input type="number" min={1} max={30} value={s.signoffReminderDays} onChange={(e) => set({ signoffReminderDays: Number(e.target.value) })} />
      </label>
      <label className="field">
        Progress from the lifecycle: {Math.round(s.progress.lifecycleWeight * 100)}% (the rest from work items)
        <input type="range" min={0} max={1} step={0.05} value={s.progress.lifecycleWeight} onChange={(e) => set({ progress: { lifecycleWeight: Number(e.target.value) } })} />
      </label>
      <label className="field">
        Status when closed
        <select value={s.onClose.status} onChange={(e) => set({ onClose: { status: e.target.value } })}>
          <option value="LIVE">Live</option>
          <option value="COMPLETED">Completed</option>
        </select>
      </label>
    </div>
  );
}

/**
 * The stages, in order: drag (or the arrows) to reorder; open one to edit it.
 * @param {{ def: TemplateDefinition; setDef: (d: TemplateDefinition) => void; users: User[] }} p
 */
function Stages({ def, setDef, users }) {
  const [openCode, setOpenCode] = useState("");
  const [drag, setDrag] = useState(-1);
  const move = (/** @type {number} */ from, /** @type {number} */ to) => {
    if (to < 0 || to >= def.stages.length || from === to) return;
    const stages = def.stages.slice();
    const [s] = stages.splice(from, 1);
    stages.splice(to, 0, s);
    setDef({ ...def, stages });
  };
  const setStage = (/** @type {number} */ i, /** @type {Partial<Stage>} */ x) => setDef({ ...def, stages: def.stages.map((s, j) => (j === i ? { ...s, ...x } : s)) });
  return (
    <div className="lcs-stages">
      <h4>Stages ({def.stages.length}) · weights add up to {def.stages.reduce((a, s) => a + s.weight, 0)}</h4>
      <ol>
        {def.stages.map((s, i) => (
          <li
            key={s.code}
            className={`lcs-stage ${drag === i ? "dragging" : ""}`}
            draggable
            onDragStart={() => setDrag(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              move(drag, i);
              setDrag(-1);
            }}
            onDragEnd={() => setDrag(-1)}
          >
            <div className="lcs-stage-head">
              <GripVertical size={16} className="lcs-grip" aria-hidden="true" />
              <b>
                {i + 1}. {s.name}
              </b>
              <span className="lc-pill info">{def.phases.find((p) => p.code === s.phase)?.name}</span>
              <span className="lc-pill">{STAGE_TYPE_LABEL[s.type]}</span>
              <span className="muted small">{s.targetDays ? `${s.targetDays} days` : "no target"} · weight {s.weight}</span>
              <span className="lc-row">
                <button className="btn btn-ghost sm" aria-label={`Move ${s.name} up`} onClick={() => move(i, i - 1)}>
                  <ArrowUp size={13} />
                </button>
                <button className="btn btn-ghost sm" aria-label={`Move ${s.name} down`} onClick={() => move(i, i + 1)}>
                  <ArrowDown size={13} />
                </button>
                <button className="btn btn-ghost sm" onClick={() => setOpenCode(openCode === s.code ? "" : s.code)}>
                  {openCode === s.code ? "Done" : "Edit"}
                </button>
                <button className="btn btn-ghost sm" aria-label={`Remove ${s.name}`} disabled={def.stages.length < 2} onClick={() => setDef({ ...def, stages: def.stages.filter((_, j) => j !== i) })}>
                  <Trash2 size={13} />
                </button>
              </span>
            </div>
            {openCode === s.code && <StageEditor def={def} stage={s} index={i} set={(x) => setStage(i, x)} users={users} />}
          </li>
        ))}
      </ol>
      <button
        className="btn btn-ghost sm"
        onClick={() => {
          let n = def.stages.length + 1;
          while (def.stages.some((s) => s.code === `STAGE_${n}`)) n++;
          const last = def.stages[def.stages.length - 1];
          /** @type {Stage} */ const s = { code: `STAGE_${n}`, name: `New stage ${n}`, phase: last?.phase ?? def.phases[0].code, type: "work", responsible: ["lead"], ownerId: null, targetDays: 5, weight: 0, exit: [{ kind: "checklist", key: "done", label: "Done" }], deliverables: [], signoff: null, testing: null, deployment: null, transitions: { sendBackTo: [], canSkip: false }, automation: { onEnter: ["notify:responsible"], onExit: [], onOverdue: ["escalate:manager"] }, checklistAsWorkItems: false };
          setDef({ ...def, stages: [...def.stages, s] });
          setOpenCode(s.code);
        }}
      >
        <Plus size={14} aria-hidden="true" /> Add a stage
      </button>
    </div>
  );
}

/**
 * One stage's settings, gates and sign-offs.
 * @param {{ def: TemplateDefinition; stage: Stage; index: number; set: (x: Partial<Stage>) => void; users: User[] }} p
 */
function StageEditor({ def, stage, index, set, users }) {
  const earlier = def.stages.slice(0, index);
  const setExit = (/** @type {number} */ i, /** @type {Partial<Criterion>} */ x) => set({ exit: stage.exit.map((c, j) => (j === i ? /** @type {Criterion} */ ({ ...c, ...x }) : c)) });
  const sigs = stage.signoff?.signatories ?? [];
  const setSigs = (/** @type {Signatory[]} */ list) => set({ signoff: { ...(stage.signoff ?? { onDecline: stage.code }), signatories: list } });
  return (
    <div className="lcs-edit">
      <div className="org-grid">
        <label className="field">
          Name
          <input value={stage.name} onChange={(e) => set({ name: e.target.value })} maxLength={60} />
        </label>
        <label className="field">
          Code
          <input value={stage.code} onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })} maxLength={30} />
        </label>
        <label className="field">
          Phase
          <select value={stage.phase} onChange={(e) => set({ phase: e.target.value })}>
            {def.phases.map((p) => (
              <option key={p.code} value={p.code}>
                {p.code} · {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Type
          <select value={stage.type} onChange={(e) => set({ type: /** @type {StageType} */ (e.target.value) })}>
            {STAGE_TYPES.map((t) => (
              <option key={t} value={t}>
                {STAGE_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Target (business days)
          <input type="number" min={1} max={365} value={stage.targetDays ?? ""} onChange={(e) => set({ targetDays: e.target.value ? Number(e.target.value) : null })} />
        </label>
        <label className="field">
          Progress weight
          <input type="number" min={0} max={100} value={stage.weight} onChange={(e) => set({ weight: Number(e.target.value) })} />
        </label>
        <label className="field">
          Named owner (optional)
          <select value={stage.ownerId ?? ""} onChange={(e) => set({ ownerId: e.target.value || null })}>
            <option value="">Nobody in particular</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="lcs-fs">
        <legend>Responsible</legend>
        {ACTORS.map((a) => (
          <label key={a} className="lc-check inline">
            <input type="checkbox" checked={stage.responsible.includes(a)} onChange={(e) => set({ responsible: e.target.checked ? [...stage.responsible, a] : stage.responsible.filter((x) => x !== a) })} />
            {ACTOR_LABEL[a]}
          </label>
        ))}
      </fieldset>
      <fieldset className="lcs-fs">
        <legend>Exit criteria (the gate)</legend>
        {stage.exit.map((c, i) => (
          <div key={i} className="lc-row lcs-crit">
            <select value={c.kind} onChange={(e) => setExit(i, { kind: /** @type {CriterionKind} */ (e.target.value) })} aria-label="Kind">
              {CRITERION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
            <input value={c.label} onChange={(e) => setExit(i, { label: e.target.value })} placeholder="What people see" aria-label="Label" maxLength={160} />
            {(c.kind === "checklist" || c.kind === "deliverable") && <input value={c.key ?? ""} onChange={(e) => setExit(i, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })} placeholder="key" aria-label="Key" className="short" />}
            {c.kind === "test_pass_rate" && (
              <>
                <input value={c.suite ?? "QAT"} onChange={(e) => setExit(i, { suite: e.target.value.toUpperCase() })} aria-label="Suite" className="short" />
                <input type="number" min={0} max={100} value={Math.round((c.min ?? 0.95) * 100)} onChange={(e) => setExit(i, { min: Number(e.target.value) / 100 })} aria-label="Pass rate %" className="short" />%
              </>
            )}
            {c.kind === "environments" && <input value={(c.required ?? []).join(", ")} onChange={(e) => setExit(i, { required: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} placeholder="Dev, QA, UAT, Prod" aria-label="Environments" />}
            <button className="btn btn-ghost sm" aria-label="Remove this criterion" onClick={() => set({ exit: stage.exit.filter((_, j) => j !== i) })}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        <button className="btn btn-ghost sm" onClick={() => set({ exit: [...stage.exit, { kind: "checklist", key: `item_${stage.exit.length + 1}`, label: "New checklist item" }] })}>
          <Plus size={13} aria-hidden="true" /> Add a criterion
        </button>
      </fieldset>
      <fieldset className="lcs-fs">
        <legend>Sign-off</legend>
        {stage.signoff?.source === "pcn_signatories" ? (
          <p className="muted">Signed by the Concept Note's own signatories.</p>
        ) : (
          <>
            {sigs.map((g, i) => (
              <div key={i} className="lc-row lcs-crit">
                <select
                  value={g.kind === "user" ? `user:${g.userId}` : `role:${g.role}`}
                  onChange={(e) => {
                    const [k, v] = e.target.value.split(":");
                    const next = k === "user" ? { kind: /** @type {const} */ ("user"), userId: v, name: users.find((u) => u.id === v)?.name ?? v, label: g.label } : { kind: /** @type {const} */ ("role"), role: v, label: g.label };
                    setSigs(sigs.map((x, j) => (j === i ? next : x)));
                  }}
                  aria-label="Signatory"
                >
                  <optgroup label="A named person">
                    {users.map((u) => (
                      <option key={u.id} value={`user:${u.id}`}>
                        {u.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Anyone with a role">
                    {ACTORS.filter((a) => a !== "lead" && a !== "stageOwner").map((a) => (
                      <option key={a} value={`role:${a}`}>
                        Any {ACTOR_LABEL[a]}
                      </option>
                    ))}
                  </optgroup>
                </select>
                <input value={g.label} onChange={(e) => setSigs(sigs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="Signs as (e.g. Business owner)" aria-label="Signs as" />
                {g.kind === "user" && (
                  <select value={g.alternate?.userId ?? ""} onChange={(e) => setSigs(sigs.map((x, j) => (j === i ? { ...x, alternate: e.target.value ? { userId: e.target.value, name: users.find((u) => u.id === e.target.value)?.name ?? e.target.value } : undefined } : x)))} aria-label="Alternate">
                    <option value="">No alternate</option>
                    {users
                      .filter((u) => u.id !== g.userId)
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          Alternate: {u.name}
                        </option>
                      ))}
                  </select>
                )}
                <button className="btn btn-ghost sm" aria-label="Remove this signatory" onClick={() => setSigs(sigs.filter((_, j) => j !== i))}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            <div className="lc-row">
              <button className="btn btn-ghost sm" onClick={() => setSigs([...sigs, { kind: "role", role: "manager", label: "Manager" }])}>
                <Plus size={13} aria-hidden="true" /> Add a signatory
              </button>
              {stage.signoff && (
                <>
                  <label>
                    A decline sends it back to{" "}
                    <select value={stage.signoff.onDecline} onChange={(e) => set({ signoff: { ...(/** @type {NonNullable<Stage["signoff"]>} */ (stage.signoff)), onDecline: e.target.value } })}>
                      <option value={stage.code}>This stage</option>
                      {earlier.map((s) => (
                        <option key={s.code} value={s.code}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="btn btn-ghost sm" onClick={() => set({ signoff: null, exit: stage.exit.filter((c) => c.kind !== "signoffs") })}>
                    No sign-off
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </fieldset>
      <fieldset className="lcs-fs">
        <legend>Moves</legend>
        <span className="small">Can send back to:</span>
        {earlier.map((s) => (
          <label key={s.code} className="lc-check inline">
            <input
              type="checkbox"
              checked={stage.transitions.sendBackTo.includes(s.code)}
              onChange={(e) => set({ transitions: { ...stage.transitions, sendBackTo: e.target.checked ? [...stage.transitions.sendBackTo, s.code] : stage.transitions.sendBackTo.filter((x) => x !== s.code) } })}
            />
            {s.name}
          </label>
        ))}
        <label className="lc-check inline">
          <input type="checkbox" checked={stage.transitions.canSkip} onChange={(e) => set({ transitions: { ...stage.transitions, canSkip: e.target.checked } })} />
          Can be skipped (with a Manager's or Administrator's approval)
        </label>
        <label className="lc-check inline">
          <input type="checkbox" checked={stage.checklistAsWorkItems} onChange={(e) => set({ checklistAsWorkItems: e.target.checked })} />
          Create the checklist as work items on entering
        </label>
      </fieldset>
    </div>
  );
}
