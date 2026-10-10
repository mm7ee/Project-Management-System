import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Status } from "../../data/systems";

// Chart colours are CSS variables (--st-*, defined per theme in styles.css) so marks
// re-colour with the theme. Each mode's set was validated with the dataviz checker
// against its own surface: light #fff and dark #121d31 both pass lightness, chroma, CVD
// and normal-vision checks; a few steps sit under 3:1 contrast, so every chart carries
// visible labels + a table. "Not started" is deliberately the de-emphasis grey.
// Apply to SVG marks with style={{ fill }} (the fill attribute can't read variables).
export const STAGE_COLOR = {
  NOT_STARTED: "var(--st-not)",
  WIP: "var(--st-wip)",
  TESTING: "var(--st-testing)",
  TO_DEPLOY: "var(--st-deploy)",
  LIVE: "var(--st-live)",
  COMPLETED: "var(--st-done)",
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
export const HEALTH_COLOR = { ON_TRACK: "var(--st-live)", AT_RISK: "var(--st-deploy)", OVERDUE: "var(--st-overdue)", DONE: "var(--st-done)" };

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
