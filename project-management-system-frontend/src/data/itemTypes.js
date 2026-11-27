/** @import { WorkItemType } from './workitems' */
// The open workspace's item types (Settings → This workspace → Item types), loaded once per page and shared by the
// forms that create or change work items.
import { useEffect, useState } from "react";
import { api } from "./api";
import { TYPE_META, WORK_TYPES } from "./workitems";

/**
 * @typedef {Object} ItemType
 * @property {string} id
 * @property {string} name
 * @property {WorkItemType} base     the kind: where it sits in the hierarchy
 * @property {string} description
 * @property {boolean} active        offered for new items
 * @property {boolean} builtIn
 * @property {string | null} workflowId
 * @property {number} [items]
 */

/** Before the list arrives (and on a view-only link): the five built-in types. */
/** @type {ItemType[]} */ export const BUILT_IN_ITEM_TYPES = WORK_TYPES.map((t) => ({ id: t, name: TYPE_META[t].label, base: t, description: "", active: true, builtIn: true, workflowId: null }));

/** @type {Promise<ItemType[]> | null} */ let pending = null;
/** Forget the loaded list (after the types are changed). */
export function reloadItemTypes() {
  pending = null;
}
/** @returns {Promise<ItemType[]>} */
export function loadItemTypes() {
  pending ??= /** @type {Promise<ItemType[]>} */ (api("/item-types")).catch(() => {
    pending = null;
    return BUILT_IN_ITEM_TYPES;
  });
  return pending;
}
/** The workspace's item types, as a hook. */
export function useItemTypes() {
  const [types, setTypes] = useState(BUILT_IN_ITEM_TYPES);
  useEffect(() => {
    let live = true;
    loadItemTypes().then((t) => live && setTypes(t));
    return () => {
      live = false;
    };
  }, []);
  return types;
}
