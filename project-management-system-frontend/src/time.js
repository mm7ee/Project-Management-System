import { useEffect, useState } from "react";
const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/**
 * Re-renders the caller every `ms` and returns the current timestamp.
 * @param {number} [ms=MIN]
 * @returns {number}
 */
export function useNow(ms = MIN) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
/**
 * "just now", "2h ago", "2d ago", "2w ago", "3mo ago".
 * @param {string} iso
 * @param {number} now
 * @returns {string}
 */
export function timeAgo(iso, now) {
  const t = Math.max(0, now - new Date(iso).getTime());
  if (t < MIN) return "just now";
  if (t < HOUR) return `${Math.floor(t / MIN)}m ago`;
  if (t < DAY) return `${Math.floor(t / HOUR)}h ago`;
  if (t < 7 * DAY) return `${Math.floor(t / DAY)}d ago`;
  if (t < 30 * DAY) return `${Math.floor(t / (7 * DAY))}w ago`;
  if (t < 365 * DAY) return `${Math.floor(t / (30 * DAY))}mo ago`;
  return `${Math.floor(t / (365 * DAY))}y ago`;
}
/**
 * "02 Oct"
 * @param {string} iso
 * @returns {string}
 */
export function formatShort(iso) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}
/**
 * "02 Oct 2026"
 * @param {string} iso
 * @returns {string}
 */
export function formatDate(iso) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
/**
 * @param {number} n
 * @param {string} word
 * @returns {string}
 */
export function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
