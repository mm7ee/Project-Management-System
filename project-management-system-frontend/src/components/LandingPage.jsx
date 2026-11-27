import { useEffect, useRef, useState } from "react";
import { ArrowRight, Building2, ChartColumn, ChartGantt, Columns3, Headset, LoaderCircle, Moon, Orbit, Repeat2, Sparkles, Sun } from "lucide-react";
import { BRAND } from "../data/brand";
import { cycleTheme, landingTheme } from "../prefs";
import "./landing.css";

/**
 * The platform page (State A, docs/branding-plan.md; design: "Clean timeline", docs/DECISIONS.md). Neutral: no logo,
 * no organisation, no claims. One wide project timeline runs behind the page with a "Today" line; the wordmark is
 * still; the last word of the headline turns over; a small board shows a card moving to Done. Everything that moves
 * animates only transform and opacity, stops for reduced motion, and pauses when the tab is hidden or the art is off
 * screen.
 *
 * The behaviour is the sign-in page's (Login.jsx): the code field (lower-cased as it's typed), Continue, "Find your
 * organisation", the remembered device note and one generic message for every code that leads nowhere.
 * @param {{
 *   draft: string;
 *   onDraft: (v: string) => void;
 *   onSubmit: (from: DOMRect | null) => void;
 *   checking: boolean;
 *   error: string;
 *   errorKey: number;
 *   notice: string;
 *   children?: import("react").ReactNode;
 * }} props  children: shown instead of the code card (the password-reset screen an emailed link opens)
 */
export default function LandingPage({ draft, onDraft, onSubmit, checking, error, errorKey, notice, children }) {
  const page = useRef(/** @type {HTMLDivElement | null} */ (null));
  const card = useRef(/** @type {HTMLFormElement | null} */ (null));
  const go = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const [findOpen, setFindOpen] = useState(false);
  usePausedAnimations(page);

  // A refusal: the card shakes once, and the message is announced (role="alert").
  useEffect(() => {
    const el = card.current;
    if (!errorKey || !el) return;
    el.classList.remove("lp-shake");
    void el.offsetWidth; // restart the animation
    el.classList.add("lp-shake");
  }, [errorKey]);

  return (
    <div className="landing lp-a" ref={page}>
      <div className="lp-a-bg" aria-hidden="true">
        <div className="lp-a-band">
          <i style={/** @type {any} */ ({ "--w": "34%", "--s": "0%", "--d": "0s" })} />
          <i style={/** @type {any} */ ({ "--w": "28%", "--s": "18%", "--d": ".4s" })} />
          <i style={/** @type {any} */ ({ "--w": "40%", "--s": "30%", "--d": ".8s" })} />
          <i style={/** @type {any} */ ({ "--w": "22%", "--s": "52%", "--d": "1.2s" })} />
          <i style={/** @type {any} */ ({ "--w": "30%", "--s": "64%", "--d": "1.6s" })} />
          <b>
            <span>Today</span>
          </b>
        </div>
      </div>

      <main className="lp-a-main">
        <section className="lp-a-hero">
          <h1 className="lp-a-wm" aria-label={BRAND.productName}>
            <span className="lp-a-pms" aria-hidden="true">
              {BRAND.shortName}
            </span>
            <span className="lp-a-full" aria-hidden="true">
              {BRAND.productName}
            </span>
          </h1>
          <p className="lp-a-head">
            <span className="sr-only">Plan. Track. Deliver.</span>
            <span aria-hidden="true">
              Plan. Track.{" "}
              <span className="lp-a-rot">
                <span>
                  <i>Deliver.</i>
                  <i>Ship.</i>
                  <i>Report.</i>
                  <i>Succeed.</i>
                  <i>Deliver.</i>
                </span>
              </span>
            </span>
          </p>
          <p className="lp-a-lede">{BRAND.tagline}</p>
          <ul className="lp-a-chips" aria-label="What's inside">
            <li>
              <Columns3 aria-hidden="true" /> Boards
            </li>
            <li>
              <Repeat2 aria-hidden="true" /> Sprints
            </li>
            <li>
              <ChartGantt aria-hidden="true" /> Timeline
            </li>
            <li>
              <ChartColumn aria-hidden="true" /> Reports
            </li>
            <li>
              <Headset aria-hidden="true" /> Service desk
            </li>
            <li>
              <Sparkles aria-hidden="true" /> {BRAND.assistantName}
            </li>
          </ul>
        </section>

        <section className="lp-a-side">
          <span className="lp-a-ring" aria-hidden="true" />
          {children ?? (
            <form
              ref={card}
              className="lp-card lp-morph lp-a-card"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                if (!checking) onSubmit(go.current?.getBoundingClientRect() ?? null);
              }}
            >
              <label className="lp-field" htmlFor="lp-org-code">
                <span>Organisation code</span>
              </label>
              <span className="lp-input lp-a-input">
                <Building2 size={17} aria-hidden="true" />
                <input
                  id="lp-org-code"
                  autoFocus
                  autoComplete="organization"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={draft}
                  onChange={(e) => onDraft(e.target.value.toLowerCase())}
                  placeholder="e.g. your-company"
                  aria-describedby="lp-org-help lp-org-error"
                  aria-invalid={error ? true : undefined}
                />
              </span>
              <p className="lp-help" id="lp-org-help">
                Your administrator gives you this code, or a sign-in link with it. This device remembers it.
              </p>
              {notice && (
                <p className="lp-ok" role="status">
                  {notice}
                </p>
              )}
              <p className={error ? "lp-error" : "lp-a-noerror"} id="lp-org-error" role="alert" aria-live="assertive">
                {error}
              </p>
              <button ref={go} type="submit" className={`lp-submit lp-a-go ${checking ? "checking" : ""}`} aria-busy={checking}>
                {checking ? (
                  <>
                    <LoaderCircle size={18} className="lp-a-spin" aria-hidden="true" /> Checking…
                  </>
                ) : (
                  <>
                    Continue <ArrowRight size={18} className="lp-a-arrow" aria-hidden="true" />
                  </>
                )}
              </button>
              <button type="button" className="lp-link" aria-expanded={findOpen} aria-controls="lp-find" onClick={() => setFindOpen((v) => !v)}>
                Find your organisation
              </button>
              {findOpen && (
                <p className="lp-find" id="lp-find">
                  Use the sign-in link your administrator sent you: it opens your organisation's page directly. Without it, ask them for your organisation's code. For privacy, organisations aren't listed or searchable here.
                </p>
              )}
            </form>
          )}
          <Board />
        </section>
      </main>

      <ThemeToggle />

      <footer className="lp-foot lp-a-foot">
        <span>
          {BRAND.productName} · {new Date().getFullYear()}
        </span>
        {BRAND.supportEmail && <a href={`mailto:${BRAND.supportEmail}`}>Help</a>}
      </footer>
    </div>
  );
}

/** The little board under the card: one card travels To do → In progress → Done, where it's ticked. */
function Board() {
  return (
    <div className="lp-a-board" aria-hidden="true">
      <span className="lp-a-cap">Board</span>
      <div className="lp-a-kb">
        {["To do", "In progress", "Done"].map((title, i) => (
          <div className="lp-a-col" key={title}>
            <b>{title}</b>
            <span className="lp-a-slot" />
            {Array.from({ length: [2, 1, 0][i] }, (_, k) => (
              <span className="lp-a-kcard" key={k} />
            ))}
          </div>
        ))}
        <span className="lp-a-kcard lp-a-mover" />
        <svg className="lp-a-tick" viewBox="0 0 16 16">
          <path d="M3 8.5l3.2 3L13 4.5" />
        </svg>
      </div>
    </div>
  );
}

/** Light → dark → futuristic. The page follows the device until someone picks; signing in applies their own choice. */
function ThemeToggle() {
  const [theme, setTheme] = useState(landingTheme);
  const next = { light: "dark", dark: "futuristic", futuristic: "light" }[theme];
  const label = { light: "Light", dark: "Dark", futuristic: "Futuristic" };
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Orbit;
  return (
    <button type="button" className="lp-a-theme" aria-label={`Theme: ${label[theme]}. Switch to ${label[/** @type {keyof typeof label} */ (next)]}`} onClick={() => setTheme(cycleTheme(theme))}>
      <Icon size={16} aria-hidden="true" />
    </button>
  );
}

/**
 * Pauses every animation on the page while the tab is hidden, and the background art while it's off screen.
 * @param {import("react").RefObject<HTMLElement | null>} ref
 */
function usePausedAnimations(ref) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onVisible = () => el.classList.toggle("lp-paused", document.hidden);
    document.addEventListener("visibilitychange", onVisible);
    onVisible();
    /** @type {IntersectionObserver | null} */ let io = null;
    if ("IntersectionObserver" in window) {
      io = new IntersectionObserver((entries) => entries.forEach((e) => e.target.classList.toggle("lp-offscreen", !e.isIntersecting)));
      el.querySelectorAll(".lp-a-band, .lp-a-board, .lp-a-ring").forEach((n) => io?.observe(n));
    }
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      io?.disconnect();
    };
  }, [ref]);
}
