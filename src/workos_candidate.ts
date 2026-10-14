import { GoogleExactControlPlaneReader, loadControlPlane, type LoadedControlPlane } from "./workos_control_plane_loader.js";
import { authorizePersistence } from "./workos_persistent_gate_projection.js";
type ExecutionSurface = "CHAT" | "WORK";
type TriggerMode = "HUMAN" | "SCHEDULE";
type TaskId = "US_JAPAN_FX_POLICY" | "ROLLING_WEDGE_INVESTMENT";
type WriteMode = "APPEND_ONLY" | "CURRENT_STATE";

interface D1RunResult {
  success: boolean;
  meta?: { changes?: number };
}

interface D1AllResult<T> {
  success: boolean;
  results: T[];
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1AllResult<T>>;
  run(): Promise<D1RunResult>;
}

interface CandidateEnv {
  DB: { prepare(query: string): D1PreparedStatement };
  RUNTIME_SECRET?: string;
  WORKOS_CONTROL_PLANE_TOKEN?: string;
}

interface DatasetControl {
  taskId: TaskId;
  writeMode: WriteMode;
  instances: ReadonlySet<string> | null;
  writers: ReadonlySet<string>;
  readers: ReadonlySet<string>;
  resourceBinding: "DB";
}

type ReadSelector =
  | { kind: "RECORD"; record_key: string }
  | { kind: "AFTER"; checkpoint_record_key: string; limit: number }
  | { kind: "TAIL"; limit: number }
  | { kind: "CURRENT" };

interface ReadRequest {
  execution_surface?: ExecutionSurface;
  trigger_mode?: TriggerMode;
  task_id: string;
  caller_identity: string;
  operation: "READ";
  dataset_id: string;
  instance_id: string;
  selector: ReadSelector;
  authority_epoch?: string;
  manifest_fingerprint?: string;
  read_purpose?: "INITIAL_BASELINE_READBACK";
  expected_version?: number;
  bootstrap_idempotency_key?: string;
}

interface WriteRequest {
  execution_surface?: ExecutionSurface;
  trigger_mode?: TriggerMode;
  task_id: string;
  caller_identity: string;
  operation: "WRITE";
  dataset_id: string;
  instance_id: string;
  idempotency_key: string;
  payload: unknown;
  record_key?: string;
  expected_version?: number;
  authority_epoch?: string;
  manifest_fingerprint?: string;
  write_operation?: "INITIAL_BASELINE";
  fields?: string[];
}

interface AppendRow {
  append_seq: number;
  dataset_id: string;
  instance_id: string;
  record_key: string;
  payload_json: string;
  invocation_id: string;
  idempotency_key: string;
  db_written_at: string;
  db_read_at?: string;
}

interface CurrentRow {
  dataset_id: string;
  instance_id: string;
  version: number;
  previous_version: number;
  payload_json: string;
  invocation_id: string;
  idempotency_key: string;
  db_written_at: string;
  db_read_at?: string;
}

const SAFE_TOKEN = /^[A-Za-z0-9._:-]+$/;
const FX_SINGLETON = new Set(["SINGLETON"]);

const WORKOS_DATASETS: Record<string, DatasetControl> = {
  FX_POLICY_ANALYSIS_STATE: {
    taskId: "US_JAPAN_FX_POLICY",
    writeMode: "APPEND_ONLY",
    instances: FX_SINGLETON,
    writers: new Set(["READER"]),
    readers: new Set(["READER", "US_Japan_FX_Policy_Workflow"]),
    resourceBinding: "DB",
  },
  FX_POLICY_EVIDENCE_LOG: {
    taskId: "US_JAPAN_FX_POLICY",
    writeMode: "APPEND_ONLY",
    instances: FX_SINGLETON,
    writers: new Set(["COLLECTOR"]),
    readers: new Set(["COLLECTOR", "READER"]),
    resourceBinding: "DB",
  },
  FX_POLICY_MARKET_STATE: {
    taskId: "US_JAPAN_FX_POLICY",
    writeMode: "APPEND_ONLY",
    instances: FX_SINGLETON,
    writers: new Set(["COLLECTOR"]),
    readers: new Set(["COLLECTOR", "READER"]),
    resourceBinding: "DB",
  },
  FX_POLICY_RUN_LOG: {
    taskId: "US_JAPAN_FX_POLICY",
    writeMode: "APPEND_ONLY",
    instances: FX_SINGLETON,
    writers: new Set(["COLLECTOR"]),
    readers: new Set(["COLLECTOR", "READER", "US_Japan_FX_Policy_Workflow"]),
    resourceBinding: "DB",
  },
  RW_CURRENT_STATE: {
    taskId: "ROLLING_WEDGE_INVESTMENT",
    writeMode: "CURRENT_STATE",
    instances: null,
    writers: new Set(["Rolling_Wedge_Workflow"]),
    readers: new Set([
      "Rolling_Wedge_Workflow",
      "MONITOR",
      "REVISER",
      "VALUATOR",
      "DECISION",
    ]),
    resourceBinding: "DB",
  },
  RW_EVIDENCE_HISTORY: {
    taskId: "ROLLING_WEDGE_INVESTMENT",
    writeMode: "APPEND_ONLY",
    instances: null,
    writers: new Set(["MONITOR"]),
    readers: new Set(["Rolling_Wedge_Workflow", "REVISER"]),
    resourceBinding: "DB",
  },
  RW_REVISION_HISTORY: {
    taskId: "ROLLING_WEDGE_INVESTMENT",
    writeMode: "APPEND_ONLY",
    instances: null,
    writers: new Set(["REVISER"]),
    readers: new Set(["Rolling_Wedge_Workflow", "REVISER"]),
    resourceBinding: "DB",
  },
  RW_VALUATION_HISTORY: {
    taskId: "ROLLING_WEDGE_INVESTMENT",
    writeMode: "APPEND_ONLY",
    instances: null,
    writers: new Set(["VALUATOR"]),
    readers: new Set(["Rolling_Wedge_Workflow", "VALUATOR"]),
    resourceBinding: "DB",
  },
  RW_RUN_LOG: {
    taskId: "ROLLING_WEDGE_INVESTMENT",
    writeMode: "APPEND_ONLY",
    instances: null,
    writers: new Set([
      "MONITOR",
      "REVISER",
      "VALUATOR",
      "DECISION",
    ]),
    readers: new Set(["Rolling_Wedge_Workflow", "MONITOR"]),
    resourceBinding: "DB",
  },
};

function fail(error: string, status: number, details: Record<string, unknown> = {}): Response {
  return Response.json({ status: "FAILED", error, ...details }, { status });
}

function authenticate(request: Request, env: CandidateEnv): Response | null {
  if (!env.RUNTIME_SECRET) return fail("RUNTIME_NOT_CONFIGURED", 503);
  if (request.headers.get("Authorization") !== "Bearer " + env.RUNTIME_SECRET) {
    return fail("UNAUTHORIZED", 401);
  }
  return null;
}

async function parseJson(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function onlyKeys(record: Record<string, unknown>, allowed: string[]): boolean {
  const set = new Set(allowed);
  return Object.keys(record).every((key) => set.has(key));
}

function safeToken(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && SAFE_TOKEN.test(value);
}

function optionalExecutionMetadata(record: Record<string, unknown>): boolean {
  return (
    (record.execution_surface === undefined || record.execution_surface === "CHAT" || record.execution_surface === "WORK") &&
    (record.trigger_mode === undefined || record.trigger_mode === "HUMAN" || record.trigger_mode === "SCHEDULE")
  );
}

function boundedLimit(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 100;
}

function validSelector(value: unknown): value is ReadSelector {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const s = value as Record<string, unknown>;
  if (s.kind === "RECORD") return onlyKeys(s, ["kind", "record_key"]) && safeToken(s.record_key, 256);
  if (s.kind === "AFTER") {
    return onlyKeys(s, ["kind", "checkpoint_record_key", "limit"]) &&
      safeToken(s.checkpoint_record_key, 256) && boundedLimit(s.limit);
  }
  if (s.kind === "TAIL") return onlyKeys(s, ["kind", "limit"]) && boundedLimit(s.limit);
  return s.kind === "CURRENT" && onlyKeys(s, ["kind"]);
}

function validRead(body: unknown): body is ReadRequest {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return false;
  const r = body as Record<string, unknown>;
  return onlyKeys(r, [
    "execution_surface", "trigger_mode", "task_id", "caller_identity", "operation",
    "dataset_id", "instance_id", "selector", "authority_epoch", "manifest_fingerprint",
    "read_purpose", "expected_version", "bootstrap_idempotency_key",
  ]) &&
    optionalExecutionMetadata(r) &&
    r.operation === "READ" &&
    typeof r.task_id === "string" &&
    typeof r.caller_identity === "string" &&
    typeof r.dataset_id === "string" &&
    typeof r.instance_id === "string" &&
    validSelector(r.selector) &&
    (r.authority_epoch === undefined || safeToken(r.authority_epoch, 128)) &&
    (r.manifest_fingerprint === undefined || safeToken(r.manifest_fingerprint, 128)) &&
    (r.read_purpose === undefined || r.read_purpose === "INITIAL_BASELINE_READBACK") &&
    (r.expected_version === undefined || r.expected_version === 1) &&
    (r.bootstrap_idempotency_key === undefined || safeToken(r.bootstrap_idempotency_key, 128));
}

function validWrite(body: unknown): body is WriteRequest {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return false;
  const r = body as Record<string, unknown>;
  return onlyKeys(r, [
    "execution_surface", "trigger_mode", "task_id", "caller_identity", "operation",
    "dataset_id", "instance_id", "idempotency_key", "payload", "record_key", "expected_version",
    "authority_epoch", "manifest_fingerprint", "write_operation", "fields",
  ]) &&
    optionalExecutionMetadata(r) &&
    r.operation === "WRITE" &&
    typeof r.task_id === "string" &&
    typeof r.caller_identity === "string" &&
    typeof r.dataset_id === "string" &&
    typeof r.instance_id === "string" &&
    safeToken(r.idempotency_key, 128) &&
    Object.prototype.hasOwnProperty.call(r, "payload") &&
    (r.authority_epoch === undefined || safeToken(r.authority_epoch, 128)) &&
    (r.manifest_fingerprint === undefined || safeToken(r.manifest_fingerprint, 128)) &&
    (r.write_operation === undefined || r.write_operation === "INITIAL_BASELINE") &&
    (r.fields === undefined || (Array.isArray(r.fields) && r.fields.length <= 128 &&
      new Set(r.fields).size === r.fields.length &&
      r.fields.every((x: unknown) => safeToken(x, 128))));
}



/**
 * Dynamic companies are resolved from the singleton-selected ACTIVE Manifest
 * using the exact authenticated Google control plane reader on each request.
 * Three correlated environment strings are NOT independent Publisher proof.
 * No caller-supplied or deployment-supplied grant JSON can create authority.
 */
type TrustedControlPlaneSource = () => Promise<LoadedControlPlane>;

async function rollingWedgeGateDecision(
  body: ReadRequest | WriteRequest, source: TrustedControlPlaneSource,
): Promise<Response | null> {
  let cp: LoadedControlPlane;
  try { cp = await source(); } catch { return fail("TRUSTED_CONTROL_PLANE_UNAVAILABLE", 403); }
  if (cp.projectionDrift || cp.task.taskId !== "ROLLING_WEDGE_INVESTMENT" ||
      cp.gate.taskId !== "ROLLING_WEDGE_INVESTMENT")
    return fail("CONTROL_DENIED", 403);
  const snapshot = cp.gate;
  // Omitted legacy bindings are resolved exclusively from this trusted
  // singleton-selected authority. An explicitly provided value must match.
  if (!snapshot.expectedActivationEpoch || !snapshot.manifestFingerprint ||
      (body.authority_epoch !== undefined &&
       body.authority_epoch !== snapshot.expectedActivationEpoch) ||
      (body.manifest_fingerprint !== undefined &&
       body.manifest_fingerprint !== snapshot.manifestFingerprint))
    return fail("AUTHORITY_BINDING_MISMATCH", 403);
  const entries = snapshot.accesses.filter(x =>
    x.datasetId === body.dataset_id && x.instanceId === body.instance_id);
  if (entries.length !== 1) return fail("DATASET_NOT_REGISTERED", 403);
  const entry = entries[0];
  const isDraft = entry.dynamicInstance && entry.businessAuthorityState === "DRAFT";
  if (!isDraft && entry.businessAuthorityState !== "ACTIVE")
    return fail("BUSINESS_AUTHORITY_NOT_READY", 403);
  if (entry.writeMode !== WORKOS_DATASETS[body.dataset_id]?.writeMode)
    return fail("MANIFEST_OPERATION_MODE_MISMATCH", 403);
  if (isDraft && (body.dataset_id !== "RW_CURRENT_STATE" ||
      (body.operation === "READ" && body.selector.kind !== "CURRENT")))
    return fail("BUSINESS_AUTHORITY_NOT_READY", 403);

  const fields = body.operation === "WRITE" && body.payload !== null &&
    typeof body.payload === "object" && !Array.isArray(body.payload)
    ? new Set(Object.keys(body.payload as Record<string,unknown>)) : new Set<string>();
  const operation = body.operation === "WRITE"
    ? (isDraft ? body.write_operation : (
        WORKOS_DATASETS[body.dataset_id]?.writeMode === "CURRENT_STATE"
          ? "CONDITIONAL_CURRENT_STATE" : "APPEND_ONLY"))
    : undefined;
  if (body.operation === "WRITE" && (!operation ||
      (body.fields !== undefined &&
        (body.fields.length !== fields.size || !body.fields.every(x => fields.has(x)))) ||
      (!isDraft && body.write_operation !== undefined)))
    return fail("WRITE_SCOPE_VIOLATION", 403);
  if (!isDraft && body.operation === "READ" &&
      (body.read_purpose !== undefined || body.bootstrap_idempotency_key !== undefined))
    return fail("READ_NOT_AUTHORIZED", 403);
  try {
    authorizePersistence(snapshot,{
      taskId: body.task_id, callerIdentity: body.caller_identity,
      manifestId: snapshot.manifestId, datasetId: body.dataset_id,
      instanceId: body.instance_id, logicalMember: entry.logicalMember,
      operation: body.operation,
      ...(body.operation === "WRITE" ? {
        writeOperation: operation, fields, expectedVersion: body.expected_version,
        idempotencyKey: body.idempotency_key,
      } : {
        readPurpose: body.read_purpose, expectedVersion: body.expected_version,
        idempotencyKey: body.bootstrap_idempotency_key,
      }),
    });
  } catch { return fail("PUBLISHED_GATE_DENIED", 403); }

  if (!isDraft) return null;
  if (body.operation === "READ") return null;
  const data = body.payload as Record<string,unknown>;
  if (data.Company_ID !== body.instance_id || data.Instance_ID !== body.instance_id ||
      data.Belief_State_ID !== null || data.Valuation_State_ID !== null ||
      data.Decision_State_ID !== null || data.Scenario_Probabilities !== null ||
      data.Confidence !== null || data.Next_Reality_Watch_Accepted !== false ||
      data.Material_Capital_Commitment_Accepted !== false ||
      data.Production_D1_Initialized !== false ||
      typeof data.Base_Source_Source_Status !== "string" ||
      !data.Base_Source_Source_Status.startsWith("SOURCE_STATUS: ACCEPTED") ||
      "MATERIAL_CAPITAL_COMMITMENT_CANDIDATE__REVISER_OWNED" in data ||
      "NEXT_REALITY_WATCH_CANDIDATE__REVISER_OWNED" in data)
    return fail("BOOTSTRAP_PAYLOAD_INVALID", 400);
  return null;
}

async function resolveControl(
  body: ReadRequest | WriteRequest, env: CandidateEnv, source: TrustedControlPlaneSource,
): Promise<DatasetControl | Response> {
  const control = WORKOS_DATASETS[body.dataset_id];
  if (!control) return fail("DATASET_NOT_REGISTERED", 403);
  if (control.taskId !== body.task_id) return fail("CONTROL_DENIED", 403);
  if (control.taskId === "ROLLING_WEDGE_INVESTMENT") {
    // Every RW instance, including the original three, must enter the
    // trusted Manifest Gate; Worker-local company/caller lists grant nothing.
    const denied = await rollingWedgeGateDecision(body, source);
    return denied ?? control;
  }
  // Unchanged FX singleton and legacy caller behavior.
  if (!control.instances?.has(body.instance_id)) return fail("CONTROL_DENIED", 403);
  if (body.operation === "READ") {
    if (!control.readers.has(body.caller_identity)) return fail("READ_NOT_AUTHORIZED", 403);
  } else if (!control.writers.has(body.caller_identity)) {
    return fail("WRITE_NOT_AUTHORIZED", 403);
  }
  return control;
}

function canonicalizePayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizePayload);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const canonical: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      canonical[key] = canonicalizePayload(record[key]);
    }
    return canonical;
  }
  return value;
}

function serializePayload(payload: unknown): string | null {
  if (payload === undefined) return null;
  try {
    const result = JSON.stringify(canonicalizePayload(payload));
    return result === undefined ? null : result;
  } catch {
    return null;
  }
}

function base(body: ReadRequest | WriteRequest, control: DatasetControl): Record<string, unknown> {
  return {
    task_id: body.task_id,
    caller_identity: body.caller_identity,
    operation: body.operation,
    dataset_id: body.dataset_id,
    instance_id: body.instance_id,
    resource_binding: control.resourceBinding,
    ...(body.execution_surface ? { execution_surface: body.execution_surface } : {}),
    ...(body.trigger_mode ? { trigger_mode: body.trigger_mode } : {}),
  };
}

function parsePayload(payloadJson: string): unknown {
  return JSON.parse(payloadJson);
}

async function appendByRecord(env: CandidateEnv, dataset: string, instance: string, key: string): Promise<AppendRow | null> {
  return env.DB.prepare("SELECT append_seq,dataset_id,instance_id,record_key,payload_json,invocation_id,idempotency_key,db_written_at,strftime('%Y-%m-%dT%H:%M:%fZ','now') AS db_read_at FROM workos_append_records WHERE dataset_id=? AND instance_id=? AND record_key=? LIMIT 1")
    .bind(dataset, instance, key).first<AppendRow>();
}

async function appendByIdempotency(env: CandidateEnv, key: string): Promise<AppendRow | null> {
  return env.DB.prepare("SELECT append_seq,dataset_id,instance_id,record_key,payload_json,invocation_id,idempotency_key,db_written_at,strftime('%Y-%m-%dT%H:%M:%fZ','now') AS db_read_at FROM workos_append_records WHERE idempotency_key=? LIMIT 1")
    .bind(key).first<AppendRow>();
}

async function appendByInvocation(env: CandidateEnv, id: string): Promise<AppendRow | null> {
  return env.DB.prepare("SELECT append_seq,dataset_id,instance_id,record_key,payload_json,invocation_id,idempotency_key,db_written_at,strftime('%Y-%m-%dT%H:%M:%fZ','now') AS db_read_at FROM workos_append_records WHERE invocation_id=? LIMIT 1")
    .bind(id).first<AppendRow>();
}

async function current(env: CandidateEnv, dataset: string, instance: string): Promise<CurrentRow | null> {
  return env.DB.prepare("SELECT dataset_id,instance_id,version,previous_version,payload_json,invocation_id,idempotency_key,db_written_at,strftime('%Y-%m-%dT%H:%M:%fZ','now') AS db_read_at FROM workos_current_state_versions WHERE dataset_id=? AND instance_id=? ORDER BY version DESC LIMIT 1")
    .bind(dataset, instance).first<CurrentRow>();
}

async function currentByIdempotency(env: CandidateEnv, key: string): Promise<CurrentRow | null> {
  return env.DB.prepare("SELECT dataset_id,instance_id,version,previous_version,payload_json,invocation_id,idempotency_key,db_written_at,strftime('%Y-%m-%dT%H:%M:%fZ','now') AS db_read_at FROM workos_current_state_versions WHERE idempotency_key=? LIMIT 1")
    .bind(key).first<CurrentRow>();
}

async function currentByInvocation(env: CandidateEnv, id: string): Promise<CurrentRow | null> {
  return env.DB.prepare("SELECT dataset_id,instance_id,version,previous_version,payload_json,invocation_id,idempotency_key,db_written_at,strftime('%Y-%m-%dT%H:%M:%fZ','now') AS db_read_at FROM workos_current_state_versions WHERE invocation_id=? LIMIT 1")
    .bind(id).first<CurrentRow>();
}

function appendSuccess(body: WriteRequest, control: DatasetControl, row: AppendRow, replayed: boolean): Response {
  return Response.json({
    status: "SUCCESS", ...base(body, control), write_mode: "APPEND_ONLY",
    record_key: row.record_key, append_seq: row.append_seq, invocation_id: row.invocation_id,
    idempotency_key: row.idempotency_key, db_written_at: row.db_written_at,
    db_read_at: row.db_read_at ?? null, replayed,
  });
}

function currentSuccess(body: WriteRequest, control: DatasetControl, row: CurrentRow, replayed: boolean): Response {
  return Response.json({
    status: "SUCCESS", ...base(body, control), write_mode: "CURRENT_STATE",
    previous_version: row.previous_version, version: row.version, invocation_id: row.invocation_id,
    idempotency_key: row.idempotency_key, db_written_at: row.db_written_at,
    db_read_at: row.db_read_at ?? null, replayed,
  });
}

async function handleRead(body: ReadRequest, env: CandidateEnv, source: TrustedControlPlaneSource): Promise<Response> {
  const resolved = await resolveControl(body, env, source);
  if (resolved instanceof Response) return resolved;
  const b = base(body, resolved);

  if (resolved.writeMode === "CURRENT_STATE") {
    if (body.selector.kind !== "CURRENT") return fail("INVALID_READ_SELECTOR", 400);
    let row: CurrentRow | null;
    try { row = await current(env, body.dataset_id, body.instance_id); }
    catch { return fail("READ_FAILED", 500); }
    if (!row) return fail("NOT_FOUND", 404);
    if (body.read_purpose === "INITIAL_BASELINE_READBACK" &&
        (row.version !== 1 || row.previous_version !== 0 ||
         row.idempotency_key !== body.bootstrap_idempotency_key))
      return fail("BOOTSTRAP_READBACK_MISMATCH", 409);
    try {
      return Response.json({
        status: "SUCCESS", ...b, selector: "CURRENT", version: row.version,
        previous_version: row.previous_version, payload: parsePayload(row.payload_json),
        invocation_id: row.invocation_id, db_written_at: row.db_written_at,
        db_read_at: row.db_read_at ?? null,
      });
    } catch { return fail("PERSISTED_PAYLOAD_INVALID", 500); }
  }

  if (body.selector.kind === "CURRENT") return fail("INVALID_READ_SELECTOR", 400);

  if (body.selector.kind === "RECORD") {
    let row: AppendRow | null;
    try { row = await appendByRecord(env, body.dataset_id, body.instance_id, body.selector.record_key); }
    catch { return fail("READ_FAILED", 500); }
    if (!row) return fail("NOT_FOUND", 404);
    try {
      return Response.json({
        status: "SUCCESS", ...b, selector: "RECORD",
        record: {
          append_seq: row.append_seq, record_key: row.record_key,
          payload: parsePayload(row.payload_json), invocation_id: row.invocation_id,
          db_written_at: row.db_written_at, db_read_at: row.db_read_at ?? null,
        },
      });
    } catch { return fail("PERSISTED_PAYLOAD_INVALID", 500); }
  }

  let rows: AppendRow[];
  try {
    if (body.selector.kind === "AFTER") {
      const checkpoint = await appendByRecord(env, body.dataset_id, body.instance_id, body.selector.checkpoint_record_key);
      if (!checkpoint) return fail("CHECKPOINT_NOT_FOUND", 404);
      const result = await env.DB.prepare("SELECT append_seq,dataset_id,instance_id,record_key,payload_json,invocation_id,idempotency_key,db_written_at FROM workos_append_records WHERE dataset_id=? AND instance_id=? AND append_seq>? ORDER BY append_seq ASC LIMIT ?")
        .bind(body.dataset_id, body.instance_id, checkpoint.append_seq, body.selector.limit).all<AppendRow>();
      rows = result.results;
    } else {
      const result = await env.DB.prepare("SELECT append_seq,dataset_id,instance_id,record_key,payload_json,invocation_id,idempotency_key,db_written_at FROM workos_append_records WHERE dataset_id=? AND instance_id=? ORDER BY append_seq DESC LIMIT ?")
        .bind(body.dataset_id, body.instance_id, body.selector.limit).all<AppendRow>();
      rows = result.results.reverse();
    }
  } catch { return fail("READ_FAILED", 500); }

  try {
    return Response.json({
      status: "SUCCESS", ...b, selector: body.selector.kind,
      records: rows.map((row) => ({
        append_seq: row.append_seq, record_key: row.record_key,
        payload: parsePayload(row.payload_json), invocation_id: row.invocation_id,
        db_written_at: row.db_written_at,
      })),
    });
  } catch { return fail("PERSISTED_PAYLOAD_INVALID", 500); }
}

async function replayAppend(body: WriteRequest, control: DatasetControl, env: CandidateEnv, payloadJson: string): Promise<Response | null> {
  const row = await appendByIdempotency(env, body.idempotency_key);
  if (!row) return null;
  if (row.dataset_id !== body.dataset_id || row.instance_id !== body.instance_id ||
      row.record_key !== body.record_key || row.payload_json !== payloadJson) {
    return fail("IDEMPOTENCY_CONFLICT", 409, {
      dataset_id: body.dataset_id, instance_id: body.instance_id, idempotency_key: body.idempotency_key,
    });
  }
  return appendSuccess(body, control, row, true);
}

async function handleAppendWrite(body: WriteRequest, control: DatasetControl, env: CandidateEnv, payloadJson: string): Promise<Response> {
  if (!safeToken(body.record_key, 256) || body.expected_version !== undefined) return fail("INVALID_WRITE_SHAPE", 400);

  try {
    const replay = await replayAppend(body, control, env, payloadJson);
    if (replay) return replay;
  } catch { return fail("READBACK_FAILED", 500); }

  const invocationId = crypto.randomUUID();
  let result: D1RunResult;
  try {
    result = await env.DB.prepare("INSERT INTO workos_append_records (dataset_id,instance_id,record_key,payload_json,invocation_id,idempotency_key,db_written_at) VALUES (?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
      .bind(body.dataset_id, body.instance_id, body.record_key, payloadJson, invocationId, body.idempotency_key).run();
  } catch {
    try {
      const replay = await replayAppend(body, control, env, payloadJson);
      if (replay) return replay;
      const duplicate = await appendByRecord(env, body.dataset_id, body.instance_id, body.record_key);
      if (duplicate) return fail("DUPLICATE_RECORD", 409, {
        dataset_id: body.dataset_id, instance_id: body.instance_id, record_key: body.record_key,
      });
    } catch { return fail("PERSISTENCE_WRITE_FAILED", 500); }
    return fail("PERSISTENCE_WRITE_FAILED", 500);
  }

  if (!result.success || result.meta?.changes !== 1) {
    try {
      const replay = await replayAppend(body, control, env, payloadJson);
      if (replay) return replay;
      const duplicate = await appendByRecord(env, body.dataset_id, body.instance_id, body.record_key);
      if (duplicate) return fail("DUPLICATE_RECORD", 409, {
        dataset_id: body.dataset_id, instance_id: body.instance_id, record_key: body.record_key,
      });
    } catch { return fail("READBACK_FAILED", 500); }
    return fail("PERSISTENCE_WRITE_FAILED", 500);
  }

  let row: AppendRow | null;
  try { row = await appendByInvocation(env, invocationId); }
  catch { return fail("READBACK_FAILED", 500); }
  if (!row) return fail("READBACK_NOT_FOUND", 500);
  if (row.dataset_id !== body.dataset_id || row.instance_id !== body.instance_id ||
      row.record_key !== body.record_key || row.payload_json !== payloadJson ||
      row.idempotency_key !== body.idempotency_key || row.invocation_id !== invocationId) {
    return fail("READBACK_MISMATCH", 500);
  }
  return appendSuccess(body, control, row, false);
}

async function replayCurrent(body: WriteRequest, control: DatasetControl, env: CandidateEnv, payloadJson: string): Promise<Response | null> {
  const row = await currentByIdempotency(env, body.idempotency_key);
  if (!row) return null;
  if (row.dataset_id !== body.dataset_id || row.instance_id !== body.instance_id ||
      row.previous_version !== body.expected_version || row.payload_json !== payloadJson) {
    return fail("IDEMPOTENCY_CONFLICT", 409, {
      dataset_id: body.dataset_id, instance_id: body.instance_id, idempotency_key: body.idempotency_key,
    });
  }
  return currentSuccess(body, control, row, true);
}

async function staleCurrent(body: WriteRequest, env: CandidateEnv): Promise<Response> {
  const row = await current(env, body.dataset_id, body.instance_id);
  return fail("STALE_STATE", 409, {
    dataset_id: body.dataset_id, instance_id: body.instance_id,
    expected_version: body.expected_version, current_version: row?.version ?? 0,
  });
}

async function handleCurrentWrite(body: WriteRequest, control: DatasetControl, env: CandidateEnv, payloadJson: string): Promise<Response> {
  if (body.record_key !== undefined || !Number.isInteger(body.expected_version) ||
      (body.expected_version as number) < 0 || (body.expected_version as number) > 2147483647) {
    return fail("INVALID_WRITE_SHAPE", 400);
  }

  try {
    const replay = await replayCurrent(body, control, env, payloadJson);
    if (replay) return replay;
  } catch { return fail("READBACK_FAILED", 500); }

  const invocationId = crypto.randomUUID();
  let result: D1RunResult;
  try {
    if (body.expected_version === 0) {
      result = await env.DB.prepare("INSERT INTO workos_current_state_versions (dataset_id,instance_id,version,previous_version,payload_json,invocation_id,idempotency_key,db_written_at) SELECT ?,?,1,0,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE NOT EXISTS (SELECT 1 FROM workos_current_state_versions WHERE dataset_id=? AND instance_id=?)")
        .bind(body.dataset_id, body.instance_id, payloadJson, invocationId, body.idempotency_key, body.dataset_id, body.instance_id).run();
    } else {
      result = await env.DB.prepare("INSERT INTO workos_current_state_versions (dataset_id,instance_id,version,previous_version,payload_json,invocation_id,idempotency_key,db_written_at) SELECT ?,?,current.version+1,current.version,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM (SELECT version FROM workos_current_state_versions WHERE dataset_id=? AND instance_id=? ORDER BY version DESC LIMIT 1) AS current WHERE current.version=?")
        .bind(body.dataset_id, body.instance_id, payloadJson, invocationId, body.idempotency_key, body.dataset_id, body.instance_id, body.expected_version).run();
    }
  } catch {
    try {
      const replay = await replayCurrent(body, control, env, payloadJson);
      if (replay) return replay;
      return await staleCurrent(body, env);
    } catch { return fail("PERSISTENCE_WRITE_FAILED", 500); }
  }

  if (!result.success || result.meta?.changes !== 1) {
    try {
      const replay = await replayCurrent(body, control, env, payloadJson);
      if (replay) return replay;
      return await staleCurrent(body, env);
    } catch { return fail("READBACK_FAILED", 500); }
  }

  let row: CurrentRow | null;
  try { row = await currentByInvocation(env, invocationId); }
  catch { return fail("READBACK_FAILED", 500); }
  if (!row) return fail("READBACK_NOT_FOUND", 500);
  if (row.dataset_id !== body.dataset_id || row.instance_id !== body.instance_id ||
      row.previous_version !== body.expected_version || row.version !== (body.expected_version as number) + 1 ||
      row.payload_json !== payloadJson || row.idempotency_key !== body.idempotency_key ||
      row.invocation_id !== invocationId) {
    return fail("READBACK_MISMATCH", 500);
  }
  return currentSuccess(body, control, row, false);
}

async function handleWrite(body: WriteRequest, env: CandidateEnv, source: TrustedControlPlaneSource): Promise<Response> {
  const resolved = await resolveControl(body, env, source);
  if (resolved instanceof Response) return resolved;
  const payloadJson = serializePayload(body.payload);
  if (payloadJson === null) return fail("INVALID_PAYLOAD", 400);
  return resolved.writeMode === "APPEND_ONLY"
    ? handleAppendWrite(body, resolved, env, payloadJson)
    : handleCurrentWrite(body, resolved, env, payloadJson);
}

export async function handleWorkOsCandidatePersistence(
  request: Request, env: CandidateEnv,
  /** Isolated tests may inject a trusted reader; HTTP callers cannot supply one. */
  trustedSource?: TrustedControlPlaneSource,
): Promise<Response> {
  const authError = authenticate(request, env);
  if (authError) return authError;
  const source: TrustedControlPlaneSource = trustedSource ?? (async () => {
    if (!env.WORKOS_CONTROL_PLANE_TOKEN) throw new Error("CONTROL_PLANE_TOKEN_MISSING");
    return loadControlPlane(
      new GoogleExactControlPlaneReader(env.WORKOS_CONTROL_PLANE_TOKEN),
      "ROLLING_WEDGE_INVESTMENT",
    );
  });
  const body = await parseJson(request);
  if (validRead(body)) return handleRead(body, env, source);
  if (validWrite(body)) return handleWrite(body, env, source);
  return fail("INVALID_REQUEST", 400);
}
