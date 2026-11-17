import { useState } from "react";
import { Bookmark, Search } from "lucide-react";
import { api } from "../data/api";

/** Under an Ask Pulse answer: the question as a PQL search, to open in Search or save as a filter. */
export default function AskToPql({ question, onSearch }: { question: string; onSearch: (pql: string) => void }) {
  const [state, setState] = useState<{ loading?: boolean; pql?: string; error?: string; saved?: string } | null>(null);
  const [name, setName] = useState(question.slice(0, 80));
  if (!state)
    return (
      <button type="button" className="ask-pql-btn" onClick={() => convert()}>
        <Search size={13} /> Turn this into a search
      </button>
    );
  async function convert() {
    setState({ loading: true });
    try {
      const r = await api<{ pql: string; error?: string }>("/ask/pql", "POST", { question });
      setState({ pql: r.pql, ...(r.error ? { error: r.error } : {}) });
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : "Couldn't make a search from that" });
    }
  }
  if (state.loading) return <p className="ask-pql muted">Writing the search…</p>;
  return (
    <div className="ask-pql">
      {state.pql && (
        <code className="ask-pql-code" aria-label="The question as PQL">
          {state.pql}
        </code>
      )}
      {state.error && <p className="form-error">{state.pql ? `This query needs a fix: ${state.error}` : state.error}</p>}
      {state.pql && (
        <div className="ask-pql-actions">
          <button type="button" className="btn btn-ghost sm" onClick={() => onSearch(state.pql!)}>
            <Search size={13} /> Open in Search
          </button>
          {!state.error &&
            (state.saved ? (
              <span className="form-ok">Saved as "{state.saved}"</span>
            ) : (
              <form
                className="ask-pql-save"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await api("/filters", "POST", { name, pql: state.pql });
                    setState({ ...state, saved: name });
                  } catch (err) {
                    setState({ ...state, error: err instanceof Error ? err.message : "Couldn't save it" });
                  }
                }}
              >
                <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Filter name" maxLength={80} required />
                <button className="btn btn-navy sm" type="submit">
                  <Bookmark size={13} /> Save as filter
                </button>
              </form>
            ))}
        </div>
      )}
    </div>
  );
}
