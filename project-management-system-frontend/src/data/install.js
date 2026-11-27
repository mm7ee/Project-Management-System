// Adding PMS to a phone's home screen. Android and desktop Chrome offer a prompt, which fires once
// early on, so it's caught here at start-up for the Settings page to use later. iPhones have no
// prompt: people use Share, then Add to Home Screen.
/** @type {InstallPromptEvent | null} */ let deferred = null;
const listeners = /** @type {Set<() => void>} */ (/** @type {unknown} */ (new Set()));
/**
 * @returns {void}
 */
const changed = () => listeners.forEach((f) => f());
/**
 * @returns {void}
 */
export function startInstallSupport() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = /** @type {InstallPromptEvent} */ (e);
    changed();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    changed();
  });
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => undefined));
  }
}
/**
 * @returns {boolean}
 */
export const canPromptInstall = () => !!deferred;
/**
 * @param {() => void} listener
 * @returns {() => void}
 */
export function onInstallChange(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
/**
 * @returns {Promise<void>}
 */
export async function promptInstall() {
  if (!deferred) return;
  await deferred.prompt();
  await deferred.userChoice.catch(() => undefined);
  deferred = null;
  changed();
}
/**
 * Already running from the home screen.
 * @returns {boolean}
 */
export const isInstalled = () => window.matchMedia("(display-mode: standalone)").matches || /** @type {Navigator & { standalone?: boolean }} */ (navigator).standalone === true;
/**
 * @returns {boolean}
 */
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
/** @typedef {Event & InstallPromptEventOwn} InstallPromptEvent */
/**
 * @typedef {Object} InstallPromptEventOwn
 * @property {() => Promise<void>} prompt
 * @property {Promise<{ outcome: "accepted" | "dismissed" }>} userChoice
 */
