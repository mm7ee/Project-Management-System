import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Status } from "../../data/systems";

// Chart colours. Validated with the dataviz palette checker (light surface #fff):
// the five active statuses pass lightness, chroma, CVD and normal-vision checks; cyan
// and amber sit under 3:1 contrast, so every chart carries visible labels + a table.
// "Not started" (idea + upcoming) is deliberately the de-emphasis grey, not a hue.
export const STAGE_COLOR = {
  NOT_STARTED: "#b7c3d3",
  WIP: "#1ba9e1",
  TESTING: "#7356d6",
  TO_DEPLOY: "#d18e00",
  LIVE: "#0e8a6b",
  COMPLETED: "#24589f",
} as const;
export type Stage = keyof typeof STAGE_COLOR;

export const STAGES: { key: Stage; label: string }[] = [
  { key: "NOT_STARTED", label: "Not started" },
  { key: "WIP", label: "In progress" },
  { key: "TESTING", label: "Testing" },
  { key: "TO_DEPLOY", label: "To deploy" },
  { key: "LIVE", label: "Live" },
  { key: "COMPLETED", label: "Completed" },
];

export const stageOf = (s: Status): Stage => (s === "IDEA" || s === "UPCOMING" ? "NOT_STARTED" : s);

// Reserved status colours for schedule health (never reused for series).
export const HEALTH_COLOR = { ON_TRACK: "#0e8a6b", AT_RISK: "#d18e00", OVERDUE: "#d9534f", DONE: "#24589f" };

/** Tracks an element's content width so SVGs render at true pixel size (crisp text). */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

// ---------- one shared tooltip for every chart ----------

interface Tip {
  x: number;
  y: number;
  content: ReactNode;
}
const TipContext = createContext<(t: Tip | null) => void>(() => undefined);

export function TooltipLayer({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<Tip | null>(null);
  return (
    <TipContext.Provider value={setTip}>
      {children}
      {tip && (
        <div
          className="viz-tip"
          role="status"
          style={{
            left: Math.min(tip.x + 14, window.innerWidth - 260),
            top: tip.y + 14 > window.innerHeight - 140 ? tip.y - 120 : tip.y + 14,
          }}
        >
          {tip.content}
        </div>
      )}
    </TipContext.Provider>
  );
}

/**
 * Props that make any SVG mark (or its larger hit area) show a tooltip on hover and on
 * keyboard focus. Tooltips enhance only: every value is also in labels or the table.
 */
export function useTip() {
  const set = useContext(TipContext);
  return useCallback(
    (content: ReactNode, label: string) => ({
      tabIndex: 0,
      role: "img",
      "aria-label": label,
      onPointerMove: (e: React.PointerEvent) => set({ x: e.clientX, y: e.clientY, content }),
      onPointerLeave: () => set(null),
      onFocus: (e: React.FocusEvent<Element>) => {
        const r = e.currentTarget.getBoundingClientRect();
        set({ x: r.left + r.width / 2, y: r.top + r.height / 2, content });
      },
      onBlur: () => set(null),
    }),
    [set],
  );
}

/** Tooltip body: value first and strong, label after (the tooltip hierarchy). */
export function TipRows({ title, rows }: { title: string; rows: [string, ReactNode, string?][] }) {
  return (
    <>
      <div className="viz-tip-title">{title}</div>
      {rows.map(([label, value, color]) => (
        <div key={label} className="viz-tip-row">
          {color && <i style={{ background: color }} />}
          <b>{value}</b>
          <span>{label}</span>
        </div>
      ))}
    </>
  );
}

/** Legend: swatch shape mirrors the mark (rect for bars). Always present for 2+ series. */
export function Legend({ items }: { items: { label: string; color: string; shape?: "rect" | "tick" | "line" }[] }) {
  return (
    <ul className="viz-legend">
      {items.map((i) => (
        <li key={i.label}>
          <i className={`viz-key ${i.shape ?? "rect"}`} style={{ background: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}
