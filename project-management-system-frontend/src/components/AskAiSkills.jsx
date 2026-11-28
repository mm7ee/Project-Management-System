// Settings → This workspace → Ask AI skills (organisation administrators): the workspace's own skills, shown as
// one-click starters in the Ask AI panel next to the built-in ones. Each is a prompt, where it shows, and the tools it
// may use (never more than the person asking may use). Backend: src/skills.js.
import { useEffect, useState } from "react";
import { Pencil, Trash2, Zap } from "lucide-react";
import { api } from "../data/api";
import { BRAND } from "../data/brand";
import {
  BUILT_IN_SKILLS,
  CONTEXT_LABELS,
  MAX_CUSTOM_SKILLS,
  SKILL_CONTEXTS,
} from "../data/skills";
import Panel from "./Panel";
import { Empty, Help, ToastProvider, useConfirm, useToast } from "./AdminKit";

/**
 * @typedef {{ id: string; name: string; context: string; prompt: string; tools: string[]; enabled: boolean; updatedAt: string }} CustomSkill
 * @typedef {{ skills: CustomSkill[]; tools: { name: string; description: string }[] }} SkillsData
 */

export default function AskAiSkills() {
  return (
    <ToastProvider>
      <Skills />
    </ToastProvider>
  );
}

const EMPTY = {
  id: "",
  name: "",
  context: "project",
  prompt: "",
  tools: /** @type {string[]} */ ([]),
};

function Skills() {
  const toast = useToast();
  const [dialog, confirm] = useConfirm();
  const [data, setData] = useState(/** @type {SkillsData | null} */ (null));
  const [form, setForm] = useState(EMPTY);
  const load = () =>
    api("/assistant/skills/custom")
      .then((r) => setData(/** @type {SkillsData} */ (r)))
      .catch((e) =>
        toast(
          e instanceof Error ? e.message : "Couldn't load the skills",
          false,
        ),
      );
  useEffect(() => {
    load();
  }, []);
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
  if (!data) return <p className="muted">Loading…</p>;
  const ctx = /** @type {Record<string, string>} */ (CONTEXT_LABELS);
  return (
    <Panel title={`${BRAND.assistantName} skills`} icon={Zap}>
      {dialog}
      <Help>
        Skills are one-click starters in the {BRAND.assistantName} panel, shown
        where they belong: on a project, its documents, a work item, a service
        desk request, across projects or on the service desk.{" "}
        {BUILT_IN_SKILLS.length} come with PMS; add your own here for everyone
        in this workspace. In the prompt, {"{project}"}, {"{document}"} and{" "}
        {"{item}"} become the names of what's open. A skill only ever uses the
        tools you tick, and never any the person asking couldn't use.
      </Help>
      {data.skills.length === 0 ? (
        <Empty title="No skills of your own yet">
          Add one below, for example "Draft the monthly client report" on a
          project.
        </Empty>
      ) : (
        <div className="org-table-wrap">
          <table className="org-table">
            <caption className="sr-only">This workspace's own skills</caption>
            <thead>
              <tr>
                <th scope="col">Skill</th>
                <th scope="col">Shows</th>
                <th scope="col">Tools</th>
                <th scope="col">On</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.skills.map((s) => (
                <tr key={s.id} className={s.enabled ? "" : "org-off"}>
                  <th scope="row" title={s.prompt}>
                    {s.name}
                  </th>
                  <td>{ctx[s.context] ?? s.context}</td>
                  <td>{s.tools.length ? s.tools.length : "Any"}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={s.enabled}
                      aria-label={`${s.name} is on`}
                      onChange={(e) =>
                        act(
                          () =>
                            api(`/assistant/skills/custom/${s.id}`, "PATCH", {
                              enabled: e.target.checked,
                            }),
                          `${s.name} is ${e.target.checked ? "on" : "off"}.`,
                        )
                      }
                    />
                  </td>
                  <td className="org-actions">
                    <button
                      className="btn btn-ghost sm"
                      aria-label={`Edit ${s.name}`}
                      onClick={() =>
                        setForm({
                          id: s.id,
                          name: s.name,
                          context: s.context,
                          prompt: s.prompt,
                          tools: s.tools,
                        })
                      }
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className="btn btn-ghost sm"
                      aria-label={`Delete ${s.name}`}
                      onClick={async () => {
                        if (
                          await confirm({
                            title: `Delete the skill ${s.name}?`,
                            body: "It goes from the Ask AI panel for everyone in this workspace.",
                            confirm: "Delete",
                            danger: true,
                          })
                        )
                          act(
                            () =>
                              api(`/assistant/skills/custom/${s.id}`, "DELETE"),
                            `${s.name} is deleted.`,
                          );
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(form.id || data.skills.length < MAX_CUSTOM_SKILLS) && (
        <form
          className="org-new org-boxed"
          aria-label={form.id ? "Edit skill" : "New skill"}
          onSubmit={async (e) => {
            e.preventDefault();
            const payload = {
              name: form.name,
              context: form.context,
              prompt: form.prompt,
              tools: form.tools,
            };
            const ok = await act(
              () =>
                form.id
                  ? api(`/assistant/skills/custom/${form.id}`, "PATCH", payload)
                  : api("/assistant/skills/custom", "POST", payload),
              `${form.name} is ${form.id ? "saved" : "added"}.`,
            );
            if (ok) setForm(EMPTY);
          }}
        >
          <h4>{form.id ? `Edit ${form.name}` : "New skill"}</h4>
          <div className="org-grid">
            <label className="field">
              Name (the button's words)
              <input
                value={form.name}
                maxLength={80}
                required
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Draft the monthly client report"
              />
            </label>
            <label className="field">
              Shows
              <select
                value={form.context}
                onChange={(e) => setForm({ ...form, context: e.target.value })}
              >
                {SKILL_CONTEXTS.map((k) => (
                  <option key={k} value={k}>
                    {ctx[k]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            What it asks
            <textarea
              rows={4}
              value={form.prompt}
              maxLength={2000}
              required
              onChange={(e) => setForm({ ...form, prompt: e.target.value })}
              placeholder="Draft the monthly report for {project}'s client: progress, what's next, risks, and decisions we need from them."
            />
          </label>
          <fieldset className="org-fieldset">
            <legend>
              Tools it may use (none ticked: any the person may use)
            </legend>
            {data.tools.map((t) => (
              <label key={t.name} className="org-check" title={t.description}>
                <input
                  type="checkbox"
                  checked={form.tools.includes(t.name)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      tools: e.target.checked
                        ? [...form.tools, t.name]
                        : form.tools.filter((x) => x !== t.name),
                    })
                  }
                />{" "}
                {t.name.replace(/_/g, " ")}
              </label>
            ))}
          </fieldset>
          <div>
            <button className="btn btn-primary" type="submit">
              {form.id ? "Save" : "Add skill"}
            </button>
            {form.id && (
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => setForm(EMPTY)}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </Panel>
  );
}
