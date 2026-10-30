import { useEffect, useRef } from "react";
import { reduceMotion } from "../prefs";

// One heartbeat, as bumps along a phase of 0–1: the small P wave, the sharp QRS spike, the T wave.
const WAVE: [centre: number, width: number, height: number][] = [
  [0.18, 0.035, 0.12],
  [0.3, 0.012, -0.12],
  [0.335, 0.014, 1],
  [0.372, 0.014, -0.3],
  [0.56, 0.05, 0.22],
];
const signal = (phase: number) => WAVE.reduce((y, [c, w, h]) => y + h * Math.exp(-(((phase - c) / w) ** 2)), 0);

const BEAT_PX = 240; // width of one heartbeat
const BEAT_SECONDS = 1.3; // matches the headline's beat in landing.css

/**
 * A heart-monitor trace across the whole width: a bright head sweeps left to right and the line
 * fades away behind it. Draws one still trace when motion is reduced; pauses while the tab is hidden.
 */
export default function PulseMonitor({ className, tone = "dark" }: { className?: string; tone?: "dark" | "light" }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // Glowing light on navy, or cyan and navy ink on a pale page.
    const ink =
      tone === "dark"
        ? { glow: "27, 169, 225", glowAlpha: 0.22, line: "143, 220, 251", lineAlpha: 0.9, halo: "rgba(143, 220, 251, 0.22)", head: "#ffffff" }
        : { glow: "27, 169, 225", glowAlpha: 0.16, line: "11, 111, 176", lineAlpha: 0.75, halo: "rgba(27, 169, 225, 0.2)", head: "#0b6fb0" };
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const still = reduceMotion();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    let frame = 0;
    const started = performance.now();

    const yAt = (x: number) => h * 0.62 - signal((x / BEAT_PX) % 1) * h * 0.46;

    const draw = (now: number) => {
      ctx.clearRect(0, 0, w, h);
      if (w) {
        const head = still ? w : (((now - started) / 1000) * (BEAT_PX / BEAT_SECONDS)) % w;
        const STEP = 3;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        for (let x = 0; x < w; x += STEP) {
          // How long ago the head passed this point: 0 just now, 1 a full sweep ago.
          const age = ((head - x + w) % w) / w;
          const alpha = still ? 0.4 : age > 0.9 ? 0 : (1 - age / 0.9) ** 1.7;
          if (alpha < 0.01) continue;
          ctx.beginPath();
          ctx.moveTo(x, yAt(x));
          ctx.lineTo(x + STEP, yAt(x + STEP));
          ctx.strokeStyle = `rgba(${ink.glow}, ${alpha * ink.glowAlpha})`;
          ctx.lineWidth = 7;
          ctx.stroke();
          ctx.strokeStyle = `rgba(${ink.line}, ${alpha * ink.lineAlpha})`;
          ctx.lineWidth = 1.8;
          ctx.stroke();
        }
        if (!still) {
          const y = yAt(head);
          ctx.fillStyle = ink.halo;
          ctx.beginPath();
          ctx.arc(head, y, 11, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = ink.head;
          ctx.beginPath();
          ctx.arc(head, y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (!still && !document.hidden) frame = requestAnimationFrame(draw);
    };

    const size = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (still) draw(0);
    };
    const onVisible = () => {
      cancelAnimationFrame(frame);
      if (!document.hidden && !still) frame = requestAnimationFrame(draw);
    };

    const watch = new ResizeObserver(size);
    watch.observe(canvas);
    size();
    if (!still) frame = requestAnimationFrame(draw);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelAnimationFrame(frame);
      watch.disconnect();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tone]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
