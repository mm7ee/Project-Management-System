import { BRAND } from "../data/brand";
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Eye, Link2, Plus } from "lucide-react";
import { api } from "../data/api";
import { formatDate, timeAgo } from "../time";
/** The two kinds of secret link, both for the open workspace only. */
const KINDS = {
  view: {
    endpoint: "/share-links",
    title: "View-only links",
    intro:
      `Let managers or leadership browse this workspace without an account: the dashboard, projects, feature requests, Concept Notes, reports and ${BRAND.assistantName}, read-only. Anyone with the link can see it until it expires, so share it only with the people it's for. Contact details are hidden and documents can't be downloaded.`,
    days: [1, 7, 30, 90],
    first: 7,
  },
  executive: {
    endpoint: "/showcase-links",
    title: "Executive page links",
    intro:
      "The executive page shows how the system works and this workspace's portfolio as live totals: no names of projects, people or blockers. Anyone with the link can open it until it expires.",
    days: [7, 30, 90, 365],
    first: 30,
  },
};
/**
 * Secret links that expire, for people without an account: view-only links (browse this workspace read-only) or
 * executive page links (its totals). The link is shown once, when it's made.
 * @param {{ kind?: keyof typeof KINDS }} props
 */
export default function ShareLinks({ kind = "view" }) {
  const k = KINDS[kind];
  const [links, setLinks] = useState(/** @type {ShareLink[] | null | (() => ShareLink[] | null)} */ (null));
  const [label, setLabel] = useState("");
  const [days, setDays] = useState(k.first);
  const [made, setMade] = useState(/** @type {{ url: string; label: string } | null | (() => { url: string; label: string } | null)} */ (null));
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState(/** @type {string | null | (() => string | null)} */ (null));
  const [error, setError] = useState("");
  const now = Date.now();
  const load = useCallback(() => /** @type {Promise<Array<ShareLink>>} */ (/** @type {unknown} */ (api(k.endpoint))).then(setLinks), [k.endpoint]);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);
  const run = /** @param {() => Promise<unknown>} fn */ async (fn) => {
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  };
  const status = /** @param {ShareLink} l */ (l) => (l.revokedAt ? "Turned off" : Date.parse(l.expiresAt) <= now ? "Expired" : "Active");
  return (
    <section className="set-card share-links">
      <header className="set-head">
        <span className="set-icon">
          <Link2 size={18} />
        </span>
        <div>
          <h3>{k.title}</h3>
          <p>{k.intro}</p>
        </div>
      </header>

      <form
        className="share-form"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const r = await /** @type {Promise<{ url: string; }>} */ (/** @type {unknown} */ (api(k.endpoint, "POST", { label, days })));
            setMade({ url: r.url, label });
            setCopied(false);
            setLabel("");
          });
        }}
      >
        <label className="field">
          <span>Who it's for</span>
          <input required maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Exco review, Board meeting" />
        </label>
        <label className="field">
          <span>Works for</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {k.days.map((d) => (
              <option key={d} value={d}>
                {d === 1 ? "1 day" : d === 365 ? "1 year" : `${d} days`}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-navy">
          <Plus size={16} /> Create link
        </button>
      </form>

      {made && (
        <div className="share-made" role="status">
          <p>
            <b>Link for {made.label}.</b> Copy it now: for safety it isn't shown again.
          </p>
          <div className="share-url">
            <code>{made.url}</code>
            <button
              type="button"
              className="btn btn-ghost sm"
              onClick={async () => {
                await navigator.clipboard.writeText(made.url).catch(() => undefined);
                setCopied(true);
              }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
      {error && <p className="form-error">{error}</p>}

      {links && links.length > 0 && (
        <ul className="share-list">
          {links.map((l) => (
            <li key={l.id} className={status(l) === "Active" ? "" : "inactive"}>
              <Eye size={16} />
              <span className="share-text">
                <b>{l.label}</b>
                <small>
                  {status(l)} · {status(l) === "Active" ? `expires ${formatDate(l.expiresAt)}` : formatDate(l.revokedAt ?? l.expiresAt)} · {l.views} view
                  {l.views === 1 ? "" : "s"}
                  {l.lastUsedAt ? `, last ${timeAgo(l.lastUsedAt, now)}` : ""} · made by {l.createdBy}
                </small>
              </span>
              {status(l) === "Active" &&
                (confirm === l.id ? (
                  <span className="page-actions">
                    <button className="btn btn-ghost sm" onClick={() => setConfirm(null)}>
                      Keep
                    </button>
                    <button className="btn btn-danger sm" onClick={() => run(() => api(`${k.endpoint}/${l.id}`, "DELETE")).then(() => setConfirm(null))}>
                      Turn off now
                    </button>
                  </span>
                ) : (
                  <button className="btn btn-ghost sm danger-text" onClick={() => setConfirm(l.id)}>
                    Turn off
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
/**
 * @typedef {Object} ShareLink
 * @property {string} id
 * @property {string} label
 * @property {string} createdBy
 * @property {string} createdAt
 * @property {string} expiresAt
 * @property {string} [revokedAt]
 * @property {string} [lastUsedAt]
 * @property {number} views
 */
