# Pulse: frontend

The screens people use, in React 18 and Vite (JavaScript, with JSDoc types checked by `tsc --checkJs`).

```
src/
  components/   the screens and their parts
  data/         types and shared rules (permissions, workflows, PQL, calendars...), also used by the API
public/         static files
tests/          Vitest tests of the shared logic in src/data
```

The API in `../project-management-system-backend` imports `src/data/`, so a change there is a change to both. The
backend's tests check it from the server side.

| Command | What it does |
| --- | --- |
| `npm install` | Install the packages (the backend needs them too: it builds this folder) |
| `npm run dev` | Vite dev server at http://localhost:5173, on its own. `/api` goes to the backend on port 8787 (`npm run dev` there); while it's off, API calls answer 503 saying so. `PULSE_API=<url>` points it elsewhere |
| `npm run build` | Type-check and build to `dist/` (the Worker serves it) |
| `npm test` | The tests |

Deploying is done from the backend: see the main [README](../README.md).
