import ParticleField from "./ParticleField";

/**
 * The Light theme's moving backdrop: pastel aurora clouds, a slowly panning dot grid, the
 * particle network in navy ink, and a beam of light that sweeps across now and then.
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
      <div className="dl-dots" />
      <div className="dl-rings">
        <i />
        <i />
        <i />
      </div>
      <ParticleField className="dl-particles" palette="light" />
      <div className="dl-beam" />
    </div>
  );
}
