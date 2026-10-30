import ParticleField from "./ParticleField";

/**
 * The Light theme's moving backdrop: pastel aurora clouds, ECG paper, signal
 * rings and the particle network in navy ink.
 * Fixed behind the app; cards turn to frosted glass so it shows through.
 */
export default function DaylightBackdrop() {
  return (
    <div className="dl-backdrop" aria-hidden="true">
      <div className="dl-aurora">
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="dl-paper" />
      <div className="dl-rings">
        <i />
        <i />
        <i />
      </div>
      <ParticleField className="dl-particles" palette="light" />
    </div>
  );
}
