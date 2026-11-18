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
| 404 | Not found, or not visible to the token's owner |
| 429 | Over the rate limit |

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
The setup steps are in **Settings → Administration → Integrations**.
