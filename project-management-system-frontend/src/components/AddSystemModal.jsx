/** @import { Health, Status, System } from '../data/systems' */
/** @import { User } from '../data/roles' */
/** @import { ProjectTemplate } from '../data/templates' */
/** @import { Pcn } from '../data/pcn' */
import { useEffect, useState } from "react";
import { ArrowLeft, FilePlus2, FileText, LayoutTemplate, Trash2, X } from "lucide-react";
import { STATUS_META } from "../data/systems";
import { templateDueDate } from "../data/templates";
import DeveloperPicker from "./DeveloperPicker";
import { emptyPcn, pcnMissing } from "../data/pcn";
import { PcnForm } from "./Pcn";
import { KEY_PATTERN, suggestKey } from "../data/workitems";
/**
 * @returns {string}
 */
const today = () => new Date().toISOString().slice(0, 10);
/**
 * @param {Props} props
 */
export default function AddSystemModal({ workspaces, initialWorkspace = "", users, systems, limit, templates, me, proposeOnly = false, error, onSave, onDeleteTemplate, onClose }) {
  // First choose how to start: a Concept Note, blank, or a template that prefills the form.
  const [step, setStep] = useState(/** @type {"start" | "form" | "pcn" | (() => "start" | "form" | "pcn")} */ (proposeOnly ? "pcn" : "start"));
  // The PCN goes to the Managers for sign-off by default.
  const [pcn, setPcn] = useState(
    /** @type {Pcn | (() => Pcn)} */ (
      () =>
        emptyPcn(
          me.name,
          today(),
          users.filter((u) => u.role === "manager"),
        )
    ),
  );
  const [template, setTemplate] = useState(/** @type {ProjectTemplate | null | (() => ProjectTemplate | null)} */ (null));
  const [dueFromTemplate, setDueFromTemplate] = useState(false); // due date still the template's suggestion
  const [deleting, setDeleting] = useState(/** @type {string | null | (() => string | null)} */ (null));
  const [name, setName] = useState("");
  // The project key: suggested from the name until someone types their own.
  const [keyDraft, setKeyDraft] = useState(/** @type {string | null | (() => string | null)} */ (null));
  const takenKeys = systems.map((s) => s.key ?? "");
  const key = keyDraft ?? (name.trim() ? suggestKey(name, takenKeys) : "");
  const keyProblem = !key ? "" : !KEY_PATTERN.test(key) ? "2 to 10 capital letters" : takenKeys.includes(key) ? `${key} is taken by another project` : "";
  const [description, setDescription] = useState("");
  const [workspace, setWorkspace] = useState(workspaces.includes(initialWorkspace) ? initialWorkspace : (workspaces[0] ?? ""));
  const [url, setUrl] = useState("");
  const [lead, setLead] = useState("");
  const [developers, setDevelopers] = useState(/** @type {string[] | (() => string[])} */ ([]));
  const [status, setStatus] = useState(/** @type {Status | (() => Status)} */ ("WIP"));
  const [progress, setProgress] = useState(0);
  const [startedAt, setStartedAt] = useState(today());
  const [dueAt, setDueAt] = useState("");
  const [finishedAt, setFinishedAt] = useState(today());
  const [health, setHealth] = useState(/** @type {Health | (() => Health)} */ ("Stable"));
  // Live / completed systems are delivered; everything else is still scheduled.
  const delivered = status === "LIVE" || status === "COMPLETED";
  useEffect(() => {
    const onKey = /** @param {KeyboardEvent} e */ (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const pickStatus = /** @param {Status} s */ (s) => {
    setStatus(s);
    if (s === "LIVE" || s === "COMPLETED") setProgress(100);
  };
  const begin = /** @param {ProjectTemplate | null} t */ (t) => {
    setTemplate(t);
    setDescription(t?.description ?? "");
    pickStatus(t?.status ?? "WIP");
    setProgress(t?.progress ?? 0);
    setDueAt(t ? templateDueDate(t, startedAt) : "");
    setDueFromTemplate(!!t?.durationWeeks);
    setStep("form");
  };
  // Moving the start date moves a due date the template suggested, keeping the same duration.
  const changeStart = /** @param {string} v */ (v) => {
    setStartedAt(v);
    if (template && dueFromTemplate) setDueAt(templateDueDate(template, v));
  };
  if (step === "pcn") {
    // Everything but the signatories is needed to submit; without signatories it stays a draft.
    const missing = pcnMissing(pcn).filter((m) => !m.startsWith("4."));
    return (
      <div className="backdrop modal-backdrop" onClick={onClose}>
        <form
          className="modal modal-wide pcn-modal"
          role="dialog"
          aria-label="Project Concept Note"
          onClick={(e) => e.stopPropagation()}
          onSubmit={(e) => {
            e.preventDefault();
            if (missing.length) return;
            const start = pcn.proposedDates.find((d) => d) ?? today();
            onSave({
              name: pcn.title.trim(),
              description: pcn.concept.trim(),
              status: "IDEA",
              progress: 0,
              startedAt: start,
              template: "Project Concept Note",
              developers: [],
              pcn: { ...pcn, proposedDates: pcn.proposedDates.filter((d) => d) },
            });
          }}
        >
          <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
          <button type="button" className="modal-back" onClick={onClose} aria-label="Back to the previous page (nothing is saved)">
            <ArrowLeft size={16} aria-hidden="true" /> Back
          </button>
          <h2>Project Concept Note</h2>
          <p className="modal-note">
            OmniContact BPO's PCN for proposing a new project. It's saved as an <b>Idea</b>; once every signatory approves through Econet, it moves on to planning.
            {!proposeOnly && (
              <>
                {" "}
                <button type="button" className="link-btn" onClick={() => setStep("start")}>
                  <ArrowLeft size={13} /> Other ways to start
                </button>
              </>
            )}
          </p>
          <PcnForm value={pcn} onChange={setPcn} users={users} />
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-amber" disabled={missing.length > 0}>
              Submit PCN
            </button>
          </div>
        </form>
      </div>
    );
  }
  if (step === "start") {
    return (
      <div className="backdrop modal-backdrop" onClick={onClose}>
        <div className="modal modal-wide start-modal" role="dialog" aria-label="Add a system" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
          <button type="button" className="modal-back" onClick={onClose} aria-label="Back to the previous page (nothing is saved)">
            <ArrowLeft size={16} aria-hidden="true" /> Back
          </button>
          <h2>Add a system</h2>
          <p className="modal-note">How do you want to start?</p>

          <button type="button" className="start-option pcn" onClick={() => setStep("pcn")} autoFocus>
            <span className="start-icon">
              <FileText size={20} />
            </span>
            <span className="start-text">
              <b>Project Concept Note (PCN)</b>
              <small>For a new idea that needs approval: fill in the OmniContact PCN and track sign-off from its signatories.</small>
            </span>
          </button>

          <button type="button" className="start-option blank" onClick={() => begin(null)}>
            <span className="start-icon">
              <FilePlus2 size={20} />
            </span>
            <span className="start-text">
              <b>Start blank</b>
              <small>An empty form; fill in everything yourself.</small>
            </span>
          </button>

          <h3 className="start-head">
            <LayoutTemplate size={16} /> Start from a template
          </h3>
          {templates.length ? (
            <ul className="start-templates">
              {templates.map((t) => (
                <li key={t.id}>
                  {deleting === t.id ? (
                    <div className="start-option confirming">
                      <span className="start-text">
                        <b>Delete "{t.name}"?</b>
                        <small>Projects already made from it are not affected.</small>
                      </span>
                      <button type="button" className="btn btn-ghost sm" onClick={() => setDeleting(null)}>
                        Cancel
                      </button>
                      <button type="button" className="btn btn-danger sm" onClick={() => onDeleteTemplate(t.id).then(() => setDeleting(null))}>
                        Delete
                      </button>
                    </div>
                  ) : (
                    <div className="start-row">
                      <button type="button" className="start-option" onClick={() => begin(t)}>
                        <span className="start-text">
                          <b>{t.name}</b>
                          {t.summary && <small>{t.summary}</small>}
                          <small className="start-meta">
                            Starts as {STATUS_META[t.status].label}
                            {t.durationWeeks ? ` · about ${t.durationWeeks} week${t.durationWeeks === 1 ? "" : "s"}` : " · no due date"}
                            {t.createdBy ? ` · saved by ${users.find((u) => u.id === t.createdBy)?.name ?? "a colleague"}` : ""}
                          </small>
                        </span>
                      </button>
                      <button type="button" className="icon-link danger" title={`Delete the "${t.name}" template`} aria-label={`Delete the ${t.name} template`} onClick={() => setDeleting(t.id)}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="lead-none">No templates yet. Save one from any project's page with "Save as template".</p>
          )}
          {error && <p className="form-error">{error}</p>}
        </div>
      </div>
    );
  }
  return (
    <div className="backdrop modal-backdrop" onClick={onClose}>
      <form
        className="modal modal-wide"
        role="dialog"
        aria-label="Add a system"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (keyProblem) return;
          onSave({
            name: name.trim(),
            ...(key ? { key } : {}),
            description: description.trim(),
            url: url.trim(),
            ...(workspace ? { workspace } : {}),
            ...(lead ? { lead } : {}),
            developers,
            ...(template ? { template: template.name } : {}),
            status,
            progress,
            startedAt,
            ...(delivered ? { finishedAt, health } : dueAt ? { dueAt: `${dueAt}T17:00:00` } : {}),
          });
        }}
      >
        <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <button type="button" className="modal-back" onClick={onClose} aria-label="Back to the previous page (nothing is saved)">
          <ArrowLeft size={16} aria-hidden="true" /> Back
        </button>
        <h2>Add a system</h2>
        <div className="start-chosen">
          {template ? (
            <>
              <LayoutTemplate size={15} /> From template: <b>{template.name}</b>
            </>
          ) : (
            <>
              <FilePlus2 size={15} /> Blank project
            </>
          )}
          <button type="button" className="link-btn" onClick={() => setStep("start")}>
            <ArrowLeft size={13} /> Change
          </button>
        </div>

        <label className="field">
          <span>Name</span>
          <input required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Leave Planner" />
        </label>

        <label className="field">
          <span>Key</span>
          <input
            className="mono"
            value={key}
            onChange={(e) =>
              setKeyDraft(
                e.target.value
                  .toUpperCase()
                  .replace(/[^A-Z]/g, "")
                  .slice(0, 10),
              )
            }
            placeholder="e.g. LP"
            aria-describedby="key-hint"
            aria-invalid={!!keyProblem}
          />
          <small id="key-hint" className={keyProblem ? "form-error" : "field-hint"}>
            {keyProblem || `Its work items will be numbered ${key || "KEY"}-1, ${key || "KEY"}-2… You can change the key until the first one exists.`}
          </small>
        </label>

        <label className="field">
          <span>Workspace</span>
          <select value={workspace} onChange={(e) => setWorkspace(e.target.value)}>
            {workspaces.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Description</span>
          <textarea rows={template ? 5 : 2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does it do?" />
        </label>

        <div className="field-row">
          <label className="field">
            <span>Status</span>
            <select value={status} onChange={(e) => pickStatus(/** @type {Status} */ (e.target.value))}>
              {/** @type {Status[]} */ (Object.keys(STATUS_META)).map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Project lead</span>
            <select value={lead} onChange={(e) => setLead(e.target.value)}>
              <option value="">Not assigned yet</option>
              {users.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.title ? ` · ${p.title}` : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="field">
          <span>Developers {developers.length > 0 && <b>{developers.length}</b>}</span>
          <DeveloperPicker users={users} systems={systems} value={developers} limit={limit} onChange={setDevelopers} />
        </div>

        <label className="field">
          <span>
            Progress <b>{progress}%</b>
          </span>
          <input type="range" min={0} max={100} step={5} value={progress} onChange={(e) => setProgress(+e.target.value)} />
        </label>

        <div className="field-row">
          <label className="field">
            <span>Start date</span>
            <input type="date" required value={startedAt} onChange={(e) => changeStart(e.target.value)} />
          </label>
          {delivered ? (
            <label className="field">
              <span>Delivered on</span>
              <input type="date" required value={finishedAt} min={startedAt} onChange={(e) => setFinishedAt(e.target.value)} />
            </label>
          ) : (
            <label className="field">
              <span>Due date</span>
              <input
                type="date"
                value={dueAt}
                min={startedAt}
                onChange={(e) => {
                  setDueAt(e.target.value);
                  setDueFromTemplate(false);
                }}
              />
            </label>
          )}
        </div>

        <div className="field-row">
          <label className="field">
            <span>Address (URL)</span>
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.198.160:8087" />
          </label>
          {delivered && (
            <label className="field">
              <span>Health</span>
              <select value={health} onChange={(e) => setHealth(/** @type {Health} */ (e.target.value))}>
                <option value="Stable">Stable</option>
                <option value="Maintenance">Maintenance</option>
              </select>
            </label>
          )}
        </div>

        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-amber">
            Add system
          </button>
        </div>
      </form>
    </div>
  );
}
/**
 * @typedef {Object} Props
 * @property {string[]} workspaces
 * @property {string} [initialWorkspace]
 * @property {User[]} users
 * @property {System[]} systems
 * @property {number} limit
 * @property {ProjectTemplate[]} templates
 * @property {User} me
 * @property {boolean} [proposeOnly]
 * @property {string} [error]
 * @property {(s: Partial<System> & { developers: string[] }) => void} onSave
 * @property {(id: string) => Promise<void>} onDeleteTemplate
 * @property {() => void} onClose
 */
