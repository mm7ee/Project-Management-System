// Adding Pulse to a phone's home screen. Android and desktop Chrome offer a prompt, which fires once
// early on, so it's caught here at start-up for the Settings page to use later. iPhones have no
// prompt: people use Share, then Add to Home Screen.

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

export function startInstallSupport() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
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

export const canPromptInstall = () => !!deferred;

export function onInstallChange(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function promptInstall() {
  if (!deferred) return;
  await deferred.prompt();
  await deferred.userChoice.catch(() => undefined);
  deferred = null;
  changed();
}

/** Already running from the home screen. */
export const isInstalled = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
