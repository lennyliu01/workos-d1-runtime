-- NONPRODUCTION CANDIDATE ONLY: DO NOT APPLY to production.
-- Separate Lifecycle/PCV/Human approval of Workflow semantic event binding
-- and scoped Shared Runtime D1 terminal-fence CHANGE is mandatory.
-- Does not establish a Human Owner, provider identity, issuer or Publisher.
CREATE TABLE IF NOT EXISTS workos_batch07_owner_terminal_decision (
  scope_key TEXT PRIMARY KEY
    CHECK (scope_key = 'RW_BATCH07_RW_CURRENT_STATE_OWNER_REVIEW_20261014'),
  subject_sha256 TEXT NOT NULL,
  change_spec_sha256 TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('ACCEPT','REJECT')),
  checks_json TEXT NOT NULL,
  provider TEXT NOT NULL,
  actor_provider_id TEXT NOT NULL,
  native_event_id TEXT NOT NULL UNIQUE,
  native_event_digest TEXT NOT NULL,
  native_event_at TEXT NOT NULL,
  issuer_ref TEXT NOT NULL,
  verifier_ref TEXT NOT NULL,
  evidence_anchor_ref TEXT NOT NULL,
  committed_at TEXT NOT NULL
);
-- Privileged DDL remains outside this guard; provider provenance/audit
-- anchoring is an unresolved independent acceptance predicate.
CREATE TRIGGER IF NOT EXISTS workos_batch07_owner_terminal_no_update
BEFORE UPDATE ON workos_batch07_owner_terminal_decision
BEGIN SELECT RAISE(ABORT,'OWNER_TERMINAL_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS workos_batch07_owner_terminal_no_delete
BEFORE DELETE ON workos_batch07_owner_terminal_decision
BEGIN SELECT RAISE(ABORT,'OWNER_TERMINAL_IMMUTABLE'); END;
