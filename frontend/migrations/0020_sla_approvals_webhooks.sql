-- Administrator module, phase 4: SLAs for work items, approvals on workflow moves, and webhook payload templates.
--   1. sla_policies: per workspace, targets for the first response and for resolution, counted in the organisation's
--      working hours, for some item types and priorities (or all). item_sla_events records each warning and breach
--      once, so people are told once.
--   2. approvals and approval_votes: a move with an "approval" rule doesn't happen at once; the item waits for a named
--      person, anyone with a role, or N of M people to approve it. A rejection needs a reason.
--   3. Automation triggers: an SLA is about to be breached, or has been; an approval is granted or rejected.
--   4. webhooks.payload_template: an outgoing webhook can send its own JSON, with smart values.
-- Reverse: migrations/down/0020_sla_approvals_webhooks.down.sql.

-- 1. SLAs.
CREATE TABLE sla_policies (
  organization_id        TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  workspace_id           TEXT NOT NULL DEFAULT NULLIF(current_setting('app.workspace_id', true), ''),
  id                     TEXT NOT NULL,
  name                   TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  item_types             TEXT,              -- JSON list of item type ids; NULL: every type
  priorities             TEXT,              -- JSON list (HIGHEST …); NULL: every priority
  first_response_minutes INTEGER CHECK (first_response_minutes IS NULL OR first_response_minutes > 0),
  resolution_minutes     INTEGER CHECK (resolution_minutes IS NULL OR resolution_minutes > 0),
  warn_percent           INTEGER NOT NULL DEFAULT 80 CHECK (warn_percent BETWEEN 10 AND 99),
  position               INTEGER NOT NULL DEFAULT 0,
  active                 INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CHECK (first_response_minutes IS NOT NULL OR resolution_minutes IS NOT NULL),
  CONSTRAINT sla_policies_ws FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces (organization_id, id) ON DELETE CASCADE
);
CREATE TABLE item_sla_events (
  organization_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  workspace_id    TEXT NOT NULL DEFAULT NULLIF(current_setting('app.workspace_id', true), ''),
  item_id         TEXT NOT NULL,
  target          TEXT NOT NULL CHECK (target IN ('response', 'resolution')),
  event           TEXT NOT NULL CHECK (event IN ('warning', 'breached')),
  at              TEXT NOT NULL,
  PRIMARY KEY (workspace_id, item_id, target, event),
  CONSTRAINT item_sla_events_item FOREIGN KEY (workspace_id, item_id) REFERENCES work_items (workspace_id, id) ON DELETE CASCADE
);

-- 2. Approvals.
CREATE TABLE approvals (
  organization_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  workspace_id    TEXT NOT NULL DEFAULT NULLIF(current_setting('app.workspace_id', true), ''),
  id              TEXT NOT NULL,
  item_id         TEXT NOT NULL,
  transition_id   TEXT NOT NULL,
  transition_name TEXT NOT NULL,
  from_status     TEXT NOT NULL,
  to_status       TEXT NOT NULL,
  comment         TEXT NOT NULL DEFAULT '',    -- what the requester wrote with the move
  fields          TEXT NOT NULL DEFAULT '{}',  -- JSON: what the requester filled in with the move
  approvers       TEXT NOT NULL,               -- JSON list of user ids who may decide
  needed          INTEGER NOT NULL CHECK (needed >= 1),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by    TEXT NOT NULL,
  requested_at    TEXT NOT NULL,
  decided_at      TEXT,
  reason          TEXT,                        -- a rejection's reason
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT approvals_item FOREIGN KEY (workspace_id, item_id) REFERENCES work_items (workspace_id, id) ON DELETE CASCADE
);
-- One open approval per item.
CREATE UNIQUE INDEX approvals_one_pending ON approvals (workspace_id, item_id) WHERE status = 'pending';
CREATE INDEX approvals_item ON approvals (workspace_id, item_id, requested_at);
CREATE TABLE approval_votes (
  organization_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  workspace_id    TEXT NOT NULL DEFAULT NULLIF(current_setting('app.workspace_id', true), ''),
  approval_id     TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  decision        TEXT NOT NULL CHECK (decision IN ('approve', 'reject')),
  comment         TEXT NOT NULL DEFAULT '',
  at              TEXT NOT NULL,
  PRIMARY KEY (workspace_id, approval_id, user_id),
  CONSTRAINT approval_votes_approval FOREIGN KEY (workspace_id, approval_id) REFERENCES approvals (workspace_id, id) ON DELETE CASCADE
);
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sla_policies', 'item_sla_events', 'approvals', 'approval_votes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON %I TO pulse_app USING (workspace_id = current_setting(''app.workspace_id'', true))
      WITH CHECK (workspace_id = current_setting(''app.workspace_id'', true) AND organization_id = current_setting(''app.org_id'', true))', t);
  END LOOP;
END $$;
-- A decision, once made, isn't changed.
REVOKE UPDATE, DELETE ON approval_votes FROM pulse_app;

-- 3. Automation triggers.
ALTER TABLE automation_rules DROP CONSTRAINT automation_rules_trigger_check;
ALTER TABLE automation_rules ADD CONSTRAINT automation_rules_trigger_check CHECK (trigger IN (
  'item_created', 'item_transitioned', 'field_changed', 'comment_added', 'subtasks_done', 'sprint_started', 'sprint_completed', 'schedule',
  'item_assigned', 'due_soon', 'due_passed', 'webhook', 'manual', 'sla_warning', 'sla_breached', 'approval_granted', 'approval_rejected'));

-- 4. Webhook payload templates.
ALTER TABLE webhooks ADD COLUMN payload_template TEXT CHECK (payload_template IS NULL OR length(payload_template) <= 8000);
