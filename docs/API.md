# Pulse API reference

Pulse's API is the one its own pages use. Other systems reach it with a **personal API token**.

## Tokens

- **Making one:** in Pulse, go to **Settings → Security & privacy → API tokens**. Name the token after what will
  use it, choose **Read only** or **Read and write**, and choose when it expires (7 to 365 days).
- **Copy it at once.** Pulse keeps only a hash, so the token is shown once.
- **Who may make them:** your role needs "Use personal API tokens". By default that's every role except Standard
  user.
- **Revoking:** you can revoke your own tokens, and an administrator can see and revoke anyone's. A revoked or
  expired token stops working at once.

Send the token in the `Authorization` header:

```
GET /api/items?system=<project id>&state=open
Authorization: Bearer pulse_3f9c…
```

- **Who it acts as:** a token acts as its owner, with the owner's permissions and visibility rules. A developer's
  token sees only their own items, and no token sees an item at a security level its owner isn't in.
- **Which workspace:** a token reaches **only the workspace it was made in**, with the owner's role there, even if
  the owner belongs to other workspaces too. It stops working if the owner leaves that workspace, or the workspace
  or organisation is archived or suspended. To work in two workspaces, make a token in each.
- **Read tokens** may only `GET`.
- **Rate limit:** up to **120 requests a minute** per token. Over that, Pulse answers `429` with
  `{"error": …, "code": "rate_limited", "retryAfter": <seconds>}`.
- **Never with a token:** accounts and sign-in (`/api/me…`, `/api/logout…`, `/api/users…`), tokens
  (`/api/tokens…`), settings (`/api/settings/…`), view-only links, integrations and webhooks.
- **Activity log:** every change made with a token is logged as its owner, marked with the token's name.

Errors come back as JSON, `{"error": "…"}`, with a 4xx status:

| Status | Meaning |
| --- | --- |
| 400 | The request isn't valid |
| 401 | The token is missing, expired or revoked |
| 403 | Not allowed |
| 404 | Not found, not visible to the token's owner, or in another workspace or organisation (these look the same) |
| 429 | Over the rate limit |

## Organisations and workspaces

Pulse holds several organisations, each with its own workspaces (for example Projects, HR, Finance). Everything the
API returns belongs to **one organisation and one workspace**: the one your session has open, or the one a token,
view-only link or portal link was made in. Nothing from another workspace or organisation is ever returned, counted
or changed, and asking for it by id or key gives `404`, the same as something that doesn't exist.

- **Keys:** project keys, and so item keys such as `INFRA-12`, are unique within an organisation. Another
  organisation may use the same key for its own project.
- **Signing in:** `POST /api/login` takes `{ organization, username, password }`, where `organization` is the
  organisation's code (`omnicontact`), in any capitals. Every refusal reads the same, whether the code is unknown,
  the organisation is suspended, the username isn't in it, or the password is wrong. A correct sign-in returns
  `{ ok, workspace, workspaces }`, your own workspaces only; with more than one, choose with `POST /api/me/workspace`.
  Someone in no workspace gets `403`, `code: "no_workspace"`, after the right password only.
  `POST /api/password/forgot` takes `organization` the same way. Without a code, a username used in only one active
  organisation still signs in (for older scripts).
- `GET /api/data` includes `tenant`: `{ organization: { id, name, code }, workspace: { id, name, key },
  workspaces: [{ id, name, key, role }], orgAdmin }`. `workspaces` lists the ones you belong to (empty for links).
- `GET /api/me/workspaces` returns the same `tenant` object (signed-in people only, not tokens or links).
- `POST /api/me/workspace` with `{ "workspaceId": "…" }` switches the open workspace without signing in again.
  Membership is checked on every switch: a workspace you don't belong to, in your organisation or another, is
  `404`. Signed-in people only.
- `PUT /api/settings/workspaces` (the old workspace list) is refused with `409`, `code: "workspaces_managed_by_org"`:
  workspaces are managed in Organisation settings.

## Work items

- **`GET /api/items`** returns a page of work items, `{ items, total, offset }`.
  - **Filters:** `system`, `type` (EPIC, STORY, TASK, BUG, SUBTASK; comma-separated), `status`, `priority`,
    `assignee` (a user id, `me` or `none`), `reporter`, `label`, `component`, `source` (`internal`,
    `client_request`, `service_desk`), `parent`, `state` (`open` or `done`), `due` (`overdue` or `week`), `q`
    (words).
  - **Sorting:** `sort` (`key`, `updated`, `created`, `priority`, `due`, `status`, `summary`, `type`) and `dir`
    (`asc` or `desc`).
  - **Paging:** `offset`, and `limit` up to 100.
- **`GET /api/items/{KEY-12}`** returns one work item, with its links, children, watchers, time logs, status
  history, custom fields, security level, the GitHub development links and, for a service desk request, the
  request.
- **`POST /api/items`** creates a work item.
  - **Required:** `systemId`, `summary`.
  - **Optional:** `type`, `description`, `priority`, `assignee`, `parent`, `labels`, `component`, `storyPoints`,
    `originalEstimate` (minutes), `startDate`, `dueDate`, `securityLevel` (a level id you belong to), and
    `customFields` (`{ "<field id>": value }`).
  - **Custom field values:** text, a number, `YYYY-MM-DD`, a user id, an option id, or a list of option ids for a
    multi select. Required custom fields must be given.
- **`PATCH /api/items/{KEY-12}`** changes any of the fields above. A status change is a workflow move, so it needs
  `status` and, where the move asks for one, `comment`.
- **`POST /api/items/{KEY-12}/transitions`** makes a workflow move: `{ transitionId }` or `{ to }`, plus
  `comment` and `fields`. **`GET /api/items/{KEY-12}/transitions`** lists the moves you may make.
- **`GET /api/items/{KEY-12}/comments`** reads the comments (`offset`, `limit`).
  **`POST /api/items/{KEY-12}/comments`** adds one: `{ body }`. On a service desk request, `"public": true` makes
  it a reply the customer sees.
- **`DELETE /api/items/{KEY-12}`** deletes an item, if your role may.

## Search (PQL)

- **`POST /api/search`** runs a PQL query: `{ "pql": "project = INFRA AND status != Done", "offset": 0, "limit": 50 }`.
  It returns `{ items, total, offset }`, and each item carries its `customFields`.
  - A mistake in the query is a `400` with `code: "pql"` and the `start` and `end` of the problem.
  - Custom fields are searched by name, in quotes when the name has spaces: `"Customer tier" = Gold`.
- **`GET /api/search/fields`** returns the fields (built-in and custom), functions and known values.

## Reports: Projects

For people signed in with "Generate reports" (Admin, Manager, Team Leader, Projects Assistant). View-only links
and API tokens without that permission get `403`. Work items are counted with the caller's access rule, so
items under a security level they can't see are never counted.

All three take the same filters, any of which can be left out:

| Filter | Values | Default |
|---|---|---|
| `from`, `to` | `YYYY-MM-DD` | the last 90 days |
| `stage` | `NOT_STARTED`, `WIP`, `TESTING`, `TO_DEPLOY`, `LIVE`, `COMPLETED` | all |
| `schedule` | `ON_TRACK`, `AT_RISK`, `OVERDUE`, `DONE`, `UNSCHEDULED` | all |
| `rag` | `RED`, `AMBER`, `GREEN`, `NONE` (not rated) | all |
| `lead` | a user id | all |
| `workspace` | a workspace name | all |

Values that make no sense are ignored. The screen keeps the same filters in its address:
`#/reports/projects?from=2026-06-01&rag=RED`.

- **`GET /api/reports/projects/summary`** returns `{ generatedAt, filters, totals, rows, developers }`:
  - `totals`: projects by stage, schedule and health; average progress; open blockers; open and overdue update
    requests; needs attention; open and overdue work items; developers over the workload limit.
  - `rows`: one per project, worst health first, each with its `rag` and the `reasons` for it.
  - `developers`: everyone assigned to a project in the report, with `overloaded` and its `reasons`.
- **`GET /api/reports/projects/trends`** returns `{ weeks, throughput }`:
  - `weeks`: one per Monday in the period, with average progress, items created and resolved, hours logged
    and the burn-up (`scope`, `done`).
  - `throughput`: items resolved and hours logged per project.
- **`GET /api/reports/projects/export.xlsx`** downloads the same report as an Excel workbook, with sheets
  Summary, Projects, Resourcing, Trends by week, Throughput and Work items (one row per item). Each export is
  written to the activity log (`report_exported`).

## Service desk

- **`GET /api/service-desk/queues?queue=…`** returns open requests, most urgent first, each with its two SLA
  clocks. The `queue` is `unassigned`, `mine`, `at_risk`, `breached` or `all_open`.
- **`GET /api/service-desk/reports?days=30`** returns:
  - first replies and resolutions, met against breached
  - the number of requests by type
  - the average time to resolve, in business minutes
- **`POST /api/service-desk/requests`** raises a request as the token's owner:
  `{ typeId, summary, description, priority, answers: { "<question id>": "…" } }`.
- **`GET /api/service-desk/config`** returns the request types and their questions.

## Webhooks Pulse sends

An administrator adds them in **Settings → Administration → Integrations**.

**The request**
- Each event is a `POST` with a JSON body, sent to the webhook's https address.
- **Headers:**
  - `X-Pulse-Event`: `work_item.created`, `work_item.updated`, `work_item.transitioned` or `work_item.commented`
  - `X-Pulse-Delivery`: the delivery's number
  - `X-Pulse-Signature`: `sha256=` and the HMAC-SHA256 of the raw body, keyed with the webhook's secret
- Check the signature before trusting a delivery. The secret starts `whsec_` and is shown once, when the webhook
  is made.

**The body**
- `event` and `sentAt`.
- `item`, with these fields:
  - `key`, `url`, `project`, `type`, `summary`
  - `status`, `statusCategory`, `priority`
  - `assignee` and `reporter` (each `{ username, name }`)
  - `labels`, `dueDate`, `storyPoints`
  - `createdAt`, `updatedAt`, `resolvedAt`, `source`
- Depending on the event, also `changed` (field names), `from` and `to` (statuses), or `comment`.

**Answering and retries**
- Answer with any 2xx status within 10 seconds.
- A failed delivery is retried after 15 seconds, then after about 1, 2, 4 and 8 hours. After six tries it's marked
  failed; an administrator can retry it from the webhook's deliveries.
- Items with a security level are never sent.

## GitHub

GitHub calls `POST /api/integrations/github/webhook`, signed with the shared secret in `X-Hub-Signature-256`. Pulse
reads pushes, branch creation and pull requests, and links each one that mentions a key (INFRA-12) to that item.
Each workspace connects GitHub with its own secret; a delivery belongs to the workspace whose secret signed it, and
links only to that workspace's items.
The setup steps are in **Settings → Administration → Integrations**.

## Organisation administration

For Organisation Administrators, signed in (not with a token or link). Others get `403`, `code: "org_admin_only"`.
Another organisation's workspace or person is `404`.

- `GET /api/org`: the organisation, every workspace (`id, name, key, status, members`), and every person with their
  workspaces and role in each (`workspaces: [{ workspaceId, role }]`) and `orgAdmin`.
- `POST /api/org/workspaces` `{ name, key }`: a new workspace. You become its administrator.
- `PATCH /api/org/workspaces/:id` `{ name?, key?, status?: "active" | "archived" }`. The last active workspace, and
  the one you have open, can't be archived.
- `POST /api/org/people` `{ username, name, title?, email?, orgAdmin?, workspaces: [{ workspaceId, role }] }`:
  returns `{ id, temporaryPassword }`, shown once.
- `PUT /api/org/people/:id/workspaces` `{ workspaces: [{ workspaceId, role }] }`: replaces their memberships.
  Leaving a workspace ends their sessions in it.
- `PATCH /api/org/people/:id` `{ orgAdmin?, name?, title?, email? }`. `DELETE /api/org/people/:id` removes them from
  the organisation. There must always be one Organisation Administrator.
- **Organisation-wide settings:** `PUT /api/settings/signin`, `/api/settings/mfa`, `/api/settings/delivery` and
  `/api/roles` also need an Organisation Administrator.

## Platform administration

Platform Administrators only, at `/api/platform/…`, with their own session cookie (`pulse_platform`, sent only to
`/api/platform`). The first one is made with `node scripts/platform-admin.mjs`.

- `POST /api/platform/login` `{ username, password }` → `{ ticket, setup? }`. `setup` (`{ secret, uri }`) comes the
  first time: an authenticator app must be set up. Then `POST /api/platform/login/code` `{ ticket, code }` signs
  in. Every refusal reads the same.
- `GET /api/platform/me`; `POST /api/platform/me/password` `{ current, password }` (required before anything else
  after a temporary password); `POST /api/platform/logout`.
- `GET /api/platform/organizations`: each organisation's `name, code, status, createdAt` and its counts of
  workspaces, people and administrators. Nothing inside an organisation.
- `POST /api/platform/organizations` `{ name, code, admin: { username, name, email? } }` → the organisation, the
  administrator's temporary password (shown once) and the sign-in link.
- `PATCH /api/platform/organizations/:id` `{ name?, status?: "active" | "suspended" | "archived" }`. Leaving active
  ends its sessions.
- `POST /api/platform/organizations/:id/admins` `{ username, name, email? }`: another Organisation Administrator.
