import ParticleField from "./ParticleField";
import "./landing.css";

/**
 * The sign-in page's backdrop (aurora glow, ECG paper, particle network), fixed
 * behind the whole app for the Futuristic theme.
 */
export default function FuturisticBackdrop() {
  return (
    <div className="fx-backdrop" aria-hidden="true">
      <div className="lp-aurora">
        <span />
        <span />
        <span />
      </div>
      <div className="lp-paper" />
      <ParticleField className="lp-particles" />
    </div>
  );
}
