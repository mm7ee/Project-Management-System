import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowLeft, Check, Hash, LogOut, MessagesSquare, Pencil, Plus, Search, Send, Trash2, UserPlus, Users, X } from "lucide-react";
import { api } from "../data/api";
import { initials } from "../data/systems";
import type { User } from "../data/roles";
import {
  MAX_GROUP_NAME,
  MAX_MESSAGE,
  POLL_BADGE_MS,
  POLL_LIST_MS,
  POLL_OPEN_MS,
  conversationTitle,
  type ChatMessage,
  type Conversation,
  type MessagesPage,
} from "../data/chat";
import Markdown from "./Markdown";

/** Whether the tab is in view: polling slows to nothing while it isn't. */
function useVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  useEffect(() => {
    const on = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

/** Runs `fn` now and every `ms` while `active`, and again when the tab comes back into view. */
function usePoll(fn: () => Promise<void> | void, ms: number, active: boolean) {
  const ref = useRef(fn);
  ref.current = fn;
  const visible = useVisible();
  useEffect(() => {
    if (!active || !visible) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        await ref.current();
      } catch {
        // A missed poll is caught up by the next one.
      }
      if (!stopped) timer = setTimeout(tick, ms);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [ms, active, visible]);
}

/** The unread count beside "Chat" in the sidebar, checked every minute. */
export function useChatUnread(enabled: boolean): [number, (n: number) => void] {
  const [unread, setUnread] = useState(0);
  usePoll(
    async () => {
      setUnread((await api<{ unread: number }>("/chat/unread")).unread);
    },
    POLL_BADGE_MS,
    enabled,
  );
  return [unread, setUnread];
}

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
};
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const listTime = (iso: string) => (new Date(iso).toDateString() === new Date().toDateString() ? clock(iso) : new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }));

interface Props {
  me: User;
  users: User[];
  canModerate: boolean; // may remove others' messages and group members (manage_users)
  openId?: string | null; // a conversation to open, from a notification link
  onUnread: (n: number) => void;
}

/** Chat: direct messages, group chats and project channels. */
export default function ChatPage({ me, users, canModerate, openId, onUnread }: Props) {
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(openId ?? null);
  const [filter, setFilter] = useState("");
  const [starting, setStarting] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [error, setError] = useState("");
  const synced = useRef(false);

  const byId = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const nameOf = useCallback((id: string) => byId.get(id)?.name ?? "Someone", [byId]);

  const loadList = useCallback(async () => {
    // The first load also adds you to the channels of the projects you lead or work on.
    const res = await api<{ conversations: Conversation[]; unread: number }>(`/chat${synced.current ? "" : "?sync=1"}`);
    synced.current = true;
    setConversations(res.conversations);
    onUnread(res.unread);
    setError("");
  }, [onUnread]);
  usePoll(() => loadList().catch((e) => setError(e instanceof Error ? e.message : "Couldn't load your conversations")), POLL_LIST_MS, true);

  useEffect(() => {
    if (openId) setActiveId(openId);
  }, [openId]);

  // A conversation that isn't on your list (a project channel you haven't joined) is fetched on its own.
  const [outside, setOutside] = useState<Conversation | null>(null);
  const listed = conversations?.find((c) => c.id === activeId);
  useEffect(() => {
    if (!activeId || !conversations || listed) return;
    let live = true;
    api<Conversation>(`/chat/${activeId}`)
      .then((c) => live && setOutside(c))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Couldn't open that conversation"));
    return () => {
      live = false;
    };
  }, [activeId, conversations, listed]);
  const active = listed ?? (outside?.id === activeId ? outside : undefined);
  const shown = (conversations ?? []).filter((c) => !filter.trim() || conversationTitle(c, me.id, nameOf).toLowerCase().includes(filter.trim().toLowerCase()));

  const openConversation = async (id: string) => {
    setActiveId(id);
    await loadList().catch(() => undefined);
  };

  return (
    <div className="page chat-page">
      <header className="page-head">
        <div>
          <h2>
            <MessagesSquare size={20} aria-hidden="true" /> Chat
          </h2>
          <p>Message colleagues directly, in groups, or in a project's channel.</p>
        </div>
      </header>
      <div className={`chat ${activeId ? "chat-open" : ""}`}>
        <aside className="chat-list" aria-label="Conversations">
          <div className="chat-list-actions">
            <button className="btn btn-navy sm" onClick={() => setStarting(true)}>
              <Plus size={15} /> New chat
            </button>
            <button className="btn btn-ghost sm" onClick={() => setBrowsing(true)}>
              <Hash size={15} /> Project channels
            </button>
          </div>
          <label className="chat-filter">
            <Search size={15} />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a conversation" aria-label="Find a conversation" />
          </label>
          {error && <p className="chat-error">{error}</p>}
          {conversations === null ? (
            <p className="chat-empty">Loading…</p>
          ) : shown.length === 0 ? (
            <p className="chat-empty">{filter ? "No conversation matches." : "No conversations yet. Start one with New chat."}</p>
          ) : (
            <ul>
              {shown.map((c) => {
                const title = conversationTitle(c, me.id, nameOf);
                const last = c.lastMessage;
                const preview = !last
                  ? c.kind === "project"
                    ? "Project channel"
                    : "No messages yet"
                  : last.kind === "event"
                    ? `${last.userId === me.id ? "You" : nameOf(last.userId)} ${last.body}`
                    : `${last.userId === me.id ? "You: " : c.kind === "direct" ? "" : `${nameOf(last.userId).split(" ")[0]}: `}${last.body || "Message deleted"}`;
                return (
                  <li key={c.id}>
                    <button className={`chat-row ${c.id === activeId ? "on" : ""} ${c.unread ? "unread" : ""}`} onClick={() => openConversation(c.id)}>
                      <ConversationAvatar c={c} title={title} />
                      <span className="chat-row-text">
                        <span className="chat-row-top">
                          <b>{title}</b>
                          {(last?.at ?? c.lastMessageAt) && <time>{listTime(last?.at ?? c.lastMessageAt!)}</time>}
                        </span>
                        <span className="chat-row-bottom">
                          <span className="chat-preview">{preview}</span>
                          {c.unread > 0 && <span className="chat-badge">{c.unread > 99 ? "99+" : c.unread}</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section className="chat-pane">
          {activeId ? (
            <ConversationView
              key={activeId}
              id={activeId}
              conversation={active}
              me={me}
              users={users}
              nameOf={nameOf}
              canModerate={canModerate}
              onBack={() => setActiveId(null)}
              onChanged={() => loadList().catch(() => undefined)}
              onLeft={() => {
                setActiveId(null);
                loadList().catch(() => undefined);
              }}
            />
          ) : (
            <div className="chat-placeholder">
              <MessagesSquare size={40} aria-hidden="true" />
              <p>Choose a conversation, or start a new one.</p>
            </div>
          )}
        </section>
      </div>

      {starting && <NewChat me={me} users={users} onClose={() => setStarting(false)} onOpen={(id) => { setStarting(false); openConversation(id); }} />}
      {browsing && <BrowseChannels onClose={() => setBrowsing(false)} onOpen={(id) => { setBrowsing(false); openConversation(id); }} />}
    </div>
  );
}

function ConversationAvatar({ c, title }: { c: Pick<Conversation, "kind">; title: string }) {
  if (c.kind === "project")
    return (
      <span className="chat-avatar project" aria-hidden="true">
        <Hash size={16} />
      </span>
    );
  if (c.kind === "group")
    return (
      <span className="chat-avatar group" aria-hidden="true">
        <Users size={16} />
      </span>
    );
  return (
    <span className="chat-avatar" aria-hidden="true">
      {initials(title)}
    </span>
  );
}

// ---------- one conversation ----------

interface ViewProps {
  id: string;
  conversation?: Conversation;
  me: User;
  users: User[];
  nameOf: (id: string) => string;
  canModerate: boolean;
  onBack: () => void;
  onChanged: () => void;
  onLeft: () => void;
}

/** Messages a few minutes apart from the same person are shown as one block. */
const GROUP_GAP_MS = 5 * 60_000;

function ConversationView({ id, conversation, me, users, nameOf, canModerate, onBack, onChanged, onLeft }: ViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [readers, setReaders] = useState<MessagesPage["readers"]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [details, setDetails] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const since = useRef<string | null>(null);
  const lastId = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // keep to the bottom while the reader is there
  const visible = useVisible();

  const merge = useCallback((incoming: ChatMessage[], prepend = false) => {
    if (!incoming.length) return;
    setMessages((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) map.set(m.id, m);
      const all = [...map.values()].sort((a, b) => a.id - b.id);
      return prepend || all.length !== prev.length || incoming.some((m) => prev.find((p) => p.id === m.id) !== m) ? all : prev;
    });
    lastId.current = Math.max(lastId.current, ...incoming.map((m) => m.id));
  }, []);

  const poll = useCallback(async () => {
    const read = visible ? "&read=1" : "";
    const page = since.current
      ? await api<MessagesPage>(`/chat/${id}/messages?after=${lastId.current}&since=${encodeURIComponent(since.current)}${read}`)
      : await api<MessagesPage>(`/chat/${id}/messages?${read.slice(1)}`);
    if (!since.current) setHasOlder(page.hasOlder);
    since.current = page.now;
    merge([...page.messages, ...page.changed]);
    setReaders(page.readers);
    setLoaded(true);
    setError("");
    // Something new arrived and was read: the list's unread counts move on.
    if (page.messages.some((m) => m.userId !== me.id) && read) onChanged();
  }, [id, visible, merge, me.id, onChanged]);
  usePoll(() => poll().catch((e) => setError(e instanceof Error ? e.message : "Couldn't load messages")), POLL_OPEN_MS, true);

  const loadOlder = async () => {
    const first = messages[0];
    if (!first) return;
    const el = scroller.current;
    const fromBottom = el ? el.scrollHeight - el.scrollTop : 0;
    const page = await api<MessagesPage>(`/chat/${id}/messages?before=${first.id}`);
    setHasOlder(page.hasOlder);
    stick.current = false;
    merge(page.messages, true);
    // Keep the reader where they were.
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - fromBottom;
    });
  };

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const send = async (text: string) => {
    const saved = await api<ChatMessage>(`/chat/${id}/messages`, "POST", { body: text });
    stick.current = true;
    merge([saved]);
    onChanged();
  };

  const remove = async (m: ChatMessage) => {
    if (!window.confirm(m.userId === me.id ? "Delete this message?" : `Remove ${nameOf(m.userId)}'s message?`)) return;
    try {
      await api(`/chat/${id}/messages/${m.id}`, "DELETE");
      merge([{ ...m, body: "", deletedAt: new Date().toISOString() }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete that message");
    }
  };

  const saveEdit = async (m: ChatMessage, text: string) => {
    const updated = await api<ChatMessage>(`/chat/${id}/messages/${m.id}`, "PUT", { body: text });
    merge([updated]);
    setEditing(null);
  };

  const title = conversation ? conversationTitle(conversation, me.id, nameOf) : "";
  const member = conversation?.member ?? false;
  const memberIds = conversation?.memberIds ?? [];
  const usernames = useMemo(() => users.map((u) => u.username), [users]);
  // Who can be @mentioned: the people in it, or anyone for a project channel.
  const mentionable = useMemo(() => (conversation?.kind === "project" ? users : users.filter((u) => memberIds.includes(u.id))).filter((u) => u.id !== me.id), [conversation?.kind, users, memberIds, me.id]);

  // "Seen": on your latest message, who has read up to it.
  const myLast = [...messages].reverse().find((m) => m.userId === me.id && m.kind === "text" && !m.deletedAt);
  const seenBy = myLast ? readers.filter((r) => r.userId !== me.id && r.lastReadId >= myLast.id).map((r) => r.userId) : [];

  const subtitle =
    conversation?.kind === "direct"
      ? (users.find((u) => u.id === memberIds.find((x) => x !== me.id))?.title ?? "")
      : conversation
        ? `${memberIds.length} ${memberIds.length === 1 ? "member" : "members"}`
        : "";

  return (
    <>
      <header className="chat-head">
        <button className="chat-back" onClick={onBack} aria-label="Back to conversations">
          <ArrowLeft size={18} />
        </button>
        {conversation && <ConversationAvatar c={conversation} title={title} />}
        <div className="chat-head-text">
          <h3>{conversation ? (conversation.kind === "project" ? `# ${title}` : title) : "Loading…"}</h3>
          {subtitle && <span>{subtitle}</span>}
        </div>
        {conversation && conversation.kind !== "direct" && (
          <button className="btn btn-ghost sm" onClick={() => setDetails(true)}>
            <Users size={15} /> Details
          </button>
        )}
      </header>

      <div className="chat-messages" ref={scroller} onScroll={onScroll} aria-live="polite">
        {hasOlder && (
          <button className="chat-older" onClick={() => loadOlder().catch(() => undefined)}>
            Show earlier messages
          </button>
        )}
        {loaded && messages.length === 0 && <p className="chat-empty">No messages yet. Say hello.</p>}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
          const continued = !newDay && prev && prev.kind === "text" && m.kind === "text" && prev.userId === m.userId && Date.parse(m.createdAt) - Date.parse(prev.createdAt) < GROUP_GAP_MS;
          const mine = m.userId === me.id;
          return (
            <div key={m.id}>
              {newDay && (
                <div className="chat-day">
                  <span>{dayLabel(m.createdAt)}</span>
                </div>
              )}
              {m.kind === "event" ? (
                <p className="chat-event">
                  <b>{mine ? "You" : nameOf(m.userId)}</b> {m.body} · {clock(m.createdAt)}
                </p>
              ) : (
                <div className={`chat-msg ${mine ? "mine" : ""} ${continued ? "continued" : ""}`}>
                  {!continued ? (
                    <span className="chat-avatar sm" aria-hidden="true">
                      {initials(nameOf(m.userId))}
                    </span>
                  ) : (
                    <span className="chat-avatar-gap" />
                  )}
                  <div className="chat-msg-main">
                    {!continued && (
                      <div className="chat-msg-head">
                        <b>{mine ? "You" : nameOf(m.userId)}</b>
                        <time dateTime={m.createdAt}>{clock(m.createdAt)}</time>
                      </div>
                    )}
                    {m.deletedAt ? (
                      <p className="chat-deleted">Message deleted</p>
                    ) : editing === m.id ? (
                      <Composer
                        initial={m.body}
                        mentionable={mentionable}
                        submitLabel="Save"
                        onSubmit={(text) => saveEdit(m, text)}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <div className="chat-body">
                        <Markdown text={m.body} usernames={usernames} />
                        {m.editedAt && <span className="chat-edited">(edited)</span>}
                      </div>
                    )}
                  </div>
                  {!m.deletedAt && editing !== m.id && (mine || (canModerate && conversation?.kind !== "direct")) && (
                    <div className="chat-msg-tools">
                      {mine && (
                        <button onClick={() => setEditing(m.id)} aria-label="Edit message" title="Edit">
                          <Pencil size={14} />
                        </button>
                      )}
                      <button onClick={() => remove(m)} aria-label="Delete message" title="Delete">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              )}
              {myLast?.id === m.id && seenBy.length > 0 && (
                <p className="chat-seen">
                  <Check size={12} /> Seen{conversation?.kind === "direct" ? "" : ` by ${seenBy.length === 1 ? nameOf(seenBy[0]) : `${seenBy.length} people`}`}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="chat-error">{error}</p>}
      {conversation?.kind === "project" && !member && <p className="chat-join-note">You're reading this channel. Sending a message joins it.</p>}
      <Composer mentionable={mentionable} submitLabel="Send" onSubmit={send} autoFocus />

      {details && conversation && (
        <ConversationDetails
          conversation={conversation}
          me={me}
          users={users}
          nameOf={nameOf}
          canModerate={canModerate}
          onClose={() => setDetails(false)}
          onChanged={onChanged}
          onLeft={() => {
            setDetails(false);
            onLeft();
          }}
        />
      )}
    </>
  );
}

// ---------- writing a message ----------

interface ComposerProps {
  initial?: string;
  mentionable: User[];
  submitLabel: string;
  autoFocus?: boolean;
  onSubmit: (text: string) => Promise<void>;
  onCancel?: () => void;
}

/** Enter sends, Shift+Enter starts a new line; typing @ suggests people. */
function Composer({ initial = "", mentionable, submitLabel, autoFocus, onSubmit, onCancel }: ComposerProps) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pick, setPick] = useState(0);
  const [caret, setCaret] = useState(0);
  const box = useRef<HTMLTextAreaElement>(null);

  // The @word being typed at the caret, if any.
  const mention = text.slice(0, caret).match(/(?:^|[^\w@])@([a-z0-9._-]{0,40})$/i);
  const suggestions = mention
    ? mentionable
        .filter((u) => u.username.toLowerCase().startsWith(mention[1].toLowerCase()) || u.name.toLowerCase().split(" ").some((w) => w.startsWith(mention[1].toLowerCase())))
        .slice(0, 6)
    : [];

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  const insert = (u: User) => {
    const start = caret - (mention?.[1].length ?? 0);
    const next = `${text.slice(0, start)}${u.username} ${text.slice(caret)}`;
    setText(next);
    const at = start + u.username.length + 1;
    requestAnimationFrame(() => {
      box.current?.focus();
      box.current?.setSelectionRange(at, at);
      setCaret(at);
    });
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit(t);
      if (!onCancel) setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send that");
    } finally {
      setBusy(false);
      box.current?.focus();
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setPick((p) => (p + (e.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insert(suggestions[Math.min(pick, suggestions.length - 1)]);
        return;
      }
    }
    if (e.key === "Escape" && onCancel) onCancel();
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form className={`chat-composer ${onCancel ? "editing" : ""}`} onSubmit={submit}>
      {suggestions.length > 0 && (
        <ul className="chat-mentions" role="listbox" aria-label="People to mention">
          {suggestions.map((u, i) => (
            <li key={u.id} role="option" aria-selected={i === pick}>
              <button
                type="button"
                className={i === pick ? "on" : ""}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insert(u);
                }}
              >
                <b>{u.name}</b> <span>@{u.username}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <textarea
        ref={box}
        rows={1}
        value={text}
        maxLength={MAX_MESSAGE}
        autoFocus={autoFocus}
        placeholder={onCancel ? "Edit your message" : "Write a message. Enter sends, Shift+Enter for a new line."}
        aria-label={onCancel ? "Edit message" : "Message"}
        onChange={(e) => {
          setText(e.target.value);
          setCaret(e.target.selectionStart);
          setPick(0);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={onKey}
      />
      {onCancel && (
        <button type="button" className="btn btn-ghost sm" onClick={onCancel}>
          Cancel
        </button>
      )}
      <button type="submit" className="btn btn-navy sm chat-send" disabled={!text.trim() || busy} aria-label={submitLabel}>
        {onCancel ? submitLabel : <Send size={16} />}
      </button>
      {error && <p className="chat-error">{error}</p>}
    </form>
  );
}

// ---------- pop-ups ----------

function PeoplePicker({ users, me, chosen, onToggle, exclude = [] }: { users: User[]; me: User; chosen: string[]; onToggle: (id: string) => void; exclude?: string[] }) {
  const [q, setQ] = useState("");
  const list = users
    .filter((u) => u.id !== me.id && !exclude.includes(u.id))
    .filter((u) => !q.trim() || `${u.name} ${u.username} ${u.title}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="chat-picker">
      <label className="chat-filter">
        <Search size={15} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" aria-label="Search people" autoFocus />
      </label>
      <ul>
        {list.map((u) => (
          <li key={u.id}>
            <button type="button" className={chosen.includes(u.id) ? "on" : ""} onClick={() => onToggle(u.id)} aria-pressed={chosen.includes(u.id)}>
              <span className="chat-avatar sm">{initials(u.name)}</span>
              <span className="chat-picker-text">
                <b>{u.name}</b>
                <span>{u.title || `@${u.username}`}</span>
              </span>
              {chosen.includes(u.id) && <Check size={16} />}
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="chat-empty">Nobody matches.</li>}
      </ul>
    </div>
  );
}

function NewChat({ me, users, onClose, onOpen }: { me: User; users: User[]; onClose: () => void; onOpen: (id: string) => void }) {
  const [mode, setMode] = useState<"direct" | "group">("direct");
  const [chosen, setChosen] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const go = async (run: () => Promise<{ id: string }>) => {
    setBusy(true);
    setError("");
    try {
      onOpen((await run()).id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start that chat");
      setBusy(false);
    }
  };

  return (
    <div className="backdrop modal-backdrop" onClick={onClose}>
      <form
        className="modal chat-modal"
        role="dialog"
        aria-modal="true"
        aria-label="New chat"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (mode === "group") go(() => api<{ id: string }>("/chat/groups", "POST", { name, people: chosen }));
        }}
      >
        <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <h2>New chat</h2>
        <div className="seg" role="tablist" aria-label="Kind of chat">
          <button type="button" role="tab" aria-selected={mode === "direct"} className={mode === "direct" ? "on" : ""} onClick={() => setMode("direct")}>
            Direct message
          </button>
          <button type="button" role="tab" aria-selected={mode === "group"} className={mode === "group" ? "on" : ""} onClick={() => setMode("group")}>
            Group chat
          </button>
        </div>
        {mode === "group" && (
          <label className="field">
            Group name
            <input value={name} maxLength={MAX_GROUP_NAME} onChange={(e) => setName(e.target.value)} placeholder="e.g. Release planning" />
          </label>
        )}
        <PeoplePicker
          users={users}
          me={me}
          chosen={chosen}
          onToggle={(id) => {
            if (mode === "direct") go(() => api<{ id: string }>("/chat/direct", "POST", { userId: id }));
            else setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
          }}
        />
        {error && <p className="chat-error">{error}</p>}
        {mode === "group" && (
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-navy" disabled={busy || !name.trim() || !chosen.length}>
              Create group{chosen.length ? ` (${chosen.length + 1})` : ""}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

interface Channel {
  systemId: string;
  name: string;
  conversationId: string;
  member: boolean;
  members: number;
}

function BrowseChannels({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string) => void }) {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    api<Channel[]>("/chat/channels")
      .then(setChannels)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load the channels"));
  }, []);
  const join = async (c: Channel) => {
    try {
      const { id } = await api<{ id: string }>(`/chat/projects/${c.systemId}/join`, "POST");
      onOpen(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't join that channel");
    }
  };
  const shown = (channels ?? []).filter((c) => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="backdrop modal-backdrop" onClick={onClose}>
      <div className="modal chat-modal" role="dialog" aria-modal="true" aria-label="Project channels" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <h2>Project channels</h2>
        <p className="modal-note">Every project has a channel. Its lead and developers are added automatically; anyone can join.</p>
        <label className="chat-filter">
          <Search size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a project" aria-label="Find a project" autoFocus />
        </label>
        {error && <p className="chat-error">{error}</p>}
        <ul className="chat-channels">
          {channels === null && !error && <li className="chat-empty">Loading…</li>}
          {shown.map((c) => (
            <li key={c.systemId}>
              <span className="chat-avatar project" aria-hidden="true">
                <Hash size={15} />
              </span>
              <span className="chat-picker-text">
                <b>{c.name}</b>
                <span>
                  {c.members} {c.members === 1 ? "member" : "members"}
                </span>
              </span>
              <button className={`btn sm ${c.member ? "btn-ghost" : "btn-navy"}`} onClick={() => (c.member ? onOpen(c.conversationId) : join(c))}>
                {c.member ? "Open" : "Join"}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ConversationDetails({
  conversation,
  me,
  users,
  nameOf,
  canModerate,
  onClose,
  onChanged,
  onLeft,
}: {
  conversation: Conversation;
  me: User;
  users: User[];
  nameOf: (id: string) => string;
  canModerate: boolean;
  onClose: () => void;
  onChanged: () => void;
  onLeft: () => void;
}) {
  const group = conversation.kind === "group";
  const [name, setName] = useState(conversation.name);
  const [adding, setAdding] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canRemove = group && (conversation.createdBy === me.id || canModerate);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      onChanged();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work");
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="backdrop modal-backdrop" onClick={onClose}>
      <div className="modal chat-modal" role="dialog" aria-modal="true" aria-label="Conversation details" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <h2>{group ? "Group details" : `# ${conversation.name}`}</h2>
        {group && (
          <form
            className="chat-rename"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => api(`/chat/${conversation.id}`, "PUT", { name }));
            }}
          >
            <label className="field">
              Group name
              <input value={name} maxLength={MAX_GROUP_NAME} onChange={(e) => setName(e.target.value)} />
            </label>
            <button className="btn btn-ghost sm" disabled={busy || !name.trim() || name.trim() === conversation.name}>
              Rename
            </button>
          </form>
        )}

        {adding ? (
          <>
            <PeoplePicker users={users} me={me} chosen={adding} exclude={conversation.memberIds} onToggle={(id) => setAdding((a) => (a!.includes(id) ? a!.filter((x) => x !== id) : [...a!, id]))} />
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setAdding(null)}>
                Cancel
              </button>
              <button
                className="btn btn-navy"
                disabled={busy || !adding.length}
                onClick={async () => {
                  if (await run(() => api(`/chat/${conversation.id}/members`, "POST", { people: adding }))) setAdding(null);
                }}
              >
                Add {adding.length || ""}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="chat-members-head">
              <b>
                {conversation.memberIds.length} {conversation.memberIds.length === 1 ? "member" : "members"}
              </b>
              {group && (
                <button className="btn btn-ghost sm" onClick={() => setAdding([])}>
                  <UserPlus size={15} /> Add people
                </button>
              )}
            </div>
            <ul className="chat-members">
              {conversation.memberIds.map((id) => (
                <li key={id}>
                  <span className="chat-avatar sm">{initials(nameOf(id))}</span>
                  <span className="chat-picker-text">
                    <b>
                      {nameOf(id)}
                      {id === me.id ? " (you)" : ""}
                    </b>
                    <span>{id === conversation.createdBy ? "Created the group" : (users.find((u) => u.id === id)?.title ?? "")}</span>
                  </span>
                  {canRemove && id !== me.id && (
                    <button
                      className="chat-remove"
                      disabled={busy}
                      aria-label={`Remove ${nameOf(id)}`}
                      title="Remove from the group"
                      onClick={() => window.confirm(`Remove ${nameOf(id)} from the group?`) && run(() => api(`/chat/${conversation.id}/members/${id}`, "DELETE"))}
                    >
                      <X size={15} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        {error && <p className="chat-error">{error}</p>}
        {!adding && (
          <button
            className="delete-link"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm(group ? "Leave this group? You'll stop getting its messages." : "Leave this channel? You can join again from Project channels.")) return;
              if (await run(() => api(`/chat/${conversation.id}/members/me`, "DELETE"))) onLeft();
            }}
          >
            <LogOut size={15} /> {group ? "Leave group" : "Leave channel"}
          </button>
        )}
      </div>
    </div>
  );
}
