/** @import { MutableRefObject } from 'react' */
/** @import { ReactNode } from 'react' */
/** @import { Status } from '../../data/systems' */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
// Chart colours are CSS variables (--st-*, defined per theme in styles.css) so marks
// re-colour with the theme. Each mode's set was validated with the dataviz checker
// against its own surface: light #fff and dark #121d31 both pass lightness, chroma, CVD
// and normal-vision checks; a few steps sit under 3:1 contrast, so every chart carries
// visible labels + a table. "Not started" is deliberately the de-emphasis grey.
// Apply to SVG marks with style={{ fill }} (the fill attribute can't read variables).
export const STAGE_COLOR = /** @type {const} */ ({
  NOT_STARTED: "var(--st-not)",
  WIP: "var(--st-wip)",
  TESTING: "var(--st-testing)",
  TO_DEPLOY: "var(--st-deploy)",
  LIVE: "var(--st-live)",
  COMPLETED: "var(--st-done)",
});
/** @type {{ key: Stage; label: string }[]} */ export const STAGES = [
  { key: "NOT_STARTED", label: "Not started" },
  { key: "WIP", label: "In progress" },
  { key: "TESTING", label: "Testing" },
  { key: "TO_DEPLOY", label: "To deploy" },
  { key: "LIVE", label: "Live" },
  { key: "COMPLETED", label: "Completed" },
];
export const stageOf =
  /**
   * @param {Status} s
   * @returns {Stage}
   */ (s) => (s === "IDEA" || s === "UPCOMING" ? "NOT_STARTED" : s);
// Reserved status colours for schedule health (never reused for series).
export const HEALTH_COLOR = { ON_TRACK: "var(--st-live)", AT_RISK: "var(--st-deploy)", OVERDUE: "var(--st-overdue)", DONE: "var(--st-done)" };
/**
 * Tracks an element's content width so SVGs render at true pixel size (crisp text).
 * @template {HTMLElement} T
 * @returns {readonly [MutableRefObject<T | null>, number]}
 */
export function useWidth() {
  const ref = useRef(/** @type {T | null} */ (null));
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return /** @type {const} */ ([ref, width]);
}
const TipContext = /** @type {React.Context<(t: Tip | null) => void>} */ (/** @type {unknown} */ (createContext(() => undefined)));
/**
 * @param {{ children: ReactNode }} arg1
 */
export function TooltipLayer({ children }) {
  const [tip, setTip] = useState(/** @type {Tip | null | (() => Tip | null)} */ (null));
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
    /** @param {ReactNode} content @param {string} label */ (content, label) => ({
      tabIndex: 0,
      role: "img",
      "aria-label": label,
      onPointerMove: /** @param {React.PointerEvent} e */ (e) => set({ x: e.clientX, y: e.clientY, content }),
      onPointerLeave: () => set(null),
      onFocus: /** @param {React.FocusEvent<Element>} e */ (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        set({ x: r.left + r.width / 2, y: r.top + r.height / 2, content });
      },
      onBlur: () => set(null),
    }),
    [set],
  );
}
/**
 * Tooltip body: value first and strong, label after (the tooltip hierarchy).
 * @param {{ title: string; rows: [string, ReactNode, string?][] }} arg4
 */
export function TipRows({ title, rows }) {
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
/**
 * Legend: swatch shape mirrors the mark (rect for bars). Always present for 2+ series.
 * @param {{ items: { label: string; color: string; shape?: "rect" | "tick" | "line" }[] }} props
 */
export function Legend({ items }) {
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
/** @typedef {keyof typeof STAGE_COLOR} Stage */
/**
 * @typedef {Object} Tip
 * @property {number} x
 * @property {number} y
 * @property {ReactNode} content
 */
