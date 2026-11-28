// The project page's summary: three plain sentences on where the project stands. Workers AI writes them from the
// project's facts only (the overview, as the viewer may see it), the way the digests do; text that quotes a number
// the facts don't have, or spells one out, is thrown away for the plain summary worked out here. Shared by the Worker
// (src/projectPage.js) and the tests.
import { seedOf } from "./forecast";

export const SUMMARY_INSTRUCTIONS = `You write the status summary at the top of a project's page in an organisation's project management system.
Using ONLY the FACTS, write exactly 3 short, plain sentences for a manager: where the project is and whether it's on time; what is holding it up or waiting on someone; and what comes next or when it should finish.
Write names exactly as given. Quote numbers and dates exactly as written in the FACTS; never count, add up or work anything out, and never write a number in words. No greeting, headings, lists or markdown. Don't invent causes, advice or people.`;
/** Number words can't be checked against the facts, so the summary may not use them. */
export const SPELLED_NUMBER = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\w+teen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|several|dozen|couple|half|twice)\b/i;
const plural = (/** @type {number} */ n, /** @type {string} */ one, /** @type {string} */ many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "30 Jan 2027" @param {string} iso */
export const longDate = (iso) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * The facts the summary may use, one per line, from GET /api/systems/:id/overview.
 * @param {any} o
 * @returns {string}
 */
export function summaryFacts(o) {
  const k = o.kpis;
  const life = o.lifecycle;
  /** @type {string[]} */ const lines = [`Project: ${o.project.name}`, `Status: ${o.project.status}`, `Health: ${o.health.label}`];
  if (o.health.reasons.length && o.health.rag !== "NONE") lines.push(`Health reasons: ${o.health.reasons.join("; ")}`);
  if (life) {
    if (life.closed) lines.push("Lifecycle: closed");
    else {
      lines.push(`Stage: ${life.stage.name} (stage ${life.stage.n} of ${life.stage.total})`);
      if (life.sla && life.targetDays) lines.push(`Time in this stage: ${Math.max(1, Math.ceil(life.sla.usedDays))} of ${life.targetDays} business days${life.sla.state === "overdue" ? `, ${Math.round((life.sla.usedDays - life.targetDays) * 10) / 10} over its target` : ""}`);
      if (life.missing.length) lines.push(`This stage still needs: ${life.missing.join("; ")}`);
      const next = life.stages[life.stage.n];
      if (next) lines.push(`Next stage: ${next.name}`);
    }
  }
  lines.push(`Open work items: ${k.openItems.value}`, `Overdue work items: ${k.overdueItems.value}`, `Open blockers: ${k.blockers.value}`);
  for (const e of o.attention.entries.filter((/** @type {any} */ x) => x.kind === "blocker").slice(0, 2)) lines.push(`Blocker: ${e.title} (${e.detail})`);
  for (const e of o.attention.entries.filter((/** @type {any} */ x) => x.kind === "signoff").slice(0, 3)) lines.push(`Waiting for sign-off: ${e.title} (${e.detail})`);
  if (k.risks.highCritical) lines.push(`Open High or Critical risks: ${k.risks.highCritical}`);
  if (k.security.criticalHigh) lines.push(`Open Critical or High security findings: ${k.security.criticalHigh}`);
  const f = k.forecast;
  if (f.finish) lines.push(`Forecast finish: ${longDate(f.finish)}${f.basis === "lifecycle" ? " (from the remaining stages' targets)" : " (from the pace of the work)"}`);
  else if (f.items?.status === "insufficient") lines.push("Forecast: not enough history yet");
  if (f.target) lines.push(`Due date: ${longDate(f.target)}`);
  if (f.varianceDays) lines.push(`Forecast against the due date: ${Math.abs(f.varianceDays)} days ${f.varianceDays > 0 ? "late" : "early"}`);
  const soon = o.upcoming[0];
  if (soon) lines.push(`Next date: ${soon.title} on ${longDate(soon.date)}`);
  return lines.join("\n");
}

/**
 * The plain summary, written from the same facts without a model: what the page shows when the model is off, fails,
 * or strays from the facts.
 * @param {any} o
 * @returns {string}
 */
export function plainSummary(o) {
  const k = o.kpis;
  const life = o.lifecycle;
  const lead = o.health.rag === "NONE" ? `${o.project.name} is` : `${o.project.name} is ${o.health.label.toLowerCase()}: it is`;
  const where = life && !life.closed ? `${lead} at ${life.stage.name} (stage ${life.stage.n} of ${life.stage.total})${life.sla?.state === "overdue" && life.targetDays ? `, ${plural(Math.round((life.sla.usedDays - life.targetDays) * 10) / 10, "business day")} past its target` : ""}.` : life?.closed ? `${lead} done with its lifecycle.` : `${lead} ${String(o.project.status).toLowerCase().replace(/_/g, " ")}.`;
  /** @type {string[]} */ const waits = [];
  if (k.blockers.value) waits.push(`${plural(k.blockers.value, "open blocker")}${k.blockers.oldestDays !== null ? `, the oldest ${plural(k.blockers.oldestDays, "day")} old` : ""}`);
  const sign = o.attention.entries.filter((/** @type {any} */ e) => e.kind === "signoff");
  if (sign.length) waits.push(sign.length === 1 ? sign[0].title : `${plural(sign.length, "sign-off")} waiting`);
  if (k.overdueItems.value) waits.push(`${k.overdueItems.value} of ${plural(k.openItems.value, "open work item")} overdue`);
  const hold = waits.length ? `It has ${waits.join("; ")}.` : k.openItems.value ? `${plural(k.openItems.value, "work item")} ${k.openItems.value === 1 ? "is" : "are"} open and nothing is holding it up.` : "Nothing is holding it up.";
  const f = k.forecast;
  const next = f.finish ? `It is forecast to finish on ${longDate(f.finish)}${f.varianceDays ? `, ${plural(Math.abs(f.varianceDays), "day")} ${f.varianceDays > 0 ? "after" : "before"} its due date` : f.target ? ", on its due date" : ""}.` : life && !life.closed && life.stages[life.stage.n] ? `Next comes ${life.stages[life.stage.n].name}.` : f.items?.status === "insufficient" ? "There isn't enough history yet to forecast when it will finish." : "";
  return [where, hold, next].filter(Boolean).join(" ");
}

/**
 * The model's text if it can be trusted, else null: plain, 3 sentences or so, every number one the facts have, and no
 * number written in words.
 * @param {unknown} raw
 * @param {string} facts
 * @returns {string | null}
 */
export function checkSummary(raw, facts) {
  const text = raw === undefined || raw === null ? "" : String(raw).replace(/\*\*|__|^#+\s*/gm, "").replace(/\s+/g, " ").trim();
  if (text.length < 40 || text.length > 900) return null;
  if (/([^\s\-=_*#`.])\1{19,}/.test(text) || /^\s*[-*•]\s/m.test(String(raw))) return null;
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean);
  if (sentences.length > 4) return null;
  const known = new Set(facts.match(/\d+(?:\.\d+)?/g) ?? []);
  if ((text.match(/\d+(?:\.\d+)?/g) ?? []).some((n) => !known.has(n))) return null;
  if (SPELLED_NUMBER.test(text)) return null;
  return text;
}
/** A short fingerprint of the facts: the saved summary is reused while they're unchanged. @param {string} facts */
export const factsHash = (facts) => `${seedOf(facts).toString(16)}-${facts.length}`;
