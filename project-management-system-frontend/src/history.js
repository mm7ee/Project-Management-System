// the system's place in the browser history, shared by App (pages) and the pages that have tabs.
// Every entry carries { pms: { view, filter, depth, tabs } }: `depth` counts the steps since PMS
// opened (so the ← only shows when there's somewhere to go back to) and `tabs` remembers which tab
// each page was on, so Back returns to that tab instead of skipping past the page.
import { useCallback, useEffect, useRef, useState } from "react";

/** The depth of the entry on screen. App keeps it current; tab switches move it on. */
export const depth = { current: 0 };
/** @type {(canGoBack: boolean) => void} */
let onDepth = () => {};
/** App tells us how to show or hide the ← when a tab switch adds an entry. */
export const setDepthListener = /** @param {(canGoBack: boolean) => void} fn */ (fn) => {
  onDepth = fn;
};

/** @returns {Record<string, string>} */
const tabsNow = () => window.history.state?.pms?.tabs ?? {};

/**
 * A page's open tab, kept in the browser history: switching tabs is a step Back undoes.
 * @template {string} T
 * @param {string} key   unique per page, e.g. "settings"
 * @param {T | (() => T)} initial  the tab when the entry doesn't name one
 * @returns {[T, (next: T, url?: string) => void, (next: T) => void]}  [tab, go (a Back step; optional new
 *   address for the entry), show (no step)]
 */
export function useHistoryTab(key, initial) {
  const fallback = () => (typeof initial === "function" ? /** @type {() => T} */ (initial)() : initial);
  const [tab, setTab] = useState(/** @type {T | (() => T)} */ (() => /** @type {T | undefined} */ (tabsNow()[key]) ?? fallback()));
  const current = useRef(tab);
  useEffect(() => {
    // The tab the page opened on is the one its own entry showed (that entry names no tab).
    const start = current.current;
    // Also write it on the entry, so Back or Forward to it later shows this tab (not, say, the tab
    // last saved on this device). After a tick: when the page has just opened, App adds its entry
    // after this effect runs.
    const record = setTimeout(() => {
      const s = window.history.state;
      if (s?.pms && !s.pms.tabs?.[key]) window.history.replaceState({ ...s, pms: { ...s.pms, tabs: { ...s.pms.tabs, [key]: start } } }, "");
    }, 0);
    const onPop = /** @param {PopStateEvent} e */ (e) => {
      const t = /** @type {T | undefined} */ (e.state?.pms?.tabs?.[key]) ?? start;
      current.current = t;
      setTab(t);
    };
    window.addEventListener("popstate", onPop);
    return () => {
      clearTimeout(record);
      window.removeEventListener("popstate", onPop);
    };
  }, [key]);
  const go = useCallback(
    /** @param {T} next @param {string} [url] */ (next, url) => {
      if (current.current === next) return;
      current.current = next;
      const s = window.history.state ?? {};
      depth.current += 1;
      window.history.pushState({ ...s, pms: { ...s.pms, depth: depth.current, tabs: { ...s.pms?.tabs, [key]: next } } }, "", url);
      onDepth(true);
      setTab(next);
    },
    [key],
  );
  // Switch without a history step: when the page itself was just opened on that tab from elsewhere.
  const show = useCallback(
    /** @param {T} next */ (next) => {
      current.current = next;
      setTab(next);
    },
    [],
  );
  return [tab, go, show];
}
