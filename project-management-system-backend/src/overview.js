// A project's page, in one call (docs/API.md, "Project overview"):
//   GET /api/systems/:id/overview → the header, the lifecycle stepper, the KPI tiles, what needs attention, the
//   next 14 days and every chart's series.
// - Counting happens in SQL, a fixed handful of grouped queries whatever the size of the project (no query per item).
// - Work items always go through access.js (itemAccess): security levels, a developer's own-items rule and view-only
//   links apply to every figure, so an item the viewer can't see is never counted, charted or listed.
// - The figures use the same rules as Reports → Projects (itemCountsQuery, ragOf, stageFacts), so they agree.
// - Another workspace's project is a 404, like one that doesn't exist (row-level security hides the row).
/** @import { System } from '../../project-management-system-frontend/src/data/systems' */
/** @import { Limits } from '../../project-management-system-frontend/src/data/project' */
/** @typedef {import("./workitems").ItemContext} ItemContext */
import { HttpError, json } from "./http";
import { itemAccess } from "./access";
import { itemCountsQuery } from "./projectReports";
import { lifecycleSnapshot } from "./lifecycle";
import { currentWorkspace, settingRow } from "./settings";
import { DEFAULT_LIMITS, lastUpdateOf, stalledDays } from "../../project-management-system-frontend/src/data/project";
import { RAG_META, ragOf } from "../../project-management-system-frontend/src/data/projectHealth";
import { weekOf } from "../../project-management-system-frontend/src/data/projectReport";
import { lifecycleProgress, riskRating, stageIndex } from "../../project-management-system-frontend/src/data/lifecycle";
import { workingMinutes } from "../../project-management-system-frontend/src/data/workCalendar";
import { lifecycleForecast, seedOf, throughputForecast, varianceDays } from "../../project-management-system-frontend/src/data/forecast";
import { attentionFor } from "../../project-management-system-frontend/src/data/attention";

const DAY = 86_400_000;
/** Weeks of history in the burn-up, created vs resolved and cumulative flow charts (the current week included). */
export const OVERVIEW_WEEKS = 12;
/** Days of history behind each KPI tile's sparkline. */
export const SPARK_DAYS = 30;
const iso = (/** @type {number} */ t) => new Date(t).toISOString().slice(0, 10);
const addDays = (/** @type {string} */ d, /** @type {number} */ n) => iso(Date.parse(`${d}T00:00:00Z`) + n * DAY);
const num = (/** @type {unknown} */ v) => Number(v ?? 0) || 0;
const pqlQuote = (/** @type {string} */ v) => (/^[A-Za-z][A-Za-z0-9_]*$/.test(v) ? v : `"${v.replace(/"/g, '\\"')}"`);

/**
 * @param {ItemContext} c
 * @param {string} path
 * @param {string} method
 * @returns {Promise<Response | null>}
 */
export async function overviewApi(c, path, method) {
  const m = path.match(/^\/api\/systems\/([a-z0-9-]+)\/overview$/);
  if (!m) return null;
  if (method !== "GET") throw new HttpError(405, "Method not allowed");
  return json(await projectOverview(c, m[1]));
}

/**
 * Everything on a project's Overview, as the viewer may see it.
 * @param {ItemContext} c
 * @param {string} systemId
 */
export async function projectOverview(c, systemId) {
  const { db } = c;
  const row = /** @type {{ data: string; key: string } | null} */ (await db.prepare("SELECT data, key FROM systems WHERE id = ?").bind(systemId).first());
  if (!row) throw new HttpError(404, "Project not found");
  /** @type {System} */ const sys = JSON.parse(row.data);
  const key = row.key ?? sys.key ?? "";
  const now = Date.parse(c.now);
  const today = c.now.slice(0, 10);
  const a = itemAccess(c.viewer, "w");
  const counts = itemCountsQuery(c.viewer, today, systemId);
  const thisWeek = weekOf(today);
  const firstWeek = addDays(thisWeek, -7 * (OVERVIEW_WEEKS - 1));
  const sparkFrom = addDays(today, -(SPARK_DAYS - 1));
  const weekEnd = addDays(thisWeek, 6);
  const horizon = addDays(today, 14);
  const wk = /** @param {string} col */ (col) => `to_char(date_trunc('week', (${col})::timestamptz AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`;
  const all = /** @template T @param {string} sql @param {unknown[]} args @returns {Promise<T[]>} */ async (sql, args) => /** @type {T[]} */ ((await db.prepare(sql).bind(...args).all()).results);

  const [workspace, limitsRow, users, team, countRow, blockers, requests, risks, findings, weekly, before, cfd, daily, overdue, upcomingItems, sprints, snap] = await Promise.all([
    currentWorkspace(db),
    /** @type {Promise<{ value: string } | null>} */ (settingRow(db, "workload_limits")),
    all("SELECT id, name, role, username FROM users", []),
    all("SELECT user_id FROM assignments WHERE system_id = ?", [systemId]),
    all(counts.sql, counts.args),
    all("SELECT id, text, raised_by, raised_at, resolved_at FROM blockers WHERE system_id = ? AND (resolved_at IS NULL OR resolved_at >= ?)", [systemId, sparkFrom]),
    all("SELECT id, requested_by, message, created_at FROM requests WHERE system_id = ? ORDER BY created_at", [systemId]),
    all("SELECT likelihood, impact, owner_id, status, created_at, updated_at FROM risk_register WHERE system_id = ?", [systemId]),
    all("SELECT severity, status FROM security_findings WHERE system_id = ?", [systemId]),
    // Created and resolved per week (Monday, UTC, as Reports → Projects).
    all(
      `SELECT 'c' AS what, ${wk("w.created_at")} AS week, COUNT(*) AS n FROM work_items w WHERE w.system_id = ? AND ${a.sql} AND w.created_at >= ? GROUP BY 2
       UNION ALL
       SELECT 'r' AS what, ${wk("w.resolved_at")} AS week, COUNT(*) AS n FROM work_items w WHERE w.system_id = ? AND ${a.sql} AND w.resolved_at >= ? GROUP BY 2`,
      [systemId, ...a.args, addDays(firstWeek, -7 * 12), systemId, ...a.args, addDays(firstWeek, -7 * 12)],
    ),
    // What existed, and was done, before the burn-up's first week; and when work on the project began.
    all(`SELECT COUNT(*) AS scope, SUM(CASE WHEN w.resolved_at IS NOT NULL AND w.resolved_at < ? THEN 1 ELSE 0 END) AS done, MIN(w.created_at) AS first FROM work_items w WHERE w.system_id = ? AND ${a.sql} AND w.created_at < ?`, [firstWeek, systemId, ...a.args, firstWeek]),
    // Cumulative flow: each item's status category at the end of each week, from its status history.
    all(
      `SELECT to_char(g.d, 'YYYY-MM-DD') AS week, st.category, COUNT(*) AS n
       FROM generate_series(?::date, ?::date, interval '7 days') AS g(d)
       JOIN LATERAL (
         SELECT DISTINCT ON (h.item_id) h.to_status FROM status_history h JOIN work_items w ON w.id = h.item_id
         WHERE w.system_id = ? AND ${a.sql} AND h.changed_at < to_char(g.d + interval '7 days', 'YYYY-MM-DD')
         ORDER BY h.item_id, h.changed_at DESC, h.id DESC
       ) x ON TRUE
       JOIN work_statuses st ON st.id = x.to_status
       GROUP BY 1, 2`,
      [firstWeek, thisWeek, systemId, ...a.args],
    ),
    // Open and overdue work items at the end of each of the last 30 days, for the sparklines.
    all(
      `SELECT to_char(g.d, 'YYYY-MM-DD') AS day,
         COUNT(w.id) FILTER (WHERE w.created_at < to_char(g.d + interval '1 day', 'YYYY-MM-DD') AND (w.resolved_at IS NULL OR w.resolved_at >= to_char(g.d + interval '1 day', 'YYYY-MM-DD'))) AS open,
         COUNT(w.id) FILTER (WHERE w.created_at < to_char(g.d + interval '1 day', 'YYYY-MM-DD') AND (w.resolved_at IS NULL OR w.resolved_at >= to_char(g.d + interval '1 day', 'YYYY-MM-DD')) AND w.due_date IS NOT NULL AND w.due_date < to_char(g.d, 'YYYY-MM-DD')) AS overdue
       FROM generate_series(?::date, ?::date, interval '1 day') AS g(d)
       LEFT JOIN work_items w ON w.system_id = ? AND ${a.sql}
       GROUP BY g.d ORDER BY g.d`,
      [sparkFrom, today, systemId, ...a.args],
    ),
    all(
      `SELECT w.number, w.summary, w.due_date, u.name AS assignee_name FROM work_items w JOIN work_statuses st ON st.id = w.status LEFT JOIN users u ON u.id = w.assignee
       WHERE w.system_id = ? AND ${a.sql} AND st.category <> 'DONE' AND w.due_date IS NOT NULL AND w.due_date < ? ORDER BY w.due_date, w.number LIMIT 50`,
      [systemId, ...a.args, today],
    ),
    all(
      `SELECT w.number, w.summary, w.type, w.due_date, u.name AS assignee_name FROM work_items w JOIN work_statuses st ON st.id = w.status LEFT JOIN users u ON u.id = w.assignee
       WHERE w.system_id = ? AND ${a.sql} AND st.category <> 'DONE' AND w.due_date >= ? AND w.due_date <= ? ORDER BY w.due_date, w.number LIMIT 20`,
      [systemId, ...a.args, today, horizon],
    ),
    all("SELECT name, end_date, state FROM sprints WHERE system_id = ? AND state <> 'CLOSED' AND end_date >= ? AND end_date <= ?", [systemId, today, horizon]),
    lifecycleSnapshot(c, systemId),
  ]);

  /** @type {Limits} */ const limits = limitsRow ? { ...DEFAULT_LIMITS, ...JSON.parse(limitsRow.value) } : DEFAULT_LIMITS;
  const people = new Map(/** @type {{ id: string; name: string; role: string; username: string }[]} */ (users).map((u) => [u.id, u]));
  const nameOf = (/** @type {string | null | undefined} */ id) => (id && people.get(id)?.name) || "Someone";
  const cnt = /** @type {{ open?: unknown; overdue?: unknown; done?: unknown }} */ (countRow[0] ?? {});
  const items = { open: num(cnt.open), overdue: num(cnt.overdue), done: num(cnt.done) };
  const openBlockers = /** @type {{ id: string; text: string; raised_by: string; raised_at: string; resolved_at: string | null }[]} */ (blockers).filter((b) => !b.resolved_at);
  const oldestBlocker = openBlockers.map((b) => b.raised_at).sort()[0] ?? null;

  // ---- the lifecycle: where it is, the stepper ----
  const life = snap;
  const stageFact = life && !life.closed && life.sla && life.stage.targetDays ? { name: life.stage.name, usedDays: life.sla.usedDays, targetDays: life.stage.targetDays } : null;
  const health = ragOf(sys, { openBlockers: openBlockers.length, oldestBlockerAt: oldestBlocker, openItems: items.open, overdueItems: items.overdue, stage: stageFact }, now, limits);
  /** @type {any} */ let lifecycle = null;
  if (life) {
    const { def } = life;
    const at = stageIndex(def, life.stage.code);
    const sentBackFrom = new Set(life.history.filter((h) => h.kind === "send_back" || h.kind === "decline").map((h) => h.from_code));
    /** @type {Map<string, { kind: string; at: string }>} */ const left = new Map();
    for (const h of life.history) if (h.from_code && h.kind !== "send_back" && h.kind !== "decline") left.set(h.from_code, { kind: h.kind, at: h.at });
    const stages = def.stages.map((s, i) => {
      const out = left.get(s.code);
      const state = life.closed ? "done" : i < at ? (out ? (out.kind === "skip" ? "skipped" : "done") : "migrated") : i === at ? (life.sla?.state === "overdue" ? "overdue" : "current") : "upcoming";
      return { code: s.code, name: s.name, phase: s.phase, n: i + 1, state, date: state === "done" || state === "skipped" ? (out?.at ?? null) : null, sentBack: sentBackFrom.has(s.code), targetDays: s.targetDays };
    });
    lifecycle = {
      phases: def.phases.map((p) => ({ code: p.code, name: p.name })),
      stages,
      stage: { code: life.stage.code, name: life.stage.name, n: at + 1, total: def.stages.length, phase: life.stage.phase, type: life.stage.type },
      closed: life.closed,
      enteredAt: life.life.stage_entered_at,
      sla: life.sla,
      targetDays: life.stage.targetDays,
      ready: life.ready,
      canAdvance: life.canAdvance && life.ready,
      missing: life.gate.filter((g) => !g.ok).map((g) => g.missing ?? g.label),
    };
  }

  // ---- the charts' series ----
  /** @type {Map<string, number>} */ const createdW = new Map();
  /** @type {Map<string, number>} */ const resolvedW = new Map();
  for (const r of /** @type {{ what: string; week: string; n: unknown }[]} */ (weekly)) (r.what === "c" ? createdW : resolvedW).set(r.week, num(r.n));
  const b0 = /** @type {{ scope?: unknown; done?: unknown; first?: string | null }} */ (before[0] ?? {});
  let scope = num(b0.scope);
  let done = num(b0.done);
  const weeks = Array.from({ length: OVERVIEW_WEEKS }, (_, i) => addDays(firstWeek, 7 * i)).map((week) => {
    const created = createdW.get(week) ?? 0;
    const resolved = resolvedW.get(week) ?? 0;
    scope += created;
    done += resolved;
    return { week, created, resolved, scope, done };
  });
  /** @type {Record<string, { todo: number; inProgress: number; done: number }>} */ const flow = {};
  for (const r of /** @type {{ week: string; category: string; n: unknown }[]} */ (cfd)) {
    const f = (flow[r.week] ??= { todo: 0, inProgress: 0, done: 0 });
    if (r.category === "TODO") f.todo += num(r.n);
    else if (r.category === "IN_PROGRESS") f.inProgress += num(r.n);
    else f.done += num(r.n);
  }
  const cumulative = weeks.map((w) => ({ week: w.week, ...(flow[w.week] ?? { todo: 0, inProgress: 0, done: 0 }) }));
  const riskRows = /** @type {{ likelihood: number; impact: number; owner_id: string | null; status: string; created_at: string; updated_at: string }[]} */ (risks).map((r) => ({ ...r, rating: riskRating(Number(r.likelihood), Number(r.impact)) }));
  const severe = (/** @type {{ rating: string }} */ r) => r.rating === "High" || r.rating === "Critical";
  const days = /** @type {{ day: string; open: unknown; overdue: unknown }[]} */ (daily).map((d) => {
    const end = addDays(d.day, 1);
    return {
      day: d.day,
      open: num(d.open),
      overdue: num(d.overdue),
      blockers: /** @type {{ raised_at: string; resolved_at: string | null }[]} */ (blockers).filter((b) => b.raised_at < end && (!b.resolved_at || b.resolved_at >= end)).length,
      // A closed risk's close time is its last change.
      risks: riskRows.filter((r) => severe(r) && r.created_at < end && (r.status === "open" || r.updated_at >= end)).length,
    };
  });
  // Today's points are the tiles' own figures (counted by status, as the report counts them).
  if (days.length) Object.assign(days[days.length - 1], { open: items.open, overdue: items.overdue, blockers: openBlockers.length });
  const weekAgo = days.length > 7 ? days[days.length - 8].open : null;

  // Time in each stage (business days), against its target.
  /** @type {{ code: string; name: string; days: number; targetDays: number | null; visits: number; current: boolean }[]} */ let timeInStage = [];
  if (life) {
    const dayMinutes = (() => {
      const [sh, sm] = life.cal.start.split(":").map(Number);
      const [eh, em] = life.cal.end.split(":").map(Number);
      return Math.max(60, eh * 60 + em - (sh * 60 + sm));
    })();
    /** @type {Map<string, { days: number; visits: number }>} */ const per = new Map();
    /** @type {{ code: string; at: string } | null} */ let was = null;
    for (const h of life.history) {
      if (was && h.kind !== "migrate" && h.kind !== "start") {
        const p = per.get(was.code) ?? { days: 0, visits: 0 };
        p.days += workingMinutes(Date.parse(was.at), Date.parse(h.at), life.cal) / dayMinutes;
        p.visits++;
        per.set(was.code, p);
      }
      was = { code: h.to_code, at: h.at };
    }
    if (!life.closed && life.sla) {
      const p = per.get(life.stage.code) ?? { days: 0, visits: 0 };
      p.days += life.sla.usedDays;
      p.visits++;
      per.set(life.stage.code, p);
    }
    timeInStage = life.def.stages.filter((s) => per.has(s.code)).map((s) => {
      const p = /** @type {{ days: number; visits: number }} */ (per.get(s.code));
      return { code: s.code, name: s.name, days: Math.round(p.days * 10) / 10, targetDays: s.targetDays, visits: p.visits, current: !life.closed && s.code === life.stage.code };
    });
  }

  // Workload this week: hours logged (Monday to today) and the remaining estimates of open items due by Sunday
  // (overdue ones included), across all of the workspace's projects the viewer can see, for this project's team.
  const teamIds = [...new Set([...(sys.lead ? [sys.lead] : []), .../** @type {{ user_id: string }[]} */ (team).map((t) => t.user_id)])].filter((id) => people.has(id));
  /** @type {{ user_id: string; minutes: unknown }[]} */ let logged = [];
  /** @type {{ assignee: string; minutes: unknown; open: unknown; here: unknown }[]} */ let planned = [];
  if (teamIds.length) {
    const ids = teamIds.map(() => "?").join(", ");
    [logged, planned] = await Promise.all([
      all(`SELECT l.user_id, SUM(l.minutes) AS minutes FROM work_logs l JOIN work_items w ON w.id = l.item_id WHERE ${a.sql} AND l.user_id IN (${ids}) AND l.work_date >= ? AND l.work_date <= ? GROUP BY l.user_id`, [...a.args, ...teamIds, thisWeek, today]),
      all(
        `SELECT w.assignee, SUM(CASE WHEN w.due_date IS NOT NULL AND w.due_date <= ? THEN COALESCE(w.remaining_estimate, w.original_estimate, 0) ELSE 0 END) AS minutes,
                COUNT(*) AS open, SUM(CASE WHEN w.system_id = ? THEN 1 ELSE 0 END) AS here
         FROM work_items w JOIN work_statuses st ON st.id = w.status WHERE ${a.sql} AND st.category <> 'DONE' AND w.assignee IN (${ids}) GROUP BY w.assignee`,
        [weekEnd, systemId, ...a.args, ...teamIds],
      ),
    ]);
  }
  const hours = (/** @type {unknown} */ m) => Math.round((num(m) / 60) * 2) / 2;
  const workload = {
    capacityHours: limits.capacityHours ?? 30,
    people: teamIds.map((id) => {
      const l = logged.find((x) => x.user_id === id);
      const p = planned.find((x) => x.assignee === id);
      return { id, name: nameOf(id), username: people.get(id)?.username ?? null, lead: id === sys.lead, loggedHours: hours(l?.minutes), plannedHours: hours(p?.minutes), openItems: num(p?.open), openItemsHere: num(p?.here) };
    }),
  };

  // ---- the KPI tiles ----
  const doneShare = items.open + items.done ? items.done / (items.open + items.done) : null;
  const stagesPct = life ? lifecycleProgress(life.def, life.stage.code, life.closed, null) : null;
  const progress = life ? lifecycleProgress(life.def, life.stage.code, life.closed, doneShare) : sys.progress;
  // Throughput: complete weeks only (not this one), since work on the project began, at most 12.
  const began = b0.first ?? weeks.find((w) => w.created)?.week ?? null;
  const fromWeek = began && weekOf(began) > addDays(thisWeek, -7 * 12) ? weekOf(began) : addDays(thisWeek, -7 * 12);
  /** @type {number[]} */ const tput = [];
  for (let w = fromWeek; w < thisWeek; w = addDays(w, 7)) tput.push(resolvedW.get(w) ?? 0);
  const itemsForecast = items.open + items.done ? throughputForecast({ weekly: tput, remaining: items.open, now, seed: seedOf(systemId) }) : null;
  const lifeForecast = life && !life.closed && life.sla ? lifecycleForecast(life.def, life.stage.code, life.sla.usedDays, now, life.cal) : null;
  // The work and the remaining stages must both be done: the headline is the later of the two.
  const itemsDate = itemsForecast?.status === "ok" ? /** @type {{ date: string }} */ (itemsForecast.p50).date : null;
  const lifeDate = lifeForecast?.date ?? null;
  const finish = itemsDate && lifeDate ? (itemsDate > lifeDate ? itemsDate : lifeDate) : itemsDate ?? lifeDate;
  const basis = !finish ? null : finish === itemsDate ? "items" : "lifecycle";
  const sec = /** @type {{ severity: string; status: string }[]} */ (findings);
  const securityStage = life ? life.def.stages.findIndex((s) => s.exit.some((x) => x.kind === "security_clear") || s.type === "assessment" && /secur/i.test(s.name)) : -1;
  const pk = pqlQuote(key);
  const pql = {
    open: `project = ${pk} AND statusCategory != Done ORDER BY priority DESC`,
    overdue: `project = ${pk} AND statusCategory != Done AND due < now() ORDER BY due ASC`,
    done: `project = ${pk} AND statusCategory = Done ORDER BY resolved DESC`,
    all: `project = ${pk} ORDER BY created DESC`,
  };
  const passRate = (/** @type {{ total: number; pass: number; fail: number; waived: number; notRun: number } | undefined} */ s) =>
    s && s.total - s.waived > 0 ? { ...s, rate: Math.floor((s.pass / (s.total - s.waived)) * 1000) / 10 } : s ? { ...s, rate: null } : null;
  const inTesting = !!life && !life.closed && (life.stage.type === "testing" || stageIndex(life.def, life.stage.code) > life.def.stages.findIndex((s) => s.type === "testing"));
  const kpis = {
    progress: { value: Math.round(progress), stages: stagesPct === null ? null : Math.round(stagesPct), work: doneShare === null ? null : Math.round(doneShare * 100) },
    forecast: { items: itemsForecast, lifecycle: lifeForecast, target: sys.dueAt ?? null, finish, basis, varianceDays: varianceDays(finish, sys.dueAt) },
    openItems: { value: items.open, change7: weekAgo === null ? null : items.open - weekAgo, pql: pql.open },
    overdueItems: { value: items.overdue, share: items.open ? Math.round((items.overdue / items.open) * 1000) / 10 : 0, pql: pql.overdue },
    doneItems: { value: items.done, pql: pql.done },
    blockers: { value: openBlockers.length, oldestDays: oldestBlocker ? Math.floor((now - Date.parse(oldestBlocker)) / DAY) : null },
    risks: { highCritical: riskRows.filter((r) => r.status === "open" && severe(r)).length, open: riskRows.filter((r) => r.status === "open").length, unowned: riskRows.filter((r) => r.status === "open" && !r.owner_id).length },
    security: {
      criticalHigh: sec.filter((f) => f.status === "open" && (f.severity === "Critical" || f.severity === "High")).length,
      open: sec.filter((f) => f.status === "open").length,
      total: sec.length,
      stage: securityStage >= 0 && life ? { name: life.def.stages[securityStage].name, n: securityStage + 1, reached: life.closed || stageIndex(life.def, life.stage.code) >= securityStage } : null,
    },
    tests: life && (inTesting || Object.keys(life.tests).length) ? { inTesting, QAT: passRate(life.tests.QAT), UAT: passRate(life.tests.UAT), SMOKE: passRate(life.tests.SMOKE) } : null,
  };

  // ---- what needs attention ----
  const lockKey = life?.stage.signoff?.lockDeliverables?.[0];
  const attention = attentionFor(
    {
      systemId,
      blockers: openBlockers.map((b) => ({ id: b.id, text: b.text, raisedAt: b.raised_at, raisedByName: nameOf(b.raised_by) })),
      signoffs: life
        ? [
            ...life.pendingSignoffs.map((s) => ({ id: s.id, signerName: s.signer_name, label: s.label, stageName: life.stage.name, document: s.document_version && lockKey ? `${lockKey.toUpperCase()} v${s.document_version}` : null, requestedAt: s.requested_at })),
            ...life.pcnPending.map((s, i) => ({ id: `pcn-${i}`, signerName: s.name, label: s.primary ? "Concept Note signatory (primary)" : "Concept Note signatory", stageName: life.stage.name, document: "The Concept Note", requestedAt: life.life.stage_entered_at })),
          ]
        : [],
      stage: life && !life.closed && life.sla ? { code: life.stage.code, name: life.stage.name, enteredAt: life.life.stage_entered_at, usedDays: life.sla.usedDays, targetDays: life.stage.targetDays, state: life.sla.state, missing: life.gate.filter((g) => !g.ok).map((g) => g.missing ?? g.label) } : null,
      overdueItems: /** @type {{ number: number; summary: string; due_date: string; assignee_name: string | null }[]} */ (overdue).map((w) => ({ key: `${key}-${w.number}`, summary: w.summary, dueDate: w.due_date, assigneeName: w.assignee_name })),
      overduePql: pql.overdue,
      requests: /** @type {{ id: string; requested_by: string; message: string; created_at: string }[]} */ (requests).map((r) => ({ id: r.id, requestedByName: nameOf(r.requested_by), message: r.message, createdAt: r.created_at })),
      stalledDays: stalledDays(sys, now, limits),
      lastUpdate: lastUpdateOf(sys),
    },
    now,
  );

  // ---- the next 14 days ----
  /** @type {{ date: string; kind: "item" | "milestone" | "sprint" | "stage" | "due"; title: string; detail: string; href?: string }[]} */ const upcoming = [];
  for (const w of /** @type {{ number: number; summary: string; type: string; due_date: string; assignee_name: string | null }[]} */ (upcomingItems)) {
    upcoming.push({ date: w.due_date, kind: w.type === "EPIC" ? "milestone" : "item", title: `${key}-${w.number} ${w.summary}`, detail: w.type === "EPIC" ? "Epic due" : `Due · ${w.assignee_name ?? "Unassigned"}`, href: `#/projects/${systemId}/items/${key}-${w.number}` });
  }
  for (const s of /** @type {{ name: string; end_date: string; state: string }[]} */ (sprints)) upcoming.push({ date: s.end_date, kind: "sprint", title: `${s.name} ends`, detail: s.state === "ACTIVE" ? "Sprint" : "Planned sprint" });
  if (life?.sla && life.sla.dueAt.slice(0, 10) >= today && life.sla.dueAt.slice(0, 10) <= horizon) upcoming.push({ date: life.sla.dueAt.slice(0, 10), kind: "stage", title: `${life.stage.name} target`, detail: "Lifecycle", href: `#/projects/${systemId}/lifecycle` });
  if (sys.dueAt && sys.dueAt >= today && sys.dueAt <= horizon) upcoming.push({ date: sys.dueAt, kind: "due", title: "The project is due", detail: "Due date" });
  upcoming.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));

  const lead = sys.lead ? people.get(sys.lead) : null;
  return {
    generatedAt: c.now,
    project: {
      id: systemId,
      key,
      name: sys.name,
      status: sys.status,
      workspace: workspace.name,
      startedAt: sys.startedAt,
      dueAt: sys.dueAt ?? null,
      lead: lead ? { id: lead.id, name: lead.name } : null,
      team: teamIds.filter((id) => id !== sys.lead).map((id) => ({ id, name: nameOf(id), role: people.get(id)?.role ?? null })),
    },
    health: { rag: health.rag, label: RAG_META[health.rag].label, reasons: health.reasons },
    lifecycle,
    kpis,
    attention: { total: attention.length, entries: attention.slice(0, 20) },
    upcoming: upcoming.slice(0, 12),
    series: { weeks, cumulative, days, timeInStage, workload },
    pql,
  };
}
