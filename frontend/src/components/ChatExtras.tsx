import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  Coffee,
  Construction,
  Download,
  FileText,
  Flame,
  Hand,
  Heart,
  LifeBuoy,
  Lightbulb,
  PartyPopper,
  Rocket,
  Search,
  Star,
  Sunrise,
  ThumbsUp,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { api } from "../data/api";
import { EMOJI_GROUPS, searchEmoji } from "../data/emoji";
import { INLINE_IMAGE, STICKERS, fileSize, type ChatFile, type ChatGif } from "../data/chat";

// ---------- a pop-over that closes on Escape or a click outside ----------

export function Popover({ label, onClose, children, className = "" }: { label: string; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
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

const RECENT_KEY = "pulse:recent-emoji";
const recentEmoji = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]").slice(0, 16);
  } catch {
    return [];
  }
};
const remember = (e: string) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...recentEmoji().filter((x) => x !== e)].slice(0, 16)));
  } catch {
    /* this browser keeps nothing */
  }
};

/** Search, recently used, then the groups. Picking calls `onPick`; the picker stays open for more. */
export function EmojiPicker({ onPick, onClose, label = "Emoji" }: { onPick: (emoji: string) => void; onClose: () => void; label?: string }) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState(EMOJI_GROUPS[0].id);
  const recent = recentEmoji();
  const pick = (e: string) => {
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

// ---------- GIFs ----------

type GifResult = ChatGif & { preview: string };

/** GIPHY search through the Worker; trending when the box is empty. Off until an administrator adds a key. */
export function GifPicker({ onPick, onClose }: { onPick: (g: ChatGif) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [state, setState] = useState<{ enabled: boolean; results: GifResult[] } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const t = setTimeout(
      () =>
        api<{ enabled: boolean; results: GifResult[] }>(`/chat/gifs?q=${encodeURIComponent(q.trim())}`)
          .then((r) => live && (setState(r), setError("")))
          .catch((e) => live && setError(e instanceof Error ? e.message : "GIF search isn't answering")),
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
          <p>An administrator can turn it on by adding a GIPHY API key to Pulse. You can still attach your own GIF files with the paperclip.</p>
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

export function GifView({ gif }: { gif: ChatGif }) {
  const w = Math.min(gif.width, 280);
  return (
    <figure className="chat-gif" style={{ width: w, aspectRatio: `${gif.width} / ${gif.height}` }}>
      <img src={gif.url} alt={gif.title || "GIF"} loading="lazy" referrerPolicy="no-referrer" />
      <figcaption>GIPHY</figcaption>
    </figure>
  );
}

// ---------- stickers: Pulse's own set ----------

const STICKER_ART: Record<string, { icon: LucideIcon; from: string; to: string }> = {
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

export function Sticker({ id, size = 112 }: { id: string; size?: number }) {
  const meta = STICKERS.find((s) => s.id === id);
  const art = STICKER_ART[id];
  if (!meta || !art) return null;
  const Icon = art.icon;
  return (
    <span className="chat-sticker" role="img" aria-label={`Sticker: ${meta.label}`} style={{ width: size, height: size, ["--from" as string]: art.from, ["--to" as string]: art.to }}>
      <Icon size={size * 0.38} strokeWidth={2.2} aria-hidden="true" />
      <b style={{ fontSize: Math.max(10, size * 0.13) }}>{meta.label}</b>
    </span>
  );
}

export function StickerPicker({ onPick, onClose }: { onPick: (id: string) => void; onClose: () => void }) {
  return (
    <Popover label="Stickers" onClose={onClose} className="chat-sticker-pop">
      <p className="chat-pop-label">Pulse stickers</p>
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

export const fileUrl = (conversationId: string, f: ChatFile, download = false) => `/api/chat/${conversationId}/files/${f.id}${download ? "?download" : ""}`;

/** Images show inline (click for full size); other files are a card with their size and a download. */
export function FileList({ conversationId, files }: { conversationId: string; files: ChatFile[] }) {
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

/** A file waiting in the composer: uploading, ready, or failed. */
export interface PendingFile {
  key: string;
  name: string;
  size: number;
  preview?: string; // an object URL for images
  file?: ChatFile; // set once uploaded
  error?: string;
}

export function PendingFiles({ files, onRemove }: { files: PendingFile[]; onRemove: (key: string) => void }) {
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
