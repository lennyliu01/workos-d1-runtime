-- NONPRODUCTION CANDIDATE ONLY. NO SEED, NO ACTIVATION, NO READER SWITCH.
-- Authority Pointer is a single CURRENT row; this schema is not production authority.
-- The committed bundle is an opaque immutable, exact-byte projection of owner-approved refs.
CREATE TABLE workos_authority_pointer_candidate (
  selector_key TEXT NOT NULL PRIMARY KEY CHECK (selector_key = 'CURRENT'),
  epoch INTEGER NOT NULL CHECK (epoch >= 0),
  previous_epoch INTEGER NOT NULL CHECK (previous_epoch >= -1),
  source_fingerprint TEXT NOT NULL CHECK (length(source_fingerprint) = 64),
  bundle_fingerprint TEXT NOT NULL CHECK (length(bundle_fingerprint) = 64),
  bundle_json TEXT NOT NULL,
  publication_id TEXT NOT NULL,
  publisher_invocation_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status = 'COMMITTED'),
  committed_at TEXT NOT NULL,
  CHECK (previous_epoch < epoch)
);
