/** @import { FormEvent, KeyboardEvent } from 'react' */
/** @import { User } from '../data/roles' */
/** @import { ChatFile, ChatGif, ChatMessage, ChatReaction, Conversation, MessagesPage } from '../data/chat' */
/** @import { PendingFile } from './ChatExtras' */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Copy, CornerUpLeft, Hash, LogOut, MessagesSquare, Paperclip, Pencil, Pin, PinOff, Plus, Reply, Search, Send, Smile, SmilePlus, StickyNote, Trash2, UserPlus, Users, X } from "lucide-react";
import { api, uploadChatFile } from "../data/api";
import { initials } from "../data/systems";
import { INLINE_IMAGE, MAX_CHAT_FILE, MAX_CHAT_FILES, MAX_GROUP_NAME, MAX_MESSAGE, POLL_BADGE_MS, POLL_LIST_MS, POLL_OPEN_MS, QUICK_REACTIONS, conversationTitle, fileSize, messagePreview } from "../data/chat";
import Markdown from "./Markdown";
import { EmojiPicker, FileList, GifPicker, GifView, PendingFiles, Sticker, StickerPicker } from "./ChatExtras";
/**
 * Whether the tab is in view: polling slows to nothing while it isn't.
 * @returns {boolean}
 */
function useVisible() {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  useEffect(() => {
    const on = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}
/**
 * Runs `fn` now and every `ms` while `active`, and again when the tab comes back into view.
 * @param {() => Promise<void> | void} fn
 * @param {number} ms
 * @param {boolean} active
 * @returns {void}
 */
function usePoll(fn, ms, active) {
  const ref = useRef(fn);
  ref.current = fn;
  const visible = useVisible();
  useEffect(() => {
    if (!active || !visible) return;
    let stopped = false;
    /** @type {ReturnType<typeof setTimeout>} */ let timer;
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
/**
 * The unread count beside "Chat" in the sidebar, checked every minute.
 * @param {boolean} enabled
 * @returns {[number, (n: number) => void]}
 */
export function useChatUnread(enabled) {
  const [unread, setUnread] = useState(0);
  usePoll(
    async () => {
      setUnread((await /** @type {Promise<{ unread: number; }>} */ (/** @type {unknown} */ (api("/chat/unread")))).unread);
    },
    POLL_BADGE_MS,
    enabled,
  );
  return [unread, setUnread];
}
const dayLabel =
  /** @param {string} iso
   * @returns {string}
   */ (iso) => {
    const d = new Date(iso);
    const today = new Date();
    const yesterday = new Date(Date.now() - 86400000);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
  };
/** A list preview without Markdown marks: "**plan**" reads "plan". */
const plainPreview =
  /** @param {string} s
   * @returns {string}
   */ (s) => s.replace(/(\*\*|__|~~|`+)/g, "").replace(/\n+/g, " ");
const clock =
  /** @param {string} iso
   * @returns {string}
   */ (iso) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const listTime =
  /** @param {string} iso
   * @returns {string}
   */ (iso) => (new Date(iso).toDateString() === new Date().toDateString() ? clock(iso) : new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }));
/**
 * Chat: direct messages, group chats and project channels.
 * @param {Props} arg8
 */
export default function ChatPage({ me, users, canModerate, openId, onUnread, docked = false }) {
  const [conversations, setConversations] = useState(/** @type {Conversation[] | null | (() => Conversation[] | null)} */ (null));
  const [activeId, setActiveId] = useState(/** @type {string | null | (() => string | null)} */ (openId ?? null));
  const [filter, setFilter] = useState("");
  const [starting, setStarting] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [error, setError] = useState("");
  const synced = useRef(false);
  const byId = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const nameOf = useCallback(/** @param {string} id */ (id) => byId.get(id)?.name ?? "Someone", [byId]);
  const loadList = useCallback(async () => {
    // The first load also adds you to the channels of the projects you lead or work on.
    const res = await /** @type {Promise<{ conversations: Conversation[]; unread: number; }>} */ (/** @type {unknown} */ (api(`/chat${synced.current ? "" : "?sync=1"}`)));
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
  const [outside, setOutside] = useState(/** @type {Conversation | null | (() => Conversation | null)} */ (null));
  const listed = conversations?.find((c) => c.id === activeId);
  useEffect(() => {
    if (!activeId || !conversations || listed) return;
    let live = true;
    /** @type {Promise<Conversation>} */ (/** @type {unknown} */ (api(`/chat/${activeId}`))).then((c) => live && setOutside(c)).catch((e) => live && setError(e instanceof Error ? e.message : "Couldn't open that conversation"));
    return () => {
      live = false;
    };
  }, [activeId, conversations, listed]);
  const active = listed ?? (outside?.id === activeId ? outside : undefined);
  const shown = (conversations ?? []).filter((c) => !filter.trim() || conversationTitle(c, me.id, nameOf).toLowerCase().includes(filter.trim().toLowerCase()));
  const openConversation = /** @param {string} id */ async (id) => {
    setActiveId(id);
    await loadList().catch(() => undefined);
  };
  return (
    <div className={`page chat-page ${docked ? "docked" : ""}`}>
      {!docked && (
        <header className="page-head">
          <div>
            <h2>
              <MessagesSquare size={20} aria-hidden="true" /> Chat
            </h2>
            <p>Message colleagues directly, in groups, or in a project's channel.</p>
          </div>
        </header>
      )}
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
                          {(last?.at ?? c.lastMessageAt) && <time>{listTime(last?.at ?? /** @type {NonNullable<typeof c.lastMessageAt>} */ (c.lastMessageAt))}</time>}
                        </span>
                        <span className="chat-row-bottom">
                          <span className="chat-preview">{plainPreview(preview)}</span>
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

      {starting && (
        <NewChat
          me={me}
          users={users}
          onClose={() => setStarting(false)}
          onOpen={(id) => {
            setStarting(false);
            openConversation(id);
          }}
        />
      )}
      {browsing && (
        <BrowseChannels
          onClose={() => setBrowsing(false)}
          onOpen={(id) => {
            setBrowsing(false);
            openConversation(id);
          }}
        />
      )}
    </div>
  );
}
/**
 * @param {{ c: Pick<Conversation, "kind">; title: string }} arg2
 */
function ConversationAvatar({ c, title }) {
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
/**
 * Messages a few minutes apart from the same person are shown as one block.
 * @type {number}
 */
const GROUP_GAP_MS = 5 * 60000;
/**
 * @param {ViewProps} props
 */
function ConversationView({ id, conversation, me, users, nameOf, canModerate, onBack, onChanged, onLeft }) {
  const [messages, setMessages] = useState(/** @type {ChatMessage[] | (() => ChatMessage[])} */ ([]));
  const [readers, setReaders] = useState(/** @type {MessagesPage["readers"] | (() => MessagesPage["readers"])} */ ([]));
  const [hasOlder, setHasOlder] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [details, setDetails] = useState(false);
  const [editing, setEditing] = useState(/** @type {number | null | (() => number | null)} */ (null));
  const [replyTo, setReplyTo] = useState(/** @type {ChatMessage | null | (() => ChatMessage | null)} */ (null));
  const [reacting, setReacting] = useState(/** @type {number | null | (() => number | null)} */ (null)); // the message whose full emoji picker is open
  const [panel, setPanel] = useState(/** @type {"pins" | "search" | null | (() => "pins" | "search" | null)} */ (null));
  const [highlight, setHighlight] = useState(/** @type {number | null | (() => number | null)} */ (null));
  const [dragging, setDragging] = useState(false);
  const addFiles = useRef(/** @type {((files: File[]) => void) | null | null} */ (null));
  const since = useRef(/** @type {string | null | null} */ (null));
  const lastId = useRef(0);
  const scroller = useRef(/** @type {HTMLDivElement | null} */ (null));
  const stick = useRef(true); // keep to the bottom while the reader is there
  const visible = useVisible();
  const merge = useCallback(
    /** @param {ChatMessage[]} incoming */ (incoming, prepend = false) => {
      if (!incoming.length) return;
      setMessages((prev) => {
        const map = new Map(prev.map((m) => [m.id, m]));
        for (const m of incoming) map.set(m.id, m);
        const all = [...map.values()].sort((a, b) => a.id - b.id);
        return prepend || all.length !== prev.length || incoming.some((m) => prev.find((p) => p.id === m.id) !== m) ? all : prev;
      });
      lastId.current = Math.max(lastId.current, ...incoming.map((m) => m.id));
    },
    [],
  );
  const poll = useCallback(async () => {
    const read = visible ? "&read=1" : "";
    const page = since.current
      ? await /** @type {Promise<MessagesPage>} */ (/** @type {unknown} */ (api(`/chat/${id}/messages?after=${lastId.current}&since=${encodeURIComponent(since.current)}${read}`)))
      : await /** @type {Promise<MessagesPage>} */ (/** @type {unknown} */ (api(`/chat/${id}/messages?${read.slice(1)}`)));
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
    if (!first) return false;
    const el = scroller.current;
    const fromBottom = el ? el.scrollHeight - el.scrollTop : 0;
    const page = await /** @type {Promise<MessagesPage>} */ (/** @type {unknown} */ (api(`/chat/${id}/messages?before=${first.id}`)));
    setHasOlder(page.hasOlder);
    stick.current = false;
    merge(page.messages, true);
    // Keep the reader where they were.
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - fromBottom;
    });
    return page.hasOlder;
  };
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);
  const onScroll = () => {
    const el = scroller.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  /** Scrolls to a message (a reply's quote, a pin, a search result), loading older pages until it's there. */
  const jumpTo = /** @param {number} target */ async (target) => {
    let more = hasOlder;
    for (let i = 0; i < 20 && !document.getElementById(`chat-msg-${target}`) && more; i++) {
      more = await loadOlder();
      await new Promise((r) => requestAnimationFrame(r));
    }
    const el = document.getElementById(`chat-msg-${target}`);
    if (!el) return setError("That message is too far back to show here.");
    stick.current = false;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setHighlight(target);
    setTimeout(() => setHighlight((h) => (h === target ? null : h)), 2200);
  };
  const send = /** @param {Outgoing} out */ async (out) => {
    const saved = await /** @type {Promise<ChatMessage>} */ (/** @type {unknown} */ (api(`/chat/${id}/messages`, "POST", { ...out, ...(replyTo ? { replyTo: replyTo.id } : {}) })));
    stick.current = true;
    setReplyTo(null);
    merge([saved]);
    onChanged();
  };
  const run = /** @param {() => Promise<ChatMessage | null | void>} fn @param {string} failed */ async (fn, failed) => {
    try {
      const m = await fn();
      if (m) merge([m]);
    } catch (e) {
      setError(e instanceof Error ? e.message : failed);
    }
  };
  const react = /** @param {ChatMessage} m @param {string} emoji */ (m, emoji) => run(() => /** @type {Promise<ChatMessage>} */ (/** @type {unknown} */ (api(`/chat/${id}/messages/${m.id}/reactions`, "POST", { emoji }))), "Couldn't add that reaction");
  const pin = /** @param {ChatMessage} m */ (m) => run(() => /** @type {Promise<ChatMessage>} */ (/** @type {unknown} */ (api(`/chat/${id}/messages/${m.id}/pin`, "POST"))), "Couldn't pin that message");
  const remove = /** @param {ChatMessage} m */ async (m) => {
    if (!window.confirm(m.userId === me.id ? "Delete this message?" : `Remove ${nameOf(m.userId)}'s message?`)) return;
    await run(async () => {
      await api(`/chat/${id}/messages/${m.id}`, "DELETE");
      return { ...m, body: "", files: undefined, gif: undefined, sticker: undefined, reactions: undefined, replyTo: undefined, pinnedAt: undefined, deletedAt: new Date().toISOString() };
    }, "Couldn't delete that message");
  };
  const saveEdit = /** @param {ChatMessage} m @param {Outgoing} out */ async (m, out) => {
    const updated = await /** @type {Promise<ChatMessage>} */ (/** @type {unknown} */ (api(`/chat/${id}/messages/${m.id}`, "PUT", { body: out.body })));
    merge([updated]);
    setEditing(null);
  };
  const copy = /** @param {ChatMessage} m */ (m) => navigator.clipboard?.writeText(m.body).catch(() => setError("Couldn't copy that"));
  const title = conversation ? conversationTitle(conversation, me.id, nameOf) : "";
  const member = conversation?.member ?? false;
  const memberIds = conversation?.memberIds ?? [];
  const usernames = useMemo(() => users.map((u) => u.username), [users]);
  // Who can be @mentioned: the people in it, or anyone for a project channel.
  const mentionable = useMemo(() => (conversation?.kind === "project" ? users : users.filter((u) => memberIds.includes(u.id))).filter((u) => u.id !== me.id), [conversation?.kind, users, memberIds, me.id]);
  // "Seen": on your latest message, who has read up to it.
  const myLast = [...messages].reverse().find((m) => m.userId === me.id && m.kind === "text" && !m.deletedAt);
  const seenBy = myLast ? readers.filter((r) => r.userId !== me.id && r.lastReadId >= myLast.id).map((r) => r.userId) : [];
  const pinnedCount = messages.filter((m) => m.pinnedAt).length;
  const subtitle = conversation?.kind === "direct" ? (users.find((u) => u.id === memberIds.find((x) => x !== me.id))?.title ?? "") : conversation ? `${memberIds.length} ${memberIds.length === 1 ? "member" : "members"}` : "";
  const reactionLabel = /** @param {ChatReaction} r */ (r) => {
    const names = r.userIds.map((u) => (u === me.id ? "You" : nameOf(u).split(" ")[0]));
    return `${names.slice(0, 5).join(", ")}${names.length > 5 ? ` and ${names.length - 5} more` : ""} reacted ${r.emoji}`;
  };
  return (
    <div
      className={`chat-conv ${dragging ? "dropping" : ""}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(/** @type {Node} */ (e.relatedTarget))) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        addFiles.current?.([...e.dataTransfer.files]);
      }}
    >
      <header className="chat-head">
        <button className="chat-back" onClick={onBack} aria-label="Back to conversations">
          <ArrowLeft size={18} />
        </button>
        {conversation && <ConversationAvatar c={conversation} title={title} />}
        <div className="chat-head-text">
          <h3>{conversation ? (conversation.kind === "project" ? `# ${title}` : title) : "Loading…"}</h3>
          {subtitle && <span>{subtitle}</span>}
        </div>
        <div className="chat-head-tools">
          <button className={`icon-link ${panel === "search" ? "on" : ""}`} onClick={() => setPanel((p) => (p === "search" ? null : "search"))} aria-label="Search this conversation" aria-pressed={panel === "search"} title="Search">
            <Search size={15} />
          </button>
          <button className={`icon-link ${panel === "pins" ? "on" : ""}`} onClick={() => setPanel((p) => (p === "pins" ? null : "pins"))} aria-label="Pinned messages" aria-pressed={panel === "pins"} title="Pinned messages">
            <Pin size={15} />
            {pinnedCount > 0 && <span className="chat-head-count">{pinnedCount}</span>}
          </button>
          {conversation && conversation.kind !== "direct" && (
            <button className="btn btn-ghost sm" onClick={() => setDetails(true)}>
              <Users size={15} /> Details
            </button>
          )}
        </div>
      </header>

      <div className="chat-body-row">
        <div
          className="chat-messages"
          ref={scroller}
          onScroll={onScroll}
          // Images arrive after the text: keep the newest message in view while the reader is at the bottom.
          onLoadCapture={() => {
            const el = scroller.current;
            if (el && stick.current) el.scrollTop = el.scrollHeight;
          }}
          aria-live="polite"
        >
          {hasOlder && (
            <button className="chat-older" onClick={() => loadOlder().catch(() => undefined)}>
              Show earlier messages
            </button>
          )}
          {loaded && messages.length === 0 && <p className="chat-empty">No messages yet. Say hello, or drop a file here.</p>}
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
            const continued = !newDay && prev && prev.kind === "text" && m.kind === "text" && prev.userId === m.userId && Date.parse(m.createdAt) - Date.parse(prev.createdAt) < GROUP_GAP_MS && !m.replyTo;
            const mine = m.userId === me.id;
            const canDelete = mine || (canModerate && conversation?.kind !== "direct");
            return (
              <div key={m.id} id={`chat-msg-${m.id}`}>
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
                  <div className={`chat-msg ${mine ? "mine" : ""} ${continued ? "continued" : ""} ${highlight === m.id ? "flash" : ""} ${m.pinnedAt ? "pinned" : ""}`}>
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
                          {m.pinnedAt && (
                            <span className="chat-pinned-tag" title={m.pinnedBy ? `Pinned by ${m.pinnedBy === me.id ? "you" : nameOf(m.pinnedBy)}` : "Pinned"}>
                              <Pin size={11} aria-hidden="true" /> Pinned
                            </span>
                          )}
                        </div>
                      )}
                      {m.deletedAt ? (
                        <p className="chat-deleted">Message deleted</p>
                      ) : editing === m.id ? (
                        <Composer conversationId={id} initial={m.body} mentionable={mentionable} submitLabel="Save" onSubmit={(out) => saveEdit(m, out)} onCancel={() => setEditing(null)} />
                      ) : (
                        <>
                          {m.replyTo && (
                            <button className="chat-quote" onClick={() => jumpTo(/** @type {NonNullable<typeof m.replyTo>} */ (m.replyTo).id)} title="Go to the message">
                              <CornerUpLeft size={12} aria-hidden="true" />
                              <b>{m.replyTo.userId === me.id ? "You" : nameOf(m.replyTo.userId)}</b>
                              <span>{m.replyTo.deleted ? "Message deleted" : m.replyTo.body}</span>
                            </button>
                          )}
                          {m.body && (
                            <div className="chat-body">
                              <Markdown text={m.body} usernames={usernames} />
                              {m.editedAt && <span className="chat-edited">(edited)</span>}
                            </div>
                          )}
                          {m.sticker && <Sticker id={m.sticker} />}
                          {m.gif && <GifView gif={m.gif} />}
                          {m.files && m.files.length > 0 && <FileList conversationId={id} files={m.files} />}
                          {m.reactions && m.reactions.length > 0 && (
                            <div className="chat-reactions">
                              {m.reactions.map((r) => (
                                <button key={r.emoji} className={r.userIds.includes(me.id) ? "on" : ""} onClick={() => react(m, r.emoji)} title={reactionLabel(r)} aria-label={`${reactionLabel(r)}. ${r.userIds.includes(me.id) ? "Remove yours" : "Add yours"}`} aria-pressed={r.userIds.includes(me.id)}>
                                  <span>{r.emoji}</span>
                                  <b>{r.userIds.length}</b>
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    {!m.deletedAt && editing !== m.id && (
                      <div className={`chat-msg-tools ${reacting === m.id ? "open" : ""}`}>
                        {QUICK_REACTIONS.slice(0, 3).map((e) => (
                          <button key={e} onClick={() => react(m, e)} aria-label={`React ${e}`} title={`React ${e}`} className="chat-quick">
                            {e}
                          </button>
                        ))}
                        <button onClick={() => setReacting(m.id)} aria-label="Add a reaction" title="Add a reaction">
                          <SmilePlus size={14} />
                        </button>
                        <button onClick={() => setReplyTo(m)} aria-label="Reply" title="Reply">
                          <Reply size={14} />
                        </button>
                        {member && (
                          <button onClick={() => pin(m)} aria-label={m.pinnedAt ? "Unpin message" : "Pin message"} title={m.pinnedAt ? "Unpin" : "Pin"}>
                            {m.pinnedAt ? <PinOff size={14} /> : <Pin size={14} />}
                          </button>
                        )}
                        {m.body && (
                          <button onClick={() => copy(m)} aria-label="Copy text" title="Copy text">
                            <Copy size={14} />
                          </button>
                        )}
                        {mine && (
                          <button onClick={() => setEditing(m.id)} aria-label="Edit message" title="Edit">
                            <Pencil size={14} />
                          </button>
                        )}
                        {canDelete && (
                          <button onClick={() => remove(m)} aria-label="Delete message" title="Delete">
                            <Trash2 size={14} />
                          </button>
                        )}
                        {reacting === m.id && (
                          <EmojiPicker
                            label="Add a reaction"
                            onClose={() => setReacting(null)}
                            onPick={(e) => {
                              setReacting(null);
                              react(m, e);
                            }}
                          />
                        )}
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

        {panel && <SidePanel kind={panel} conversationId={id} me={me} nameOf={nameOf} onClose={() => setPanel(null)} onJump={(mid) => jumpTo(mid)} onUnpin={member ? (m) => pin(m) : undefined} refreshKey={pinnedCount} />}
      </div>

      {dragging && (
        <div className="chat-drop" aria-hidden="true">
          <Paperclip size={28} />
          <b>Drop files to attach them</b>
        </div>
      )}
      {error && <p className="chat-error">{error}</p>}
      {conversation?.kind === "project" && !member && <p className="chat-join-note">You're reading this channel. Sending a message joins it.</p>}
      <Composer
        conversationId={id}
        mentionable={mentionable}
        submitLabel="Send"
        onSubmit={send}
        autoFocus
        replyTo={replyTo ? { name: replyTo.userId === me.id ? "yourself" : nameOf(replyTo.userId), text: messagePreview(replyTo) || "Attachment" } : null}
        onClearReply={() => setReplyTo(null)}
        registerAdd={(fn) => (addFiles.current = fn)}
      />

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
    </div>
  );
}
/**
 * Pinned messages, or a search of this conversation. Clicking one scrolls to it.
 * @param {{
 *   kind: "pins" | "search";
 *   conversationId: string;
 *   me: User;
 *   nameOf: (id: string) => string;
 *   onClose: () => void;
 *   onJump: (id: number) => void;
 *   onUnpin?: (m: ChatMessage) => void;
 *   refreshKey: number;
 * }} arg13
 */
function SidePanel({ kind, conversationId, me, nameOf, onClose, onJump, onUnpin, refreshKey }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState(/** @type {ChatMessage[] | null | (() => ChatMessage[] | null)} */ (null));
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    if (kind === "search" && q.trim().length < 2) {
      setResults(null);
      return;
    }
    const t = setTimeout(
      () =>
        /** @type {Promise<Array<ChatMessage>>} */ (/** @type {unknown} */ (api(kind === "pins" ? `/chat/${conversationId}/pins` : `/chat/${conversationId}/search?q=${encodeURIComponent(q.trim())}`)))
          .then((r) => live && (setResults(r), setError("")))
          .catch((e) => live && setError(e instanceof Error ? e.message : "Couldn't load that")),
      kind === "search" ? 300 : 0,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [kind, q, conversationId, refreshKey]);
  return (
    <aside className="chat-side" aria-label={kind === "pins" ? "Pinned messages" : "Search this conversation"}>
      <header>
        <b>{kind === "pins" ? "Pinned messages" : "Search"}</b>
        <button className="icon-link" onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
      </header>
      {kind === "search" && (
        <label className="chat-filter">
          <Search size={14} aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Words or a file name" aria-label="Search messages" autoFocus maxLength={100} />
        </label>
      )}
      {error && <p className="chat-error">{error}</p>}
      <ul>
        {kind === "pins" && results?.length === 0 && <li className="chat-empty">Nothing pinned yet. Pin a message from its toolbar to keep it here.</li>}
        {kind === "search" && results?.length === 0 && <li className="chat-empty">No messages match.</li>}
        {kind === "search" && results === null && <li className="chat-empty">Type at least two letters.</li>}
        {results?.map((m) => (
          <li key={m.id}>
            <button className="chat-side-item" onClick={() => onJump(m.id)}>
              <span>
                <b>{m.userId === me.id ? "You" : nameOf(m.userId)}</b> <time>{new Date(m.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</time>
              </span>
              <span className="chat-side-text">{messagePreview(m) || "Attachment"}</span>
            </button>
            {kind === "pins" && onUnpin && (
              <button className="icon-link" onClick={() => onUnpin(m)} aria-label="Unpin" title="Unpin">
                <PinOff size={13} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}
/**
 * Enter sends, Shift+Enter starts a new line; typing @ suggests people. Files by button, paste or drop.
 * @param {ComposerProps} props
 */
function Composer({ conversationId, initial = "", mentionable, submitLabel, autoFocus, onSubmit, onCancel, replyTo, onClearReply, registerAdd }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pick, setPick] = useState(0);
  const [caret, setCaret] = useState(0);
  const [pending, setPending] = useState(/** @type {PendingFile[] | (() => PendingFile[])} */ ([]));
  const [open, setOpen] = useState(/** @type {"emoji" | "gif" | "sticker" | null | (() => "emoji" | "gif" | "sticker" | null)} */ (null));
  const box = useRef(/** @type {HTMLTextAreaElement | null} */ (null));
  const fileInput = useRef(/** @type {HTMLInputElement | null} */ (null));
  const editing = !!onCancel;
  // The @word being typed at the caret, if any.
  const mention = text.slice(0, caret).match(/(?:^|[^\w@])@([a-z0-9._-]{0,40})$/i);
  const suggestions = mention
    ? mentionable
        .filter(
          (u) =>
            u.username.toLowerCase().startsWith(mention[1].toLowerCase()) ||
            u.name
              .toLowerCase()
              .split(" ")
              .some((w) => w.startsWith(mention[1].toLowerCase())),
        )
        .slice(0, 6)
    : [];
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);
  // Object URLs for image previews are let go when the composer closes.
  const previews = useRef(/** @type {string[]} */ ([]));
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);
  const add = useCallback(
    /** @param {File[]} files */ (files) => {
      if (editing) return;
      setError("");
      const room = MAX_CHAT_FILES - pending.length;
      if (files.length > room) setError(`Up to ${MAX_CHAT_FILES} files in one message.`);
      for (const file of files.slice(0, Math.max(0, room))) {
        const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const preview = INLINE_IMAGE.test(file.type) ? URL.createObjectURL(file) : undefined;
        if (preview) previews.current.push(preview);
        if (file.size > MAX_CHAT_FILE) {
          setPending((p) => [...p, { key, name: file.name, size: file.size, preview, error: `Too big: files can be up to ${fileSize(MAX_CHAT_FILE)}` }]);
          continue;
        }
        setPending((p) => [...p, { key, name: file.name, size: file.size, preview }]);
        /** @type {Promise<ChatFile>} */ (/** @type {unknown} */ (uploadChatFile(conversationId, file)))
          .then((saved) => setPending((p) => p.map((x) => (x.key === key ? { ...x, file: saved } : x))))
          .catch((e) => setPending((p) => p.map((x) => (x.key === key ? { ...x, error: e instanceof Error ? e.message : "Upload failed" } : x))));
      }
    },
    [conversationId, editing, pending.length],
  );
  // Braces: the effect must return nothing, or React would call `add` as its clean-up.
  useEffect(() => {
    registerAdd?.(add);
  }, [registerAdd, add]);
  const insertAtCaret = /** @param {string} s */ (s) => {
    const el = box.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = `${text.slice(0, start)}${s}${text.slice(end)}`.slice(0, MAX_MESSAGE);
    setText(next);
    const at = start + s.length;
    requestAnimationFrame(() => {
      box.current?.focus();
      box.current?.setSelectionRange(at, at);
      setCaret(at);
    });
  };
  const insert = /** @param {User} u */ (u) => {
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
  const uploading = pending.some((p) => !p.file && !p.error);
  const ready = pending.filter((p) => p.file).map((p) => /** @type {NonNullable<typeof p.file>} */ (p.file).id);
  const deliver = /** @param {Outgoing} out @param {boolean} clear */ async (out, clear) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit(out);
      if (clear && !editing) {
        setText("");
        setPending([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send that");
    } finally {
      setBusy(false);
      box.current?.focus();
    }
  };
  const submit = /** @param {FormEvent} [e] */ async (e) => {
    e?.preventDefault();
    const t = text.trim();
    if (uploading) return setError("Wait for the files to finish uploading.");
    if (!t && !ready.length && !(editing && initial)) return;
    await deliver({ body: t, ...(ready.length ? { files: ready } : {}) }, true);
  };
  const onKey = /** @param {KeyboardEvent<HTMLTextAreaElement>} e */ (e) => {
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
    if (e.key === "Escape") {
      if (onCancel) onCancel();
      else if (replyTo) onClearReply?.();
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };
  const canSend = !busy && !uploading && (!!text.trim() || ready.length > 0 || (editing && !!initial));
  return (
    <form className={`chat-composer ${editing ? "editing" : ""}`} onSubmit={submit}>
      {replyTo && !editing && (
        <div className="chat-replying">
          <CornerUpLeft size={13} aria-hidden="true" />
          <span>
            Replying to <b>{replyTo.name}</b>: {replyTo.text}
          </span>
          <button type="button" onClick={onClearReply} aria-label="Cancel the reply">
            <X size={13} />
          </button>
        </div>
      )}
      {!editing && <PendingFiles files={pending} onRemove={(key) => setPending((p) => p.filter((x) => x.key !== key))} />}
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
      <div className="chat-compose-row">
        {!editing && (
          <div className="chat-compose-tools">
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                add([...(e.target.files ?? [])]);
                e.target.value = "";
              }}
            />
            <button type="button" onClick={() => fileInput.current?.click()} aria-label="Attach files" title={`Attach files (up to ${fileSize(MAX_CHAT_FILE)} each)`}>
              <Paperclip size={17} />
            </button>
            <button type="button" className={open === "emoji" ? "on" : ""} onClick={() => setOpen((o) => (o === "emoji" ? null : "emoji"))} aria-label="Emoji" title="Emoji" aria-expanded={open === "emoji"}>
              <Smile size={17} />
            </button>
            <button type="button" className={`chat-gif-btn ${open === "gif" ? "on" : ""}`} onClick={() => setOpen((o) => (o === "gif" ? null : "gif"))} aria-label="GIFs" title="GIFs" aria-expanded={open === "gif"}>
              GIF
            </button>
            <button type="button" className={open === "sticker" ? "on" : ""} onClick={() => setOpen((o) => (o === "sticker" ? null : "sticker"))} aria-label="Stickers" title="Stickers" aria-expanded={open === "sticker"}>
              <StickyNote size={17} />
            </button>
            {open === "emoji" && <EmojiPicker onClose={() => setOpen(null)} onPick={insertAtCaret} />}
            {open === "gif" && (
              <GifPicker
                onClose={() => setOpen(null)}
                onPick={(gif) => {
                  setOpen(null);
                  deliver({ body: "", gif }, false);
                }}
              />
            )}
            {open === "sticker" && (
              <StickerPicker
                onClose={() => setOpen(null)}
                onPick={(sticker) => {
                  setOpen(null);
                  deliver({ body: "", sticker }, false);
                }}
              />
            )}
          </div>
        )}
        <textarea
          ref={box}
          rows={1}
          value={text}
          maxLength={MAX_MESSAGE}
          autoFocus={autoFocus}
          placeholder={editing ? "Edit your message" : "Write a message. Enter sends, Shift+Enter for a new line."}
          aria-label={editing ? "Edit message" : "Message"}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart);
            setPick(0);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKey}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length && !editing) {
              e.preventDefault();
              add(files);
            }
          }}
        />
        {editing && (
          <button type="button" className="btn btn-ghost sm" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn btn-navy sm chat-send" disabled={!canSend} aria-label={submitLabel}>
          {editing ? submitLabel : <Send size={16} />}
        </button>
      </div>
      {error && <p className="chat-error">{error}</p>}
    </form>
  );
}
// ---------- pop-ups ----------
/**
 * @param {{ users: User[]; me: User; chosen: string[]; onToggle: (id: string) => void; exclude?: string[] }} arg7
 */
function PeoplePicker({ users, me, chosen, onToggle, exclude = [] }) {
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
/**
 * @param {{ me: User; users: User[]; onClose: () => void; onOpen: (id: string) => void }} props
 */
function NewChat({ me, users, onClose, onOpen }) {
  const [mode, setMode] = useState(/** @type {"direct" | "group" | (() => "direct" | "group")} */ ("direct"));
  const [chosen, setChosen] = useState(/** @type {string[] | (() => string[])} */ ([]));
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const go = /** @param {() => Promise<{ id: string }>} run */ async (run) => {
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
          if (mode === "group") go(() => /** @type {Promise<{ id: string; }>} */ (/** @type {unknown} */ (api("/chat/groups", "POST", { name, people: chosen }))));
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
            if (mode === "direct") go(() => /** @type {Promise<{ id: string; }>} */ (/** @type {unknown} */ (api("/chat/direct", "POST", { userId: id }))));
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
/**
 * @param {{ onClose: () => void; onOpen: (id: string) => void }} arg1
 */
function BrowseChannels({ onClose, onOpen }) {
  const [channels, setChannels] = useState(/** @type {Channel[] | null | (() => Channel[] | null)} */ (null));
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    /** @type {Promise<Array<Channel>>} */ (/** @type {unknown} */ (api("/chat/channels"))).then(setChannels).catch((e) => setError(e instanceof Error ? e.message : "Couldn't load the channels"));
  }, []);
  const join = /** @param {Channel} c */ async (c) => {
    try {
      const { id } = await /** @type {Promise<{ id: string; }>} */ (/** @type {unknown} */ (api(`/chat/projects/${c.systemId}/join`, "POST")));
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
/**
 * @param {{
 *   conversation: Conversation;
 *   me: User;
 *   users: User[];
 *   nameOf: (id: string) => string;
 *   canModerate: boolean;
 *   onClose: () => void;
 *   onChanged: () => void;
 *   onLeft: () => void;
 * }} arg1
 */
function ConversationDetails({ conversation, me, users, nameOf, canModerate, onClose, onChanged, onLeft }) {
  const group = conversation.kind === "group";
  const [name, setName] = useState(conversation.name);
  const [adding, setAdding] = useState(/** @type {string[] | null | (() => string[] | null)} */ (null));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canRemove = group && (conversation.createdBy === me.id || canModerate);
  const run = /** @param {() => Promise<unknown>} fn */ async (fn) => {
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
            <PeoplePicker
              users={users}
              me={me}
              chosen={adding}
              exclude={conversation.memberIds}
              onToggle={(id) => setAdding((a) => (/** @type {NonNullable<typeof a>} */ (a).includes(id) ? /** @type {NonNullable<typeof a>} */ (a).filter((x) => x !== id) : [.../** @type {NonNullable<typeof a>} */ (a), id]))}
            />
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
                    <button className="chat-remove" disabled={busy} aria-label={`Remove ${nameOf(id)}`} title="Remove from the group" onClick={() => window.confirm(`Remove ${nameOf(id)} from the group?`) && run(() => api(`/chat/${conversation.id}/members/${id}`, "DELETE"))}>
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
/**
 * @typedef {Object} Props
 * @property {User} me
 * @property {User[]} users
 * @property {boolean} canModerate
 * @property {string | null} [openId]
 * @property {(n: number) => void} onUnread
 * @property {boolean} [docked] One conversation (openId) inside another page: no page header, no list of conversations.
 */
/**
 * @typedef {Object} ViewProps
 * @property {string} id
 * @property {Conversation} [conversation]
 * @property {User} me
 * @property {User[]} users
 * @property {(id: string) => string} nameOf
 * @property {boolean} canModerate
 * @property {() => void} onBack
 * @property {() => void} onChanged
 * @property {() => void} onLeft
 */
/**
 * What the composer sends: words, files, a GIF or a sticker, maybe as a reply.
 * @typedef {Object} Outgoing
 * @property {string} body
 * @property {string[]} [files]
 * @property {ChatGif} [gif]
 * @property {string} [sticker]
 */
/**
 * @typedef {Object} ComposerProps
 * @property {string} conversationId
 * @property {string} [initial]
 * @property {User[]} mentionable
 * @property {string} submitLabel
 * @property {boolean} [autoFocus]
 * @property {(out: Outgoing) => Promise<void>} onSubmit
 * @property {() => void} [onCancel]
 * @property {{ name: string; text: string } | null} [replyTo]
 * @property {() => void} [onClearReply]
 * @property {(fn: (files: File[]) => void) => void} [registerAdd]
 */
/**
 * @typedef {Object} Channel
 * @property {string} systemId
 * @property {string} name
 * @property {string} conversationId
 * @property {boolean} member
 * @property {number} members
 */
