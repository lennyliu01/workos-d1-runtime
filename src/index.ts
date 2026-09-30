import { handleWorkOsCandidatePersistence } from "./workos_candidate";

type ExecutionSurface = "CHAT" | "WORK";
type TriggerMode = "HUMAN" | "SCHEDULE";

interface D1RunMeta {
  changes?: number;
}

interface D1RunResult {
  success: boolean;
  error?: string;
  meta?: D1RunMeta;
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

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface Env {
  DB: D1Database;
  RUNTIME_SECRET?: string;
}

interface TimeRoundtripRequest {
  execution_surface: ExecutionSurface;
  trigger_mode: TriggerMode;
  operation: "TIME_ROUNDTRIP";
  model?: string;
  reasoning_level?: string;
  source_run_key?: string;
}

interface StoredInvocation {
  invocation_id: string;
  execution_surface: ExecutionSurface;
  trigger_mode: TriggerMode;
  operation: "TIME_ROUNDTRIP";
  db_written_at: string;
  status: "RECORDED";
  model: string | null;
  reasoning_level: string | null;
  source_run_key: string | null;
  db_read_at: string;
}

interface StateCompareAndSetRequest {
  execution_surface: ExecutionSurface;
  trigger_mode: TriggerMode;
  operation: "STATE_COMPARE_AND_SET";
  state_key: string;
  expected_version: number;
  expected_state: string | null;
  next_state: string;
  idempotency_key: string;
  source_run_key?: string;
}

interface StoredStateVersion {
  state_key: string;
  version: number;
  state_value: string;
  previous_version: number;
  previous_state: string | null;
  invocation_id: string;
  idempotency_key: string;
  execution_surface: ExecutionSurface;
  trigger_mode: TriggerMode;
  operation: "STATE_COMPARE_AND_SET";
  db_written_at: string;
  source_run_key: string | null;
  db_read_at: string;
}

interface CurrentState {
  state_key: string;
  version: number;
  state_value: string;
  db_read_at: string;
}

const TIME_ROUNDTRIP_FIELDS = new Set([
  "execution_surface",
  "trigger_mode",
  "operation",
  "model",
  "reasoning_level",
  "source_run_key",
]);

const STATE_COMPARE_AND_SET_FIELDS = new Set([
  "execution_surface",
  "trigger_mode",
  "operation",
  "state_key",
  "expected_version",
  "expected_state",
  "next_state",
  "idempotency_key",
  "source_run_key",
]);

const SAFE_TOKEN = /^[A-Za-z0-9._:-]+$/;

function jsonError(error: string, statusCode: number): Response {
  return Response.json(
    {
      status: "FAILED",
      error,
    },
    { status: statusCode },
  );
}

function jsonStateError(
  error: string,
  statusCode: number,
  details: Record<string, unknown>,
): Response {
  return Response.json(
    {
      status: "FAILED",
      error,
      ...details,
    },
    { status: statusCode },
  );
}

function isOptionalBoundedString(value: unknown, maxLength = 256): boolean {
  return value === undefined || (typeof value === "string" && value.length <= maxLength);
}

function isSafeToken(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maxLength &&
    SAFE_TOKEN.test(value)
  );
}

function hasOnlyFields(record: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(record).every((key) => allowed.has(key));
}

function hasValidSurfaceAndTrigger(record: Record<string, unknown>): boolean {
  return (
    (record.execution_surface === "CHAT" || record.execution_surface === "WORK") &&
    (record.trigger_mode === "HUMAN" || record.trigger_mode === "SCHEDULE")
  );
}

function validateTimeRoundtripRequest(body: unknown): body is TimeRoundtripRequest {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return false;
  }

  const record = body as Record<string, unknown>;

  if (!hasOnlyFields(record, TIME_ROUNDTRIP_FIELDS) || !hasValidSurfaceAndTrigger(record)) {
    return false;
  }

  if (record.operation !== "TIME_ROUNDTRIP") {
    return false;
  }

  return (
    isOptionalBoundedString(record.model) &&
    isOptionalBoundedString(record.reasoning_level) &&
    isOptionalBoundedString(record.source_run_key)
  );
}

function validateStateCompareAndSetRequest(body: unknown): body is StateCompareAndSetRequest {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return false;
  }

  const record = body as Record<string, unknown>;

  if (
    !hasOnlyFields(record, STATE_COMPARE_AND_SET_FIELDS) ||
    !hasValidSurfaceAndTrigger(record) ||
    record.operation !== "STATE_COMPARE_AND_SET"
  ) {
    return false;
  }

  if (
    !isSafeToken(record.state_key, 64) ||
    !Number.isInteger(record.expected_version) ||
    (record.expected_version as number) < 0 ||
    (record.expected_version as number) > 2_147_483_647 ||
    !isSafeToken(record.next_state, 64) ||
    !isSafeToken(record.idempotency_key, 128) ||
    !isOptionalBoundedString(record.source_run_key)
  ) {
    return false;
  }

  if (record.expected_version === 0) {
    return record.expected_state === null;
  }

  return isSafeToken(record.expected_state, 64) && record.next_state !== record.expected_state;
}

function authenticate(request: Request, env: Env): Response | null {
  if (!env.RUNTIME_SECRET) {
    return jsonError("RUNTIME_NOT_CONFIGURED", 503);
  }

  const authorization = request.headers.get("Authorization");
  if (authorization !== `Bearer ${env.RUNTIME_SECRET}`) {
    return jsonError("UNAUTHORIZED", 401);
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

async function handleTimeRoundtrip(request: Request, env: Env): Promise<Response> {
  const authError = authenticate(request, env);
  if (authError) {
    return authError;
  }

  const body = await parseJson(request);
  if (!validateTimeRoundtripRequest(body)) {
    return jsonError("INVALID_REQUEST", 400);
  }

  const invocationId = crypto.randomUUID();

  try {
    const writeResult = await env.DB.prepare(
      `INSERT INTO prototype_invocations (
        invocation_id,
        execution_surface,
        trigger_mode,
        operation,
        db_written_at,
        status,
        model,
        reasoning_level,
        source_run_key
      ) VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'RECORDED', ?, ?, ?)`,
    )
      .bind(
        invocationId,
        body.execution_surface,
        body.trigger_mode,
        body.operation,
        body.model ?? null,
        body.reasoning_level ?? null,
        body.source_run_key ?? null,
      )
      .run();

    if (!writeResult.success) {
      return jsonError("PERSISTENCE_WRITE_FAILED", 500);
    }
  } catch {
    return jsonError("PERSISTENCE_WRITE_FAILED", 500);
  }

  let stored: StoredInvocation | null;
  try {
    stored = await env.DB.prepare(
      `SELECT
        invocation_id,
        execution_surface,
        trigger_mode,
        operation,
        db_written_at,
        status,
        model,
        reasoning_level,
        source_run_key,
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS db_read_at
      FROM prototype_invocations
      WHERE invocation_id = ?
      LIMIT 1`,
    )
      .bind(invocationId)
      .first<StoredInvocation>();
  } catch {
    return jsonError("READBACK_FAILED", 500);
  }

  if (!stored) {
    return jsonError("READBACK_NOT_FOUND", 500);
  }

  if (
    stored.invocation_id !== invocationId ||
    stored.execution_surface !== body.execution_surface ||
    stored.trigger_mode !== body.trigger_mode ||
    stored.operation !== body.operation ||
    stored.status !== "RECORDED"
  ) {
    return jsonError("READBACK_MISMATCH", 500);
  }

  return Response.json({
    status: "SUCCESS",
    invocation_id: stored.invocation_id,
    execution_surface: stored.execution_surface,
    trigger_mode: stored.trigger_mode,
    operation: stored.operation,
    db_written_at: stored.db_written_at,
    db_read_at: stored.db_read_at,
    stored_status: stored.status,
    model: stored.model,
    reasoning_level: stored.reasoning_level,
    source_run_key: stored.source_run_key,
  });
}

async function readStateVersionByIdempotencyKey(
  env: Env,
  idempotencyKey: string,
): Promise<StoredStateVersion | null> {
  return env.DB.prepare(
    `SELECT
      state_key,
      version,
      state_value,
      previous_version,
      previous_state,
      invocation_id,
      idempotency_key,
      execution_surface,
      trigger_mode,
      operation,
      db_written_at,
      source_run_key,
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS db_read_at
    FROM prototype_state_versions
    WHERE idempotency_key = ?
    LIMIT 1`,
  )
    .bind(idempotencyKey)
    .first<StoredStateVersion>();
}

async function readStateVersionByInvocationId(
  env: Env,
  invocationId: string,
): Promise<StoredStateVersion | null> {
  return env.DB.prepare(
    `SELECT
      state_key,
      version,
      state_value,
      previous_version,
      previous_state,
      invocation_id,
      idempotency_key,
      execution_surface,
      trigger_mode,
      operation,
      db_written_at,
      source_run_key,
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS db_read_at
    FROM prototype_state_versions
    WHERE invocation_id = ?
    LIMIT 1`,
  )
    .bind(invocationId)
    .first<StoredStateVersion>();
}

async function readCurrentState(env: Env, stateKey: string): Promise<CurrentState | null> {
  return env.DB.prepare(
    `SELECT
      state_key,
      version,
      state_value,
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS db_read_at
    FROM prototype_state_versions
    WHERE state_key = ?
    ORDER BY version DESC
    LIMIT 1`,
  )
    .bind(stateKey)
    .first<CurrentState>();
}

function stateMutationMatchesRequest(
  stored: StoredStateVersion,
  body: StateCompareAndSetRequest,
): boolean {
  return (
    stored.state_key === body.state_key &&
    stored.previous_version === body.expected_version &&
    stored.previous_state === body.expected_state &&
    stored.state_value === body.next_state &&
    stored.execution_surface === body.execution_surface &&
    stored.trigger_mode === body.trigger_mode &&
    stored.operation === body.operation
  );
}

function successfulStateResponse(stored: StoredStateVersion, replayed: boolean): Response {
  return Response.json({
    status: "SUCCESS",
    invocation_id: stored.invocation_id,
    execution_surface: stored.execution_surface,
    trigger_mode: stored.trigger_mode,
    operation: stored.operation,
    state_key: stored.state_key,
    previous_version: stored.previous_version,
    previous_state: stored.previous_state,
    version: stored.version,
    state: stored.state_value,
    idempotency_key: stored.idempotency_key,
    db_written_at: stored.db_written_at,
    db_read_at: stored.db_read_at,
    source_run_key: stored.source_run_key,
    replayed,
  });
}

async function replayOrConflict(
  env: Env,
  body: StateCompareAndSetRequest,
): Promise<Response | null> {
  const existing = await readStateVersionByIdempotencyKey(env, body.idempotency_key);
  if (!existing) {
    return null;
  }

  if (!stateMutationMatchesRequest(existing, body)) {
    return jsonStateError("IDEMPOTENCY_CONFLICT", 409, {
      idempotency_key: body.idempotency_key,
      state_key: body.state_key,
    });
  }

  return successfulStateResponse(existing, true);
}

async function staleStateResponse(env: Env, body: StateCompareAndSetRequest): Promise<Response> {
  const current = await readCurrentState(env, body.state_key);
  return jsonStateError("STALE_STATE", 409, {
    state_key: body.state_key,
    expected_version: body.expected_version,
    expected_state: body.expected_state,
    current_version: current?.version ?? 0,
    current_state: current?.state_value ?? null,
    db_read_at: current?.db_read_at ?? null,
  });
}

async function handleStateCompareAndSet(request: Request, env: Env): Promise<Response> {
  const authError = authenticate(request, env);
  if (authError) {
    return authError;
  }

  const body = await parseJson(request);
  if (!validateStateCompareAndSetRequest(body)) {
    return jsonError("INVALID_REQUEST", 400);
  }

  try {
    const replay = await replayOrConflict(env, body);
    if (replay) {
      return replay;
    }
  } catch {
    return jsonError("READBACK_FAILED", 500);
  }

  const invocationId = crypto.randomUUID();
  let writeResult: D1RunResult;

  try {
    if (body.expected_version === 0) {
      writeResult = await env.DB.prepare(
        `INSERT INTO prototype_state_versions (
          state_key,
          version,
          state_value,
          previous_version,
          previous_state,
          invocation_id,
          idempotency_key,
          execution_surface,
          trigger_mode,
          operation,
          db_written_at,
          source_run_key
        )
        SELECT
          ?,
          1,
          ?,
          0,
          NULL,
          ?,
          ?,
          ?,
          ?,
          ?,
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          ?
        WHERE NOT EXISTS (
          SELECT 1
          FROM prototype_state_versions
          WHERE state_key = ?
        )`,
      )
        .bind(
          body.state_key,
          body.next_state,
          invocationId,
          body.idempotency_key,
          body.execution_surface,
          body.trigger_mode,
          body.operation,
          body.source_run_key ?? null,
          body.state_key,
        )
        .run();
    } else {
      writeResult = await env.DB.prepare(
        `INSERT INTO prototype_state_versions (
          state_key,
          version,
          state_value,
          previous_version,
          previous_state,
          invocation_id,
          idempotency_key,
          execution_surface,
          trigger_mode,
          operation,
          db_written_at,
          source_run_key
        )
        SELECT
          ?,
          current.version + 1,
          ?,
          current.version,
          current.state_value,
          ?,
          ?,
          ?,
          ?,
          ?,
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          ?
        FROM (
          SELECT version, state_value
          FROM prototype_state_versions
          WHERE state_key = ?
          ORDER BY version DESC
          LIMIT 1
        ) AS current
        WHERE current.version = ?
          AND current.state_value = ?`,
      )
        .bind(
          body.state_key,
          body.next_state,
          invocationId,
          body.idempotency_key,
          body.execution_surface,
          body.trigger_mode,
          body.operation,
          body.source_run_key ?? null,
          body.state_key,
          body.expected_version,
          body.expected_state,
        )
        .run();
    }
  } catch {
    try {
      const replay = await replayOrConflict(env, body);
      if (replay) {
        return replay;
      }

      const current = await readCurrentState(env, body.state_key);
      const expectedStillMatches =
        body.expected_version === 0
          ? current === null
          : current?.version === body.expected_version && current?.state_value === body.expected_state;

      if (!expectedStillMatches) {
        return staleStateResponse(env, body);
      }
    } catch {
      return jsonError("PERSISTENCE_WRITE_FAILED", 500);
    }

    return jsonError("PERSISTENCE_WRITE_FAILED", 500);
  }

  if (!writeResult.success || writeResult.meta?.changes !== 1) {
    try {
      const replay = await replayOrConflict(env, body);
      if (replay) {
        return replay;
      }
      return staleStateResponse(env, body);
    } catch {
      return jsonError("READBACK_FAILED", 500);
    }
  }

  let stored: StoredStateVersion | null;
  try {
    stored = await readStateVersionByInvocationId(env, invocationId);
  } catch {
    return jsonError("READBACK_FAILED", 500);
  }

  if (!stored) {
    return jsonError("READBACK_NOT_FOUND", 500);
  }

  const expectedVersion = body.expected_version + 1;
  if (
    !stateMutationMatchesRequest(stored, body) ||
    stored.invocation_id !== invocationId ||
    stored.idempotency_key !== body.idempotency_key ||
    stored.version !== expectedVersion
  ) {
    return jsonError("READBACK_MISMATCH", 500);
  }

  return successfulStateResponse(stored, false);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return Response.json({
        service: "d1-runtime-prototype",
        status: "alive",
        version: "prototype1-state-cas-core",
      });
    }

    if (request.method === "GET" && url.pathname === "/d1-check") {
      try {
        const result = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();

        return Response.json({
          service: "d1-runtime-prototype",
          d1: result?.ok === 1 ? "connected" : "unexpected_result",
        });
      } catch {
        return Response.json(
          {
            service: "d1-runtime-prototype",
            d1: "error",
          },
          { status: 500 },
        );
      }
    }

    if (request.method === "POST" && url.pathname === "/prototype/time-roundtrip") {
      return handleTimeRoundtrip(request, env);
    }

    if (request.method === "POST" && url.pathname === "/prototype/state-cas") {
      return handleStateCompareAndSet(request, env);
    }

    if (request.method === "POST" && url.pathname === "/candidate/workos-persistence") {
      return handleWorkOsCandidatePersistence(request, env);
    }

    return Response.json(
      {
        error: "NOT_FOUND",
      },
      { status: 404 },
    );
  },
};
