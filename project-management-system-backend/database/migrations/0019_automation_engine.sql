-- Administrator module, phase 3: the automation engine.
--   1. More triggers: an item is assigned; its due date is near or has passed; a webhook arrives; someone presses
--      the rule's button on an item; schedules every day, week or month at a time, in the organisation's time zone.
--      (SLA and approval triggers come with phase 4.)
--   2. Conditions built from AND/OR groups (automation_rules.conditions, JSON), beside the PQL condition.
--   3. More actions: add a label, clear a field, create an item (here or in another workspace), email, WhatsApp/SMS
--      (through a provider adapter), call a webhook (signed), escalate.
--   4. Rules shared across workspaces: an organisation rule is a copy in each workspace it covers, sharing an id.
--   5. A job ledger (automation_jobs) for retries with back-off, and automation_fired so time-based triggers fire
--      once per item.
-- Reverse: migrations/down/0019_automation_engine.down.sql.

-- 1. Triggers.
ALTER TABLE automation_rules DROP CONSTRAINT automation_rules_trigger_check;
ALTER TABLE automation_rules ADD CONSTRAINT automation_rules_trigger_check CHECK (trigger IN (
  'item_created', 'item_transitioned', 'field_changed', 'comment_added', 'subtasks_done', 'sprint_started', 'sprint_completed', 'schedule',
  'item_assigned', 'due_soon', 'due_passed', 'webhook', 'manual'));
ALTER TABLE automation_rules
  ADD COLUMN trigger_config     TEXT,               -- JSON: due_soon { hours }, schedule { every, weekday, day, time }
  ADD COLUMN webhook_token_hash TEXT UNIQUE,        -- webhook: the secret in its address, as a hash
  ADD COLUMN conditions         TEXT,               -- 2. JSON: { op: "and" | "or", items: [condition | group] }; NULL: none
  ADD COLUMN owner_id           TEXT,               -- told when the rule keeps failing; NULL: its maker
  ADD COLUMN rr_cursor          INTEGER NOT NULL DEFAULT 0, -- round-robin assignment: whose turn it is
  ADD COLUMN shared_id          TEXT,               -- 4. an organisation rule: its copies share this
  ADD COLUMN shared_scope       TEXT CHECK (shared_scope IN ('organization', 'workspaces')),
  ADD COLUMN failure_alerted_at TEXT;
CREATE INDEX automation_rules_shared ON automation_rules (organization_id, shared_id) WHERE shared_id IS NOT NULL;

-- 3. Actions.
ALTER TABLE automation_actions DROP CONSTRAINT automation_actions_kind_check;
ALTER TABLE automation_actions ADD CONSTRAINT automation_actions_kind_check CHECK (kind IN (
  'transition', 'assign', 'set_field', 'comment', 'notify', 'create_subtask', 'link',
  'add_label', 'clear_field', 'create_item', 'email', 'message', 'webhook', 'escalate'));
ALTER TABLE automation_actions ADD COLUMN secret_sealed TEXT;  -- webhook: its signing secret, sealed with MFA_KEY

-- What each run decided and did, for the run log.
ALTER TABLE automation_runs ADD COLUMN detail TEXT;            -- JSON: { conditions: [...], actions: [...] }

-- 5. The job ledger. A job is one rule on one item (or on its matches, for bulk triggers), tried until it works,
--    backing off 1, 2, 4, 8 minutes between tries; after the last it's failed and its owner is told.
CREATE TABLE automation_jobs (
  id              BIGSERIAL PRIMARY KEY,
  organization_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  workspace_id    TEXT NOT NULL DEFAULT NULLIF(current_setting('app.workspace_id', true), ''),
  rule_id         TEXT NOT NULL,
  item_id         TEXT,
  trigger_event   TEXT NOT NULL,
  depth           INTEGER NOT NULL DEFAULT 0,
  idem_key        TEXT NOT NULL,                  -- the same work is queued once
  status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'waiting', 'done', 'failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  run_after       TEXT NOT NULL,
  last_error      TEXT,
  created_at      TEXT NOT NULL,
  CONSTRAINT automation_jobs_ws FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces (organization_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX automation_jobs_once ON automation_jobs (workspace_id, idem_key);
CREATE INDEX automation_jobs_due ON automation_jobs (workspace_id, status, run_after);
-- Time-based triggers fire once per item and occasion (a due date, a day's schedule).
CREATE TABLE automation_fired (
  organization_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  workspace_id    TEXT NOT NULL DEFAULT NULLIF(current_setting('app.workspace_id', true), ''),
  rule_id         TEXT NOT NULL,
  item_id         TEXT NOT NULL DEFAULT '',
  occasion        TEXT NOT NULL,
  at              TEXT NOT NULL,
  PRIMARY KEY (workspace_id, rule_id, item_id, occasion),
  CONSTRAINT automation_fired_ws FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces (organization_id, id) ON DELETE CASCADE
);
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['automation_jobs', 'automation_fired'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON %I TO pulse_app USING (workspace_id = current_setting(''app.workspace_id'', true))
      WITH CHECK (workspace_id = current_setting(''app.workspace_id'', true) AND organization_id = current_setting(''app.org_id'', true))', t);
  END LOOP;
END $$;
GRANT USAGE, SELECT ON SEQUENCE automation_jobs_id_seq TO pulse_app;
