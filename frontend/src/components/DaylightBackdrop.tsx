import ParticleField from "./ParticleField";
import PulseMonitor from "./PulseMonitor";

/**
 * The Light theme's moving backdrop: pastel aurora clouds, ECG paper, the monitor trace, signal
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
      <PulseMonitor className="app-monitor" tone="light" />
      <div className="dl-rings">
        <i />
        <i />
        <i />
      </div>
      <ParticleField className="dl-particles" palette="light" />
    </div>
  );
}
