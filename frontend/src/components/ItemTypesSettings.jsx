/** @import { ItemType } from '../data/itemTypes' */
/** @import { WorkItemType } from '../data/workitems' */
// Settings → This workspace → Item types: the kinds of work this workspace tracks (Campaign, Content Piece …). Each
// is one of the five built-in kinds, which decides where it sits (an epic groups items; a sub-task sits under one)
// and how boards and sprints treat it. Which workflow each type follows is chosen under Workflows.
import { useEffect, useState } from "react";
import { Shapes, Plus, Trash2 } from "lucide-react";
import { api } from "../data/api";
import { reloadItemTypes } from "../data/itemTypes";
import { ITEM_KINDS } from "../data/workspaceTemplates";
import { TypeIcon } from "./WorkItemBits";
import { Empty, Help, ToastProvider, useConfirm, useToast } from "./AdminKit";
import Panel from "./Panel";

/** @param {{ canEdit: boolean }} p */
export default function ItemTypesSettings({ canEdit }) {
  return (
    <ToastProvider>
      <ItemTypes canEdit={canEdit} />
    </ToastProvider>
  );
}

/** @param {{ canEdit: boolean }} p */
function ItemTypes({ canEdit }) {
  const toast = useToast();
  const [dialog, ask] = useConfirm();
  const [types, setTypes] = useState(/** @type {ItemType[] | null} */ (null));
  const [name, setName] = useState("");
  const [base, setBase] = useState(/** @type {WorkItemType} */ ("TASK"));
  const [renaming, setRenaming] = useState(/** @type {{ id: string; name: string } | null} */ (null));
  const load = async () => {
    try {
      setTypes(/** @type {ItemType[]} */ (await api("/item-types")));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't load the item types", false);
    }
  };
  useEffect(() => {
    load();
  }, []);
  /** @param {() => Promise<unknown>} fn @param {string} done */
  const act = async (fn, done) => {
    try {
      await fn();
      reloadItemTypes();
      toast(done);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "That didn't work", false);
    }
  };
  if (!types) return <p className="muted">Loading…</p>;
  return (
    <Panel title="Item types" icon={Shapes}>
      {dialog}
      <Help>
        The kinds of work this workspace tracks. Each type behaves like one of the built-in kinds: an <b>epic</b> groups other items, a <b>sub-task</b> sits under one, and the rest are pieces of work. Switch a type off to stop offering it for new items; items
        already of that type keep it. Choose a type's own workflow under Workflows.
      </Help>
      {types.length === 0 ? (
        <Empty title="No item types" />
      ) : (
        <div className="org-table-wrap">
          <table className="org-table">
            <caption className="sr-only">Item types</caption>
            <thead>
              <tr>
                <th scope="col">Type</th>
                <th scope="col">Behaves like</th>
                <th scope="col" className="num">
                  Items
                </th>
                <th scope="col">Offered for new items</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id} className={t.active ? "" : "org-off"}>
                  <th scope="row">
                    {renaming?.id === t.id ? (
                      <form
                        className="org-inline"
                        onSubmit={(e) => {
                          e.preventDefault();
                          act(() => api(`/item-types/${t.id}`, "PATCH", { name: renaming.name }), `Renamed to ${renaming.name}.`).then(() => setRenaming(null));
                        }}
                      >
                        <input value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} maxLength={40} aria-label={`New name for ${t.name}`} autoFocus />
                        <button className="btn btn-navy sm">Save</button>
                        <button type="button" className="btn btn-ghost sm" onClick={() => setRenaming(null)}>
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <span className="wi-inline">
                        <TypeIcon type={t.base} /> {t.name}
                        {t.builtIn && <span className="muted org-sub"> built in</span>}
                      </span>
                    )}
                  </th>
                  <td>{ITEM_KINDS[t.base].split(":")[0]}</td>
                  <td className="num">{t.items ?? 0}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={t.active}
                      disabled={!canEdit}
                      aria-label={`Offer ${t.name} for new items`}
                      onChange={(e) => act(() => api(`/item-types/${t.id}`, "PATCH", { active: e.target.checked }), e.target.checked ? `${t.name} is offered again.` : `${t.name} is no longer offered for new items.`)}
                    />
                  </td>
                  <td className="org-actions">
                    {canEdit && (
                      <button className="btn btn-ghost sm" onClick={() => setRenaming({ id: t.id, name: t.name })}>
                        Rename
                      </button>
                    )}
                    {canEdit && !t.builtIn && (
                      <button
                        className="btn btn-ghost sm"
                        aria-label={`Delete ${t.name}`}
                        onClick={async () => {
                          if (await ask({ title: `Delete ${t.name}?`, body: "Only a type no work item uses can be deleted. Fields shown only for it stop being limited to it.", confirm: "Delete", danger: true })) {
                            act(() => api(`/item-types/${t.id}`, "DELETE"), `${t.name} is deleted.`);
                          }
                        }}
                      >
                        <Trash2 size={14} /> Delete
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
          className="org-inline"
          aria-label="New item type"
          onSubmit={(e) => {
            e.preventDefault();
            act(() => api("/item-types", "POST", { name, base }), `${name} is added.`).then(() => setName(""));
          }}
        >
          <label className="field">
            New type
            <input required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Campaign" />
          </label>
          <label className="field">
            Behaves like
            <select value={base} onChange={(e) => setBase(/** @type {WorkItemType} */ (e.target.value))}>
              {Object.entries(ITEM_KINDS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-navy sm">
            <Plus size={15} /> Add type
          </button>
        </form>
      )}
    </Panel>
  );
}
