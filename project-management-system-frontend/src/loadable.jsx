import { Component, lazy, useEffect, useState } from "react";
import { BRAND } from "./data/brand";

// Parts of the app that load on demand (the signed-in app, the platform, executive and portal pages) arrive as separate
// files. A download can fail: a dropped connection, or a tab left open across a release whose old files are gone.
// Without this, React shows nothing at all. With it: the download is tried again, the page reloads once to pick up
// the current release, and if that still fails, a message with a Reload button.

const RELOADED = "pms:reloaded-for-update";

/**
 * React.lazy, with one retry and then one page reload before giving up.
 * @template {import("react").ComponentType<any>} T
 * @param {() => Promise<{ default: T }>} load
 */
export function lazyRetry(load) {
  return lazy(async () => {
    try {
      const m = await load();
      try {
        sessionStorage.removeItem(RELOADED);
      } catch {
        // A nicety only.
      }
      return m;
    } catch (first) {
      await new Promise((r) => setTimeout(r, 800));
      try {
        return await load();
      } catch {
        // Once per tab: reload to fetch the current release's files.
        let reloaded = false;
        try {
          reloaded = sessionStorage.getItem(RELOADED) === "1";
          if (!reloaded) sessionStorage.setItem(RELOADED, "1");
        } catch {
          reloaded = true;
        }
        if (!reloaded) {
          window.location.reload();
          return new Promise(() => {}); // the reload takes over
        }
        throw first;
      }
    }
  });
}

/** While data or a page's code loads: the neutral PMS mark, then, if it takes too long, a way out. */
export function Splash() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 15000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="splash" role="status" aria-label="Loading">
      <span className="splash-pms">{BRAND.shortName}</span>
      {slow && (
        <p className="splash-slow">
          This is taking longer than usual.{" "}
          <button type="button" className="btn btn-ghost sm" onClick={() => window.location.reload()}>
            Reload
          </button>
        </p>
      )}
    </div>
  );
}

/**
 * If a part of the app fails to load or crashes while drawing, says so and offers a reload, instead of a blank page.
 * @extends {Component<{ children: import("react").ReactNode }, { failed: boolean }>}
 */
export class LoadBoundary extends Component {
  /** @param {{ children: import("react").ReactNode }} props */
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  /** @param {unknown} error */
  componentDidCatch(error) {
    console.error("The page couldn't load", error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="splash load-failed" role="alert">
        <span className="splash-pms">{BRAND.shortName}</span>
        <p>The page couldn't finish loading. Check your connection, then reload.</p>
        <button type="button" className="btn btn-navy" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
