-- CANDIDATE ONLY: enforcement projection, not a second Authority or a session issuer.
-- Existing authority tuple and business schemas remain untouched.
CREATE TABLE authority_boundary_admission_session (
  session_id TEXT PRIMARY KEY NOT NULL,
  principal TEXT NOT NULL,
  tuple_json TEXT NOT NULL CHECK(json_valid(tuple_json) AND json_type(tuple_json)='array' AND json_array_length(tuple_json)=8),
  dependencies_json TEXT NOT NULL CHECK(json_valid(dependencies_json) AND json_type(dependencies_json)='object'),
  expires_unix INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('OPEN','CLOSED'))
);
CREATE TRIGGER authority_admission_no_reopen BEFORE UPDATE ON authority_boundary_admission_session
WHEN OLD.state!='OPEN' OR NEW.state!='CLOSED' OR
  NEW.session_id!=OLD.session_id OR NEW.principal!=OLD.principal OR
  NEW.tuple_json!=OLD.tuple_json OR NEW.dependencies_json!=OLD.dependencies_json OR NEW.expires_unix!=OLD.expires_unix
BEGIN SELECT RAISE(ABORT,'ADMISSION_SESSION_IMMUTABLE'); END;
CREATE TRIGGER authority_admission_no_delete BEFORE DELETE ON authority_boundary_admission_session
BEGIN SELECT RAISE(ABORT,'ADMISSION_SESSION_IMMUTABLE'); END;
CREATE TRIGGER authority_admission_open_guard BEFORE INSERT ON authority_boundary_admission_session
WHEN NEW.state!='OPEN' OR NEW.expires_unix<=CAST(strftime('%s','now') AS INTEGER) OR
 NOT EXISTS(SELECT 1 FROM authority_boundary_current c WHERE c.tuple_json=NEW.tuple_json AND c.dependencies_json=NEW.dependencies_json)
BEGIN SELECT RAISE(ABORT,'ADMISSION_SESSION_INVALID'); END;
