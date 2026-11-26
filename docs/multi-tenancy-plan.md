# Multi-tenancy: audit and proposal

Status (2026-11-26): **approved with every recommendation in section 12** (the owner said "continue"). Phases (a)
and (b) are built: (a) is on main, (b) is committed locally, and both are applied to the Neon dev branch only.
Changes from this plan:
- **Tests run on PGlite** (added with the owner's OK), in CI too. The Neon dev branch is optional (`PULSE_DB=dev`).
- **Row-level security is the enforcement, not only a backstop** (section 4.3). With about 710 raw SQL strings, the
  database refusing unscoped access is more dependable than filters added by hand. See DECISIONS.md, phase (b).
- **Phase (a) freezes workspace renames and project moves** until phase (b) ships (see 4.6 and DECISIONS.md).

## 1. Where the brief and the repository differ

| The brief says | The repository has | What I'll do |
| --- | --- | --- |
| The Worker is TypeScript (`worker/index.ts`, `access.ts`) | JavaScript with JSDoc types since 2026-11-25 (DECISIONS.md) | Follow the recorded decision: `.js`, type-checked by `tsc --checkJs` |
| "One shared helper every query goes through (extend the adapter)" | ~710 `db.prepare()` calls written as raw SQL strings across 20 modules, plus SQL fragments built at run time (PQL, reports) | The adapter can't see which tenant a raw string belongs to. Section 4 proposes a scoped handle and RLS as the guarantee |
| Workspaces are an existing concept with ids | Workspaces are **names**: a string list in `settings.workspaces`, and that name is stored in `systems.data` (JSON), `workspace_workflows.workspace`, `boards.workspace`, `custom_fields.workspace`, filter/dashboard `share_value`, and automation `scope_value` | Phase (a) gives them ids and replaces each name with `workspace_id` |
| Today's workspaces are separate | They're **one team's groupings**: everyone sees every workspace; boards, Reports' workspace slicer, the Overview dashboard and `/executive` all span them | Strict isolation removes cross-workspace views. See Q5 |
| — | Statuses, workflows, security levels, notification schemes, request types, SLA targets, holidays, the role matrix and templates are **global**, shared by all workspaces | Section 3 puts them at organisation level, see Q4 |
| — | `/api/showcase` (the `/executive` page) is **public, unauthenticated and publicly cached** for 60 s | It has to become a per-workspace link. See Q7 |
| — | No foreign keys at all in the baseline tables (`systems`, `users`, `documents`, `requests`, `activity` …); only newer tables have them | The migration adds them along with the tenant columns |

## 2. Levels

- **Platform:** organisations, Platform Administrators, platform-wide limits. It holds no project data.
- **Organisation:** people (accounts), sign-in and two-step settings, delivery (email/Teams), roles and permissions, and shared configuration (statuses, workflows, schemes, levels, holidays, templates).
- **Workspace:** all project data, and everything made from it.

Every tenant table gets `organization_id`. Every workspace table also gets `workspace_id`. Both are `NOT NULL`, indexed, and have foreign keys. Child tables get **composite foreign keys** to their parent, for example `(workspace_id, work_item_id) → work_items (workspace_id, id)`. The database then refuses a comment whose workspace differs from its item's, whatever the code does.

## 3. Every table, and how it is scoped

**Platform (no tenant):** `organizations` (new), `platform_admins` (new), `schema_migrations`.
`login_failures` gains `organization_id` (nullable), so the account limit is per organisation and the address limit stays platform-wide. An attacker spraying several organisations from one address is still stopped.

**Organisation (`organization_id`):**

| Table | Notes |
| --- | --- |
| `users` | Username unique per organisation: `UNIQUE (organization_id, lower(username))` replaces the global `users_username`. `users.role` moves to `workspace_members.role`. New `org_admin` 0/1 |
| `workspaces` (new) | id, organization_id, name, key, status, workflow_id (replaces `workspace_workflows`), settings JSON |
| `workspace_members` (new) | workspace_id, user_id, role, joined_at. Composite FK makes sure the user's organisation matches the workspace's |
| `sessions` | + `organization_id`, `workspace_id` (the workspace currently open) |
| `passkeys`, `mfa_challenges`, `mfa_recovery`, `mfa_help_requests`, `password_history`, `password_resets`, `webauthn_challenges` | Follow the user |
| `org_settings` (new) | `role_permissions`, `mfa_policy`, `signin_rules`, `delivery`, `delivery_error` move here from `settings` |
| `integration_secrets` | The email/Teams keys are organisation-level. The GitHub secret moves to workspace level (see below) |
| `work_statuses`, `workflows`, `workflow_statuses`, `workflow_transitions`, `workflow_rules` | Shared by an organisation's workspaces, as today. See Q4 |
| `security_levels`, `security_level_grants`, `notification_schemes`, `notification_optouts`, `public_holidays`, `templates` | Organisation configuration |

**Workspace (`organization_id` + `workspace_id`):**

| Area | Tables |
| --- | --- |
| Projects | `systems` (+ real `workspace_id` column; the JSON `workspace` name is derived from it), `assignments`, `requests`, `blockers`, `documents`, `document_chunks` |
| Work items | `work_items` (and the `features` view), `work_item_labels`, `status_history`, `work_item_comments`, `work_item_watchers`, `work_item_links` (both ends must be in the same workspace), `work_logs` |
| Boards, sprints | `boards`, `board_columns`, `board_column_statuses`, `sprints`, `sprint_items`, `sprint_snapshots` |
| Search, dashboards | `saved_filters`, `filter_favourites`, `filter_subscriptions`, `dashboards`, `dashboard_gadgets` |
| Automation | `automation_rules`, `automation_actions`, `automation_runs` (scope "global" becomes "whole workspace") |
| Custom fields | `custom_fields`, `custom_field_options`, `custom_field_values` (names unique per workspace, as now) |
| Integrations | `api_tokens`, `api_token_usage`, `webhooks`, `webhook_deliveries`, `dev_links`, `github_deliveries`, GitHub's secret |
| Service desk | `service_desk_config` (one per workspace), `request_types`, `request_type_fields`, `request_type_field_options`, `sla_targets`, `portal_links`, `sd_requests`, `sd_answers`, `sd_pauses` |
| Chat | `chat_conversations`, `chat_members`, `chat_messages`, `chat_files`, `chat_file_chunks`, `chat_reactions` (see Q6) |
| Bell and log | `notifications`, `activity` (see Q8), `share_links` |
| Workspace settings (new `workspace_settings`) | `workload_limits`, `latest_briefing` move here from `settings` |

**Unique per tenant** (today these are global):

| Key | Unique within |
| --- | --- |
| `systems.key` | Organisation, as the brief asks. Item keys like INFRA-12 then never collide inside an organisation, so a GitHub commit or a link names exactly one item |
| `boards.workspace` and `boards.system_id` | Workspace |
| `chat_conversations.direct_key` | Workspace or organisation, depending on Q6 |
| `notifications (user_id, dedupe)` | `(workspace_id, user_id, dedupe)` |

## 4. Enforcement

**4.1 Scope resolved once.** `index.js` resolves `{ organizationId, workspaceId }` from whichever identity the request carries, and puts it on `ItemContext` as `scope`:

| Identity | Where the scope comes from |
| --- | --- |
| Session | The session row |
| API token | The token row, bound to one workspace when it's made |
| Share link | The link row |
| Portal link | The link row |
| GitHub | The webhook URL (`/api/integrations/github/webhook/<id>`), verified by that workspace's secret |

Every module receives the scope; no module reads a tenant from the request itself.

**4.2 One helper.** `ctx.db` becomes a **scoped handle**: `tenantDb(rawDb, scope)`. It carries the scope and adds `ctx.t(alias)`, which returns `"<alias>.workspace_id = ? "` with its value, the same way `itemAccess()` works today. Code without a scope (sign-in, the platform screens) gets a different handle that **refuses** queries on tenant tables. A table list in code decides which tables those are, and a unit test keeps it in step with the migrations.

**4.3 Row-level security as the backstop (recommended).** Raw SQL means a missed filter is always possible across ~710 queries, so the database refuses it too:
- Every tenant table gets `ENABLE` and `FORCE ROW LEVEL SECURITY`, with policies on `current_setting('app.org_id', true)` and `current_setting('app.workspace_id', true)`. Organisation-level tables check only the organisation.
- **The Worker must connect as a new role without `BYPASSRLS` and not the owner.** Today it very likely connects as the Neon owner, which skips RLS. You'd create the role and point the Hyperdrive config at it; migrations keep running as the owner.
- **Through Hyperdrive:** it works only inside a transaction. Hyperdrive pools by transaction and resets a connection when it goes back to the pool, so a session-level `SET` doesn't survive, while `SET LOCAL` / `set_config(…, true)` inside BEGIN…COMMIT does ([Hyperdrive: how it works](https://developers.cloudflare.com/hyperdrive/concepts/how-hyperdrive-works/), [connection lifecycle](https://developers.cloudflare.com/hyperdrive/concepts/connection-lifecycle/)). The docs also advise keeping such transactions short, because each one holds a pooled connection.
- **Two ways to give every query its transaction:**

  | Option | What it costs |
  | --- | --- |
  | **A. Per statement** (recommended to try first) | The adapter runs each query as BEGIN → `set_config` → query → COMMIT, pipelined by postgres.js. Error behaviour stays the same as today. The cost is extra round trips per query, which I'll measure on the dev branch before committing to it |
  | **B. Per request** | One transaction for the whole request. Fewer round trips, but it holds a connection during Workers AI calls (Ask Pulse) and email/Teams sends. A failed statement aborts everything after it, and about a dozen places catch a database error and carry on (the activity-log write, PQL runs, gadgets). Each of those would need a savepoint |

- If the measured cost is too high, I'll report the numbers and we decide. RLS is defence in depth; 4.2 still does the filtering.

**4.4 Ids from the client.** Every lookup by id or key (project, item, board, sprint, filter, dashboard, gadget, rule, webhook, token, conversation, document, status, workflow) also matches the scope. A miss is **404**, the same as a missing row. Several endpoints answer 403 today on someone else's object (for example "Only the owner can change…"); those stay 403 only *inside* a workspace.

**4.5 Background work.** It gets an explicit scope and loops over `organizations (status = active) × workspaces (status = active)`, setting the scope for each. That covers digests, the Monday Briefing, subscriptions, scheduled rules, SLA checks and webhook retries. Retention deletes by age across everyone, so it runs as a separate maintenance role allowed to bypass RLS, and only for deletes.

**4.6 Phase (a) must be releasable before (b).** Old code doesn't set `workspace_id`, so phase (a) adds **insert triggers** that fill `organization_id` and `workspace_id` from the parent: `system_id → systems`, `work_item_id → work_items`, and so on. Rows with no parent go to Omnicontact's default workspace. In phase (b) the code sets the columns itself, and the triggers become a consistency check that raises when the values don't match the parent.

## 5. Endpoints

| Group | Today | Scoped how |
| --- | --- | --- |
| Before sign-in: `/api/login*`, `/api/password/*`, `/api/manifest` | Global user lookup | The organisation code is part of the body. Unknown organisation = same 401, dummy hash, same timing |
| `/api/showcase` (public `/executive`) | **Public**, every project, cached publicly | A per-workspace link token, `cache-control: private` (Q7) |
| `/api/integrations/github/webhook` | One global secret | One URL and secret per workspace; GitHub needs the new URL |
| `/api/portal/*` | Portal link → global | Link → its workspace |
| `/api/data` | Everything | Current workspace; users = its members |
| `/api/systems*`, `/api/requests*`, `/api/blockers*`, `/api/documents*`, PCNs, templates | By id | Scope + id, 404 |
| `/api/items*`, transitions, comments, links, attachments, worklogs, watch | By key | Key within the organisation and workspace |
| `/api/boards*`, `/api/backlog*`, `/api/sprints*`, `/api/timeline` | By id or workspace name | Workspace from scope; the `workspace=` parameter goes |
| `/api/search*`, `/api/filters*`, `/api/dashboards*`, `/api/ask*`, `/api/ask/pql` | PQL compiled with `itemAccess` | `itemAccess` also adds the scope, so every PQL, gadget and CSV inherits it. Ask Pulse's prompt only lists this workspace's keys, statuses and people |
| `/api/automation/*`, `/api/custom-fields*`, `/api/notification-schemes`, `/api/security-levels*`, `/api/workflows*`, `/api/statuses*` | Global | Workspace or organisation per section 3 |
| `/api/service-desk/*` | Global config | Workspace |
| `/api/chat*` | Global | Q6 |
| `/api/reports/*` (projects, agile, export.xlsx) | Global with visibility | Scope |
| `/api/tokens*`, `/api/webhooks*`, `/api/share-links*` | Global | Workspace; administrators list only their workspace's |
| `/api/users*`, `/api/settings/*`, `/api/activity*`, `/api/me/*` | Global admin | Users, roles, sign-in, two-step and delivery: Organisation Administrator. Workspace settings: workspace Admin role |
| **New** `/api/me/workspaces`, `POST /api/me/workspace` (switch), `/api/platform/*`, `/api/org/*` | — | Switching checks `workspace_members` on the server, every time |

## 6. Background jobs

| Job | Change |
| --- | --- |
| Daily digests | Per workspace, to its members (Q9) |
| Monday Briefing | Per workspace. `latest_briefing` per workspace |
| Filter subscriptions | Run in the filter's workspace, as the subscriber |
| Scheduled automation, SLA checks | Per workspace |
| Webhook retries | Each delivery carries its workspace |
| Retention | Platform-wide by age (maintenance role) |
| Event automation (`runEvent`) and `raise()` notifications | Carry the scope of the request that set them off |
| Email/Teams | The organisation's delivery settings |

## 7. Front end

- **Sign-in** (`Login.jsx`), see section 8. **Switcher** in the top bar replaces `WorkspaceBar`. Switching reloads `/api/data` and clears every open page.
- **Workspace pickers removed** (the workspace is implicit):
  - Projects page filter, and the workspace field in `AddSystemModal`
  - Boards page workspace choice and `BoardView`/`TimelineView`
  - Reports Overview slicer (`BiDashboard`), `ReportsPage` filter, `FeatureInsights` and `AgileReports` workspace options
  - Custom fields' workspace selector, `WorkflowsSettings` ("this workspace uses …")
  - Automation scope "a workspace", filter and dashboard sharing "with a workspace" (becomes "everyone in this workspace")
- **New screens:** Platform (organisations: create, rename, suspend, archive, first administrator) and Organisation (workspaces, members and their role per workspace, plus the organisation settings that exist today).
- **Browser storage:** keys such as `omnitrack:workspace`, the last dashboard, the Reports tab and drafts get the organisation and workspace in their name, and are cleared at sign-out. A shared computer then can't show one tenant's leftovers to the next.

## 8. Sign-in flow

| Option | How it works | Trade-off |
| --- | --- | --- |
| **1. Organisation code, then account, then workspace (recommended)** | Type the organisation code (or arrive at `#/o/omnicontact`, remembered on the device) → username and password → two-step → choose among *your* workspaces (skipped when you have one) | Nothing about an organisation is shown before sign-in. A wrong code looks exactly like a wrong password |
| 2. As the brief orders it: organisation → workspace → sign in | Workspace list shown after the code | Anyone who knows or guesses a code sees that organisation's workspace names, and learns the code is real. Conflicts with "reveal nothing before sign-in" |
| 3. Subdomain per organisation | `omnicontact.pulse.example` | Needs a custom domain on Cloudflare. `*.workers.dev` can't do per-tenant subdomains. Can be added later on top of option 1 |

Under option 1, the "workspace" step becomes "choose which of your workspaces to open". It's shown only after the password and two-step have been checked.

## 9. Migration of existing data

1. **`00xx_tenancy_dry_run`**, a read-only script (`scripts/tenancy-dry-run.mjs`), not a migration. It prints rows per table per target workspace, and every row it can't place, with the reason.
2. **`0013_tenancy_schema.sql`** creates the new tables and Omnicontact. It turns each name in `settings.workspaces` into a `workspaces` row, plus "Projects" if missing. It adds the columns, backfills them, adds the indexes, foreign keys and insert triggers, then sets `NOT NULL`.
   - **Placement:** a project goes to its JSON workspace; children follow their parent. Unknown or empty names go to Projects, and each one is reported.
   - **Membership:** every existing user joins **every** existing workspace with their current role, so nobody loses access on day one. Existing Admins become Organisation Administrators.
   - **Sessions** get Omnicontact and their user's first workspace, so nobody is signed out.
   - **Share links, portal links and API tokens:**

     | Item | Workspace |
     | --- | --- |
     | API tokens | The owner's first workspace |
     | Share links | Projects |
     | Portal links | The service desk project's workspace |

     Each one is reported, because what a link or token shows narrows.
3. **`0014_tenancy_settings.sql`** splits `settings`.
4. **`0015_tenancy_rls.sql`** adds the policies and the app role. It goes in last, separately, after measuring.
5. Each migration has a `.down.sql` beside it, run by hand.
6. **Order:** dev branch → a **new Neon branch made from `production`** (a copy, never `PG_MAIN`), running the dry run and the migration there and comparing → you take `npm run db:backup` and a `backup-before-tenancy` branch → you apply to live, then push.

## 10. Tests

- **Today:** 117 Vitest tests, all of them pure functions; none touches a database. CI runs `npm test` before deploy and has no database.
- **Proposed:** run the Worker's real `fetch()` against **PGlite** (Postgres compiled to WebAssembly, in-process, supports RLS) with every migration applied. That gives real SQL and real policies, in CI, with no secrets and no network, and adds one dev dependency (`@electric-sql/pglite`). The alternative is the Neon dev branch, which would need its connection string as a CI secret and network access from CI.
- **Fixtures:** two organisations × two workspaces, each with projects, items, comments, boards, sprints, filters, dashboards, rules, chat, tokens, share links and a portal link.
- **Cases:**
  - For every endpoint group, a user in A1 reading, counting, searching, exporting, asking about or changing anything in A2/B1/B2 gets 404 or an empty result
  - Notifications are never raised across workspaces
  - Switching without membership → refused
  - Token and share link confined to their workspace
  - An RLS-only test with the app filter removed shows the database still refuses

## 11. Phases

| Phase | Contents | Releasable alone because |
| --- | --- | --- |
| a | Schema, migration, dry run, triggers | Triggers fill the columns for the old code |
| b | Scoped handle, every module, 404s, tests, RLS (after measuring) | Sessions already carry a workspace |
| c | Sign-in with organisation code, workspace choice, switcher | — |
| d | Platform and Organisation admin screens | — |
| e | Background jobs, digests, webhooks, GitHub per workspace, docs, Postman, admin guide | — |

**Size:** this touches nearly every Worker module and about 20 components. Phase (b) alone means reviewing all ~710 queries. Expect several sessions, with a report and your go-ahead after each phase.

## 12. Decisions needed before starting

1. **Sign-in flow:** option 1 (organisation code → account → your workspaces), as recommended, or the brief's order?
2. **RLS:** add it (recommended), knowing it needs a new database role and a Hyperdrive config change on your side, with the decision on per-statement vs per-request transactions taken after I measure on dev?
3. **Tests on PGlite** (one new dev dependency), or against the Neon dev branch from CI?
4. **Configuration level:** statuses, workflows, security levels, notification schemes, holidays and templates shared per **organisation** (recommended: closest to today, and much simpler to migrate), or copied per workspace?
5. **Cross-workspace views:** today managers see Projects and HR together (Reports slicer, workspace boards, the dashboard). Under strict isolation they switch workspaces instead. Is that right, or should Organisation Administrators get a read-only roll-up across their workspaces? I recommend none for now.
6. **Chat:** direct messages and groups per **workspace** (strict, recommended), or per organisation? Project channels are per workspace either way.
7. **`/executive`:** turn it into a per-workspace secret link (recommended), or drop it?
8. **Activity log:** organisation-level events (sign-ins, users, organisation settings) need a home. Allow `activity.workspace_id` to be empty for those, readable only by Organisation Administrators (recommended), or a separate `org_activity` table?
9. **Digests and the Monday Briefing** for someone in two workspaces: one per workspace (recommended), or one combined?
10. **Moving a project to another workspace** (allowed today): forbid it under tenancy (recommended for now), or keep it as an Organisation Administrator action that moves everything?
11. **Platform Administrators:** separate accounts with no organisation, signing in at their own page, with two-step required, that can manage organisations but **not open their data** (recommended)?
12. **Roles:** the existing Admin role becomes the **workspace** admin (workflows, schemes, automation, integrations in that workspace). Organisation Administrator is a separate flag for people, workspaces, sign-in, two-step and delivery. Agreed?
