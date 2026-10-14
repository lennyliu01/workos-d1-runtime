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
  RW_AUTHORITY_PROJECTION?: string;
  RW_AUTHORITY_EPOCH?: string;
  RW_MANIFEST_FINGERPRINT?: string;
}

interface DatasetControl {
  taskId: TaskId;
  writeMode: WriteMode;
  instances: ReadonlySet<string>;
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
const RW_INSTANCES = new Set(["ENPLAS", "SERVICENOW", "FIGMA"]);

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
    instances: RW_INSTANCES,
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
    instances: RW_INSTANCES,
    writers: new Set(["MONITOR"]),
    readers: new Set(["Rolling_Wedge_Workflow", "REVISER"]),
    resourceBinding: "DB",
  },
  RW_REVISION_HISTORY: {
    taskId: "ROLLING_WEDGE_INVESTMENT",
    writeMode: "APPEND_ONLY",
    instances: RW_INSTANCES,
    writers: new Set(["REVISER"]),
    readers: new Set(["Rolling_Wedge_Workflow", "REVISER"]),
    resourceBinding: "DB",
  },
  RW_VALUATION_HISTORY: {
    taskId: "ROLLING_WEDGE_INVESTMENT",
    writeMode: "APPEND_ONLY",
    instances: RW_INSTANCES,
    writers: new Set(["VALUATOR"]),
    readers: new Set(["Rolling_Wedge_Workflow", "VALUATOR"]),
    resourceBinding: "DB",
  },
  RW_RUN_LOG: {
    taskId: "ROLLING_WEDGE_INVESTMENT",
    writeMode: "APPEND_ONLY",
    instances: RW_INSTANCES,
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


interface DynamicBinding {
  dataset_id: string; instance_id: string;
  business_state: "DRAFT" | "ACTIVE";
  readers: string[];
  writers: Array<{writer_id: string; operations: string[]}>;
  bootstrap?: {fields: string[]; idempotency_key: string};
}
function dynamicInstanceDecision(body: ReadRequest | WriteRequest, env: CandidateEnv): Response | null {
  // A projection is accepted only if a separate publisher-controlled epoch and
  // manifest fingerprint match. Caller claims cannot register an instance.
  if (!env.RW_AUTHORITY_PROJECTION || !env.RW_AUTHORITY_EPOCH ||
      !env.RW_MANIFEST_FINGERPRINT) return fail("CONTROL_DENIED", 403);
  let raw: unknown;
  try { raw = JSON.parse(env.RW_AUTHORITY_PROJECTION); } catch { return fail("CONTROL_DENIED", 403); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("CONTROL_DENIED", 403);
  const p = raw as Record<string, unknown>;
  if (p.state !== "ACTIVE" || p.authority_epoch !== env.RW_AUTHORITY_EPOCH ||
      p.manifest_fingerprint !== env.RW_MANIFEST_FINGERPRINT ||
      body.authority_epoch !== p.authority_epoch ||
      body.manifest_fingerprint !== p.manifest_fingerprint ||
      !Array.isArray(p.bindings) || p.bindings.length > 1000)
    return fail("CONTROL_DENIED", 403);
  const matches = (p.bindings as DynamicBinding[]).filter(x =>
    x && x.dataset_id === body.dataset_id && x.instance_id === body.instance_id);
  if (matches.length !== 1) return fail("CONTROL_DENIED", 403);
  const b = matches[0];
  if (!Array.isArray(b.readers) || !Array.isArray(b.writers) ||
      !["ACTIVE","DRAFT"].includes(b.business_state)) return fail("CONTROL_DENIED", 403);
  if (b.business_state === "ACTIVE") {
    if (body.operation === "READ")
      return b.readers.includes(body.caller_identity) && !body.read_purpose &&
        body.bootstrap_idempotency_key === undefined ? null : fail("READ_NOT_AUTHORIZED", 403);
    const w = b.writers.filter(x => x.writer_id === body.caller_identity);
    return w.length === 1 && Array.isArray(w[0].operations) &&
      w[0].operations.includes("ORDINARY_WRITE") && body.write_operation === undefined ?
      null : fail("WRITE_NOT_AUTHORIZED", 403);
  }
  if (body.dataset_id !== "RW_CURRENT_STATE" || body.caller_identity !== "Rolling_Wedge_Workflow" ||
      !b.bootstrap || !Array.isArray(b.bootstrap.fields) ||
      !safeToken(b.bootstrap.idempotency_key, 128))
    return fail("BUSINESS_AUTHORITY_NOT_READY", 403);
  const grant = b.bootstrap;
  if (body.operation === "READ")
    return body.read_purpose === "INITIAL_BASELINE_READBACK" &&
      body.selector.kind === "CURRENT" && body.expected_version === 1 &&
      body.bootstrap_idempotency_key === grant.idempotency_key &&
      b.readers.includes(body.caller_identity) ? null : fail("BUSINESS_AUTHORITY_NOT_READY", 403);
  if (body.write_operation !== "INITIAL_BASELINE" || body.expected_version !== 0 ||
      body.record_key !== undefined || body.idempotency_key !== grant.idempotency_key ||
      !body.fields || body.fields.length !== grant.fields.length ||
      !body.fields.every(x => grant.fields.includes(x)) ||
      !b.writers.some(x => x.writer_id === body.caller_identity &&
        Array.isArray(x.operations) && x.operations.includes("INITIAL_BASELINE")))
    return fail("BUSINESS_AUTHORITY_NOT_READY", 403);
  const v = body.payload;
  if (!v || typeof v !== "object" || Array.isArray(v)) return fail("BOOTSTRAP_PAYLOAD_INVALID",400);
  const data = v as Record<string,unknown>;
  if (Object.keys(data).length !== grant.fields.length ||
      !Object.keys(data).every(x => grant.fields.includes(x)) ||
      data.Company_ID !== body.instance_id || data.Instance_ID !== body.instance_id ||
      data.Belief_State_ID !== null || data.Valuation_State_ID !== null ||
      data.Decision_State_ID !== null || data.Scenario_Probabilities !== null ||
      data.Confidence !== null || data.Next_Reality_Watch_Accepted !== false ||
      data.Material_Capital_Commitment_Accepted !== false ||
      data.Production_D1_Initialized !== false ||
      typeof data.Base_Source_Source_Status !== "string" ||
      !data.Base_Source_Source_Status.startsWith("SOURCE_STATUS: ACCEPTED"))
    return fail("BOOTSTRAP_PAYLOAD_INVALID",400);
  return null;
}

function resolveControl(body: ReadRequest | WriteRequest, env: CandidateEnv): DatasetControl | Response {
  const control = WORKOS_DATASETS[body.dataset_id];
  if (!control) return fail("DATASET_NOT_REGISTERED", 403);
  if (control.taskId !== body.task_id) return fail("CONTROL_DENIED", 403);
  if (!control.instances.has(body.instance_id)) {
    if (control.taskId !== "ROLLING_WEDGE_INVESTMENT") return fail("CONTROL_DENIED",403);
    const denied = dynamicInstanceDecision(body, env);
    if (denied) return denied;
  }
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

async function handleRead(body: ReadRequest, env: CandidateEnv): Promise<Response> {
  const resolved = resolveControl(body, env);
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

async function handleWrite(body: WriteRequest, env: CandidateEnv): Promise<Response> {
  const resolved = resolveControl(body, env);
  if (resolved instanceof Response) return resolved;
  const payloadJson = serializePayload(body.payload);
  if (payloadJson === null) return fail("INVALID_PAYLOAD", 400);
  return resolved.writeMode === "APPEND_ONLY"
    ? handleAppendWrite(body, resolved, env, payloadJson)
    : handleCurrentWrite(body, resolved, env, payloadJson);
}

export async function handleWorkOsCandidatePersistence(request: Request, env: CandidateEnv): Promise<Response> {
  const authError = authenticate(request, env);
  if (authError) return authError;

  const body = await parseJson(request);
  if (validRead(body)) return handleRead(body, env);
  if (validWrite(body)) return handleWrite(body, env);
  return fail("INVALID_REQUEST", 400);
}
