/**
 * Additive D1 migration ONLY. Do not apply to production until the exact
 * Batch07 publication, schema and deployment gates have been accepted.
 *
 * The unique scoped identity is per WorkOS published authority/manifest and
 * target DRAFT instance. This is a durable CONSUMPTION ledger, never an issuer.
 * Issuance remains solely with the governed WorkOS Publisher.
 */
CREATE TABLE IF NOT EXISTS workos_initial_baseline_consumptions (
  authority_scope_fingerprint TEXT NOT NULL,
  activation_epoch TEXT NOT NULL,
  manifest_id TEXT NOT NULL,
  dataset_id TEXT NOT NULL CHECK(dataset_id='RW_CURRENT_STATE'),
  instance_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
  invocation_id TEXT NOT NULL,
  db_consumed_at TEXT NOT NULL,
  PRIMARY KEY (
    authority_scope_fingerprint, activation_epoch, manifest_id,
    dataset_id, instance_id
  ),
  UNIQUE (idempotency_key),
  UNIQUE (invocation_id)
);
