import { useEffect } from "react";
import type { Prefs } from "./data/roles";

// Preferences live on the account (so they follow the user between devices); the theme
// is also cached locally so a reload paints in the right colours before sign-in data arrives.
const THEME_CACHE = "omnitrack:theme";
const root = () => document.documentElement;
const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

type Resolved = "light" | "dark" | "futuristic";

function resolveTheme(theme: Prefs["theme"]): Resolved {
  return theme === "system" ? (darkQuery().matches ? "dark" : "light") : theme;
}

/** Run once at start-up, before React renders. */
export function applyCachedTheme() {
  try {
    const t = localStorage.getItem(THEME_CACHE);
    if (t === "dark" || t === "light" || t === "futuristic") root().dataset.theme = t;
  } catch {
    // Storage unavailable: start in light.
  }
}

/** Keeps <html> data attributes in step with the user's preferences. */
export function useApplyPrefs(prefs: Prefs | null) {
  useEffect(() => {
    if (!prefs) return;
    const apply = () => {
      const theme = resolveTheme(prefs.theme);
      root().dataset.theme = theme;
      try {
        localStorage.setItem(THEME_CACHE, theme);
      } catch {
        // Cache is a nicety only.
      }
    };
    apply();
    root().dataset.motion = prefs.motion;
    root().dataset.density = prefs.density;
    if (prefs.theme !== "system") return;
    const q = darkQuery();
    q.addEventListener("change", apply);
    return () => q.removeEventListener("change", apply);
  }, [prefs]);
}

/** True when animations should be skipped: the OS setting or the user's own preference. */
export function reduceMotion(): boolean {
  return root().dataset.motion === "reduced" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
