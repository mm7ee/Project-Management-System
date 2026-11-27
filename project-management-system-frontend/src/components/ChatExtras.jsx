/** @import { ReactNode } from 'react' */
/** @import { LucideIcon } from 'lucide-react' */
/** @import { ChatFile, ChatGif } from '../data/chat' */
import { useEffect, useRef, useState } from "react";
import { CalendarClock, CheckCircle2, Clock, Coffee, Construction, Download, FileText, Flame, Hand, Heart, LifeBuoy, Lightbulb, PartyPopper, Rocket, Search, Star, Sunrise, ThumbsUp, X, Zap } from "lucide-react";
import { api } from "../data/api";
import { EMOJI_GROUPS, searchEmoji } from "../data/emoji";
import { INLINE_IMAGE, STICKERS, fileSize } from "../data/chat";
// ---------- a pop-over that closes on Escape or a click outside ----------
/**
 * @param {{ label: string; onClose: () => void; children: ReactNode; className?: string }} props
 */
export function Popover({ label, onClose, children, className = "" }) {
  const ref = useRef(/** @type {HTMLDivElement | null} */ (null));
  useEffect(() => {
    const onKey = /** @param {KeyboardEvent} e */ (e) => e.key === "Escape" && onClose();
    const onDown = /** @param {MouseEvent} e */ (e) => ref.current && !ref.current.contains(/** @type {Node} */ (e.target)) && onClose();
    document.addEventListener("keydown", onKey);
    // Next tick, so the click that opened it doesn't close it.
    const t = setTimeout(() => document.addEventListener("mousedown", onDown));
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);
  return (
    <div ref={ref} className={`chat-pop ${className}`} role="dialog" aria-label={label}>
      {children}
    </div>
  );
}
// ---------- emoji ----------
const RECENT_KEY = "pms:recent-emoji";
const recentEmoji = /** @returns {string[]} */ () => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]").slice(0, 16);
  } catch {
    return [];
  }
};
const remember =
  /** @param {string} e
   * @returns {void}
   */ (e) => {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...recentEmoji().filter((x) => x !== e)].slice(0, 16)));
    } catch {
      /* this browser keeps nothing */
    }
  };
/**
 * Search, recently used, then the groups. Picking calls `onPick`; the picker stays open for more.
 * @param {{ onPick: (emoji: string) => void; onClose: () => void; label?: string }} arg3
 */
export function EmojiPicker({ onPick, onClose, label = "Emoji" }) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState(EMOJI_GROUPS[0].id);
  const recent = recentEmoji();
  const pick = /** @param {string} e */ (e) => {
    remember(e);
    onPick(e);
  };
  const list = q.trim() ? searchEmoji(q) : (EMOJI_GROUPS.find((g) => g.id === group)?.emoji.map(([e]) => e) ?? []);
  return (
    <Popover label={label} onClose={onClose} className="chat-emoji-pop">
      <label className="chat-filter">
        <Search size={14} aria-hidden="true" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search emoji" aria-label="Search emoji" autoFocus />
      </label>
      {!q.trim() && (
        <div className="chat-emoji-tabs" role="tablist" aria-label="Emoji groups">
          {EMOJI_GROUPS.map((g) => (
            <button key={g.id} type="button" role="tab" aria-selected={g.id === group} className={g.id === group ? "on" : ""} onClick={() => setGroup(g.id)} title={g.label}>
              {g.emoji[0][0]}
            </button>
          ))}
        </div>
      )}
      {!q.trim() && recent.length > 0 && (
        <>
          <p className="chat-pop-label">Recently used</p>
          <div className="chat-emoji-grid">
            {recent.map((e) => (
              <button key={e} type="button" onClick={() => pick(e)} aria-label={e}>
                {e}
              </button>
            ))}
          </div>
        </>
      )}
      <p className="chat-pop-label">{q.trim() ? `${list.length} found` : EMOJI_GROUPS.find((g) => g.id === group)?.label}</p>
      <div className="chat-emoji-grid">
        {list.map((e) => (
          <button key={e} type="button" onClick={() => pick(e)} aria-label={e}>
            {e}
          </button>
        ))}
        {q.trim() && !list.length && <p className="chat-pop-empty">No emoji match.</p>}
      </div>
    </Popover>
  );
}
/**
 * GIPHY search through the Worker; trending when the box is empty. Off until an administrator adds a key.
 * @param {{ onPick: (g: ChatGif) => void; onClose: () => void }} arg1
 */
export function GifPicker({ onPick, onClose }) {
  const [q, setQ] = useState("");
  const [state, setState] = useState(/** @type {{ enabled: boolean; results: GifResult[] } | null | (() => { enabled: boolean; results: GifResult[] } | null)} */ (null));
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const t = setTimeout(
      () =>
        /** @type {Promise<{ enabled: boolean; results: GifResult[]; }>} */ (/** @type {unknown} */ (api(`/chat/gifs?q=${encodeURIComponent(q.trim())}`))).then((r) => live && (setState(r), setError(""))).catch((e) => live && setError(e instanceof Error ? e.message : "GIF search isn't answering")),
      q ? 350 : 0,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);
  return (
    <Popover label="GIFs" onClose={onClose} className="chat-gif-pop">
      {state && !state.enabled ? (
        <div className="chat-pop-empty">
          <p>
            <b>GIF search isn't switched on yet.</b>
          </p>
          <p>An administrator can turn it on by adding a GIPHY API key to the server. You can still attach your own GIF files with the paperclip.</p>
        </div>
      ) : (
        <>
          <label className="chat-filter">
            <Search size={14} aria-hidden="true" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search GIPHY" aria-label="Search GIFs" autoFocus maxLength={50} />
          </label>
          {error && <p className="chat-error">{error}</p>}
          <div className="chat-gif-grid">
            {state === null && !error && <p className="chat-pop-empty">Loading…</p>}
            {state?.results.map((g) => (
              <button key={g.id} type="button" onClick={() => onPick(g)} title={g.title || "GIF"}>
                <img src={g.preview} alt={g.title || "GIF"} loading="lazy" referrerPolicy="no-referrer" />
              </button>
            ))}
            {state?.enabled && !state.results.length && <p className="chat-pop-empty">No GIFs match.</p>}
          </div>
          <p className="chat-giphy">Powered by GIPHY</p>
        </>
      )}
    </Popover>
  );
}
/**
 * @param {{ gif: ChatGif }} props
 */
export function GifView({ gif }) {
  const w = Math.min(gif.width, 280);
  return (
    <figure className="chat-gif" style={{ width: w, aspectRatio: `${gif.width} / ${gif.height}` }}>
      <img src={gif.url} alt={gif.title || "GIF"} loading="lazy" referrerPolicy="no-referrer" />
      <figcaption>GIPHY</figcaption>
    </figure>
  );
}
// ---------- stickers: the system's own set ----------
/** @type {Record<string, { icon: LucideIcon; from: string; to: string }>} */ const STICKER_ART = {
  thanks: { icon: Heart, from: "#ff7aa8", to: "#d6336c" },
  "great-job": { icon: Star, from: "#ffd35c", to: "#eba300" },
  "on-it": { icon: Zap, from: "#5fd3ff", to: "#0039a6" },
  shipped: { icon: Rocket, from: "#4f80e6", to: "#011f5b" },
  "looks-good": { icon: ThumbsUp, from: "#3ad29f", to: "#0e8a6b" },
  done: { icon: CheckCircle2, from: "#2fbf8a", to: "#0b6e55" },
  "need-help": { icon: LifeBuoy, from: "#ff9d5c", to: "#e36a2a" },
  blocked: { icon: Construction, from: "#ff6b6b", to: "#c8102e" },
  idea: { icon: Lightbulb, from: "#ffe27a", to: "#d99a00" },
  coffee: { icon: Coffee, from: "#c99a6b", to: "#7a4b23" },
  meeting: { icon: CalendarClock, from: "#9a72f0", to: "#5b3fc0" },
  "back-soon": { icon: Clock, from: "#8fa3c7", to: "#45557a" },
  celebrate: { icon: PartyPopper, from: "#f08ad9", to: "#9a3fc0" },
  "on-fire": { icon: Flame, from: "#ffb347", to: "#ed0000" },
  welcome: { icon: Hand, from: "#5fd3ff", to: "#2d63c8" },
  "good-morning": { icon: Sunrise, from: "#ffcf70", to: "#ff7a45" },
};
/**
 * @param {{ id: string; size?: number }} props
 */
export function Sticker({ id, size = 112 }) {
  const meta = STICKERS.find((s) => s.id === id);
  const art = STICKER_ART[id];
  if (!meta || !art) return null;
  const Icon = art.icon;
  return (
    <span className="chat-sticker" role="img" aria-label={`Sticker: ${meta.label}`} style={/** @type {React.CSSProperties} */ ({ width: size, height: size, ["--from"]: art.from, ["--to"]: art.to })}>
      <Icon size={size * 0.38} strokeWidth={2.2} aria-hidden="true" />
      <b style={{ fontSize: Math.max(10, size * 0.13) }}>{meta.label}</b>
    </span>
  );
}
/**
 * @param {{ onPick: (id: string) => void; onClose: () => void }} props
 */
export function StickerPicker({ onPick, onClose }) {
  return (
    <Popover label="Stickers" onClose={onClose} className="chat-sticker-pop">
      <p className="chat-pop-label">Stickers</p>
      <div className="chat-sticker-grid">
        {STICKERS.map((s) => (
          <button key={s.id} type="button" onClick={() => onPick(s.id)} title={s.label} aria-label={`Send the "${s.label}" sticker`}>
            <Sticker id={s.id} size={64} />
          </button>
        ))}
      </div>
    </Popover>
  );
}
// ---------- files ----------
export const fileUrl =
  /** @param {string} conversationId
   * @param {ChatFile} f
   * @param {boolean} [download=false]
   * @returns {string}
   */ (conversationId, f, download = false) => `/api/chat/${conversationId}/files/${f.id}${download ? "?download" : ""}`;
/**
 * Images show inline (click for full size); other files are a card with their size and a download.
 * @param {{ conversationId: string; files: ChatFile[] }} arg3
 */
export function FileList({ conversationId, files }) {
  const images = files.filter((f) => INLINE_IMAGE.test(f.mime));
  const others = files.filter((f) => !INLINE_IMAGE.test(f.mime));
  return (
    <div className="chat-files">
      {images.length > 0 && (
        <div className={`chat-images n${Math.min(images.length, 3)}`}>
          {images.map((f) => (
            <a key={f.id} href={fileUrl(conversationId, f)} target="_blank" rel="noopener noreferrer" title={f.name}>
              <img src={fileUrl(conversationId, f)} alt={f.name} loading="lazy" />
            </a>
          ))}
        </div>
      )}
      {others.map((f) => (
        <a key={f.id} className="chat-file" href={fileUrl(conversationId, f, f.mime !== "application/pdf")} target="_blank" rel="noopener noreferrer">
          <span className="chat-file-icon" aria-hidden="true">
            <FileText size={18} />
          </span>
          <span className="chat-file-text">
            <b>{f.name}</b>
            <small>
              {fileSize(f.size)} · {f.mime === "application/pdf" ? "PDF, opens in a new tab" : "Download"}
            </small>
          </span>
          <Download size={15} aria-hidden="true" />
        </a>
      ))}
    </div>
  );
}
/**
 * @param {{ files: PendingFile[]; onRemove: (key: string) => void }} props
 */
export function PendingFiles({ files, onRemove }) {
  if (!files.length) return null;
  return (
    <ul className="chat-pending" aria-label="Files to send">
      {files.map((p) => (
        <li key={p.key} className={p.error ? "failed" : p.file ? "ready" : "uploading"}>
          {p.preview ? <img src={p.preview} alt="" /> : <FileText size={18} aria-hidden="true" />}
          <span>
            <b>{p.name}</b>
            <small>{p.error ?? (p.file ? fileSize(p.size) : "Uploading…")}</small>
          </span>
          <button type="button" onClick={() => onRemove(p.key)} aria-label={`Remove ${p.name}`}>
            <X size={13} />
          </button>
        </li>
      ))}
    </ul>
  );
}
/** @typedef {ChatGif & { preview: string }} GifResult */
/**
 * A file waiting in the composer: uploading, ready, or failed.
 * @typedef {Object} PendingFile
 * @property {string} key
 * @property {string} name
 * @property {number} size
 * @property {string} [preview]
 * @property {ChatFile} [file]
 * @property {string} [error]
 */
