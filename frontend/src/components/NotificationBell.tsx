import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Bell, CheckCheck, FileSignature, Lock, MessageSquare, Newspaper, Sparkles, Sunrise, UserPlus, X } from "lucide-react";
import { api } from "../data/api";
import type { AppNotification, Digest, NotificationKind } from "../data/notifications";

const POLL_MS = 60_000;

const ICON: Record<NotificationKind, typeof Bell> = {
  assigned: UserPlus,
  update_requested: MessageSquare,
  signature: FileSignature,
  daily_digest: Sunrise,
  monday_briefing: Newspaper,
  account_locked: Lock,
};

function ago(iso: string): string {
  const mins = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function DigestReader({ digest, onFollow }: { digest: Digest; onFollow: (link: string) => void }) {
  const when = digest.title.split(": ").pop()!;
  return (
    <div className="digest">
      <h3>{when[0].toUpperCase() + when.slice(1)}</h3>
      <p className="digest-summary">
        {digest.aiWritten && <Sparkles size={14} aria-label="AI-written" />} {digest.summary}
      </p>
      {digest.sections.map((s) => (
        <section key={s.title}>
          <h4>{s.title}</h4>
          <ul>
            {s.items.map((item, i) => (
              <li key={i}>
                {item.link ? (
                  <a
                    className="digest-link"
                    href={item.link.startsWith("#") ? item.link : "#"}
                    onClick={(e) => {
                      e.preventDefault();
                      onFollow(item.link!);
                    }}
                  >
                    {item.text}
                  </a>
                ) : (
                  item.text
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {digest.aiWritten && <p className="ask-note">The opening is AI-written and can be wrong. The lists come straight from Pulse's data.</p>}
    </div>
  );
}

/** The bell in the top bar: alerts, the daily digest and the Monday Briefing. */
export default function NotificationBell({ viewOnly, onFollow }: { viewOnly: boolean; onFollow: (link: string) => void }) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [reading, setReading] = useState<AppNotification | null>(null);

  const load = useCallback(async () => {
    try {
      const feed = await api<{ items: AppNotification[]; unread: number }>("/notifications");
      setItems(feed.items);
      setUnread(feed.unread);
    } catch {
      // The bell just stays as it was until the next check.
    }
  }, []);

  useEffect(() => {
    load();
    const tick = () => {
      if (document.visibilityState === "visible") load();
    };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => {
    setOpen(false);
    setReading(null);
  };

  const markRead = (n: AppNotification) => {
    if (n.readAt || viewOnly) return;
    setItems((list) => list.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
    setUnread((u) => Math.max(0, u - 1));
    api("/notifications/read", "POST", { id: n.id }).catch(() => undefined);
  };

  const follow = (link: string) => {
    close();
    onFollow(link);
  };

  const choose = (n: AppNotification) => {
    markRead(n);
    if (n.digest) setReading(n);
    else if (n.link) follow(n.link);
  };

  return (
    <>
      <button className="notify-btn" onClick={() => setOpen(true)} aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} title="Notifications">
        <Bell size={19} />
        {unread > 0 && <span className="notify-count">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="backdrop drawer-backdrop ask-backdrop no-print" onClick={close}>
          <aside className="drawer ask notify" role="dialog" aria-label="Notifications" onClick={(e) => e.stopPropagation()}>
            <header className="ask-head">
              {reading ? (
                <button className="ask-clear notify-back" onClick={() => setReading(null)} aria-label="Back to notifications">
                  <ArrowLeft size={17} />
                </button>
              ) : (
                <span className="ask-badge">
                  <Bell size={18} />
                </span>
              )}
              <div>
                <h2>{reading ? (reading.kind === "monday_briefing" ? "Monday Briefing" : "Daily digest") : "Notifications"}</h2>
                {!reading && <p>{viewOnly ? "The latest Monday Briefing." : "What needs you, and your summaries."}</p>}
              </div>
              {!reading && unread > 0 && !viewOnly && (
                <button
                  className="ask-clear"
                  title="Mark all as read"
                  aria-label="Mark all as read"
                  onClick={() => {
                    setItems((list) => list.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })));
                    setUnread(0);
                    api("/notifications/read", "POST", {}).catch(() => undefined);
                  }}
                >
                  <CheckCheck size={16} />
                </button>
              )}
              <button className="close-btn" onClick={close} aria-label="Close">
                <X size={18} />
              </button>
            </header>
            <div className="ask-body">
              {reading?.digest ? (
                <DigestReader digest={reading.digest} onFollow={follow} />
              ) : items.length === 0 ? (
                <p className="notify-empty">{viewOnly ? "The first Monday Briefing will appear here." : "Nothing yet. You'll be told here when something needs you."}</p>
              ) : (
                <ul className="notify-list">
                  {items.map((n) => {
                    const Icon = ICON[n.kind] ?? Bell;
                    return (
                      <li key={n.id}>
                        <button className={`notify-item ${n.readAt || viewOnly ? "" : "unread"}`} onClick={() => choose(n)}>
                          <span className="notify-icon">
                            <Icon size={16} />
                          </span>
                          <span className="notify-text">
                            <b>{n.title}</b>
                            {n.body && <span>{n.body}</span>}
                            <small>{ago(n.createdAt)}</small>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
