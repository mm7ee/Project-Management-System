// Settings → This workspace → Ask AI documents: how many of the workspace's documents Ask AI can search, and a
// button to read the ones waiting (documents from before search existed, and any that failed). New uploads and
// submitted PMS documents are read on their own, right after they're added (backend src/docIndex.js).
import { useEffect, useState } from "react";
import { FileSearch, RefreshCw } from "lucide-react";
import { api } from "../data/api";
import { BRAND } from "../data/brand";
import Panel from "./Panel";
import { Help, ToastProvider, useToast } from "./AdminKit";

/**
 * @typedef {{ indexed: number; waiting: number; skipped: number; failed: number; passages: number; available: boolean;
 *   failures: { name: string; projectId: string; note: string | null }[]; done?: { indexed: number; skipped: number; failed: number } }} IndexStatus
 */

export default function AskAiDocuments() {
  return (
    <ToastProvider>
      <Documents />
    </ToastProvider>
  );
}

function Documents() {
  const toast = useToast();
  const [s, setS] = useState(/** @type {IndexStatus | null} */ (null));
  const [running, setRunning] = useState(false);
  useEffect(() => {
    api("/assistant/documents")
      .then((r) => setS(/** @type {IndexStatus} */ (r)))
      .catch((e) => toast(e instanceof Error ? e.message : "Couldn't load this", false));
  }, []);
  // A few documents a request: ask again while some are still waiting and the last round got through any.
  const run = async () => {
    setRunning(true);
    /** @type {{ indexed: number; skipped: number; failed: number }} */ const total = { indexed: 0, skipped: 0, failed: 0 };
    try {
      for (let round = 0; round < 50; round++) {
        const r = /** @type {IndexStatus} */ (await api("/assistant/documents/index", "POST"));
        setS(r);
        const d = r.done ?? { indexed: 0, skipped: 0, failed: 0 };
        total.indexed += d.indexed;
        total.skipped += d.skipped;
        total.failed += d.failed;
        if (!r.waiting || d.indexed + d.skipped + d.failed === 0) break;
      }
      toast(`Read ${total.indexed} ${total.indexed === 1 ? "document" : "documents"}${total.skipped ? `, ${total.skipped} without text` : ""}${total.failed ? `; ${total.failed} failed` : ""}.`, total.failed === 0);
    } catch (e) {
      toast(e instanceof Error ? e.message : "That didn't work", false);
    } finally {
      setRunning(false);
    }
  };
  if (!s) return <p className="muted">Loading…</p>;
  const tiles = /** @type {[string, number, string][]} */ ([
    ["Searchable", s.indexed, `${s.passages.toLocaleString("en-GB")} passages`],
    ["Waiting", s.waiting, "not read yet"],
    ["No text", s.skipped, "images, links, unsupported files"],
    ["Failed", s.failed, "after 3 tries"],
  ]);
  return (
    <Panel
      title={`${BRAND.assistantName}: documents`}
      icon={FileSearch}
      action={
        <button className="btn btn-primary sm" disabled={running || !s.available || !s.waiting} onClick={run}>
          <RefreshCw size={14} className={running ? "spin" : ""} /> {running ? "Reading…" : !s.available ? "No AI connected" : s.waiting ? `Read ${s.waiting} waiting` : "All read"}
        </button>
      }
    >
      <Help>
        {BRAND.assistantName} searches the text of this workspace's documents: uploaded PDF, Word, Excel, text and HTML files (up to 10 MB), work-item attachments, and the BRS, BSS and release notes written in PMS. New ones are read as they're added. It only ever answers from documents the person asking may open. {!s.available && "This server has no AI connected, so documents can't be read here."}
      </Help>
      <div className="aidoc-tiles">
        {tiles.map(([label, n, sub]) => (
          <div key={label} className={`aidoc-tile${label === "Failed" && n ? " bad" : ""}`}>
            <b>{n.toLocaleString("en-GB")}</b>
            <span>{label}</span>
            <small>{sub}</small>
          </div>
        ))}
      </div>
      {s.failures.length > 0 && (
        <>
          <h4 className="aidoc-h">Couldn't be read</h4>
          <ul className="aidoc-failures">
            {s.failures.map((f, i) => (
              <li key={i}>
                <a href={`#/projects/${f.projectId}/docs`}>{f.name}</a> <span className="muted">{f.note ?? "Reading it failed"}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
