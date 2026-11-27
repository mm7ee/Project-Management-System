/**
 * Portfolio health at a glance, as a heartbeat: the share of projects needing attention sets its state.
 * @type {{ key: string; label: string; below: number; }[]}
 */
const LEVELS = /** @type {const} */ ([
  { key: "steady", label: "Steady", below: 0.15 },
  { key: "elevated", label: "Elevated", below: 0.4 },
  { key: "critical", label: "Critical", below: Infinity },
]);
/**
 * @param {{ attention: number; total: number; onClick: () => void }} props
 */
export default function VitalSign({ attention, total, onClick }) {
  const share = total ? attention / total : 0;
  const level = /** @type {{ readonly key: "steady"; readonly label: "Steady"; readonly below: 0.15; } | { readonly key: "elevated"; readonly label: "Elevated"; readonly below: 0.4; } | { readonly key: "critical"; readonly label: "Critical"; readonly below: number; }} */ (
    LEVELS.find((l) => share < l.below)
  );
  return (
    <button className={`vital vital-${level.key}`} onClick={onClick} title={attention ? `${attention} of ${total} projects are overdue, at risk, blocked or stalled. Show them.` : `All ${total} projects are on track.`}>
      <svg className="vital-line" viewBox="0 0 48 18" aria-hidden="true">
        <path className="vital-base" d="M1 10 H13 L16 10 L19 3 L24 16 L27 7 L30 10 H47" pathLength={1} />
        <path className="vital-beat" d="M1 10 H13 L16 10 L19 3 L24 16 L27 7 L30 10 H47" pathLength={1} />
      </svg>
      <span className="vital-text">
        <b>{level.label}</b>
        <small>{attention ? `${attention} need attention` : "All on track"}</small>
      </span>
    </button>
  );
}
