/** @import { Prefs } from './data/roles' */
import { useEffect } from "react";
// Preferences live on the account (so they follow the user between devices); the theme
// is also cached locally so a reload paints in the right colours before sign-in data arrives.
const THEME_CACHE = "pms:theme";
/**
 * @returns {HTMLElement}
 */
const root = () => document.documentElement;
/**
 * @returns {MediaQueryList}
 */
const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");
/**
 * The theme actually painted: "Match device" picks Dark (the futuristic look) or Light.
 * @param {Prefs["theme"]} theme
 * @returns {Resolved}
 */
export function resolveTheme(theme) {
  return theme === "system" ? (darkQuery().matches ? "futuristic" : "light") : theme;
}
/**
 * Run once at start-up, before React renders.
 * @returns {void}
 */
export function applyCachedTheme() {
  root().dataset.theme = landingTheme();
}

/**
 * The theme before sign-in: the one last used on this device, else the device's own light or dark setting.
 * @returns {"light" | "dark" | "futuristic"}
 */
export function landingTheme() {
  try {
    const t = localStorage.getItem(THEME_CACHE);
    if (t === "light" || t === "dark" || t === "futuristic") return t;
  } catch {
    // Storage unavailable: follow the device.
  }
  return darkQuery().matches ? "dark" : "light";
}

/**
 * The platform page's theme toggle: light → dark → futuristic, remembered on this device. Signing in applies the
 * account's own choice over it.
 * @param {"light" | "dark" | "futuristic"} current
 * @returns {"light" | "dark" | "futuristic"}
 */
export function cycleTheme(current) {
  const next = current === "light" ? "dark" : current === "dark" ? "futuristic" : "light";
  root().dataset.theme = next;
  try {
    localStorage.setItem(THEME_CACHE, next);
  } catch {
    // A nicety only.
  }
  return next;
}
/**
 * Keeps <html> data attributes in step with the user's preferences.
 * @param {Prefs | null} prefs
 * @returns {void}
 */
export function useApplyPrefs(prefs) {
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
    root().dataset.glass = prefs.glass;
    if (prefs.theme !== "system") return;
    const q = darkQuery();
    q.addEventListener("change", apply);
    return () => q.removeEventListener("change", apply);
  }, [prefs]);
}
/**
 * True when animations should be skipped: the OS setting or the user's own preference.
 * @returns {boolean}
 */
export function reduceMotion() {
  return root().dataset.motion === "reduced" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
/** @typedef {"light" | "futuristic"} Resolved */
