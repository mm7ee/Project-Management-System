// A small CSV reader for imports (Settings → Organisation → People → Import). Comma-separated, with an optional
// header row; quoted fields may contain commas, quotes ("") and line breaks. Shared by the Worker and the screen.

/**
 * @param {string} text
 * @returns {string[][]}  rows of trimmed fields; blank lines are left out
 */
export function parseCsv(text) {
  /** @type {string[][]} */ const rows = [];
  /** @type {string[]} */ let row = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const s = text.replace(/^﻿/, "");
  const endField = () => {
    row.push(field.trim());
    field = "";
  };
  const endRow = () => {
    endField();
    if (row.some((f) => f !== "")) rows.push(row);
    row = [];
  };
  while (i < s.length) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (ch === '"') quoted = false;
      else field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field.trim() === "") {
      quoted = true;
      field = "";
    } else if (ch === ",") endField();
    else if (ch === "\n" || ch === "\r") {
      endRow();
      if (ch === "\r" && s[i + 1] === "\n") i += 1;
    } else field += ch;
    i += 1;
  }
  if (field !== "" || row.length) endRow();
  return rows;
}

/** The columns an import understands, by their header names (case and spaces don't matter). */
export const IMPORT_COLUMNS = /** @type {const} */ (["email", "name", "username", "title", "workspace", "role", "orgadmin"]);
export const MAX_IMPORT_ROWS = 200;
