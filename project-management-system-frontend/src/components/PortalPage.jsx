/** @import { PortalRequest, RequestType } from '../data/servicedesk' */
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Headset, Plus } from "lucide-react";
import { formatDate } from "../time";
import { RequestForm, RequestView } from "./ServiceDeskParts";
import PulseMark from "./PulseMark";
/** The secret of a service desk portal link, when the page was opened at /portal/<secret>. */
/** @type {string | null} */ export const portalToken = typeof window !== "undefined" ? (window.location.pathname.match(/^\/portal\/([A-Za-z0-9_-]{20,})\/?$/)?.[1] ?? null) : null;
/**
 * This browser's key for this link: how it finds the requests it raised. Kept in this browser only.
 * @type {"pulse:portal-requester"}
 */
const KEY_STORE = "pulse:portal-requester";
/**
 * @returns {string | null}
 */
function requesterKey() {
  try {
    return localStorage.getItem(`${KEY_STORE}:${portalToken?.slice(0, 12)}`);
  } catch {
    return null;
  }
}
/**
 * @param {string} key
 * @returns {void}
 */
function rememberKey(key) {
  try {
    localStorage.setItem(`${KEY_STORE}:${portalToken?.slice(0, 12)}`, key);
  } catch {
    // Without storage the customer can still follow the request by email.
  }
}
/**
 * @template T
 * @param {string} path
 * @param {string} [method="GET"]
 * @param {unknown} [data]
 * @returns {Promise<T>}
 */
async function portal(path, method = "GET", data) {
  const key = requesterKey();
  const res = await fetch(`/api/portal${path}`, {
    method,
    headers: {
      "x-portal-token": portalToken ?? "",
      ...(key ? { "x-requester-key": key } : {}),
      ...(data !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error ?? `Request failed (${res.status})`);
  return /** @type {T} */ (payload);
}
/**
 * The service desk portal: raise a request and follow your own. No account, no internal items.
 */
export default function PortalPage() {
  const [info, setInfo] = useState(/** @type {{ label: string; organization?: string; ready: boolean; types: RequestType[] } | null | (() => { label: string; organization?: string; ready: boolean; types: RequestType[] } | null)} */ (null));
  const [error, setError] = useState("");
  const [view, setView] = useState(/** @type {"list" | "new" | PortalRequest | (() => "list" | "new" | PortalRequest)} */ ("list"));
  const [list, setList] = useState(/** @type {PortalRequest[] | (() => PortalRequest[])} */ ([]));
  const [notice, setNotice] = useState("");
  const loadList = useCallback(async () => {
    if (!requesterKey()) return setList([]);
    setList(await /** @type {Promise<Array<PortalRequest>>} */ (/** @type {unknown} */ (portal("/requests"))).catch(() => []));
  }, []);
  useEffect(() => {
    document.title = "Service desk";
    /** @type {Promise<{ label: string; organization?: string; ready: boolean; types: RequestType[]; }>} */ (/** @type {unknown} */ (portal("")))
      .then((i) => {
        setInfo(i);
        if (!requesterKey()) setView("new");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "This link doesn't work"));
    loadList();
  }, [loadList]);
  return (
    <div className="portal">
      <header className="portal-head">
        <PulseMark tone="dark" />
        <div>
          <h1>
            <Headset size={20} aria-hidden="true" /> {info?.organization ? `${info.organization} service desk` : "Service desk"}
          </h1>
          {info && <p>For {info.label}</p>}
        </div>
      </header>
      <main className="portal-main">
        {error ? (
          <p className="form-error banner">{error}</p>
        ) : !info ? (
          <p className="muted">Loading…</p>
        ) : !info.ready ? (
          <p className="muted">The service desk isn't open yet. Please try again later.</p>
        ) : view === "new" ? (
          <>
            {list.length > 0 && (
              <button className="icon-link back-link" onClick={() => setView("list")}>
                <ArrowLeft size={14} /> Your requests
              </button>
            )}
            <h2>Raise a request</h2>
            <RequestForm
              types={info.types}
              askContact
              onSubmit={async (b) => {
                const r = await /** @type {Promise<{ key: string; requesterKey: string; }>} */ (/** @type {unknown} */ (portal("/requests", "POST", { ...b, requesterKey: requesterKey() ?? undefined })));
                rememberKey(r.requesterKey);
                setNotice(`Thank you. Your request is ${r.key}. We've emailed you a copy; you can follow it here.`);
                await loadList();
                setView("list");
              }}
            />
          </>
        ) : view === "list" ? (
          <>
            {notice && (
              <p className="form-ok" role="status">
                {notice}
              </p>
            )}
            <div className="portal-bar">
              <h2>Your requests</h2>
              <button className="btn btn-amber sm" onClick={() => setView("new")}>
                <Plus size={14} /> Raise a request
              </button>
            </div>
            {!list.length ? (
              <p className="muted">Requests you raise from this browser appear here.</p>
            ) : (
              <ul className="request-list">
                {list.map((r) => (
                  <li key={r.key}>
                    <button
                      className="request-row"
                      onClick={async () => {
                        try {
                          setView(await /** @type {Promise<PortalRequest>} */ (/** @type {unknown} */ (portal(`/requests/${r.key}`))));
                        } catch (e) {
                          setError(e instanceof Error ? e.message : "Couldn't open it");
                        }
                      }}
                    >
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
            )}
          </>
        ) : (
          <>
            <button className="icon-link back-link" onClick={() => setView("list")}>
              <ArrowLeft size={14} /> Your requests
            </button>
            <RequestView request={view} onReply={async (text) => setView(await /** @type {Promise<PortalRequest>} */ (/** @type {unknown} */ (portal(`/requests/${view.key}/reply`, "POST", { body: text }))))} />
          </>
        )}
      </main>
      <footer className="portal-foot">Only you see your requests here. Please don't share this link outside your team.</footer>
    </div>
  );
}
