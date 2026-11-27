import { useEffect, useRef } from "react";
import { reduceMotion } from "../prefs";
/**
 * Drifting network of points joined by faint lines (the "omnichannel" backdrop on the
 * landing page). Draws one still frame when the visitor prefers reduced motion, and
 * pauses while the tab is hidden.
 */
// Ink per backdrop: neutral steel and grey on every surface, the same in every organisation (the platform stays
// neutral; an organisation's accent shows in its controls, not in the backdrop). Kept faint so the pages stay calm.
const PALETTES = {
  dark: { link: "143, 179, 212", linkAlpha: 0.14, reach: "190, 205, 220", reachAlpha: 0.28, dot: "rgba(190, 205, 220, 0.6)", accent: "rgba(230, 235, 241, 0.75)" },
  light: { link: "62, 92, 118", linkAlpha: 0.16, reach: "62, 92, 118", reachAlpha: 0.4, dot: "rgba(62, 92, 118, 0.42)", accent: "rgba(31, 41, 51, 0.6)" },
  appLight: { link: "62, 92, 118", linkAlpha: 0.1, reach: "62, 92, 118", reachAlpha: 0.26, dot: "rgba(62, 92, 118, 0.28)", accent: "rgba(31, 41, 51, 0.45)" },
  appDark: { link: "143, 179, 212", linkAlpha: 0.1, reach: "190, 205, 220", reachAlpha: 0.24, dot: "rgba(190, 205, 220, 0.4)", accent: "rgba(230, 235, 241, 0.6)" },
  sidebar: { link: "190, 205, 220", linkAlpha: 0.18, reach: "190, 205, 220", reachAlpha: 0.3, dot: "rgba(210, 220, 230, 0.5)", accent: "rgba(230, 235, 241, 0.7)" },
};
/**
 * @param {{ className?: string; palette?: keyof typeof PALETTES }} props
 */
export default function ParticleField({ className, palette = "dark" }) {
  const ref = useRef(/** @type {HTMLCanvasElement | null} */ (null));
  useEffect(() => {
    const ink = PALETTES[palette];
    const canvas = /** @type {NonNullable<typeof ref.current>} */ (ref.current);
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
    const still = reduceMotion();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    let frame = 0;
    const mouse = { x: -9999, y: -9999 };
    /** @type {P[]} */ let points = [];
    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Denser in narrow spaces (the sidebar) so the web still reads; none while hidden.
      const count = w && h ? Math.round(Math.min(90, Math.max((w * h) / 16000, 24))) : 0;
      points = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        r: Math.random() * 1.6 + 0.6,
        amber: Math.random() < 0.08,
      }));
    };
    const LINK = 130;
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of points) {
        if (!still) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < -20) p.x = w + 20;
          if (p.x > w + 20) p.x = -20;
          if (p.y < -20) p.y = h + 20;
          if (p.y > h + 20) p.y = -20;
        }
      }
      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        for (let j = i + 1; j < points.length; j++) {
          const b = points[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < LINK) {
            ctx.strokeStyle = `rgba(${ink.link}, ${ink.linkAlpha * (1 - d / LINK)})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
        // Points near the pointer reach out to it.
        const dm = Math.hypot(a.x - mouse.x, a.y - mouse.y);
        if (dm < LINK * 1.4) {
          ctx.strokeStyle = `rgba(${ink.reach}, ${ink.reachAlpha * (1 - dm / (LINK * 1.4))})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(mouse.x, mouse.y);
          ctx.stroke();
        }
        ctx.fillStyle = a.amber ? ink.accent : ink.dot;
        ctx.beginPath();
        ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!still && !document.hidden) frame = requestAnimationFrame(draw);
    };
    const onMove = /** @param {PointerEvent} e */ (e) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
    };
    const onLeave = () => {
      mouse.x = mouse.y = -9999;
    };
    const onVisible = () => {
      cancelAnimationFrame(frame);
      if (!document.hidden) draw();
    };
    const onResize = () => {
      resize();
      if (still) draw();
    };
    resize();
    draw();
    // Its own size, not the window's: it also starts when a hidden canvas is shown (theme change).
    const watch = new ResizeObserver(onResize);
    watch.observe(canvas);
    window.addEventListener("pointermove", onMove);
    document.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelAnimationFrame(frame);
      watch.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [palette]);
  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
/**
 * @typedef {Object} P
 * @property {number} x
 * @property {number} y
 * @property {number} vx
 * @property {number} vy
 * @property {number} r
 * @property {boolean} amber
 */
