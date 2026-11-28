/** @import { System } from '../data/systems' */
/** @import { User } from '../data/roles' */
/** @import { Kit, Section, DocData, DocModule, Column } from '../data/documentKits' */
// A project's Documents tab (#/projects/:id/docs): the organisation's templates, in the order the lifecycle needs
// them (Concept Note, BRS, BSS, UAT script, Change Request, Release Notes, Changelog), each with where it stands and
// one button to write, continue, print or open it. Written documents are submitted as the stage's deliverable
// (worker/projectDocs.js); printed in the template's layout (Print / Save as PDF).
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, ClipboardCheck, FilePen, FileText, Lock, Plus, Printer, Rocket, ScrollText, Send, Trash2 } from "lucide-react";
import { ApiError, api } from "../data/api";
import { CHANGE_REQUEST_FIELDS, KITS, PRIORITY_LEGEND, docId, docMissing } from "../data/documentKits";
import { currentBranding } from "../brandTheme";
import { organisationName } from "../data/tenant";
import { formatDate } from "../time";
import OrgMark from "./OrgMark";

/**
 * @typedef {{ version: number; status: string; submittedAt: string | null; submittedBy: string | null; documentId: string | null; documentVersion: number | null; locked: boolean; updatedAt: string }} DocVersion
 * @typedef {{ kind: string; name: string; short: string; deliverable: string | null; draft: DocVersion | null; versions: DocVersion[] }} KitState
 */

/** The org's own letterhead (logo and name) over a document's title. @param {{ title: string; subtitle?: string }} p */
function Letterhead({ title, subtitle }) {
  const b = currentBranding();
  return (
    <header className="doc-letterhead">
      {b && <OrgMark branding={b} surface="dark" size="md" />}
      <div>
        <b>{b?.name ?? organisationName()}</b>
        <span>{title}</span>
      </div>
      {subtitle && <small>{subtitle}</small>}
    </header>
  );
}
/** @param {{ onBack: () => void; children?: import("react").ReactNode }} p */
function Toolbar({ onBack, children }) {
  return (
    <div className="page-actions no-print doc-toolbar">
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={16} /> Documents
      </button>
      <span className="doc-toolbar-actions">
        {children}
        <button className="btn btn-ghost sm" onClick={() => window.print()}>
          <Printer size={14} /> Print / Save as PDF
        </button>
      </span>
    </div>
  );
}

/**
 * @param {{ system: System; me: User; users: User[]; doc?: string; readOnly?: boolean; onChanged?: () => void }} p  doc: "brs", "brs-2", "uat", "change_request", "changelog"
 */
export default function DocumentsTab({ system, me, users, doc, readOnly = false, onChanged }) {
  const go = (/** @type {string} */ d) => (window.location.hash = `#/projects/${system.id}/docs${d ? `/${d}` : ""}`);
  if (doc === "uat") return <UatScript system={system} me={me} onBack={() => go("")} />;
  if (doc === "change_request") return <ChangeRequestDoc system={system} onBack={() => go("")} />;
  if (doc === "changelog") return <ChangelogDoc system={system} onBack={() => go("")} />;
  const m = doc?.match(/^([a-z_]+?)(?:-(\d+))?$/);
  if (m && KITS[m[1]]) return <KitDocument key={doc} system={system} kit={KITS[m[1]]} version={m[2] ? Number(m[2]) : null} readOnly={readOnly} onBack={() => go("")} onSubmitted={onChanged} />;
  return <DocumentsHome system={system} users={users} go={go} />;
}

/** The list, in lifecycle order. @param {{ system: System; users: User[]; go: (d: string) => void }} p */
function DocumentsHome({ system, go }) {
  const [state, setState] = useState(/** @type {{ kits: KitState[]; canEdit: boolean } | null} */ (null));
  const [life, setLife] = useState(/** @type {any} */ (null));
  const [error, setError] = useState("");
  useEffect(() => {
    api(`/systems/${system.id}/docs`)
      .then((r) => setState(/** @type {any} */ (r)))
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load the documents"));
    api(`/systems/${system.id}/lifecycle`)
      .then((r) => setLife(/** @type {any} */ (r).lifecycle))
      .catch(() => setLife(null));
  }, [system.id]);
  if (error) return <p className="form-error">{error}</p>;
  if (!state) return <p className="muted">Loading the documents…</p>;
  const kit = (/** @type {string} */ k) => /** @type {KitState} */ (state.kits.find((x) => x.kind === k));
  const uat = life?.testSummary?.UAT;
  const cr = life?.records?.deployment;
  const releases = kit("release_notes").versions.length;
  /** @type {{ key: string; icon: typeof FileText; name: string; stage: string; status: string; tone: string; actions: { label: string; to: string; primary?: boolean }[] }[]} */
  const rows = [
    {
      key: "pcn",
      icon: FileText,
      name: "Project Concept Note (PCN)",
      stage: "1 PCN Draft · 3 PCN Sign Off",
      status: system.pcn ? "Written" : "Not written yet",
      tone: system.pcn ? "ok" : "",
      actions: [{ label: system.pcn ? "Open" : "Write it on the project's Overview", to: system.pcn ? `#/projects/${system.id}/pcn` : `#/projects/${system.id}`, primary: !system.pcn }],
    },
    ...["brs", "bss"].map((k) => {
      const s = kit(k);
      const last = s.versions[0];
      return {
        key: k,
        icon: FilePen,
        name: `${s.name} (${s.short})`,
        stage: k === "brs" ? "5 BRS Draft · 6 BRS Sign Off" : "7 BSS Draft · 8 BSS Sign Off",
        status: s.draft ? `Draft of version ${s.draft.version}, saved ${formatDate(s.draft.updatedAt)}` : last ? `Version ${last.version} submitted${last.locked ? " · signed and locked" : ""}` : "Not started",
        tone: last?.locked ? "ok" : s.draft || last ? "info" : "",
        actions: [
          { label: s.draft ? "Continue the draft" : last ? `Start version ${last.version + 1}` : `Write the ${s.short}`, to: `#/projects/${system.id}/docs/${k}`, primary: true },
          ...(last ? [{ label: `View v${last.version}`, to: `#/projects/${system.id}/docs/${k}-${last.version}` }] : []),
        ],
      };
    }),
    {
      key: "uat",
      icon: ClipboardCheck,
      name: "UAT script",
      stage: "13 UATs",
      status: uat ? `${uat.total} test case${uat.total === 1 ? "" : "s"}: ${uat.pass} passed, ${uat.fail} failed, ${uat.waived ?? 0} waived` : "No UAT test cases yet: add them in the UATs stage",
      tone: uat?.total ? "info" : "",
      actions: [{ label: "Add and run tests", to: `#/projects/${system.id}/lifecycle` }, { label: "Print the UAT script", to: `#/projects/${system.id}/docs/uat`, primary: !!uat?.total }],
    },
    {
      key: "change_request",
      icon: Rocket,
      name: "Change Request form",
      stage: "14 Deployment",
      status: cr?.plan ? `Filled in${cr.approver ? `, approved by ${cr.approver}` : ""}` : "Not filled in yet: it's the Deployment stage's record",
      tone: cr?.approver ? "ok" : cr?.plan ? "info" : "",
      actions: [{ label: "Fill it in", to: `#/projects/${system.id}/lifecycle` }, { label: "Print the form", to: `#/projects/${system.id}/docs/change_request`, primary: !!cr?.plan }],
    },
    {
      key: "release_notes",
      icon: Send,
      name: "Release Notes",
      stage: "15 Post Deployment · 16 Close Project",
      status: kit("release_notes").draft ? "Draft saved" : releases ? `${releases} release${releases === 1 ? "" : "s"} published` : "No release yet",
      tone: releases ? "ok" : kit("release_notes").draft ? "info" : "",
      actions: [
        { label: kit("release_notes").draft ? "Continue the draft" : "Write release notes", to: `#/projects/${system.id}/docs/release_notes`, primary: true },
        ...(releases ? [{ label: "View the latest", to: `#/projects/${system.id}/docs/release_notes-${kit("release_notes").versions[0].version}` }] : []),
      ],
    },
    {
      key: "changelog",
      icon: ScrollText,
      name: "Changelog",
      stage: "Built from the release notes",
      status: releases ? `${releases} version${releases === 1 ? "" : "s"}` : "Appears after the first release notes",
      tone: releases ? "ok" : "",
      actions: releases ? [{ label: "Open the changelog", to: `#/projects/${system.id}/docs/changelog`, primary: true }] : [],
    },
  ];
  return (
    <div className="docs-home">
      <p className="muted docs-intro">
        The organisation's templates, in the order the project needs them. Write them here: they're saved as you type, printed in the template's layout, and
        submitting one makes it that stage's deliverable, ready for sign-off.
      </p>
      <ol className="docs-list">
        {rows.map((r) => (
          <li key={r.key} className="docs-item">
            <span className="docs-ico" aria-hidden="true">
              <r.icon size={18} />
            </span>
            <span className="docs-main">
              <b>{r.name}</b>
              <small>{r.stage}</small>
            </span>
            <span className={`lc-pill ${r.tone}`}>{r.status}</span>
            <span className="docs-actions">
              {r.actions.map((a) => (
                <a key={a.label} className={`btn ${a.primary ? "btn-navy" : "btn-ghost"} sm`} href={a.to} onClick={(e) => (a.to.includes("/docs/") ? (e.preventDefault(), go(a.to.split("/docs/")[1])) : undefined)}>
                  {a.label}
                </a>
              ))}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * A kit's document: the draft in the editor (saved as you type), or a submitted version, printed.
 * @param {{ system: System; kit: Kit; version: number | null; readOnly: boolean; onBack: () => void; onSubmitted?: () => void }} p
 */
function KitDocument({ system, kit, version, readOnly, onBack, onSubmitted }) {
  const [doc, setDoc] = useState(/** @type {any} */ (null));
  const [data, setData] = useState(/** @type {DocData | null} */ (null));
  const [view, setView] = useState(/** @type {"edit" | "print"} */ (version ? "print" : "edit"));
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(/** @type {string[]} */ ([]));
  const [busy, setBusy] = useState(false);
  const timer = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
  const base = `/systems/${system.id}/docs/${kit.kind}`;
  const load = () =>
    api(`${base}${version ? `?version=${version}` : ""}`)
      .then((r) => {
        setDoc(r);
        setData(/** @type {any} */ (r).data);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load the document"));
  useEffect(() => {
    setView(version ? "print" : "edit");
    void load();
  }, [base, version]);
  const editable = !version && !readOnly && !!doc?.canEdit;
  /** Saves a second after the last change. @param {DocData} next */
  const change = (next) => {
    setData(next);
    setSaved("Saving…");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api(base, "PUT", { data: next })
        .then(() => setSaved(`Saved ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`))
        .catch((e) => setSaved(e instanceof Error ? `Not saved: ${e.message}` : "Not saved"));
    }, 900);
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  if (error) return <p className="form-error">{error}</p>;
  if (!doc || !data) return <p className="muted">Loading…</p>;
  const n = doc.version.version;
  const todo = docMissing(kit, data);
  return (
    <div className="page doc-page">
      <Toolbar onBack={onBack}>
        {!version && (
          <span className="seg" role="group" aria-label="View">
            <button className={view === "edit" ? "on" : ""} aria-pressed={view === "edit"} onClick={() => setView("edit")}>
              Write
            </button>
            <button className={view === "print" ? "on" : ""} aria-pressed={view === "print"} onClick={() => setView("print")}>
              Preview
            </button>
          </span>
        )}
        {editable && <span className="muted small">{saved || (doc.saved ? "Draft" : "New draft: it's saved when you change something")}</span>}
        {editable && (
          <button
            className="btn btn-navy sm"
            disabled={busy || todo.length > 0}
            title={todo.length ? `Still needed: ${todo.join("; ")}` : undefined}
            onClick={async () => {
              setBusy(true);
              setMissing([]);
              try {
                if (timer.current) clearTimeout(timer.current);
                await api(base, "PUT", { data });
                const r = /** @type {{ version: number }} */ (await api(`${base}/submit`, "POST", {}));
                onSubmitted?.();
                window.location.hash = `#/projects/${system.id}/docs/${kit.kind}-${r.version}`;
              } catch (e) {
                setError(e instanceof Error ? e.message : "Couldn't submit it");
                if (e instanceof ApiError && Array.isArray(e.payload.missing)) setMissing(/** @type {string[]} */ (e.payload.missing));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Send size={14} /> {kit.versioned === "release" ? "Publish this release" : `Submit as the ${kit.short} for sign-off`}
          </button>
        )}
        {version && doc.version.locked && (
          <span className="lc-pill ok">
            <Lock size={12} /> Signed · locked
          </span>
        )}
      </Toolbar>
      {editable && todo.length > 0 && view === "edit" && (
        <p className="doc-todo no-print">
          <b>To submit, still needed:</b> {(missing.length ? missing : todo).join(" · ")}
        </p>
      )}
      {view === "edit" && editable ? (
        <Editor kit={kit} data={data} onChange={change} />
      ) : (
        <Printed kit={kit} data={data} version={version ? (doc.version.documentVersion ?? n) : n} draft={!version} versions={doc.versions} signoffs={doc.signoffs} />
      )}
    </div>
  );
}

// ---------- the editor ----------
/** @param {{ kit: Kit; data: DocData; onChange: (d: DocData) => void }} p */
function Editor({ kit, data, onChange }) {
  const set = (/** @type {string} */ key, /** @type {unknown} */ value) => onChange({ ...data, [key]: value });
  return (
    <div className="doc-editor">
      {kit.sections
        .filter((s) => s.kind !== "auto")
        .map((sec) => (
          <section key={sec.key} className="doc-sec">
            <h3>{sec.title}</h3>
            {"hint" in sec && sec.hint && <p className="muted small">{sec.hint}</p>}
            <SectionEditor sec={sec} value={data[sec.key]} onChange={(v) => set(sec.key, v)} />
          </section>
        ))}
      <p className="muted small">Approvals and the document history are filled in by PMS from the sign-offs and versions.</p>
    </div>
  );
}
/** @param {{ col: Column; value: string; onChange: (v: string) => void; label?: string }} p */
function Cell({ col, value, onChange, label }) {
  const aria = label ?? col.label;
  if (col.type === "select") {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={aria}>
        {!(col.options ?? []).includes(value) && <option value={value}>{value || "—"}</option>}
        {(col.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o || "—"}
          </option>
        ))}
      </select>
    );
  }
  if (col.type === "textarea") return <textarea value={value} onChange={(e) => onChange(e.target.value)} aria-label={aria} rows={2} />;
  return <input type={col.type === "date" ? "date" : col.type === "number" ? "number" : "text"} value={value} onChange={(e) => onChange(e.target.value)} aria-label={aria} />;
}
/** @param {{ sec: Section; value: unknown; onChange: (v: unknown) => void }} p */
function SectionEditor({ sec, value, onChange }) {
  if (sec.kind === "fields") {
    const v = /** @type {Record<string, string>} */ (value ?? {});
    return (
      <div className="doc-fields">
        {sec.fields.map((f) => (
          <label key={f.key} className="field">
            <span>
              {f.label}
              {sec.required?.includes(f.key) && <em> (required)</em>}
            </span>
            <Cell col={f} value={v[f.key] ?? ""} onChange={(x) => onChange({ ...v, [f.key]: x })} />
          </label>
        ))}
      </div>
    );
  }
  if (sec.kind === "text") return <textarea className="doc-text" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} aria-label={sec.title} rows={5} />;
  if (sec.kind === "list") {
    const list = /** @type {string[]} */ (value ?? []);
    return (
      <div className="doc-list">
        {list.map((item, i) => (
          <div key={i} className="lc-row">
            <span aria-hidden="true">•</span>
            <input value={item} onChange={(e) => onChange(list.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`${sec.title} ${i + 1}`} />
            <button className="btn btn-ghost sm" aria-label="Remove" onClick={() => onChange(list.filter((_, j) => j !== i))}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        <button className="btn btn-ghost sm" onClick={() => onChange([...list, ""])}>
          <Plus size={13} /> Add a line
        </button>
      </div>
    );
  }
  if (sec.kind === "table") return <TableEditor columns={sec.columns} rows={/** @type {Record<string, string>[]} */ (value ?? [])} onChange={onChange} idPrefix={sec.idPrefix} idPad={sec.idPad} title={sec.title} />;
  if (sec.kind === "modules") {
    const mods = /** @type {DocModule[]} */ (value ?? []);
    const setMod = (/** @type {number} */ i, /** @type {Partial<DocModule>} */ x) => onChange(mods.map((m, j) => (j === i ? { ...m, ...x } : m)));
    return (
      <div className="doc-modules">
        {mods.map((m, i) => (
          <div key={i} className="doc-module">
            <div className="lc-row">
              <b className="mono">{docId(sec.prefix, i, sec.idPad)}</b>
              <input className="grow" value={m.title} onChange={(e) => setMod(i, { title: e.target.value })} placeholder="Module or requirement group name" aria-label="Module name" />
              <button className="btn btn-ghost sm" aria-label="Remove this module" onClick={() => onChange(mods.filter((_, j) => j !== i))}>
                <Trash2 size={13} />
              </button>
            </div>
            <TableEditor columns={sec.itemColumns} rows={m.items} onChange={(rows) => setMod(i, { items: /** @type {any} */ (rows) })} idPrefix={`${docId(sec.prefix, i, sec.idPad)}-`} idPad={2} title={m.title || "Requirements"} />
            {sec.featureFields && (
              <details className="doc-features">
                <summary>Sub-features ({(m.features ?? []).length})</summary>
                {(m.features ?? []).map((f, k) => (
                  <div key={k} className="doc-feature">
                    <div className="doc-fields">
                      {/** @type {Column[]} */ (sec.featureFields).map((col) => (
                        <label key={col.key} className="field">
                          <span>{col.label}</span>
                          <Cell col={col} value={f[col.key] ?? ""} onChange={(x) => setMod(i, { features: (m.features ?? []).map((g, q) => (q === k ? { ...g, [col.key]: x } : g)) })} />
                        </label>
                      ))}
                    </div>
                    <button className="btn btn-ghost sm" onClick={() => setMod(i, { features: (m.features ?? []).filter((_, q) => q !== k) })}>
                      <Trash2 size={13} /> Remove this sub-feature
                    </button>
                  </div>
                ))}
                <button className="btn btn-ghost sm" onClick={() => setMod(i, { features: [...(m.features ?? []), Object.fromEntries(/** @type {Column[]} */ (sec.featureFields).map((c) => [c.key, c.key === "priority" ? "High" : ""]))] })}>
                  <Plus size={13} /> Add a sub-feature
                </button>
              </details>
            )}
          </div>
        ))}
        <button className="btn btn-ghost sm" onClick={() => onChange([...mods, { title: "", items: [Object.fromEntries(sec.itemColumns.map((c) => [c.key, c.key === "priority" ? "M" : c.key === "need" ? "Required" : ""]))], ...(sec.featureFields ? { features: [] } : {}) }])}>
          <Plus size={13} /> Add {docId(sec.prefix, mods.length, sec.idPad)}
        </button>
      </div>
    );
  }
  return null;
}
/** @param {{ columns: Column[]; rows: Record<string, string>[]; onChange: (rows: Record<string, string>[]) => void; idPrefix?: string; idPad?: number; title: string }} p */
function TableEditor({ columns, rows, onChange, idPrefix, idPad = 2, title }) {
  return (
    <div className="doc-table-wrap">
      <table className="doc-table edit">
        <thead>
          <tr>
            {idPrefix && <th style={{ width: 110 }}>Req #</th>}
            {columns.map((c) => (
              <th key={c.key} style={c.width ? { width: c.width } : undefined}>
                {c.label}
              </th>
            ))}
            <th aria-label="Remove" style={{ width: 40 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {idPrefix && <td className="mono">{docId(idPrefix, i, idPad)}</td>}
              {columns.map((c) => (
                <td key={c.key}>
                  <Cell col={c} value={r[c.key] ?? ""} label={`${title}, row ${i + 1}, ${c.label}`} onChange={(x) => onChange(rows.map((row, j) => (j === i ? { ...row, [c.key]: x } : row)))} />
                </td>
              ))}
              <td>
                <button className="btn btn-ghost sm" aria-label={`Remove row ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                  <Trash2 size={13} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn btn-ghost sm" onClick={() => onChange([...rows, Object.fromEntries(columns.map((c) => [c.key, c.key === "priority" ? "M" : ""]))])}>
        <Plus size={13} /> Add a row
      </button>
    </div>
  );
}

// ---------- printed ----------
/**
 * The document in the template's layout.
 * @param {{ kit: Kit; data: DocData; version: number; draft: boolean; versions: DocVersion[]; signoffs: any[] }} p
 */
function Printed({ kit, data, version, draft, versions, signoffs }) {
  const fieldsSec = kit.sections.find((s) => s.kind === "fields");
  const head = /** @type {Record<string, string>} */ (data[fieldsSec?.key ?? ""] ?? {});
  const title = head.title || head.system || head.product || "";
  return (
    <article className="doc-print">
      <Letterhead title={kit.name} subtitle={draft ? "DRAFT" : undefined} />
      <div className="doc-cover">
        <h1>{title}</h1>
        <p>
          {kit.name}
          {kit.versioned === "release" ? ` ${head.version ?? ""}` : ` · Version ${version}`} · {[head.modifiedOn, head.date, head.releaseDate].filter(Boolean).map((x) => (/^\d{4}-\d{2}-\d{2}$/.test(x) ? formatDate(x) : x))[0] ?? ""}
        </p>
        {head.confidentiality && <p className="doc-conf">{head.confidentiality}</p>}
      </div>
      {kit.sections.map((sec) => (
        <PrintedSection key={`${sec.key}${sec.title}`} kit={kit} sec={sec} data={data} versions={versions} signoffs={signoffs} />
      ))}
    </article>
  );
}
/** @param {{ kit: Kit; sec: Section; data: DocData; versions: DocVersion[]; signoffs: any[] }} p */
function PrintedSection({ kit, sec, data, versions, signoffs }) {
  const v = /** @type {any} */ (data[sec.key]);
  if (sec.kind === "auto") {
    if (sec.source === "approvals") {
      return (
        <section className="doc-psec">
          <h2>{sec.title}</h2>
          <PTable
            columns={[{ key: "name", label: "Name" }, { key: "label", label: "Designation" }, { key: "date", label: "Date" }, { key: "signature", label: "Signature" }]}
            rows={signoffs.length ? signoffs.map((s) => ({ name: s.signer_name, label: s.label, date: s.decided_at ? formatDate(s.decided_at) : "", signature: s.status === "approved" ? "Approved in PMS" : s.status === "declined" ? `Declined: ${s.comment}` : "Pending" })) : [{ name: "", label: "", date: "", signature: "" }]}
          />
        </section>
      );
    }
    if (sec.source === "history") {
      return (
        <section className="doc-psec">
          <h2>{sec.title}</h2>
          <PTable columns={[{ key: "rev", label: "Version" }, { key: "date", label: "Date" }, { key: "by", label: "Author" }, { key: "note", label: "Changes" }]} rows={versions.length ? [...versions].reverse().map((x) => ({ rev: String(x.documentVersion ?? x.version), date: x.submittedAt ? formatDate(x.submittedAt) : "", by: x.submittedBy ?? "", note: x.locked ? "Signed off" : "Submitted for sign-off" })) : [{ rev: "Draft", date: "", by: "", note: "" }]} />
        </section>
      );
    }
    // The high-level requirements: one line per functional module.
    const mods = /** @type {DocModule[]} */ (data.functional ?? []);
    const fsec = /** @type {Extract<Section, { kind: "modules" }>} */ (kit.sections.find((s) => s.kind === "modules"));
    return (
      <section className="doc-psec">
        <h2>{sec.title}</h2>
        <PTable columns={[{ key: "id", label: "Req. No" }, { key: "description", label: "Description" }, { key: "priority", label: "Priority" }]} rows={mods.map((m, i) => ({ id: docId(fsec.prefix, i, fsec.idPad), description: m.title, priority: m.items.some((x) => x.priority === "M") ? "M" : (m.items[0]?.priority ?? "") }))} />
        <p className="doc-legend">Priority legend: {PRIORITY_LEGEND}</p>
      </section>
    );
  }
  if (sec.kind === "fields") return null; // on the cover
  if (sec.kind === "text") {
    return (
      <section className="doc-psec">
        <h2>{sec.title}</h2>
        {String(v ?? "").trim() ? String(v).split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>) : <p className="doc-empty">Not filled in</p>}
      </section>
    );
  }
  if (sec.kind === "list") {
    const items = (/** @type {string[]} */ (v ?? [])).filter((x) => x.trim());
    return (
      <section className="doc-psec">
        <h2>{sec.title}</h2>
        {"hint" in sec && sec.hint && <p>{sec.hint}</p>}
        {items.length ? (
          <ul>
            {items.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        ) : (
          <p className="doc-empty">None</p>
        )}
      </section>
    );
  }
  if (sec.kind === "table") {
    const rows = /** @type {Record<string, string>[]} */ (v ?? []);
    return (
      <section className="doc-psec">
        <h2>{sec.title}</h2>
        {sec.hint && <p className="doc-legend">NB: Requirement priority ({sec.hint}).</p>}
        <PTable columns={sec.idPrefix ? [{ key: "__id", label: "Req #" }, ...sec.columns] : sec.columns} rows={rows.map((r, i) => (sec.idPrefix ? { __id: docId(sec.idPrefix, i, sec.idPad ?? 2), ...r } : r))} />
      </section>
    );
  }
  if (sec.kind === "modules") {
    const mods = /** @type {DocModule[]} */ (v ?? []);
    return (
      <section className="doc-psec">
        <h2>{sec.title}</h2>
        {sec.hint && <p className="doc-legend">NB: Requirement priority ({sec.hint}).</p>}
        {mods.map((m, i) => {
          const id = docId(sec.prefix, i, sec.idPad);
          return (
            <div key={i} className="doc-pmod">
              <h3>
                {id}: {m.title}
              </h3>
              <PTable columns={[{ key: "__id", label: "Req #" }, ...sec.itemColumns]} rows={m.items.map((r, j) => ({ __id: docId(`${id}-`, j, 2), ...r }))} />
              {(m.features ?? []).map((f, k) => (
                <div key={k} className="doc-pfeature">
                  <h4>
                    2.{i + 1}.{k + 1} {f.name}
                  </h4>
                  <p className="doc-legend">Priority: {f.priority}</p>
                  <table className="doc-table kv">
                    <tbody>
                      {(/** @type {Column[]} */ (sec.featureFields ?? [])).filter((c) => c.key !== "name" && c.key !== "priority").map((c) => (
                        <tr key={c.key}>
                          <th>{c.label}</th>
                          <td>{f[c.key] || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          );
        })}
      </section>
    );
  }
  return null;
}
/** @param {{ columns: Column[]; rows: Record<string, string>[] }} p */
function PTable({ columns, rows }) {
  return (
    <table className="doc-table">
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length ? (
          rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key} className={c.key === "__id" ? "doc-id" : undefined}>
                  {/^\d{4}-\d{2}-\d{2}$/.test(r[c.key] ?? "") ? formatDate(r[c.key]) : r[c.key] || ""}
                </td>
              ))}
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={columns.length} className="doc-empty">
              None
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

// ---------- generated documents ----------
/** The UAT script, from the project's UAT test cases. @param {{ system: System; me: User; onBack: () => void }} p */
function UatScript({ system, me, onBack }) {
  const [life, setLife] = useState(/** @type {any} */ (undefined));
  useEffect(() => {
    api(`/systems/${system.id}/lifecycle`)
      .then((r) => setLife(/** @type {any} */ (r).lifecycle))
      .catch(() => setLife(null));
  }, [system.id]);
  if (life === undefined) return <p className="muted">Loading…</p>;
  const cases = (life?.tests ?? []).filter((/** @type {any} */ t) => t.suite === "UAT");
  const last = (/** @type {any} */ t) => t.runs[t.runs.length - 1];
  const count = (/** @type {string} */ r) => cases.filter((/** @type {any} */ t) => last(t)?.result === r).length;
  const runDates = cases.flatMap((/** @type {any} */ t) => t.runs.map((/** @type {any} */ x) => x.run_at)).sort();
  const total = Math.max(1, cases.length);
  const bars = [
    ["Pass", count("pass"), "pass"],
    ["Fail", count("fail"), "fail"],
    ["Waived", count("waived"), "waived"],
  ];
  return (
    <div className="page doc-page">
      <Toolbar onBack={onBack} />
      <article className="doc-print">
        <Letterhead title="UAT Script" />
        <div className="uat-head">
          <div className="uat-chart" aria-label="UAT results">
            <b>UATs Results</b>
            {bars.map(([label, n, cls]) => (
              <span key={label} className="uat-bar">
                <i>{label}</i>
                <span>
                  <em className={/** @type {string} */ (cls)} style={{ width: `${(Number(n) / total) * 100}%` }} />
                </span>
                <b>{n}</b>
              </span>
            ))}
          </div>
          <table className="doc-table kv">
            <tbody>
              <tr>
                <th>Project name</th>
                <td>{system.name}</td>
              </tr>
              <tr>
                <th>Date of UAT</th>
                <td>{runDates.length ? formatDate(runDates[runDates.length - 1]) : "—"}</td>
              </tr>
              <tr>
                <th>Prepared by</th>
                <td>{me.name}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <PTable
          columns={[{ key: "scenario", label: "Scenario" }, { key: "n", label: "Test #" }, { key: "title", label: "Test case" }, { key: "user", label: "Test user(s) assigned" }, { key: "expected", label: "Expected result" }, { key: "result", label: "Result" }, { key: "comments", label: "Comments" }]}
          rows={cases.map((/** @type {any} */ t, /** @type {number} */ i) => ({ scenario: t.scenario, n: String(i + 1), title: t.title, user: t.assignee_name ?? "", expected: t.expected, result: last(t) ? last(t).result[0].toUpperCase() + last(t).result.slice(1) : "Not run", comments: last(t)?.notes ?? "" }))}
        />
        {!cases.length && <p className="doc-empty no-print">Add UAT test cases (scenario, test case, tester, expected result) in the project's Lifecycle tab, at the UATs stage.</p>}
      </article>
    </div>
  );
}
/** The Change Request form, from the Deployment stage's record. @param {{ system: System; onBack: () => void }} p */
function ChangeRequestDoc({ system, onBack }) {
  const [rec, setRec] = useState(/** @type {Record<string, string> | null | undefined} */ (undefined));
  useEffect(() => {
    api(`/systems/${system.id}/lifecycle`)
      .then((r) => setRec(/** @type {any} */ (r).lifecycle?.records?.deployment ?? null))
      .catch(() => setRec(null));
  }, [system.id]);
  if (rec === undefined) return <p className="muted">Loading…</p>;
  const r = rec ?? {};
  return (
    <div className="page doc-page">
      <Toolbar onBack={onBack} />
      <article className="doc-print cr">
        <Letterhead title="Change Request Form" />
        <p className="cr-note">
          By approving or declining this change control request you acknowledge that you are fully aware of the implications of the required change and
          therefore accept the Responsibilities of Change Approvers as outlined in the Change Management Standards and Procedures.
        </p>
        <p className="cr-project">
          <b>Project:</b> {system.name}
        </p>
        {CHANGE_REQUEST_FIELDS.map((g) => (
          <section key={g.group} className="doc-psec">
            <h2>{g.group}</h2>
            <table className="doc-table kv">
              <tbody>
                {g.fields.map((f) => (
                  <tr key={f.key}>
                    <th>{f.label}</th>
                    <td>{r[f.key] || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </article>
    </div>
  );
}
/** The changelog, from the published release notes. @param {{ system: System; onBack: () => void }} p */
function ChangelogDoc({ system, onBack }) {
  const [log, setLog] = useState(/** @type {any} */ (null));
  useEffect(() => {
    api(`/systems/${system.id}/docs/release_notes/changelog`)
      .then(setLog)
      .catch(() => setLog({ entries: [] }));
  }, [system.id]);
  if (!log) return <p className="muted">Loading…</p>;
  /** @type {[string, string][]} */ const HEADS = [["added", "Added"], ["changed", "Changed"], ["deprecated", "Deprecated / removed"], ["fixed", "Fixed"], ["security", "Security"]];
  return (
    <div className="page doc-page">
      <Toolbar onBack={onBack} />
      <article className="doc-print">
        <Letterhead title={`Changelog – ${system.name}`} />
        <p>All notable changes to this project, newest first. Version numbers follow Semantic Versioning (MAJOR.MINOR.PATCH).</p>
        <section className="doc-psec">
          <h2>Version summary</h2>
          <PTable columns={[{ key: "version", label: "Version" }, { key: "date", label: "Release date" }, { key: "summary", label: "Summary" }]} rows={log.entries.map((/** @type {any} */ e) => ({ version: e.version, date: e.date ? formatDate(e.date) : "", summary: e.summary }))} />
        </section>
        {log.entries.map((/** @type {any} */ e) => (
          <section key={e.version} className="doc-psec">
            <h2>
              [{e.version}] – {e.date ? formatDate(e.date) : ""}
            </h2>
            {HEADS.filter(([k]) => e[k].length).map(([k, label]) => (
              <div key={k}>
                <h3>{label}</h3>
                <ul>
                  {e[k].map((/** @type {string} */ x, /** @type {number} */ i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}
        {!log.entries.length && <p className="doc-empty">No release has been published yet.</p>}
      </article>
    </div>
  );
}

/**
 * The Deployment stage's record, as the Change Request form (used in the Lifecycle tab).
 * @param {{ value: Record<string, string>; disabled: boolean; onSave: (v: Record<string, string>) => void; systemId: string }} p
 */
export function ChangeRequestForm({ value, disabled, onSave, systemId }) {
  const [d, setD] = useState(() => {
    /** @type {Record<string, string>} */ const out = {};
    for (const g of CHANGE_REQUEST_FIELDS) for (const f of g.fields) out[f.key] = value[f.key] ?? f.default ?? "";
    return out;
  });
  return (
    <form
      className="lc-form stack cr-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(d);
      }}
    >
      {CHANGE_REQUEST_FIELDS.map((g) => (
        <fieldset key={g.group} className="lcs-fs">
          <legend>{g.group}</legend>
          <div className="doc-fields">
            {g.fields.map((f) => (
              <label key={f.key} className={f.type === "textarea" ? "wide" : ""}>
                {f.label}
                {f.required && <em> (needed for the gate)</em>}
                <Cell col={f} value={d[f.key] ?? ""} onChange={(x) => setD({ ...d, [f.key]: x })} />
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <div className="lc-row">
        {!disabled && (
          <button className="btn btn-ghost sm">
            <Check size={14} /> Save the change request
          </button>
        )}
        <a className="btn btn-ghost sm" href={`#/projects/${systemId}/docs/change_request`}>
          <Printer size={14} /> Print the form
        </a>
      </div>
    </form>
  );
}
