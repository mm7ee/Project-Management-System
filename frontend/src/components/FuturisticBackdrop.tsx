import ParticleField from "./ParticleField";
import "./landing.css";

/**
 * The landing page's backdrop (aurora glow, moving grid floor, particle network), fixed
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
      <div className="lp-floor" />
      <ParticleField className="lp-particles" />
    </div>
  );
}
