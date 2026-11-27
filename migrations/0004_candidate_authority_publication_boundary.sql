-- CANDIDATE ONLY. No production seed, Grant issuance or selector change.
-- Tuple JSON is the fixed Authority_Publication A:H array, epoch an integer.
CREATE TABLE authority_boundary_seed (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  tuple_json TEXT NOT NULL CHECK (json_valid(tuple_json) AND json_type(tuple_json)='array' AND json_array_length(tuple_json)=8 AND json_type(tuple_json,'$[2]')='integer' AND json_type(tuple_json,'$[0]')='text' AND length(json_extract(tuple_json,'$[0]'))>0 AND json_type(tuple_json,'$[1]')='text' AND length(json_extract(tuple_json,'$[1]'))>0 AND json_type(tuple_json,'$[3]')='text' AND length(json_extract(tuple_json,'$[3]'))>0 AND json_type(tuple_json,'$[4]')='text' AND length(json_extract(tuple_json,'$[4]'))>0 AND json_type(tuple_json,'$[5]')='text' AND length(json_extract(tuple_json,'$[5]'))>0 AND json_type(tuple_json,'$[6]')='text' AND length(json_extract(tuple_json,'$[6]'))>0 AND json_type(tuple_json,'$[7]')='text' AND length(json_extract(tuple_json,'$[7]'))>0 AND json_extract(tuple_json,'$[2]')>=0),
  dependencies_json TEXT NOT NULL CHECK (json_valid(dependencies_json) AND json_type(dependencies_json)='object')
);
CREATE TABLE authority_boundary_grant (
  grant_id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  publisher TEXT NOT NULL,
  session_id TEXT NOT NULL UNIQUE,
  revoker TEXT NOT NULL,
  expected_tuple TEXT NOT NULL CHECK (json_valid(expected_tuple) AND json_type(expected_tuple)='array' AND json_array_length(expected_tuple)=8 AND json_type(expected_tuple,'$[2]')='integer' AND json_type(expected_tuple,'$[0]')='text' AND length(json_extract(expected_tuple,'$[0]'))>0 AND json_type(expected_tuple,'$[1]')='text' AND length(json_extract(expected_tuple,'$[1]'))>0 AND json_type(expected_tuple,'$[3]')='text' AND length(json_extract(expected_tuple,'$[3]'))>0 AND json_type(expected_tuple,'$[4]')='text' AND length(json_extract(expected_tuple,'$[4]'))>0 AND json_type(expected_tuple,'$[5]')='text' AND length(json_extract(expected_tuple,'$[5]'))>0 AND json_type(expected_tuple,'$[6]')='text' AND length(json_extract(expected_tuple,'$[6]'))>0 AND json_type(expected_tuple,'$[7]')='text' AND length(json_extract(expected_tuple,'$[7]'))>0),
  target_tuple TEXT NOT NULL CHECK (json_valid(target_tuple) AND json_type(target_tuple)='array' AND json_array_length(target_tuple)=8 AND json_type(target_tuple,'$[2]')='integer' AND json_type(target_tuple,'$[0]')='text' AND length(json_extract(target_tuple,'$[0]'))>0 AND json_type(target_tuple,'$[1]')='text' AND length(json_extract(target_tuple,'$[1]'))>0 AND json_type(target_tuple,'$[3]')='text' AND length(json_extract(target_tuple,'$[3]'))>0 AND json_type(target_tuple,'$[4]')='text' AND length(json_extract(target_tuple,'$[4]'))>0 AND json_type(target_tuple,'$[5]')='text' AND length(json_extract(target_tuple,'$[5]'))>0 AND json_type(target_tuple,'$[6]')='text' AND length(json_extract(target_tuple,'$[6]'))>0 AND json_type(target_tuple,'$[7]')='text' AND length(json_extract(target_tuple,'$[7]'))>0),
  expected_dependencies TEXT NOT NULL CHECK (json_valid(expected_dependencies) AND json_type(expected_dependencies)='object'),
  target_dependencies TEXT NOT NULL CHECK (json_valid(target_dependencies) AND json_type(target_dependencies)='object'),
  frozen_identity TEXT NOT NULL CHECK (json_valid(frozen_identity) AND json_type(frozen_identity)='object'),
  change_spec_id TEXT NOT NULL CHECK (length(change_spec_id)>0),
  pcv_id TEXT NOT NULL CHECK (length(pcv_id)>0),
  faa2_id TEXT NOT NULL CHECK (length(faa2_id)>0),
  expires_unix INTEGER NOT NULL,
  CHECK (json_extract(target_tuple,'$[0]')=json_extract(expected_tuple,'$[0]')),
  CHECK (json_extract(target_tuple,'$[2]')=json_extract(expected_tuple,'$[2]')+1)
);
CREATE VIEW authority_boundary_grant_envelope AS
SELECT g.*, json_array(grant_id,request_id,publisher,session_id,expected_tuple,target_tuple,expected_dependencies,target_dependencies,frozen_identity,change_spec_id,pcv_id,faa2_id) AS envelope
FROM authority_boundary_grant g;
-- Durable one-shot dispatch claim. If its response is lost, do not send a new commit.
-- A claim alone does not consume the Grant or prove terminal failure.
CREATE TABLE authority_boundary_started (
  request_id TEXT PRIMARY KEY NOT NULL,
  grant_id TEXT NOT NULL UNIQUE REFERENCES authority_boundary_grant(grant_id),
  envelope TEXT NOT NULL,
  actor TEXT NOT NULL,
  session_id TEXT NOT NULL,
  frozen_identity TEXT NOT NULL
);
-- One terminal row is the consumption and receipt. A canceled Grant cannot commit.
CREATE TABLE authority_boundary_terminal (
  request_id TEXT PRIMARY KEY NOT NULL,
  grant_id TEXT NOT NULL UNIQUE REFERENCES authority_boundary_grant(grant_id),
  envelope TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('COMMITTED','CANCELED')),
  epoch INTEGER UNIQUE,
  actor TEXT NOT NULL,
  session_id TEXT NOT NULL,
  frozen_identity TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((outcome='COMMITTED' AND epoch IS NOT NULL) OR (outcome='CANCELED' AND epoch IS NULL))
);
CREATE VIEW authority_boundary_current AS
SELECT tuple_json,dependencies_json,epoch FROM (
  SELECT tuple_json,dependencies_json,CAST(json_extract(tuple_json,'$[2]') AS INTEGER) AS epoch FROM authority_boundary_seed
  UNION ALL
  SELECT g.target_tuple,g.target_dependencies,t.epoch FROM authority_boundary_terminal t JOIN authority_boundary_grant g ON g.grant_id=t.grant_id WHERE t.outcome='COMMITTED'
) ORDER BY epoch DESC LIMIT 1;
CREATE TRIGGER authority_boundary_started_guard BEFORE INSERT ON authority_boundary_started BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM authority_boundary_grant_envelope g
    WHERE g.grant_id=NEW.grant_id AND g.request_id=NEW.request_id AND g.envelope=NEW.envelope
      AND NEW.actor=g.publisher AND NEW.session_id=g.session_id AND NEW.frozen_identity=g.frozen_identity
      AND g.expires_unix>CAST(strftime('%s','now') AS INTEGER)
      AND NOT EXISTS (SELECT 1 FROM authority_boundary_terminal t WHERE t.grant_id=g.grant_id)
  ) THEN RAISE(ABORT,'AUTHORITY_DISPATCH_REJECTED') END;
END;
CREATE TRIGGER authority_boundary_terminal_guard BEFORE INSERT ON authority_boundary_terminal BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM authority_boundary_grant_envelope g
    WHERE g.grant_id=NEW.grant_id AND g.request_id=NEW.request_id AND g.envelope=NEW.envelope
      AND ((NEW.outcome='CANCELED' AND NEW.actor=g.revoker AND NEW.session_id=g.session_id AND NEW.frozen_identity=g.frozen_identity AND NEW.epoch IS NULL)
       OR (NEW.outcome='COMMITTED' AND NEW.actor=g.publisher AND NEW.session_id=g.session_id AND NEW.frozen_identity=g.frozen_identity
           AND g.expires_unix>CAST(strftime('%s','now') AS INTEGER)
           AND EXISTS (SELECT 1 FROM authority_boundary_started s WHERE s.grant_id=g.grant_id AND s.request_id=g.request_id AND s.envelope=g.envelope AND s.actor=g.publisher AND s.session_id=g.session_id AND s.frozen_identity=g.frozen_identity)
           AND NEW.epoch=json_extract(g.target_tuple,'$[2]')
           AND EXISTS (SELECT 1 FROM authority_boundary_current c WHERE c.tuple_json=g.expected_tuple AND c.dependencies_json=g.expected_dependencies AND NEW.epoch=c.epoch+1)))
  ) THEN RAISE(ABORT,'AUTHORITY_BOUNDARY_REJECTED') END;
END;
CREATE TRIGGER authority_seed_no_update BEFORE UPDATE ON authority_boundary_seed BEGIN SELECT RAISE(ABORT,'IMMUTABLE'); END;
CREATE TRIGGER authority_seed_no_delete BEFORE DELETE ON authority_boundary_seed BEGIN SELECT RAISE(ABORT,'IMMUTABLE'); END;
CREATE TRIGGER authority_grant_no_update BEFORE UPDATE ON authority_boundary_grant BEGIN SELECT RAISE(ABORT,'IMMUTABLE'); END;
CREATE TRIGGER authority_grant_no_delete BEFORE DELETE ON authority_boundary_grant BEGIN SELECT RAISE(ABORT,'IMMUTABLE'); END;
CREATE TRIGGER authority_terminal_no_update BEFORE UPDATE ON authority_boundary_terminal BEGIN SELECT RAISE(ABORT,'IMMUTABLE'); END;
CREATE TRIGGER authority_terminal_no_delete BEFORE DELETE ON authority_boundary_terminal BEGIN SELECT RAISE(ABORT,'IMMUTABLE'); END;
CREATE TRIGGER authority_started_no_update BEFORE UPDATE ON authority_boundary_started BEGIN SELECT RAISE(ABORT,'IMMUTABLE'); END;
CREATE TRIGGER authority_started_no_delete BEFORE DELETE ON authority_boundary_started BEGIN SELECT RAISE(ABORT,'IMMUTABLE'); END;
