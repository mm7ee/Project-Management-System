/** @import { System } from '../data/systems' */
/** @import { User } from '../data/roles' */
/** @import { Pcn, PcnStatus, SignoffStatus } from '../data/pcn' */
import { useState } from "react";
import { FileText, Search, X } from "lucide-react";
import { PCN_STATUS_META, awaitingSignature, pcnStatus } from "../data/pcn";
import { formatDate } from "../time";
import { PcnCard } from "./Pcn";
/**
 * Every submitted Project Concept Note: what's waiting for your signature first, then all of them,
 * so signatories can sign and assistants can follow each one through approval.
 * @param {{
 *   systems: System[];
 *   me: User;
 *   canRecord: boolean;
 *   canPropose: boolean;
 *   onSign: (systemId: string, index: number, decision: SignoffStatus, remarks?: string) => Promise<void>;
 *   onPropose: () => void;
 * }} props
 */
export default function ConceptNotesPage({ systems, me, canRecord, canPropose, onSign, onPropose }) {
  const [show, setShow] = useState(/** @type {"all" | PcnStatus | (() => "all" | PcnStatus)} */ ("all"));
  const [query, setQuery] = useState("");
  const notes = systems.filter(/** @returns {s is WithPcn} */ (s) => !!s.pcn).sort((a, b) => b.pcn.date.localeCompare(a.pcn.date));
  const mine = notes.filter((s) => awaitingSignature(s.pcn, me.id));
  // Search: every word typed must appear somewhere in the PCN (title, originator, type, pillars, its text,
  // the signatories) or the project's name.
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = /** @param {WithPcn} s */ (s) =>
    [s.name, s.pcn.title, s.pcn.originator, s.pcn.type, s.pcn.mainPillar, ...(s.pcn.supportingPillars ?? []), s.pcn.background, s.pcn.concept, s.pcn.mechanics, s.pcn.objectives, ...s.pcn.signatories.map((g) => g.name)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  const listed = notes.filter((s) => (show === "all" || pcnStatus(s.pcn) === show) && words.every((w) => haystack(s).includes(w)));
  const count = /** @param {PcnStatus} st */ (st) => notes.filter((s) => pcnStatus(s.pcn) === st).length;
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h2>Concept Notes</h2>
          <p>New projects proposed with a PCN, and where each one stands with its signatories.</p>
        </div>
        {canPropose && (
          <button className="btn btn-amber" onClick={onPropose}>
            <FileText size={16} /> Propose a project
          </button>
        )}
      </header>

      {mine.length > 0 && (
        <section className="pcn-queue">
          <h3 className="grid-title">
            Waiting for your signature <span>{mine.length}</span>
          </h3>
          {mine.map((s) => (
            <PcnCard key={s.id} system={s} me={me} canRecord={canRecord} canEdit={false} canMoveOn={false} compact onSign={(i, d, r) => onSign(s.id, i, d, r)} />
          ))}
        </section>
      )}

      <div className="viz-filters" role="group" aria-label="Filter Concept Notes">
        <div className="seg" role="radiogroup" aria-label="Status">
          {/** @type {const} */ ([
            ["all", `All · ${notes.length}`],
            ["PENDING", `Awaiting approval · ${count("PENDING")}`],
            ["APPROVED", `Approved · ${count("APPROVED")}`],
            ["DECLINED", `Declined · ${count("DECLINED")}`],
            ["DRAFT", `Drafts · ${count("DRAFT")}`],
          ]).map(([k, label]) => (
            <button key={k} role="radio" aria-checked={show === k} className={show === k ? "on" : ""} onClick={() => setShow(k)}>
              {label}
            </button>
          ))}
        </div>
        <div className="feature-search pcn-search" role="search">
          <Search size={16} aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search Concept Notes: title, originator, pillar, signatory…" aria-label="Search Concept Notes" />
          {query && (
            <button className="feature-search-clear" onClick={() => setQuery("")} aria-label="Clear search" title="Clear search">
              <X size={15} />
            </button>
          )}
        </div>
        {words.length > 0 && (
          <span className="viz-count" aria-live="polite">
            {listed.length} of {notes.length} match
          </span>
        )}
      </div>

      {listed.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>PCN</th>
                <th>Originator</th>
                <th>Submitted</th>
                <th>Status</th>
                <th>Signatories</th>
                <th>Project</th>
              </tr>
            </thead>
            <tbody>
              {listed.map((s) => {
                const st = pcnStatus(s.pcn);
                return (
                  <tr key={s.id}>
                    <td>
                      <a className="pcn-link" href={`#/projects/${s.id}/pcn`}>
                        <b>{s.pcn.title}</b>
                      </a>
                      <small className="muted">
                        {" "}
                        · {s.pcn.type}
                        {s.pcn.mainPillar && ` · ${s.pcn.mainPillar}`}
                      </small>
                    </td>
                    <td>{s.pcn.originator || "—"}</td>
                    <td>{formatDate(s.pcn.date)}</td>
                    <td>
                      <span className={`pill sm fill-${PCN_STATUS_META[st].tone === "red" ? "light" : PCN_STATUS_META[st].tone}`}>{PCN_STATUS_META[st].label}</span>
                    </td>
                    <td className="pcn-signer-list">
                      {s.pcn.signatories.map((g, i) => (
                        <span key={i} className={g.status === "APPROVED" ? "text-green" : g.status === "DECLINED" ? "text-red" : "muted"}>
                          {g.status === "APPROVED" ? "✓" : g.status === "DECLINED" ? "✗" : "…"} {g.name}
                        </span>
                      ))}
                    </td>
                    <td>
                      <a className="view-link" href={`#/projects/${s.id}`}>
                        Open
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">{!notes.length ? "No Concept Notes yet." : words.length ? `No Concept Notes match "${query.trim()}".` : "No Concept Notes match."}</div>
      )}
    </div>
  );
}
/** @typedef {System & { pcn: Pcn }} WithPcn */
