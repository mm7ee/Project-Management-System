import { useEffect, useRef, useState } from "react";
import { reduceMotion } from "../prefs";

/**
 * Animates a number up to `value` (ease-out), then follows later changes from wherever it
 * is. Suffixes like "%" pass through: <CountUp value="60%" />.
 */
export default function CountUp({ value, ms = 900 }: { value: number | string; ms?: number }) {
  const str = String(value);
  const match = str.match(/^(-?\d+(?:\.\d+)?)(.*)$/);
  const target = match ? Number(match[1]) : NaN;
  const suffix = match ? match[2] : "";
  const [shown, setShown] = useState(() => (reduceMotion() || Number.isNaN(target) ? target : 0));
  const from = useRef(shown);

  useEffect(() => {
    if (Number.isNaN(target) || reduceMotion()) {
      setShown(target);
      return;
    }
    const start = performance.now();
    const begin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = begin + (target - begin) * eased;
      from.current = v;
      setShown(v);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);

  if (Number.isNaN(target)) return <>{str}</>;
  return (
    <>
      {Math.round(shown).toLocaleString()}
      {suffix}
    </>
  );
}
