/** @import { ReactNode } from 'react' */
/** @import { System } from '../data/systems' */
/** @import { User } from '../data/roles' */
/** @import { Pcn, Signatory, SignoffStatus } from '../data/pcn' */
import OrgMark from "./OrgMark";
import { currentBranding } from "../brandTheme";
import { organisationName } from "../data/tenant";
import { useState } from "react";
import { ArrowLeft, Check, CheckCircle2, CircleSlash, FileText, Plus, Printer, Trash2, X } from "lucide-react";
import { ROLE_LABEL } from "../data/roles";
import { PCN_STATUS_META, PCN_TYPES, PILLARS, pcnMissing, pcnStatus } from "../data/pcn";
import { formatDate } from "../time";
const EXTERNAL = "__external__";
/** @type {User["role"][]} */ const SIGNER_ORDER = ["manager", "admin", "team_lead", "assistant", "developer", "viewer", "reader"];
/**
 * @param {{ n: string; title: string; children: ReactNode }} props
 */
function Section({ n, title, children }) {
  return (
    <section className="pcn-section">
      <header>
        <span className="pcn-n">{n}</span>
        <h3>{title}</h3>
      </header>
      <div className="pcn-body">{children}</div>
    </section>
  );
}
/**
 * The PCN as a form, section by section like the paper template. `lockSignoffs` keeps approval
 * statuses read-only (they're recorded by managers as approvals arrive through Econet).
 * @param {{ value: Pcn; onChange: (p: Pcn) => void; users: User[] }} props
 */
export function PcnForm({ value, onChange, users }) {
  // Managers first: a PCN goes to them for sign-off by default.
  const signers = [...users].sort((a, b) => SIGNER_ORDER.indexOf(a.role) - SIGNER_ORDER.indexOf(b.role) || a.name.localeCompare(b.name));
  // Rows where "Someone without an account" was chosen, so their name box shows while still empty.
  const [external, setExternal] = useState(/** @type {Set<number> | (() => Set<number>)} */ (() => new Set()));
  const set = /** @template {keyof Pcn} K @param {K} k @param {Pcn[K]} v */ (k, v) => onChange({ ...value, [k]: v });
  const setSignatory = /** @param {number} i @param {Partial<Signatory>} patch */ (i, patch) =>
    set(
      "signatories",
      value.signatories.map((s, j) => (j === i ? { ...s, ...patch } : patch.primary ? { ...s, primary: false } : s)),
    );
  const missing = pcnMissing(value);
  return (
    <div className="pcn-form">
      <div className="field-row">
        <label className="field">
          <span>PCN title</span>
          <input required autoFocus maxLength={200} value={value.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Digital leave applications" />
        </label>
        <label className="field">
          <span>PCN originator</span>
          <input maxLength={120} value={value.originator} onChange={(e) => set("originator", e.target.value)} />
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          <span>Date</span>
          <input type="date" value={value.date} onChange={(e) => set("date", e.target.value)} />
        </label>
        <label className="field">
          <span>Type of PCN</span>
          <select value={value.type} onChange={(e) => set("type", e.target.value)}>
            {PCN_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>

      <Section n="1" title="Concept details / mechanics">
        <label className="field">
          <span>1.1 Background</span>
          <textarea rows={3} value={value.background} onChange={(e) => set("background", e.target.value)} placeholder="What prompted this? What happens today?" />
        </label>
        <label className="field">
          <span>1.2 Concept description</span>
          <textarea rows={3} value={value.concept} onChange={(e) => set("concept", e.target.value)} placeholder="What is being proposed?" />
        </label>
        <label className="field">
          <span>1.3 Mechanics</span>
          <textarea rows={3} value={value.mechanics} onChange={(e) => set("mechanics", e.target.value)} placeholder="How will it work, step by step? Who does what?" />
        </label>
      </Section>

      <Section n="2" title="Strategic objectives / benefits">
        <label className="field">
          <span>2.1 Objectives</span>
          <textarea rows={3} value={value.objectives} onChange={(e) => set("objectives", e.target.value)} placeholder="What will it achieve? How will we know?" />
        </label>
        <label className="field">
          <span>2.2 Main strategic pillar</span>
          <select value={value.mainPillar} onChange={(e) => set("mainPillar", e.target.value)}>
            <option value="">Choose an item</option>
            {PILLARS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <div className="field">
          <span>2.3 Supporting strategic pillars</span>
          <div className="pcn-pillars">
            {PILLARS.filter((p) => p !== value.mainPillar).map((p) => (
              <label key={p} className="mfa-check">
                <input type="checkbox" checked={value.supportingPillars.includes(p)} onChange={() => set("supportingPillars", value.supportingPillars.includes(p) ? value.supportingPillars.filter((x) => x !== p) : [...value.supportingPillars, p])} />
                {p}
              </label>
            ))}
          </div>
        </div>
      </Section>

      <Section n="3" title="Proposed date">
        {value.proposedDates.map((d, i) => (
          <div key={i} className="pcn-date">
            <span>{i + 1}.</span>
            <input
              type="date"
              value={d}
              onChange={(e) =>
                set(
                  "proposedDates",
                  value.proposedDates.map((x, j) => (j === i ? e.target.value : x)),
                )
              }
            />
            {value.proposedDates.length > 1 && (
              <button
                type="button"
                className="icon-link danger"
                aria-label="Remove date"
                onClick={() =>
                  set(
                    "proposedDates",
                    value.proposedDates.filter((_, j) => j !== i),
                  )
                }
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
        {value.proposedDates.length < 5 && (
          <button type="button" className="link-btn" onClick={() => set("proposedDates", [...value.proposedDates, ""])}>
            <Plus size={13} /> Add another date
          </button>
        )}
        <small className="field-hint">The first date becomes the project's start date.</small>
      </Section>

      <Section n="4" title="PCN signatories">
        <div className="pcn-signers">
          {value.signatories.map((s, i) => (
            <div key={i} className="pcn-signer">
              <span className="pcn-n small">{i + 1}</span>
              <span className="pcn-who">
                <select
                  aria-label={`Signatory ${i + 1}`}
                  value={s.userId ?? (s.name || external.has(i) ? EXTERNAL : "")}
                  onChange={(e) => {
                    const v = e.target.value;
                    const u = signers.find((x) => x.id === v);
                    setExternal((x) => {
                      const n = new Set(x);
                      if (v === EXTERNAL) n.add(i);
                      else n.delete(i);
                      return n;
                    });
                    setSignatory(i, u ? { userId: u.id, name: u.name } : { userId: undefined, name: v === EXTERNAL && !s.userId ? s.name : "" });
                  }}
                >
                  <option value="">Choose a signatory…</option>
                  {signers.map((u) => (
                    <option key={u.id} value={u.id} disabled={value.signatories.some((o, j) => j !== i && o.userId === u.id)}>
                      {u.name} · {ROLE_LABEL[u.role]}
                    </option>
                  ))}
                  <option value={EXTERNAL}>Someone without an account…</option>
                </select>
                {!s.userId && (s.name || external.has(i)) && <input placeholder="Their name" maxLength={120} value={s.name} onChange={(e) => setSignatory(i, { name: e.target.value })} />}
              </span>
              <input placeholder="Remarks (optional)" maxLength={500} value={s.remarks} onChange={(e) => setSignatory(i, { remarks: e.target.value })} />
              <label className="mfa-check pcn-primary" title="Primary signatory">
                <input type="radio" name="pcn-primary" checked={s.primary} onChange={() => setSignatory(i, { primary: true })} /> Primary
              </label>
              {value.signatories.length > 1 && (
                <button
                  type="button"
                  className="icon-link danger"
                  aria-label={`Remove signatory ${i + 1}`}
                  onClick={() => {
                    set(
                      "signatories",
                      value.signatories.filter((_, j) => j !== i),
                    );
                    setExternal(new Set()); // row numbers shift; rows with a name keep their name box
                  }}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
        {value.signatories.length < 6 && (
          <button type="button" className="link-btn" onClick={() => set("signatories", [...value.signatories, { name: "", primary: false, remarks: "", status: "PENDING" }])}>
            <Plus size={13} /> Add a signatory
          </button>
        )}
        <p className="pcn-note">On submission the PCN goes to each signatory with an account: they approve or decline it from their Concept Notes page. For anyone without an account, share it through Econet and a manager records their decision. No hard-copy sign-off is needed.</p>
      </Section>

      {missing.length > 0 && <p className="form-warn">Still to fill in: {missing.join(", ")}.</p>}
    </div>
  );
}
/**
 * Summary and sign-off on a project's page (and in the Concept Notes list).
 * @param {{
 *   system: System & { pcn: Pcn };
 *   me: User;
 *   canRecord: boolean; // may record decisions for signatories without an account
 *   canEdit: boolean;
 *   canMoveOn: boolean; // may move an approved idea to Upcoming
 *   compact?: boolean; // in a list: link to the project instead of the full controls
 *   onSign: (index: number, decision: SignoffStatus, remarks?: string) => Promise<void>;
 *   onEdit?: () => void;
 *   onMoveOn?: () => Promise<void>;
 * }} arg4
 */
export function PcnCard({ system, me, canRecord, canEdit, canMoveOn, compact = false, onSign, onEdit, onMoveOn }) {
  const pcn = system.pcn;
  const status = pcnStatus(pcn);
  const meta = PCN_STATUS_META[status];
  const [busy, setBusy] = useState(false);
  const [deciding, setDeciding] = useState(/** @type {{ index: number; decision: SignoffStatus } | null | (() => { index: number; decision: SignoffStatus } | null)} */ (null));
  const [remarks, setRemarks] = useState("");
  const sign = /** @param {number} index @param {SignoffStatus} decision @param {string} [note] */ async (index, decision, note) => {
    setBusy(true);
    try {
      await onSign(index, decision, note);
      setDeciding(null);
      setRemarks("");
    } finally {
      setBusy(false);
    }
  };
  const approved = pcn.signatories.filter((s) => s.status === "APPROVED").length;
  const mine = pcn.signatories.findIndex((s) => s.userId === me.id && s.status === "PENDING");
  return (
    <section className={`p-card pcn-card ${status === "APPROVED" ? "pcn-ok" : status === "DECLINED" ? "p-card-alert" : ""} ${mine >= 0 && status !== "DECLINED" ? "pcn-yours" : ""}`}>
      <header className="p-card-head">
        <h3>
          <FileText size={17} /> {compact ? pcn.title : "Project Concept Note"}
        </h3>
        <div className="page-actions">
          {compact && (
            <a className="btn btn-ghost sm" href={`#/projects/${system.id}`}>
              Open project
            </a>
          )}
          <a className="btn btn-ghost sm" href={`#/projects/${system.id}/pcn`}>
            <Printer size={14} /> View / print
          </a>
          {canEdit && onEdit && (
            <button className="btn btn-ghost sm" onClick={onEdit}>
              Edit
            </button>
          )}
        </div>
      </header>
      <div className="pcn-summary">
        <span className={`pill sm fill-${meta.tone === "red" ? "light" : meta.tone}`}>{meta.label}</span>
        {pcn.signatories.length > 0 && (
          <span className="muted">
            {approved} of {pcn.signatories.length} approved
          </span>
        )}
        <span className="muted">
          {pcn.type} · raised by {pcn.originator || "—"} on {formatDate(pcn.date)}
          {pcn.mainPillar && ` · ${pcn.mainPillar}`}
        </span>
      </div>
      {compact && pcn.concept && <p className="pcn-concept">{pcn.concept}</p>}
      {mine >= 0 && status !== "DECLINED" && (
        <p className="pcn-ask">
          <b>Your signature is needed.</b> Read the PCN, then approve or decline it below.
        </p>
      )}
      {status === "APPROVED" && system.status === "IDEA" && canMoveOn && onMoveOn && (
        <div className="pcn-next">
          <CheckCircle2 size={18} />
          <span>Every signatory has approved. Move the project from Idea to Upcoming to start planning it.</span>
          <button className="btn btn-navy sm" disabled={busy} onClick={() => onMoveOn()}>
            Move to Upcoming
          </button>
        </div>
      )}
      {pcn.signatories.length ? (
        <table className="table pcn-signoffs">
          <thead>
            <tr>
              <th>Signatory</th>
              <th>Status</th>
              <th>Remarks</th>
              <th aria-label="Sign" />
            </tr>
          </thead>
          <tbody>
            {pcn.signatories.map((s, i) => {
              const own = s.userId === me.id;
              const mayAct = own || (!s.userId && canRecord);
              return (
                <tr key={i} className={own && s.status === "PENDING" ? "pcn-you" : ""}>
                  <td>
                    <b>{s.name}</b>
                    {s.primary && <small className="muted"> · primary</small>}
                    {own && <small className="muted"> · you</small>}
                    {!s.userId && <small className="muted"> · no account (via Econet)</small>}
                  </td>
                  <td className={s.status === "APPROVED" ? "text-green" : s.status === "DECLINED" ? "text-red" : "muted"}>
                    {s.status === "APPROVED" ? "Approved" : s.status === "DECLINED" ? "Declined" : "Awaiting signature"}
                    {s.date && ` · ${formatDate(s.date)}`}
                  </td>
                  <td className="notes-cell">{s.remarks || "—"}</td>
                  <td>
                    {mayAct &&
                      (deciding?.index === i ? (
                        <form
                          className="pcn-decide"
                          onSubmit={(e) => {
                            e.preventDefault();
                            sign(i, deciding.decision, remarks.trim());
                          }}
                        >
                          <input autoFocus maxLength={500} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={deciding.decision === "DECLINED" ? "Reason (recommended)" : "Remarks (optional)"} />
                          <button type="submit" className={`btn sm ${deciding.decision === "DECLINED" ? "btn-danger" : "btn-navy"}`} disabled={busy}>
                            {deciding.decision === "DECLINED" ? "Decline" : "Approve"}
                          </button>
                          <button type="button" className="icon-link" aria-label="Cancel" onClick={() => setDeciding(null)}>
                            <X size={14} />
                          </button>
                        </form>
                      ) : (
                        <div className="row-actions">
                          {s.status !== "APPROVED" && (
                            <button
                              className="btn btn-ghost sm"
                              disabled={busy}
                              title={own ? "Approve this PCN" : "Approval received through Econet"}
                              onClick={() => {
                                setRemarks("");
                                setDeciding({ index: i, decision: "APPROVED" });
                              }}
                            >
                              <Check size={14} /> {own ? "Approve" : "Approved"}
                            </button>
                          )}
                          {s.status !== "DECLINED" && (
                            <button
                              className="btn btn-ghost sm"
                              disabled={busy}
                              onClick={() => {
                                setRemarks("");
                                setDeciding({ index: i, decision: "DECLINED" });
                              }}
                            >
                              <CircleSlash size={14} /> {own ? "Decline" : "Declined"}
                            </button>
                          )}
                          {s.status !== "PENDING" && (
                            <button className="icon-link" disabled={busy} title="Undo" aria-label="Undo" onClick={() => sign(i, "PENDING")}>
                              <X size={14} />
                            </button>
                          )}
                        </div>
                      ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="lead-none">No signatories yet. Add them with Edit so the PCN reaches them.</p>
      )}
    </section>
  );
}
/**
 * The PCN laid out as a formal document, under the organisation's own header, for reading, printing and saving as PDF.
 * @param {{ system: System & { pcn: Pcn }; onBack: () => void }} arg3
 */
export function PcnDocument({ system, onBack }) {
  const p = system.pcn;
  const block = /** @param {string} text */ (text) => (text.trim() ? <p className="pcn-doc-text">{text}</p> : <p className="pcn-doc-empty">Not filled in</p>);
  return (
    <div className="page pcn-doc-page">
      <div className="page-actions no-print">
        <button className="back-link" onClick={onBack}>
          <ArrowLeft size={16} /> Back to {system.name}
        </button>
        <button className="btn btn-navy sm" onClick={() => window.print()}>
          <Printer size={14} /> Print / PDF
        </button>
      </div>
      <article className="pcn-doc">
        <header className="pcn-doc-banner">
          {/* The organisation's own header (the banner is dark). */}
          {currentBranding() && <OrgMark branding={/** @type {import("../data/branding").BrandingView} */ (currentBranding())} surface="dark" size="md" />}
          <div>
            <b>{currentBranding()?.name ?? organisationName()}</b>
            <span>Project Concept Note</span>
          </div>
        </header>
        <div className="pcn-doc-meta">
          <span>
            <b>PCN Title:</b> {p.title}
          </span>
          <span>
            <b>PCN Originator:</b> {p.originator}
          </span>
          <span>
            <b>Date:</b> {formatDate(p.date)}
          </span>
          <span>
            <b>Type of PCN:</b> {p.type}
          </span>
        </div>
        <table className="pcn-doc-table">
          <tbody>
            <tr>
              <th>1</th>
              <th>Concept Details / Mechanics</th>
              <td>
                <h4>1.1 Background</h4>
                {block(p.background)}
                <h4>1.2 Concept Description</h4>
                {block(p.concept)}
                <h4>1.3 Mechanics</h4>
                {block(p.mechanics)}
              </td>
            </tr>
            <tr>
              <th>2</th>
              <th>Strategic objectives / benefits</th>
              <td>
                <h4>2.1 Objectives</h4>
                {block(p.objectives)}
                <p>
                  <b>2.2 Main Strategic Pillar:</b> {p.mainPillar || "Not chosen"}
                </p>
                <p>
                  <b>2.3 Supporting Strategic Pillars:</b>
                </p>
                <ul className="pcn-doc-pillars">
                  {PILLARS.map((pl) => (
                    <li key={pl}>
                      <span className="pcn-box">{p.supportingPillars.includes(pl) ? "☒" : "☐"}</span> {pl}
                    </li>
                  ))}
                </ul>
              </td>
            </tr>
            <tr>
              <th>3</th>
              <th>Proposed Date</th>
              <td>
                <ol>
                  {(p.proposedDates.length ? p.proposedDates : [""]).map((d, i) => (
                    <li key={i}>{d ? formatDate(d) : "—"}</li>
                  ))}
                </ol>
              </td>
            </tr>
          </tbody>
        </table>
        <table className="pcn-doc-table signers">
          <thead>
            <tr>
              <th>4.</th>
              <th>PCN Signatories</th>
              <th>Name</th>
              <th>Remarks</th>
              <th>Approval (Econet)</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {(p.signatories.length ? p.signatories : [null, null, null]).map((s, i) => (
              <tr key={i}>
                <td />
                <td>
                  {i + 1}
                  {s?.primary && " (Primary)"}
                </td>
                <td>{s?.name}</td>
                <td>{s?.remarks}</td>
                <td>{s ? (s.status === "APPROVED" ? "Approved" : s.status === "DECLINED" ? "Declined" : "Pending") : ""}</td>
                <td>{s?.date ? formatDate(s.date) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="pcn-doc-note">
          <b>Note:</b>
          <ul>
            <li>PCN will be shared through Econet with all Signatories for approval</li>
            <li>Approval received through Econet will be treated as final approval, hence no sign off is required on hard copy</li>
          </ul>
        </div>
      </article>
    </div>
  );
}
