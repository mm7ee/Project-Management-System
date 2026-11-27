import { BRAND } from "../data/brand";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
// Each deploy gives the app bundle a new hashed filename. An open tab keeps running the
// bundle it loaded, so we periodically re-read index.html and offer a reload when the
// bundle it points to has changed. (A banner rather than an auto-reload, so nobody loses
// a half-filled form.)
const BUNDLE = /\/assets\/index-[\w-]+\.js/;
/**
 * @returns {string | null}
 */
function loadedBundle() {
  const el = /** @type {HTMLScriptElement | null} */ (/** @type {unknown} */ (document.querySelector('script[type="module"][src*="/assets/index-"]')));
  return el ? new URL(el.src).pathname : null;
}
/**
 */
export default function UpdateBanner() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const mine = loadedBundle();
    if (!mine) return; // dev server: no hashed bundle to compare
    let stopped = false;
    const check = async () => {
      if (stopped || document.hidden) return;
      try {
        const html = await (await fetch("/", { cache: "no-store" })).text();
        const live = html.match(BUNDLE)?.[0];
        if (live && live !== mine) setStale(true);
      } catch {
        // Offline or a blip: try again next time.
      }
    };
    const id = setInterval(check, 60000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      clearInterval(id);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  if (!stale) return null;
  return (
    <div className="update-banner" role="status">
      <span>{BRAND.shortName} has been updated.</span>
      <button onClick={() => window.location.reload()}>
        <RefreshCw size={15} /> Reload
      </button>
    </div>
  );
}
