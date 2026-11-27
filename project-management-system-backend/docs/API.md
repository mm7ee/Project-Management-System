# Project Management System (PMS) API reference

PMS's API is the one its own pages use. Other systems reach it with a **personal API token**.

## Tokens

- **Making one:** in PMS, go to **Settings → Security & privacy → API tokens**. Name the token after what will
  use it, choose **Read only** or **Read and write**, and choose when it expires (7 to 365 days).
- **Copy it at once.** PMS keeps only a hash, so the token is shown once.
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
- **Rate limit:** up to **120 requests a minute** per token. Over that, PMS answers `429` with
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

PMS holds several organisations, each with its own workspaces (for example Projects, HR, Finance). Everything the
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

## Workflows, item types and templates

Changes need `manage_workflows` in the open workspace. A workflow belongs to a workspace (`workspaceId`), or it is
one of the organisation's templates (`workspaceId: null`, `template: true`).
- **Templates:** everyone can read and copy them. Only Organisation Administrators change them; anyone else gets `403`,
  `code: "template_read_only"`.
- **Another workspace's workflow:** `404`.

- `GET /api/workflows` → `{ workflows, statuses, workspace, projects, itemTypes, usage, canEditTemplates }`.
  - `workspace` is the id of the workflow this workspace uses.
  - Each workflow has `version` (the latest published) and `draftSavedAt` if there's a draft.
- `POST /api/workflows` `{ name, copyFrom?, template? }`: a copy for this workspace. With `template: true`
  (Organisation Administrators), a new organisation template.
- **Drafts:**
  - `GET /api/workflows/:id/draft` → `{ draft | null, published, savedBy?, savedAt? }`
  - `PUT /api/workflows/:id/draft` `{ name, description, statuses: [{ id, initial }], transitions: [{ name, from, to, rules }] }`:
    checked and kept; nothing changes yet.
  - `DELETE /api/workflows/:id/draft` discards it.
- `POST /api/workflows/:id/publish` `{ moves?, note? }`: the draft becomes the workflow and is kept as a new version.
  - Work items in a status the draft takes out need a place to go: without `moves` (`{ "<status>": "<status>" }`), the
    reply is `409`, `code: "needs_moves"`, `statuses: [{ id, name, count }]`.
  - The first publish also keeps the workflow as it was, as version 1.
  - `PUT /api/workflows/:id` (the whole workflow, with `moves?` and `note?`) still publishes straight away.
- **Versions:**
  - `GET /api/workflows/:id/versions` → `{ versions: [{ version, note, publishedBy, publishedAt, statuses, moves }] }`
  - `GET /api/workflows/:id/versions/:n` → the version
  - `POST /api/workflows/:id/versions/:n/restore` `{ moves? }` publishes it again as a new version. Versions are never
    changed.
- `DELETE /api/workflows/:id`: only when no workspace, project or item type uses it.
- `PUT /api/workflow-assignments` `{ workspace?, projects?: { <id>: workflowId | null }, itemTypes?: { <typeId>: workflowId | null }, moves? }`:
  - Which workflow this workspace, each project and each item type uses.
  - An item follows its type's workflow, else its project's, else the workspace's.
  - Items whose workflow changes keep their status if the new workflow has it; otherwise `moves` applies, as for
    publishing.
- **Statuses:**
  - `POST /api/statuses` `{ name, category }` adds to the organisation's list.
  - `PATCH` and `DELETE /api/statuses/:id`: a status another workspace's workflow (or a template) uses can only be
    renamed or recategorised by an Organisation Administrator, and can't be deleted (`code: "status_shared"`).
- **Item types:**
  - `GET /api/item-types` → `[{ id, name, base, description, active, workflowId, builtIn, items }]`.
  - `base` is the kind (`EPIC`, `STORY`, `TASK`, `BUG`, `SUBTASK`): where the type sits in the hierarchy and on boards.
  - `POST /api/item-types` `{ name, base, description? }`.
  - `PATCH /api/item-types/:id` `{ name?, description?, active?, position? }`. `active: false` stops offering the type
    for new items.
  - `DELETE /api/item-types/:id` works only for a type of the workspace's own that no item uses. The five built-in
    types stay.
- **Work items:**
  - `POST /api/items` takes `itemType` (such as `CAMPAIGN`), or `type` (a kind) as before.
  - `PATCH /api/items/:key` `{ itemType }` changes it.
  - Items carry `itemType` and `itemTypeName`.
- **Custom fields** also have:
  - `kind`: `textarea`, `currency` (with `currency`, such as `USD`), `checkbox` or `url` (https:// or http:// only)
  - `defaultValue`: filled in on new items left empty. A date can be `+3d`; a choice is given by its label.
  - `itemTypes`: the item types it's for. `null` means every type; an item of another type can't be given it.
  - In PQL, a checkbox is `"Signed off" = yes`, and money compares as a number.
- **Workspace templates** (Organisation Administrators):
  - `GET /api/org/templates` → `{ builtIn, organisation }`, each with the statuses, item types and fields it sets up.
    The built-in ones are Software Development, Marketing, HR and Projects (general).
  - `POST /api/org/templates` `{ workspaceId, name, description? }` saves a workspace's set-up (not its work, people
    or automation).
  - `DELETE /api/org/templates/:id`.
  - `POST /api/org/workspaces` takes `template: "builtin:marketing"` or `"org:<id>"`.

## SLAs and approvals

- **SLAs for work items:**
  - `GET /api/sla-policies` → `{ policies, calendar }`.
  - `POST /api/sla-policies` `{ name, firstResponseMinutes?, resolutionMinutes?, warnPercent?, itemTypes?, priorities? }`.
  - `PATCH` and `DELETE /api/sla-policies/:id`. Changes need `manage_workflows`.
  - Minutes are working minutes (the organisation's time zone, working days and hours, and holidays).
  - The first matching active policy applies. A work item's detail has
    `sla: { policy, response?, resolution? }`, each `{ state: running | warning | breached | met | missed, elapsedMinutes, targetMinutes, dueAt? }`.
  - The first response is the first comment or status change by someone other than the reporter.
  - Warnings and breaches are told once (the assignee; for breaches, the workspace's administrators too) and set
    off the automation triggers `sla_warning` and `sla_breached`. `triggerValue` (`response` or `resolution`) narrows
    them.
- **Approvals:**
  - **The rule:** a move whose rules include `{ kind: "validator", rule: "approval", value: "{\"who\": \"role:manager\" | \"user:<id>\" | \"users:<id,id>\", \"needed\": N}" }`
    isn't made at once.
  - **Asking:** `POST /api/items/:key/transitions` returns the item, unmoved, with
    `approval: { id, move, toStatus, status: "pending", approvers, needed, approvals, votes }`. While it's pending,
    other moves are refused (`409`, `code: "approval_pending"`). The person asking is never an approver.
  - **Deciding:**
    - `POST /api/approvals/:id/approve` `{ comment? }`. Enough approvals make the move, with what was sent with it.
    - `POST /api/approvals/:id/reject` `{ reason }`. A reason is required (`code: "reason_required"`).
    - `POST /api/approvals/:id/cancel`, by whoever asked or someone who may edit any work item.
    - To anyone who isn't an approver, an approval is `404`. Decisions can't be changed.
  - `GET /api/approvals` lists those waiting for you; `GET /api/items/:key/approvals` gives an item's history.
  - Automation triggers: `approval_granted`, `approval_rejected`.
- **Outgoing webhooks** (`/api/webhooks`) can have `payloadTemplate`: JSON with smart values (`{{event}}`,
  `{{item.key}}`, `{{item.title}}`, `{{item.status}}`, `{{item.url}}` …), escaped for JSON, sent instead of the
  standard payload and still signed.

## Automation

Needs `manage_automation`, except the item buttons and the webhook trigger.
- **A rule** (`/api/automation/rules`, GET, POST; `/api/automation/rules/:id`, PUT, DELETE):
  - `trigger`:
    - `item_created`, `item_transitioned` (`triggerValue`: a status), `field_changed` (`triggerValue`: a field)
    - `item_assigned`, `comment_added`, `subtasks_done`, `sprint_started`, `sprint_completed`
    - `due_soon` (`triggerConfig: { hours }`), `due_passed`
    - `schedule` (`triggerConfig: { every: "day" | "weekday" | "week" | "month", weekday?, day?, time: "08:00" }`, in the
      organisation's time zone)
    - `webhook`, `manual`
  - `conditions`: `{ op: "and" | "or", items: [{ field, op, value?, fieldId? } | group] }`, up to 3 levels and 25
    conditions.
    - Fields and operators are in `src/data/automation.js` (`CONDITION_FIELDS`).
    - `conditionPql` may be used as well.
  - `actions`, up to 10:
    - `transition`, `assign` (a user, `reporter`, `lead`, `role:<role>`, `round_robin:role:<role>`,
      `least_loaded:role:<role>`, or `…:people:<id,id>`)
    - `set_field` (a due date can be `+2wd`, working days), `add_label`, `clear_field`, `comment`, `notify`,
      `create_subtask`, `link`
    - `create_item`, `email`, `message`, `webhook` and `escalate`, whose settings are JSON in `value`:
      - `create_item`: `{ workspaceId?, systemId, itemType?, summary, description? }`. In another workspace, the
        rule's owner must be a member there who may create items.
      - `email`: `{ to: "assignee" | "reporter" | "watchers" | "role:<role>" | "emails:a@b,c@d", subject, body }`
      - `message`: `{ channel: "whatsapp" | "sms", to: "assignee" | "reporter" | "phone:+…", text }`
      - `webhook`: `{ url: "https://…", payload: "<JSON with smart values>" }`
      - `escalate`: `{ message }`
  - Text can use smart values such as `{{item.key}}`, `{{item.title}}`, `{{item.assignee.name}}`,
    `{{workspace.name}}` and `{{trigger.user.name}}` (the list is `PLACEHOLDERS` in `src/data/search.js`). Values
    are escaped for HTML in emails and for JSON in webhooks.
  - `ownerId`: told when the rule keeps failing.
  - `sharedScope: "organization" | "workspaces"` (with `sharedWorkspaces`), for Organisation Administrators only:
    the rule is copied to every workspace (or those named). Changing or deleting it changes every copy, and new
    workspaces get organisation-wide rules.
  - **Secrets, shown once:**
    - A new webhook action's signing secret: `secrets: [{ action, secret }]`. Each call carries
      `X-Pulse-Signature: sha256=<hex HMAC-SHA256 of the body>`.
    - A webhook trigger's address: `webhookUrl`. `newWebhookAddress: true` on PUT makes a new one.
- `POST /api/automation/rules/:id/test` `{ itemKey? }`, or `POST /api/automation/test` `{ rule, itemKey? }` for a
  rule not saved yet → `{ wouldRun, checks: [{ label, result }], actions: ["Would …"] }`. Changes nothing.
- `POST /api/automation/rules/:id/run` `{ itemKey? }`: runs it now.
- `GET /api/automation/rules/:id/runs` → each run with `detail: { conditions, actions }`. The newest also has
  `retrying`, the number of runs waiting to be tried again.
- `GET /api/automation/presets`, `POST /api/automation/presets/:id` → `{ rule, warnings }`. The rule is added
  switched off, matched to this workspace by name; `warnings` lists what didn't match.
- `GET /api/automation/targets`: the workspaces (and their projects) where you may create work items, for
  `create_item`.
- **Buttons on an item:** `GET /api/automation/manual?item=KEY` lists the `manual` rules that apply, and
  `POST /api/automation/manual/:ruleId` `{ itemKey }` presses one. For anyone who can work on the item.
- **Webhook trigger:** `POST /api/hooks/automation/<secret>` with JSON. With `{ "itemKey": "DEV-12" }` it runs on
  that item; otherwise on what the rule's conditions pick. The body's top-level values are `{{webhook.<name>}}`.
  Answers `202`; a wrong address or a switched-off rule is `404`.
- **How it runs:**
  - Each run is a job.
  - A failure before anything changed is tried again after 1, 2, 4 and 8 minutes. After 5 tries it's failed and
    the owner is told (once a day).
  - Loops stop at 5 levels of rules setting off rules, at 10 runs an hour of one rule on one item, at the rule's runs
    a minute, and at 600 runs a minute across the organisation.
  - Time-based triggers fire once per item and due date, or once per schedule occasion. The cron runs every 5
    minutes.

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

## Webhooks PMS sends

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

GitHub calls `POST /api/integrations/github/webhook`, signed with the shared secret in `X-Hub-Signature-256`. PMS
reads pushes, branch creation and pull requests, and links each one that mentions a key (INFRA-12) to that item.
Each workspace connects GitHub with its own secret; a delivery belongs to the workspace whose secret signed it, and
links only to that workspace's items.
The setup steps are in **Settings → Administration → Integrations**.

## Organisation administration

For Organisation Administrators, signed in (not with a token or link). Others get `403`, `code: "org_admin_only"`.
Another organisation's workspace or person is `404`.

- `GET /api/org`:
  - the organisation
  - every workspace (`id, name, key, status, members, icon, colour?, description, visibility`)
  - every person with:
    - their workspaces and role in each (`workspaces: [{ workspaceId, role }]`)
    - `orgAdmin`
    - `deactivated?`
    - `invited?: "pending" | "expired"`
- `POST /api/org/workspaces` `{ name, key, icon?, colour?, description?, visibility?, cloneFrom? }`: a new workspace.
  - You become its administrator.
  - `visibility` is `"private"` (the default) or `"organization"`: anyone in the organisation may open it as a Viewer.
  - `cloneFrom`, another workspace's id, copies its configuration without its work: its workflow, custom fields,
    automation rules (switched off) and workload limits. The reply's `copied` says how much was copied.
  - `icon` is one of `src/data/orgAdmin.js` `WORKSPACE_ICONS`.
- `PATCH /api/org/workspaces/:id` `{ name?, key?, status?: "active" | "archived", icon?, colour?, description?, visibility? }`.
  The last active workspace, and the one you have open, can't be archived.
- `POST /api/org/people` `{ username, name, title?, email?, orgAdmin?, workspaces: [{ workspaceId, role }] }`:
  returns `{ id, temporaryPassword }`, shown once.
- `PUT /api/org/people/:id/workspaces` `{ workspaces: [{ workspaceId, role }] }`: replaces their memberships.
  Leaving a workspace ends their sessions in it.
- `PATCH /api/org/people/:id` `{ orgAdmin?, name?, title?, email? }`. `DELETE /api/org/people/:id` removes them from
  the organisation. There must always be one active Organisation Administrator.
- `POST /api/org/people/:id/deactivate`, `POST /api/org/people/:id/reactivate`:
  - A deactivated account can't sign in; its sessions, reset links and API tokens stop working.
  - Its memberships and history stay.
  - Sign-in treats it like an unknown username (the same message).
- `POST /api/org/invites` `{ email, name, username?, title?, orgAdmin?, workspaces: [{ workspaceId, role }] }` →
  `{ id, username, emailed, link? }`.
  - It makes the account and a one-time "choose your password" link, valid 72 hours. The link is emailed when email is
    set up; otherwise it is returned as `link`, shown once.
  - `role` is a role key or the name PMS shows ("Developer", "Viewer" …).
  - `username` comes from the email address when not given.
- `POST /api/org/people/import` `{ csv, check? }`: invitations from CSV.
  - Columns: `email, name, workspace, role`, and optionally `username, title, orgadmin`.
  - `workspace` is a key or name, several separated by `;`. Several rows with one email put that person in several
    workspaces.
  - Every row is checked first. Any problem → `400`, `code: "import_invalid"`, `problems: [{ line, problem }]`, and
    nobody is invited.
  - With `check: true` it only reports who would be invited. At most 200 people.
- `GET /api/org/profile`, `PUT /api/org/profile` `{ timeZone?, workDays?, workStart?, workEnd?, contactEmail? }`:
  - `workDays` are ISO weekdays (1 = Monday).
  - `timeZone` is an IANA name such as `Africa/Harare`.
  - The logo and colour moved to the branding (below); the old `GET /api/org/logo` is gone.
- `GET /api/org/branding` → `{ branding }`, `PUT /api/org/branding` `{ displayName?, accent?, tint?, logo?, logoDark?, icon? }`
  → `{ branding }`: the organisation's branding (see [Branding](#branding)).
  - `accent` and `tint` are `#rrggbb` (`#rgb` is accepted); `tint: null` uses the accent.
  - `logo`, `logoDark` and `icon` are PNG, WebP or JPEG `data:` URLs, or `null` to remove one. **SVG is refused.** The
    type is read from the bytes, not the label. At most 200 KB each; a logo fits in 480 × 160 pixels, the icon in
    256 × 256 (the settings page resizes them before sending).
  - Recorded in the audit log as `organization_branding_updated` (what changed; never the images).
- `GET /api/org/audit?workspace=&action=&before=` → `{ entries: [{ id, at, actor, actorId, action, targetType, targetId, workspace, before, after, ip }], more }`:
  - the administration audit log, newest first, 100 at a time
  - `before` is the last `id` seen
  - entries can't be changed or removed
- **Organisation-wide settings:** `PUT /api/settings/signin`, `/api/settings/mfa`, `/api/settings/delivery` and
  `/api/roles` also need an Organisation Administrator.

**A workspace's own audit log:** `GET /api/audit-log?before=` returns the open workspace's entries, for people with
the `audit_log` permission there.

**Viewers.** The `reader` role ("Viewer (read-only)") has no permissions, whatever Roles & permissions says. Any
request other than GET returns `403`, `code: "read_only"`, except:
- their own account (`/api/me…`, sign-out)
- notifications
- chat
- searching and Ask AI

Viewers can't be assigned work.

**Organisation-wide workspaces.** `GET /api/me/workspaces` also lists workspaces open to the organisation that you
aren't in, with `open: true`. `POST /api/me/workspace` to one makes you its Viewer.

## Branding

Each organisation has its own branding: a display name, an accent colour, an optional sign-in tint, a logo for light
backgrounds, a logo for dark backgrounds and a square icon. The platform itself is neutral. Organisation
Administrators change it with `/api/org/branding` (above), and Platform Administrators with
`/api/platform/organizations/:id/branding` (below).

A branding view, wherever it appears:

```json
{ "name": "Omnicontact", "code": "omnicontact", "accent": "#2c3280",
  "shades": { "light": "#2c3280", "dark": "#757cd0", "futuristic": "#757cd0" }, "tint": null,
  "logo": "/api/public/org/omnicontact/logo?v=2", "logoDark": "/api/public/org/omnicontact/logo-dark?v=2", "icon": null }
```

- `shades` is the accent made safe for each theme: the colour itself where it passes WCAG AA (4.5:1 as text on that
  theme's surfaces, and with white or dark text on it), else the nearest shade of the same hue that does. Status
  colours never change with the brand.
- An image is `null` when there is none. The app then shows a monogram of the organisation's initials in its accent.

**Before sign-in** (no session), only for an organisation whose code someone already has:

- `GET /api/public/org/:code/branding` → the view above, nothing else (no workspaces, people or ids).
  `Cache-Control: public, max-age=60`.
- `GET /api/public/org/:code/logo`, `/logo-dark`, `/icon` → the image, with its real type and `nosniff`. With the
  current `?v=` it is cached for a year (`immutable`); a new upload changes `v`.
- An unknown, suspended or archived organisation, a malformed code and a missing image all get the same `404`
  `{ "error": "Not found" }`, with `Cache-Control: no-store`.
- **Rate-limited per address:**
  - After 30 lookups in 10 minutes that led nowhere (unknown codes, missing images), every lookup from that address
    gets `429` with `Retry-After: 600` until the window passes. Looking up a real code doesn't count.
  - Cloudflare's rate-limit binding (30 a minute) is a first line. It counts per Cloudflare location, so it isn't
    relied on.
  - These misses never count towards pausing sign-in.

**Signed in:** `/api/me/workspaces` and `/api/data` (`tenant.organization.branding`) carry the organisation's view.
So do the executive page (`/api/showcase`: `branding`) and the service desk portal (`/api/portal`: `branding`).
Emails carry the organisation's logo, name and accent, with "Powered by Project Management System" in small print.

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
- `GET /api/platform/organizations/:id/branding`, `PUT /api/platform/organizations/:id/branding` (the same body and
  checks as `/api/org/branding`): an organisation's branding. Recorded in the platform activity log.
- `POST /api/platform/organizations/:id/deletion` `{ code }`: deletes an **archived** organisation 30 days later.
  - `code` must be the organisation's code, typed to confirm.
  - Every row it holds is removed then, by the hourly job.
  - `DELETE` on the same address calls it off, and so does reactivating or suspending it.
  - `GET /api/platform/organizations` shows `deleteAfter`.

## Executive page links

The executive page (`/executive/<link>`) shows one workspace's portfolio as totals, with no names, to anyone
holding its link. People who manage users make the links, for the open workspace:

- `GET /api/showcase-links` lists this workspace's links.
- `POST /api/showcase-links` `{ label, days: 7 | 30 | 90 | 365 }` → `{ id, url, expiresAt }`. The `url` is shown
  once; only its hash is kept.
- `DELETE /api/showcase-links/:id` turns a link off.
- `GET /api/showcase` with the header `x-showcase-token: <the link's secret>` returns the totals plus the
  `organization` and `workspace` names. No link, a wrong, expired or revoked one, or a suspended organisation's all
  give the same `404` (`code: "showcase_invalid"`). The old public `/executive` without a link is gone.
