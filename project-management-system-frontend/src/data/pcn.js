// The OmniContact BPO Project Concept Note (PCN): how a new project is proposed and approved.
// Mirrors the PCN document's sections; stored on the project (System.pcn). Shared by the UI and
// the Worker (which cleans and validates it).
export const PCN_TYPES = /** @type {const} */ (["New system", "Enhancement to an existing system", "Process improvement", "Integration", "Other"]);
export const PILLARS = /** @type {const} */ (["Customer", "People", "Innovation", "Organization & Capacity", "Business Performance", "Stakeholder & Sustainability Management", "Risk & Compliance"]);
/** @type {Record<PcnStatus, { label: string; tone: string }>} */ export const PCN_STATUS_META = {
  DRAFT: { label: "Draft: no signatories yet", tone: "slate" },
  PENDING: { label: "Awaiting approval", tone: "amber" },
  APPROVED: { label: "Approved", tone: "green" },
  DECLINED: { label: "Declined", tone: "red" },
};
/**
 * Declined if anyone declined; approved once every signatory has; draft with none.
 * @param {Pcn} p
 * @returns {PcnStatus}
 */
export function pcnStatus(p) {
  if (!p.signatories.length) return "DRAFT";
  if (p.signatories.some((s) => s.status === "DECLINED")) return "DECLINED";
  return p.signatories.every((s) => s.status === "APPROVED") ? "APPROVED" : "PENDING";
}
/**
 * A blank PCN. `signers` (normally every Manager) are listed as signatories so the note goes to
 * them on submission; the first is primary. The author can change the list.
 * @param {string} originator
 * @param {string} today
 * @param {{ id: string; name: string }[]} [signers=[]]
 * @returns {Pcn}
 */
export function emptyPcn(originator, today, signers = []) {
  return {
    title: "",
    originator,
    date: today,
    type: PCN_TYPES[0],
    background: "",
    concept: "",
    mechanics: "",
    objectives: "",
    mainPillar: "",
    supportingPillars: [],
    proposedDates: [""],
    signatories: signers.length ? signers.map((u, i) => ({ userId: u.id, name: u.name, primary: i === 0, remarks: "", status: /** @type {const} */ ("PENDING") })) : [{ name: "", primary: true, remarks: "", status: "PENDING" }],
  };
}
/** Signatories whose account is `userId` and who haven't signed yet. */
export const awaitingSignature =
  /** @param {Pcn | undefined} p
   * @param {string} userId
   * @returns {boolean}
   */ (p, userId) => !!p && pcnStatus(p) !== "DECLINED" && p.signatories.some((s) => s.userId === userId && s.status === "PENDING");
/**
 * The sections still empty, in the document's own words, so the form can say what's left.
 * @param {Pcn} p
 * @returns {string[]}
 */
export function pcnMissing(p) {
  return [
    ...(!p.title.trim() ? ["PCN title"] : []),
    ...(!p.background.trim() ? ["1.1 Background"] : []),
    ...(!p.concept.trim() ? ["1.2 Concept description"] : []),
    ...(!p.objectives.trim() ? ["2.1 Objectives"] : []),
    ...(!p.mainPillar ? ["2.2 Main strategic pillar"] : []),
    ...(!p.signatories.some((s) => s.name.trim()) ? ["4. At least one signatory"] : []),
  ];
}
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str =
  /** @param {unknown} v
   * @param {number} [max=4000]
   * @returns {string}
   */ (v, max = 4000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
/**
 * Keeps known fields with allowed values; the Worker stores only what this returns.
 * @param {unknown} raw
 * @returns {Pcn}
 */
export function cleanPcn(raw) {
  const r = /** @type {Record<string, unknown>} */ (raw && typeof raw === "object" ? raw : {});
  const list = /** @param {unknown} v */ (v) => (Array.isArray(v) ? v : []);
  const signatories = list(r.signatories)
    .slice(0, 6)
    .map((x) => (x && typeof x === "object" ? /** @type {Record<string, unknown>} */ (x) : {}))
    .map(
      /** @returns {Signatory} */ (s) => ({
        ...(typeof s.userId === "string" && /^[a-z0-9._-]{1,64}$/.test(s.userId) ? { userId: s.userId } : {}),
        name: str(s.name, 120),
        primary: s.primary === true,
        remarks: str(s.remarks, 500),
        status: s.status === "APPROVED" || s.status === "DECLINED" ? s.status : "PENDING",
        ...(typeof s.date === "string" && DATE.test(s.date) ? { date: s.date } : {}),
      }),
    )
    .filter((s) => s.name || s.userId); // an account is enough: the Worker fills in its name
  // Exactly one primary signatory when there are any.
  if (signatories.length && !signatories.some((s) => s.primary)) signatories[0].primary = true;
  let seen = false;
  for (const s of signatories) {
    if (s.primary && seen) s.primary = false;
    if (s.primary) seen = true;
  }
  return {
    title: str(r.title, 200),
    originator: str(r.originator, 120),
    date: typeof r.date === "string" && DATE.test(r.date) ? r.date : new Date().toISOString().slice(0, 10),
    type: /** @type {readonly string[]} */ (PCN_TYPES).includes(/** @type {string} */ (r.type)) ? /** @type {string} */ (r.type) : PCN_TYPES[0],
    background: str(r.background),
    concept: str(r.concept),
    mechanics: str(r.mechanics),
    objectives: str(r.objectives),
    mainPillar: /** @type {readonly string[]} */ (PILLARS).includes(/** @type {string} */ (r.mainPillar)) ? /** @type {string} */ (r.mainPillar) : "",
    supportingPillars: list(r.supportingPillars).filter(/** @returns {x is string} */ (x) => /** @type {readonly string[]} */ (PILLARS).includes(/** @type {string} */ (x))),
    proposedDates: list(r.proposedDates)
      .filter(/** @returns {d is string} */ (d) => typeof d === "string" && DATE.test(d))
      .slice(0, 5),
    signatories,
  };
}
/** @typedef {"PENDING" | "APPROVED" | "DECLINED"} SignoffStatus */
/** @typedef {"DRAFT" | "PENDING" | "APPROVED" | "DECLINED"} PcnStatus */
/**
 * @typedef {Object} Signatory
 * @property {string} [userId]
 * @property {string} name
 * @property {boolean} primary
 * @property {string} remarks
 * @property {SignoffStatus} status
 * @property {string} [date]
 */
/**
 * @typedef {Object} Pcn
 * @property {string} title
 * @property {string} originator
 * @property {string} date
 * @property {string} type
 * @property {string} background
 * @property {string} concept
 * @property {string} mechanics
 * @property {string} objectives
 * @property {string} mainPillar
 * @property {string[]} supportingPillars
 * @property {string[]} proposedDates
 * @property {Signatory[]} signatories
 */
