import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Headset } from "lucide-react";
import { api } from "../data/api";
import type { User } from "../data/roles";
import { QUEUES, REQUEST_KINDS, formatBusinessMinutes, type PortalRequest, type QueueItem, type QueueKey, type RequestType } from "../data/servicedesk";
import { timeAgo, formatDate } from "../time";
import { ItemPriority, ItemStatusPill, TypeIcon, itemHref } from "./WorkItemBits";
import { RequestForm, RequestView, SlaBadge } from "./ServiceDeskParts";

type Tab = "queues" | "raise" | "mine" | "reports";

interface Report {
  days: number;
  total: number;
  open: number;
  firstResponse: { met: number; breached: number };
  resolution: { met: number; breached: number };
  averageResolveMinutes: number | null;
  byType: { name: string; kind: keyof typeof REQUEST_KINDS; count: number; resolved: number; averageResolveMinutes: number | null }[];
  byWeek: { week: string; count: number }[];
}

/** Service desk: the team's queues, raising a request, your own requests, and the reports. */
export default function ServiceDeskPage({ users, canWork, canReports }: { users: User[]; canWork: boolean; canReports: boolean }) {
  const tabs: { key: Tab; label: string }[] = [
    ...(canWork ? [{ key: "queues" as const, label: "Queues" }] : []),
    { key: "raise", label: "Raise a request" },
    { key: "mine", label: "My requests" },
    ...(canReports ? [{ key: "reports" as const, label: "Reports" }] : []),
  ];
  const [tab, setTab] = useState<Tab>(tabs[0].key);
  return (
    <div className="page service-desk">
      <header className="page-head">
        <div>
          <h2>
            <Headset size={20} aria-hidden="true" /> Service desk
          </h2>
          <p>Incidents, service requests, changes and questions, with response and resolution targets in business hours.</p>
        </div>
      </header>
      <div className="seg" role="tablist" aria-label="Service desk">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="sd-panel">
        {tab === "queues" && <Queues users={users} />}
        {tab === "raise" && <Raise onRaised={() => setTab("mine")} />}
        {tab === "mine" && <MyRequests />}
        {tab === "reports" && <Reports />}
      </div>
    </div>
  );
}

function Queues({ users }: { users: User[] }) {
  const [queue, setQueue] = useState<QueueKey>("unassigned");
  const [data, setData] = useState<{ items: QueueItem[]; total: number; counts: Record<QueueKey, number> } | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setData(await api(`/service-desk/queues?queue=${queue}&limit=100`));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the queue");
    }
  }, [queue]);
  useEffect(() => {
    load();
  }, [load]);
  const now = Date.now();
  const name = (id?: string) => users.find((u) => u.id === id)?.name;
  return (
    <>
      <nav className="queue-tabs" aria-label="Queues">
        {QUEUES.map((q) => (
          <button key={q.key} className={queue === q.key ? "on" : ""} aria-pressed={queue === q.key} onClick={() => setQueue(q.key)}>
            {q.label} <span className={`nav-count ${q.key === "breached" && (data?.counts.breached ?? 0) > 0 ? "alert" : ""}`}>{data?.counts[q.key] ?? "…"}</span>
          </button>
        ))}
      </nav>
      {error && <p className="form-error">{error}</p>}
      {data && !data.items.length && <div className="empty">Nothing in this queue.</div>}
      {data && data.items.length > 0 && (
        <div className="table-wrap">
          <table className="table wi-table">
            <caption className="sr-only">{QUEUES.find((q) => q.key === queue)?.label}, most urgent first</caption>
            <thead>
              <tr>
                <th scope="col">Request</th>
                <th scope="col">Type</th>
                <th scope="col">Customer</th>
                <th scope="col">Status</th>
                <th scope="col">Priority</th>
                <th scope="col">Assignee</th>
                <th scope="col">SLA</th>
                <th scope="col">Raised</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.id}>
                  <td>
                    <TypeIcon type={i.type} /> <a href={itemHref(i.systemId, i.key)}>{i.key}</a> {i.summary}
                  </td>
                  <td>{i.requestType}</td>
                  <td>{i.customerName}</td>
                  <td>
                    <ItemStatusPill item={i} />
                  </td>
                  <td>
                    <ItemPriority priority={i.priority} />
                  </td>
                  <td>{name(i.assignee) ?? <i className="muted">Unassigned</i>}</td>
                  <td className="sla-cell">
                    {i.sla.firstResponse.state !== "met" && <SlaBadge label="Reply" clock={i.sla.firstResponse} />}
                    <SlaBadge label="Resolve" clock={i.sla.resolution} />
                  </td>
                  <td title={new Date(i.createdAt).toLocaleString("en-GB")}>{timeAgo(i.createdAt, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Raise({ onRaised }: { onRaised: () => void }) {
  const [types, setTypes] = useState<RequestType[] | null>(null);
  const [ready, setReady] = useState(true);
  const [done, setDone] = useState("");
  useEffect(() => {
    api<{ systemId: string | null; types: RequestType[] }>("/service-desk/config")
      .then((c) => {
        setTypes(c.types.filter((t) => t.enabled));
        setReady(!!c.systemId);
      })
      .catch(() => setTypes([]));
  }, []);
  if (!types) return <p className="muted">Loading…</p>;
  if (!ready) return <p className="muted">The service desk isn't set up yet. An administrator chooses its project in Settings → Administration → Service desk.</p>;
  return (
    <>
      {done && (
        <p className="form-ok" role="status">
          {done}{" "}
          <button className="icon-link" onClick={onRaised}>
            See my requests
          </button>
        </p>
      )}
      <RequestForm
        types={types}
        askContact={false}
        onSubmit={async (b) => {
          const r = await api<{ key: string }>("/service-desk/requests", "POST", b);
          setDone(`Sent as ${r.key}. The team will reply under your bell and by email.`);
        }}
      />
    </>
  );
}

function MyRequests() {
  const [list, setList] = useState<PortalRequest[] | null>(null);
  const [open, setOpen] = useState<PortalRequest | null>(null);
  useEffect(() => {
    api<PortalRequest[]>("/service-desk/my-requests").then(setList).catch(() => setList([]));
  }, []);
  if (open)
    return (
      <>
        <button className="icon-link back-link" onClick={() => setOpen(null)}>
          <ArrowLeft size={14} /> All my requests
        </button>
        <RequestView request={open} onReply={async (text) => setOpen(await api<PortalRequest>(`/service-desk/my-requests/${open.key}/reply`, "POST", { body: text }))} />
      </>
    );
  if (!list) return <p className="muted">Loading…</p>;
  if (!list.length) return <div className="empty">You haven't raised any requests.</div>;
  return (
    <ul className="request-list">
      {list.map((r) => (
        <li key={r.key}>
          <button className="request-row" onClick={async () => setOpen(await api<PortalRequest>(`/service-desk/my-requests/${r.key}`))}>
            <b>
              {r.key} {r.summary}
            </b>
            <small>
              {r.typeName} · {r.waiting ? "Waiting for your reply" : r.statusName} · raised {formatDate(r.createdAt)}
            </small>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Reports() {
  const [days, setDays] = useState(30);
  const [r, setR] = useState<Report | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<Report>(`/service-desk/reports?days=${days}`)
      .then(setR)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load the reports"));
  }, [days]);
  const pct = (a: number, b: number) => (a + b ? `${Math.round((a / (a + b)) * 100)}%` : "—");
  const maxWeek = Math.max(1, ...(r?.byWeek.map((w) => w.count) ?? [1]));
  return (
    <>
      <label className="field narrow-select">
        <span>Period</span>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[7, 30, 90, 180, 365].map((d) => (
            <option key={d} value={d}>
              Last {d} days
            </option>
          ))}
        </select>
      </label>
      {error && <p className="form-error">{error}</p>}
      {r && (
        <>
          <div className="sd-figures">
            <div>
              <b>{r.total}</b>
              <span>requests ({r.open} open)</span>
            </div>
            <div>
              <b>{pct(r.firstResponse.met, r.firstResponse.breached)}</b>
              <span>
                first replies on time ({r.firstResponse.met} met, {r.firstResponse.breached} breached)
              </span>
            </div>
            <div>
              <b>{pct(r.resolution.met, r.resolution.breached)}</b>
              <span>
                resolved on time ({r.resolution.met} met, {r.resolution.breached} breached)
              </span>
            </div>
            <div>
              <b>{r.averageResolveMinutes == null ? "—" : formatBusinessMinutes(r.averageResolveMinutes)}</b>
              <span>average time to resolve (business time)</span>
            </div>
          </div>
          <h3>Volume by type</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col">Requests</th>
                  <th scope="col">Resolved</th>
                  <th scope="col">Average time to resolve</th>
                </tr>
              </thead>
              <tbody>
                {r.byType.map((t) => (
                  <tr key={t.name}>
                    <th scope="row">
                      {t.name} <small className="muted">{REQUEST_KINDS[t.kind]}</small>
                    </th>
                    <td>{t.count}</td>
                    <td>{t.resolved}</td>
                    <td>{t.averageResolveMinutes == null ? "—" : formatBusinessMinutes(t.averageResolveMinutes)}</td>
                  </tr>
                ))}
                {!r.byType.length && (
                  <tr>
                    <td colSpan={4} className="muted">
                      No requests in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <h3>Requests each week</h3>
          <ul className="week-bars" aria-label="Requests each week">
            {r.byWeek.map((w) => (
              <li key={w.week}>
                <span className="week-label">{formatDate(w.week)}</span>
                <span className="bar-cell">
                  <i style={{ width: `${(w.count / maxWeek) * 100}%` }} />
                  {w.count}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
