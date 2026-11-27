/** @import { WorkPriority } from '../data/workitems' */
// Settings → This workspace → SLAs: targets for the first response and for resolution of work items, in the
// organisation's working hours. The first matching SLA (top to bottom) applies to an item. (Service desk requests
// keep their own SLAs, under Service desk.)
import { useEffect, useState } from "react";
import { Plus, Timer, Trash2 } from "lucide-react";
import { api } from "../data/api";
import { useItemTypes } from "../data/itemTypes";
import { WORK_PRIORITIES, WORK_PRIORITY_META } from "../data/workitems";
import { formatWorking } from "../data/workCalendar";
import { WEEKDAYS } from "../data/orgAdmin";
import Panel from "./Panel";
import { Empty, Help, ToastProvider, useConfirm, useToast } from "./AdminKit";

/**
 * @typedef {{ id: string; name: string; itemTypes: string[] | null; priorities: WorkPriority[] | null; firstResponseMinutes: number | null; resolutionMinutes: number | null; warnPercent: number; position: number; active: boolean }} Policy
 * @typedef {{ timeZone: string; workDays: number[]; start: string; end: string; holidays: number }} CalendarInfo
 */

/** @param {{ canEdit: boolean }} p */
export default function SlaSettings({ canEdit }) {
  return (
    <ToastProvider>
      <Slas canEdit={canEdit} />
    </ToastProvider>
  );
}

/** Minutes from hours (the form asks in working hours). @param {string} h */
const minutesOf = (h) => (h.trim() === "" ? null : Math.round(Number(h) * 60));

/** @param {{ canEdit: boolean }} p */
function Slas({ canEdit }) {
  const toast = useToast();
  const [dialog, ask] = useConfirm();
  const types = useItemTypes();
  const [data, setData] = useState(/** @type {{ policies: Policy[]; calendar: CalendarInfo } | null} */ (null));
  const [form, setForm] = useState({ name: "", first: "", resolution: "", warn: "80", types: /** @type {string[]} */ ([]), priorities: /** @type {string[]} */ ([]) });
  const load = () =>
    api("/sla-policies")
      .then((r) => setData(/** @type {NonNullable<typeof data>} */ (r)))
      .catch((e) => toast(e instanceof Error ? e.message : "Couldn't load the SLAs", false));
  useEffect(() => {
    load();
  }, []);
  if (!data) return <p className="muted">Loading…</p>;
  const cal = data.calendar;
  /** @param {() => Promise<unknown>} fn @param {string} done */
  const act = async (fn, done) => {
    try {
      await fn();
      toast(done);
      await load();
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : "That didn't work", false);
      return false;
    }
  };
  const typeName = /** @param {string} id */ (id) => types.find((t) => t.id === id)?.name ?? id;
  return (
    <Panel title="SLAs for work items" icon={Timer}>
      {dialog}
      <Help>
        Targets for the first response (a comment or status change by someone other than the reporter) and for resolution, counted in working hours: {cal.workDays.map((d) => WEEKDAYS.find(([n]) => n === d)?.[1]).join(", ")}, {cal.start}–{cal.end} ({cal.timeZone}), not counting {cal.holidays} public holidays. Change these under Organisation → Profile. The assignee is told when a target is at risk; the assignee and the administrators when it's breached. The first matching SLA applies.
      </Help>
      {data.policies.length === 0 ? (
        <Empty title="No SLAs yet">Add one below, for example two working hours to respond to high-priority bugs.</Empty>
      ) : (
        <div className="org-table-wrap">
          <table className="org-table">
            <caption className="sr-only">SLAs, in the order they're matched</caption>
            <thead>
              <tr>
                <th scope="col">SLA</th>
                <th scope="col">For</th>
                <th scope="col">First response</th>
                <th scope="col">Resolution</th>
                <th scope="col">Warn at</th>
                <th scope="col">On</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.policies.map((p) => (
                <tr key={p.id} className={p.active ? "" : "org-off"}>
                  <th scope="row">{p.name}</th>
                  <td>
                    {p.itemTypes ? p.itemTypes.map(typeName).join(", ") : "Every type"}
                    {p.priorities ? ` · ${p.priorities.map((x) => WORK_PRIORITY_META[x].label).join(", ")}` : ""}
                  </td>
                  <td>{p.firstResponseMinutes ? formatWorking(p.firstResponseMinutes) : "—"}</td>
                  <td>{p.resolutionMinutes ? formatWorking(p.resolutionMinutes) : "—"}</td>
                  <td>{p.warnPercent}%</td>
                  <td>
                    <input type="checkbox" checked={p.active} disabled={!canEdit} aria-label={`${p.name} is on`} onChange={(e) => act(() => api(`/sla-policies/${p.id}`, "PATCH", { active: e.target.checked }), `${p.name} is ${e.target.checked ? "on" : "off"}.`)} />
                  </td>
                  <td className="org-actions">
                    {canEdit && (
                      <button
                        className="btn btn-ghost sm"
                        aria-label={`Delete ${p.name}`}
                        onClick={async () => {
                          if (await ask({ title: `Delete the SLA ${p.name}?`, body: "Items it covered stop being timed by it.", confirm: "Delete", danger: true })) act(() => api(`/sla-policies/${p.id}`, "DELETE"), `${p.name} is deleted.`);
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && (
        <form
          className="org-new org-boxed"
          aria-label="New SLA"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await act(
              () =>
                api("/sla-policies", "POST", {
                  name: form.name,
                  firstResponseMinutes: minutesOf(form.first),
                  resolutionMinutes: minutesOf(form.resolution),
                  warnPercent: Number(form.warn),
                  itemTypes: form.types.length ? form.types : null,
                  priorities: form.priorities.length ? form.priorities : null,
                }),
              `${form.name} is added.`,
            );
            if (ok) setForm({ name: "", first: "", resolution: "", warn: "80", types: [], priorities: [] });
          }}
        >
          <h4>New SLA</h4>
          <div className="org-grid">
            <label className="field">
              Name
              <input required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Urgent bugs" />
            </label>
            <label className="field">
              First response within (working hours)
              <input type="number" min={0.25} step={0.25} value={form.first} onChange={(e) => setForm({ ...form, first: e.target.value })} placeholder="2" />
            </label>
            <label className="field">
              Resolved within (working hours)
              <input type="number" min={0.25} step={0.25} value={form.resolution} onChange={(e) => setForm({ ...form, resolution: e.target.value })} placeholder="16" />
            </label>
            <label className="field">
              Warn when this much time is used
              <select value={form.warn} onChange={(e) => setForm({ ...form, warn: e.target.value })}>
                {[50, 60, 70, 75, 80, 90].map((w) => (
                  <option key={w} value={w}>
                    {w}%
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="org-fieldset">
            <legend>Item types (none ticked: every type)</legend>
            {types
              .filter((t) => t.active)
              .map((t) => (
                <label key={t.id} className="org-check">
                  <input type="checkbox" checked={form.types.includes(t.id)} onChange={(e) => setForm({ ...form, types: e.target.checked ? [...form.types, t.id] : form.types.filter((x) => x !== t.id) })} /> {t.name}
                </label>
              ))}
          </fieldset>
          <fieldset className="org-fieldset">
            <legend>Priorities (none ticked: every priority)</legend>
            {WORK_PRIORITIES.map((p) => (
              <label key={p} className="org-check">
                <input type="checkbox" checked={form.priorities.includes(p)} onChange={(e) => setForm({ ...form, priorities: e.target.checked ? [...form.priorities, p] : form.priorities.filter((x) => x !== p) })} /> {WORK_PRIORITY_META[p].label}
              </label>
            ))}
          </fieldset>
          <div className="org-row">
            <button className="btn btn-navy sm" disabled={!form.first && !form.resolution}>
              <Plus size={14} /> Add SLA
            </button>
          </div>
        </form>
      )}
    </Panel>
  );
}
