/**
 * The "Pulse" half of the OmniPulse name, set beside the Omni Contact logo so the two read as
 * one name without repeating "Omni": a heartbeat line that keeps beating over the word.
 */
export default function PulseMark({ tone = "light" }: { tone?: "light" | "dark" }) {
  return (
    <span className={`pulse-mark pulse-${tone}`} role="img" aria-label="Pulse">
      <svg className="pulse-line" viewBox="0 0 64 18" aria-hidden="true">
        <path className="pulse-base" d="M1 10 H18 L22 10 L26 2 L31 16 L35 6 L38 10 H63" pathLength={1} />
        <path className="pulse-beat" d="M1 10 H18 L22 10 L26 2 L31 16 L35 6 L38 10 H63" pathLength={1} />
      </svg>
      <span className="pulse-word" aria-hidden="true">
        Pulse
      </span>
    </span>
  );
}
