/** @import { System } from '../data/systems' */
/** @import { ActivityEntry, User } from '../data/roles' */
// The project page's other tabs (docs/design/project-cockpit-mockups.html): Risks & Security (the 5×5 heat map, the
// register, findings by severity and age), Testing (the suites, the pass-rate trend, failed tests and their bugs),
// Team (who, their role, hours logged here, open work here and the share of their open work that is), Activity (the
// project's whole history, filtered) and Chat (the project's channel). Each loads its own data when it opens.
import { useEffect, useMemo, useState } from "react";
import { Bug, Hash, MessagesSquare, Search, ShieldAlert, Users } from "lucide-react";
import { api } from "../data/api";
import { riskRating } from "../data/lifecycle";
import { initials } from "../data/systems";
import { ROLE_LABEL } from "../data/roles";
import { formatDate, timeAgo } from "../time";
import { describe } from "./ActivityPage";
import ChatPage from "./ChatPage";

const DAY = 86_400_000;
const noop = () => undefined;

/** The lifecycle view (GET /api/systems/:id/lifecycle), for the Risks and Testing tabs. @param {string} systemId */
function useLifecycle(systemId) {
  const [view, setView] = useState(/** @type {any} */ (undefined));
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setView(undefined);
    api(`/systems/${systemId}/lifecycle`)
      .then((r) => live && setView(/** @type {any} */ (r).lifecycle))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Couldn't load the lifecycle"));
    return () => {
      live = false;
    };
  }, [systemId]);
  return { view, error };
}
/** @param {{ systemId: string; what: string }} p */
function NoLifecycle({ systemId, what }) {
  return (
    <div className="ck-card ck-tab-empty">
      <p>
        {what} live in the project's lifecycle, and this project doesn't have one yet. <a href={`#/projects/${systemId}/lifecycle`}>Open the Lifecycle tab</a> to start it.
      </p>
    </div>
  );
}

// ---------- Risks & Security ----------
const LEVEL_TONE = { Critical: "bad", High: "bad", Medium: "warn", Low: "ok" };
/** @param {{ system: System; now: number }} p */
export function RisksTab({ system, now }) {
  const { view, error } = useLifecycle(system.id);
  const [cell, setCell] = useState(/** @type {{ l: number; i: number } | null} */ (null));
  const [showClosed, setShowClosed] = useState(false);
  if (error) return <p className="form-error banner">{error}</p>;
  if (view === undefined) return <p className="lead-none">Loading…</p>;
  if (!view) return <NoLifecycle systemId={system.id} what="Risks and security findings" />;
  /** @type {any[]} */ const risks = view.risks;
  /** @type {any[]} */ const findings = view.findings;
  const open = risks.filter((r) => r.status === "open");
  const count = (/** @type {number} */ l, /** @type {number} */ i) => open.filter((r) => Number(r.likelihood) === l && Number(r.impact) === i).length;
  const shown = risks
    .filter((r) => showClosed || r.status === "open")
    .filter((r) => !cell || (Number(r.likelihood) === cell.l && Number(r.impact) === cell.i))
    .sort((a, b) => Number(b.likelihood) * Number(b.impact) - Number(a.likelihood) * Number(a.impact));
  const sev = ["Critical", "High", "Medium", "Low", "Info"];
  const age = (/** @type {any} */ f) => Math.floor((now - Date.parse(f.created_at)) / DAY);
  return (
    <div className="ck-tab">
      <div className="ck-tab-row">
        <section className="ck-card ck-pad" aria-labelledby="ck-heat-t">
          <h3 id="ck-heat-t" className="ck-h3">Open risks by likelihood and impact</h3>
          <p className="ck-insight">{open.length ? `${open.length} open; ${open.filter((r) => ["High", "Critical"].includes(riskRating(Number(r.likelihood), Number(r.impact)))).length} High or Critical. Click a square to list its risks.` : "No open risks."}</p>
          <div className="ck-heat" role="grid" aria-label="Risk heat map: likelihood up, impact across">
            {[5, 4, 3, 2, 1].map((l) => (
              <div className="ck-heat-row" role="row" key={l}>
                <span className="ck-heat-axis" role="rowheader">{l}</span>
                {[1, 2, 3, 4, 5].map((i) => {
                  const n = count(l, i);
                  const level = riskRating(l, i);
                  const on = cell?.l === l && cell?.i === i;
                  return (
                    <button
                      key={i}
                      role="gridcell"
                      className={`ck-heat-cell ${level.toLowerCase()} ${n ? "has" : ""} ${on ? "on" : ""}`}
                      aria-label={`Likelihood ${l}, impact ${i}: ${level}, ${n} open ${n === 1 ? "risk" : "risks"}`}
                      aria-pressed={on}
                      onClick={() => setCell(on ? null : { l, i })}
                    >
                      {n || ""}
                    </button>
                  );
                })}
              </div>
            ))}
            <div className="ck-heat-row ck-heat-foot" aria-hidden="true">
              <span className="ck-heat-axis" />
              {[1, 2, 3, 4, 5].map((i) => (
                <span key={i} className="ck-heat-axis">
                  {i}
                </span>
              ))}
            </div>
            <p className="ck-heat-labels">
              <span>↑ Likelihood</span>
              <span>Impact →</span>
            </p>
          </div>
        </section>
        <section className="ck-card ck-pad" aria-labelledby="ck-find-t">
          <h3 id="ck-find-t" className="ck-h3">
            <ShieldAlert size={16} aria-hidden="true" /> Security findings
          </h3>
          <p className="ck-insight">{findings.length ? `${findings.filter((f) => f.status === "open").length} open of ${findings.length}.` : "No findings recorded."}</p>
          <ul className="ck-sev">
            {sev.map((s) => {
              const all = findings.filter((f) => f.severity === s);
              const op = all.filter((f) => f.status === "open");
              const oldest = op.length ? Math.max(...op.map(age)) : null;
              return (
                <li key={s}>
                  <span className={`ck-chip ${LEVEL_TONE[/** @type {keyof typeof LEVEL_TONE} */ (s)] ?? "info"}`}>{s}</span>
                  <span className="ck-sev-bar" aria-hidden="true">
                    <i style={{ width: `${findings.length ? (op.length / findings.length) * 100 : 0}%` }} />
                  </span>
                  <span className="ck-sev-n">
                    {op.length} open{all.length > op.length ? ` · ${all.length - op.length} fixed or accepted` : ""}
                    {oldest !== null ? ` · oldest ${oldest} ${oldest === 1 ? "day" : "days"}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
          {findings.filter((f) => f.status === "accepted").map((f) => (
            <p key={f.id} className="ck-accepted">
              Accepted: <b>{f.title}</b> ({f.severity}) by {f.accepted_name ?? "a Manager"}
              {f.accepted_until ? ` until ${formatDate(f.accepted_until)}` : ""}
              {f.accepted_reason ? `: ${f.accepted_reason}` : ""}
            </p>
          ))}
        </section>
      </div>
      <section className="ck-card ck-pad" aria-labelledby="ck-reg-t">
        <div className="ck-card-head">
          <h3 id="ck-reg-t" className="ck-h3">Risk register</h3>
          {cell && (
            <button className="ck-chip info ck-filter" onClick={() => setCell(null)}>
              Likelihood {cell.l} × impact {cell.i} · clear
            </button>
          )}
          <span className="ck-grow" />
          <label className="ck-check">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show closed
          </label>
          <a className="btn btn-ghost sm" href={`#/projects/${system.id}/lifecycle`}>
            Add or change in Lifecycle
          </a>
        </div>
        {shown.length ? (
          <div className="ck-table-wrap tall">
            <table className="ck-table left">
              <thead>
                <tr>
                  <th scope="col">Risk</th>
                  <th scope="col">Rating</th>
                  <th scope="col">L × I</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Mitigation</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const level = riskRating(Number(r.likelihood), Number(r.impact));
                  return (
                    <tr key={r.id}>
                      <th scope="row">{r.risk}</th>
                      <td>
                        <span className={`ck-chip ${LEVEL_TONE[/** @type {keyof typeof LEVEL_TONE} */ (level)]}`}>{level}</span>
                      </td>
                      <td>
                        {r.likelihood} × {r.impact}
                      </td>
                      <td>{r.owner_name ?? <span className="warn-text">No owner</span>}</td>
                      <td className="wrap">{r.mitigation || <span className="faint">–</span>}</td>
                      <td>{r.status === "open" ? "Open" : "Closed"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="lead-none">{cell ? "No open risk in that square." : "No risks recorded."}</p>
        )}
      </section>
    </div>
  );
}

// ---------- Testing ----------
/**
 * The pass rate of a suite after each day it was run: each case's latest result up to that day, waived ones aside.
 * @param {any[]} tests the suite's cases, each with its runs
 */
export function passTrend(tests) {
  const days = [...new Set(tests.flatMap((t) => t.runs.map((/** @type {any} */ r) => String(r.run_at).slice(0, 10))))].sort();
  return days.map((d) => {
    let pass = 0;
    let counted = 0;
    for (const t of tests) {
      const upTo = t.runs.filter((/** @type {any} */ r) => String(r.run_at).slice(0, 10) <= d);
      const last = upTo[upTo.length - 1];
      if (!last || last.result === "waived") continue;
      counted++;
      if (last.result === "pass") pass++;
    }
    return { day: d, rate: counted ? Math.floor((pass / counted) * 1000) / 10 : null, counted };
  });
}
/** @param {{ system: System; now: number }} p */
export function TestingTab({ system, now }) {
  const { view, error } = useLifecycle(system.id);
  if (error) return <p className="form-error banner">{error}</p>;
  if (view === undefined) return <p className="lead-none">Loading…</p>;
  if (!view) return <NoLifecycle systemId={system.id} what="QAT, UAT and smoke tests" />;
  /** @type {any[]} */ const tests = view.tests;
  const suites = [...new Set(tests.map((t) => t.suite))];
  if (!suites.length)
    return (
      <div className="ck-card ck-tab-empty">
        <p>
          No test cases yet. They're added at the QAT, UAT and smoke-test stages, in the <a href={`#/projects/${system.id}/lifecycle`}>Lifecycle tab</a>.
        </p>
      </div>
    );
  const threshold = /** @type {any[]} */ (view.template.definition.stages).find((s) => s.testing?.suite === "QAT")?.testing?.passThreshold;
  return (
    <div className="ck-tab">
      {suites.map((suite) => {
        const cases = tests.filter((t) => t.suite === suite);
        const latest = (/** @type {any} */ t) => t.runs[t.runs.length - 1];
        const s = view.testSummary[suite] ?? { total: 0, pass: 0, fail: 0, blocked: 0, waived: 0, notRun: 0 };
        const rate = s.total - s.waived ? Math.floor((s.pass / (s.total - s.waived)) * 1000) / 10 : null;
        const trend = passTrend(cases);
        const failed = cases.filter((t) => latest(t)?.result === "fail");
        const W = 600;
        const x = (/** @type {number} */ i) => 30 + (560 * i) / Math.max(1, trend.length - 1);
        const y = (/** @type {number} */ v) => 110 - v;
        return (
          <section key={suite} className="ck-card ck-pad" aria-labelledby={`ck-suite-${suite}`}>
            <div className="ck-card-head">
              <h3 id={`ck-suite-${suite}`} className="ck-h3">
                {suite === "SMOKE" ? "Smoke tests" : `${suite}s`}
              </h3>
              <span className={`ck-chip ${rate === null ? "info" : suite === "QAT" && threshold && rate < threshold * 100 ? "bad" : "ok"}`}>{rate === null ? "Not run" : `${rate}% pass`}</span>
              <span className="ck-grow" />
              <small>
                {s.pass} passed · {s.fail} failed · {s.blocked} blocked · {s.waived} waived · {s.notRun} not run
              </small>
            </div>
            {trend.length > 1 && (
              <svg viewBox={`0 0 ${W} 130`} className="ck-svg ck-trend" role="img" aria-label={`${suite} pass rate over time: from ${trend[0].rate ?? 0}% to ${trend[trend.length - 1].rate ?? 0}%`}>
                {[0, 50, 100].map((t) => (
                  <g key={t}>
                    <line x1={30} x2={590} y1={y(t)} y2={y(t)} className="ck-grid" />
                    <text x={24} y={y(t) + 4} textAnchor="end" className="ck-axis">
                      {t}%
                    </text>
                  </g>
                ))}
                {suite === "QAT" && threshold ? <line x1={30} x2={590} y1={y(threshold * 100)} y2={y(threshold * 100)} className="ck-target" /> : null}
                <polyline className="ck-line c1" points={trend.map((d, i) => `${x(i)},${y(d.rate ?? 0)}`).join(" ")} />
                {trend.map((d, i) => (
                  <circle key={d.day} cx={x(i)} cy={y(d.rate ?? 0)} r={3.5} className="ck-mark c1">
                    <title>{`${formatDate(d.day)}: ${d.rate ?? 0}% of ${d.counted}`}</title>
                  </circle>
                ))}
                <text x={30} y={126} className="ck-axis">
                  {formatDate(trend[0].day)}
                </text>
                <text x={590} y={126} textAnchor="end" className="ck-axis">
                  {formatDate(trend[trend.length - 1].day)}
                </text>
              </svg>
            )}
            {failed.length > 0 && (
              <div className="ck-failed">
                <b>
                  <Bug size={14} aria-hidden="true" /> Failing now
                </b>
                <ul>
                  {failed.map((t) => {
                    const r = latest(t);
                    return (
                      <li key={t.id}>
                        <span>{t.title}</span>
                        <small>
                          {formatDate(r.run_at)} · {r.run_name ?? "Someone"}
                          {r.notes ? ` · ${r.notes}` : ""}
                        </small>
                        {r.bug_key ? (
                          <a className="ck-chip bad" href={`#/projects/${system.id}/items/${r.bug_key}`}>
                            {r.bug_key}
                          </a>
                        ) : (
                          <span className="ck-chip info">No bug raised</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            <div className="ck-table-wrap tall">
              <table className="ck-table left">
                <thead>
                  <tr>
                    <th scope="col">Test</th>
                    {suite === "UAT" && <th scope="col">Scenario</th>}
                    <th scope="col">Tester</th>
                    <th scope="col">Latest result</th>
                    <th scope="col">Runs</th>
                  </tr>
                </thead>
                <tbody>
                  {cases.map((t) => {
                    const r = latest(t);
                    return (
                      <tr key={t.id}>
                        <th scope="row" className="wrap">
                          {t.title}
                        </th>
                        {suite === "UAT" && <td className="wrap">{t.scenario || "–"}</td>}
                        <td>{t.assignee_name ?? "–"}</td>
                        <td>{r ? <span className={`ck-chip ${r.result === "pass" ? "ok" : r.result === "fail" ? "bad" : r.result === "blocked" ? "warn" : "info"}`}>{r.result === "pass" ? "Pass" : r.result === "fail" ? "Fail" : r.result === "blocked" ? "Blocked" : "Waived"}</span> : "Not run"}</td>
                        <td>
                          {t.runs.length}
                          {r ? ` · ${timeAgo(r.run_at, now)}` : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      <p className="ck-note-line">
        Record results in the <a href={`#/projects/${system.id}/lifecycle`}>Lifecycle tab</a>, at the testing stage. A failed test raises a bug automatically.
      </p>
    </div>
  );
}

// ---------- Team ----------
/** @param {{ system: System; capacityHours: number }} p */
export function TeamTab({ system, capacityHours }) {
  const [data, setData] = useState(/** @type {any[] | null} */ (null));
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    api(`/systems/${system.id}/team`)
      .then((r) => live && setData(/** @type {any} */ (r).people))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Couldn't load the team"));
    return () => {
      live = false;
    };
  }, [system.id]);
  if (error) return <p className="form-error banner">{error}</p>;
  if (!data) return <p className="lead-none">Loading…</p>;
  if (!data.length)
    return (
      <div className="ck-card ck-tab-empty">
        <p>Nobody is on this project yet. Add the lead and developers on the Overview.</p>
      </div>
    );
  const most = Math.max(1, ...data.map((p) => p.hoursRecent));
  return (
    <div className="ck-tab">
      <section className="ck-card ck-pad" aria-labelledby="ck-team-t">
        <div className="ck-card-head">
          <Users size={16} aria-hidden="true" />
          <h3 id="ck-team-t" className="ck-h3">
            Team · {data.length}
          </h3>
          <span className="ck-grow" />
          <small>Hours and items you can see. Weekly capacity {capacityHours} h a person (this week's load is on the Overview).</small>
        </div>
        <div className="ck-table-wrap tall">
          <table className="ck-table left">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Role</th>
                <th scope="col">Hours here, 30 days</th>
                <th scope="col">Hours here, in all</th>
                <th scope="col">Open here</th>
                <th scope="col">Done here, 30 days</th>
                <th scope="col">Share of their open work</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id}>
                  <th scope="row">
                    <span className="ck-person">
                      <span className={`ck-av sm ${p.lead ? "lead" : ""}`}>{initials(p.name)}</span>
                      <span>
                        <b>{p.name}</b>
                        <small>{p.lead ? "Project lead" : p.title ?? ""}</small>
                      </span>
                    </span>
                  </th>
                  <td>{ROLE_LABEL[/** @type {keyof typeof ROLE_LABEL} */ (p.role)] ?? p.role}</td>
                  <td>
                    <span className="ck-hbar" aria-hidden="true">
                      <i style={{ width: `${(p.hoursRecent / most) * 100}%` }} />
                    </span>
                    {p.hoursRecent} h
                  </td>
                  <td>{p.hoursAll} h</td>
                  <td>{p.openHere}</td>
                  <td>{p.doneRecent}</td>
                  <td>{p.share === null ? "–" : `${p.share}% (${p.openHere} of ${p.openAll})`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ---------- Activity ----------
const GROUPS = /** @type {const} */ ([
  ["all", "All"],
  ["stages", "Stages and sign-offs"],
  ["work", "Work items"],
  ["docs", "Documents"],
  ["updates", "Updates and blockers"],
  ["people", "People and settings"],
]);
/** Which filter an activity entry belongs to. @param {string} action */
export function activityGroup(action) {
  if (/^(stage_|signoff_|lifecycle_|pcn_)/.test(action)) return "stages";
  if (/^(work_item|work_items|comment_|link_|attachment_|time_|sprint_|backlog_)/.test(action)) return "work";
  if (/^(document_|project_document)/.test(action)) return "docs";
  if (/^(system_progress|request_|blocker_|feature_)/.test(action)) return "updates";
  return "people";
}
/** @param {{ history: ActivityEntry[] | null; users: User[]; systems: System[]; now: number }} p */
export function ActivityTab({ history, users, systems, now }) {
  const [group, setGroup] = useState(/** @type {string} */ ("all"));
  const [q, setQ] = useState("");
  const rows = useMemo(
    () =>
      (history ?? []).map((e) => ({ e, text: describe(e, users, systems), group: activityGroup(e.action) })),
    [history, users, systems],
  );
  if (history === null) return <p className="lead-none">Loading…</p>;
  const shown = rows.filter((r) => (group === "all" || r.group === group) && (!q.trim() || `${r.text} ${r.e.actor}`.toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <div className="ck-tab">
      <section className="ck-card ck-pad" aria-labelledby="ck-act-t">
        <div className="ck-card-head">
          <h3 id="ck-act-t" className="ck-h3">Activity</h3>
          <span className="ck-grow" />
          <label className="ck-search">
            <Search size={14} aria-hidden="true" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find in the history" aria-label="Find in the history" />
          </label>
        </div>
        <div className="ck-filters" role="group" aria-label="Show">
          {GROUPS.map(([k, label]) => (
            <button key={k} className={`ck-pill ${group === k ? "on" : ""}`} aria-pressed={group === k} onClick={() => setGroup(k)}>
              {label}
              <span>{k === "all" ? rows.length : rows.filter((r) => r.group === k).length}</span>
            </button>
          ))}
        </div>
        {shown.length ? (
          <ol className="ck-feed">
            {shown.map(({ e, text }) => (
              <li key={e.id}>
                <span className="ck-av sm">{initials(e.actor)}</span>
                <span className="ck-drow-text">
                  <span>{text}</span>
                  <small title={new Date(e.at).toLocaleString("en-GB")}>
                    {e.actor} · {timeAgo(e.at, now)}
                  </small>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="lead-none">{rows.length ? "Nothing matches." : "Nothing recorded yet."}</p>
        )}
        <p className="ck-foot">
          <span>The last {rows.length} changes to this project. The whole audit trail is in Settings → Activity.</span>
        </p>
      </section>
    </div>
  );
}

// ---------- Chat ----------
/** @param {{ system: System; me: User; users: User[] }} p */
export function ProjectChat({ system, me, users }) {
  const id = `p-${system.id}`;
  const [state, setState] = useState(/** @type {"checking" | "ready" | "join" | string} */ ("checking"));
  useEffect(() => {
    let live = true;
    setState("checking");
    api(`/chat/${id}`)
      .then(() => live && setState("ready"))
      .catch(() => live && setState("join"));
    return () => {
      live = false;
    };
  }, [id]);
  if (state === "checking") return <p className="lead-none">Loading…</p>;
  if (state !== "ready")
    return (
      <div className="ck-card ck-tab-empty">
        <p>
          <Hash size={16} aria-hidden="true" /> This project's channel hasn't started yet.
        </p>
        {state !== "join" && <p className="form-error">{state}</p>}
        <button
          className="btn btn-navy sm"
          onClick={async () => {
            try {
              await api(`/chat/projects/${system.id}/join`, "POST");
              setState("ready");
            } catch (e) {
              setState(e instanceof Error ? e.message : "Couldn't open the channel");
            }
          }}
        >
          <MessagesSquare size={15} aria-hidden="true" /> Open the channel
        </button>
      </div>
    );
  return <ChatPage me={me} users={users} canModerate={false} openId={id} onUnread={noop} docked />;
}
