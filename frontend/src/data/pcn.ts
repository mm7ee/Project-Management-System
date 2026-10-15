// The OmniContact BPO Project Concept Note (PCN): how a new project is proposed and approved.
// Mirrors the PCN document's sections; stored on the project (System.pcn). Shared by the UI and
// the Worker (which cleans and validates it).

export const PCN_TYPES = ["New system", "Enhancement to an existing system", "Process improvement", "Integration", "Other"] as const;

export const PILLARS = [
  "Customer",
  "People",
  "Innovation",
  "Organization & Capacity",
  "Business Performance",
  "Stakeholder & Sustainability Management",
  "Risk & Compliance",
] as const;

export type SignoffStatus = "PENDING" | "APPROVED" | "DECLINED";

export interface Signatory {
  userId?: string; // an OmniTrack account: they sign in the app. Unset for someone without one.
  name: string;
  primary: boolean; // the primary signatory
  remarks: string;
  status: SignoffStatus; // signed in the app, or recorded by a manager as received through Econet
  date?: string; // when they approved or declined (YYYY-MM-DD)
}

export interface Pcn {
  title: string;
  originator: string; // who raised it (a name)
  date: string; // YYYY-MM-DD
  type: string; // one of PCN_TYPES
  background: string; // 1.1
  concept: string; // 1.2 Concept description
  mechanics: string; // 1.3
  objectives: string; // 2.1
  mainPillar: string; // 2.2, one of PILLARS
  supportingPillars: string[]; // 2.3
  proposedDates: string[]; // 3, YYYY-MM-DD
  signatories: Signatory[]; // 4
}

export type PcnStatus = "DRAFT" | "PENDING" | "APPROVED" | "DECLINED";

export const PCN_STATUS_META: Record<PcnStatus, { label: string; tone: string }> = {
  DRAFT: { label: "Draft: no signatories yet", tone: "slate" },
  PENDING: { label: "Awaiting approval", tone: "amber" },
  APPROVED: { label: "Approved", tone: "green" },
  DECLINED: { label: "Declined", tone: "red" },
};

/** Declined if anyone declined; approved once every signatory has; draft with none. */
export function pcnStatus(p: Pcn): PcnStatus {
  if (!p.signatories.length) return "DRAFT";
  if (p.signatories.some((s) => s.status === "DECLINED")) return "DECLINED";
  return p.signatories.every((s) => s.status === "APPROVED") ? "APPROVED" : "PENDING";
}

/**
 * A blank PCN. `signers` (normally every Manager) are listed as signatories so the note goes to
 * them on submission; the first is primary. The author can change the list.
 */
export function emptyPcn(originator: string, today: string, signers: { id: string; name: string }[] = []): Pcn {
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
    signatories: signers.length
      ? signers.map((u, i) => ({ userId: u.id, name: u.name, primary: i === 0, remarks: "", status: "PENDING" as const }))
      : [{ name: "", primary: true, remarks: "", status: "PENDING" }],
  };
}

/** Signatories whose account is `userId` and who haven't signed yet. */
export const awaitingSignature = (p: Pcn | undefined, userId: string) =>
  !!p && pcnStatus(p) !== "DECLINED" && p.signatories.some((s) => s.userId === userId && s.status === "PENDING");

/** The sections still empty, in the document's own words, so the form can say what's left. */
export function pcnMissing(p: Pcn): string[] {
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
const str = (v: unknown, max = 4000) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Keeps known fields with allowed values; the Worker stores only what this returns. */
export function cleanPcn(raw: unknown): Pcn {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  const signatories = list(r.signatories)
    .slice(0, 6)
    .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}))
    .map(
      (s): Signatory => ({
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
    type: (PCN_TYPES as readonly string[]).includes(r.type as string) ? (r.type as string) : PCN_TYPES[0],
    background: str(r.background),
    concept: str(r.concept),
    mechanics: str(r.mechanics),
    objectives: str(r.objectives),
    mainPillar: (PILLARS as readonly string[]).includes(r.mainPillar as string) ? (r.mainPillar as string) : "",
    supportingPillars: list(r.supportingPillars).filter((x): x is string => (PILLARS as readonly string[]).includes(x as string)),
    proposedDates: list(r.proposedDates).filter((d): d is string => typeof d === "string" && DATE.test(d)).slice(0, 5),
    signatories,
  };
}
