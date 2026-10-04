import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const SAFE_TOKEN = /^[A-Za-z0-9._:-]+$/;

export type ExecutionSurface = "CHAT" | "WORK";
export type TriggerMode = "HUMAN" | "SCHEDULE";
export type RuntimeOperation = "TIME_ROUNDTRIP" | "STATE_COMPARE_AND_SET" | "READ" | "WRITE";
export type ReadSelector =
  | { kind: "CURRENT" }
  | { kind: "RECORD"; record_key: string }
  | { kind: "AFTER"; checkpoint_record_key: string; limit: number }
  | { kind: "TAIL"; limit: number };

export interface PersistenceReadRequest {
  execution_surface: ExecutionSurface;
  trigger_mode: TriggerMode;
  task_id: string;
  caller_identity: string;
  operation: "READ";
  dataset_id: string;
  instance_id: string;
  selector: ReadSelector;
}

export interface PersistenceWriteRequest {
  execution_surface: ExecutionSurface;
  trigger_mode: TriggerMode;
  task_id: string;
  caller_identity: string;
  operation: "WRITE";
  dataset_id: string;
  instance_id: string;
  idempotency_key: string;
  payload: unknown;
  record_key?: string;
  expected_version?: number;
}

export type PersistenceRequest = PersistenceReadRequest | PersistenceWriteRequest;

export interface RuntimeInvocationResult {
  httpStatus: number;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  operation: RuntimeOperation;
  endpoint: string;
  sourceRunKey?: string;
}

const WORKOS_ENDPOINT = "https://d1-runtime-prototype.lennyliu01.workers.dev/candidate/workos-persistence";
const TIME_ENDPOINT = "https://d1-runtime-prototype.lennyliu01.workers.dev/prototype/time-roundtrip";
const CAS_ENDPOINT = "https://d1-runtime-prototype.lennyliu01.workers.dev/prototype/state-cas";

function safeToken(value: string | undefined, max: number, field: string): string {
  if (!value || value.length > max || !SAFE_TOKEN.test(value)) throw new Error(`INVALID_${field}`);
  return value;
}

function boundedLimit(value: string | undefined): number {
  if (!value || !/^[1-9][0-9]?$|^100$/.test(value)) throw new Error("INVALID_LIMIT");
  return Number(value);
}

function lineMap(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of body.split(/\r?\n/)) {
    const i = line.indexOf(": ");
    if (i > 0 && !out.has(line.slice(0, i))) out.set(line.slice(0, i), line.slice(i + 2));
  }
  return out;
}

function executionMetadata(lines: Map<string, string>): { execution_surface: ExecutionSurface; trigger_mode: TriggerMode } {
  const execution_surface = lines.get("Execution_Surface");
  const trigger_mode = lines.get("Trigger_Mode");
  if (execution_surface !== "CHAT" && execution_surface !== "WORK") throw new Error("INVALID_EXECUTION_SURFACE");
  if (trigger_mode !== "HUMAN" && trigger_mode !== "SCHEDULE") throw new Error("INVALID_TRIGGER_MODE");
  return { execution_surface, trigger_mode };
}

export function parseIssueInvocation(title: string, body: string, issueNumber: number): {
  operation: RuntimeOperation;
  request: Record<string, unknown>;
  endpoint: string;
  sourceRunKey: string;
} {
  const lines = lineMap(body);
  const meta = executionMetadata(lines);
  const operation = lines.get("Operation") as RuntimeOperation | undefined;
  const sourceRunKey = `github-issue-${issueNumber}`;
  if (!operation) throw new Error("INVALID_OPERATION");
  if (title !== `[RUNTIME_INVOCATION] ${operation}`) throw new Error("TITLE_OPERATION_MISMATCH");

  if (operation === "TIME_ROUNDTRIP") {
    return { operation, endpoint: TIME_ENDPOINT, sourceRunKey, request: { ...meta, operation, source_run_key: sourceRunKey } };
  }

  if (operation === "STATE_COMPARE_AND_SET") {
    const stateKey = safeToken(lines.get("State_Key"), 64, "STATE_KEY");
    const expectedVersionRaw = lines.get("Expected_Version");
    if (!expectedVersionRaw || !/^(0|[1-9][0-9]*)$/.test(expectedVersionRaw)) throw new Error("INVALID_EXPECTED_VERSION");
    const expectedVersion = Number(expectedVersionRaw);
    if (expectedVersion > 2147483647) throw new Error("EXPECTED_VERSION_TOO_LARGE");
    const expectedState = lines.get("Expected_State");
    const nextState = safeToken(lines.get("Next_State"), 64, "NEXT_STATE");
    const idempotencyKey = safeToken(lines.get("Idempotency_Key"), 128, "IDEMPOTENCY_KEY");
    if (expectedVersion === 0 && expectedState !== "null") throw new Error("EXPECTED_STATE_MUST_BE_NULL");
    if (expectedVersion > 0) {
      safeToken(expectedState, 64, "EXPECTED_STATE");
      if (expectedState === nextState) throw new Error("NEXT_STATE_MUST_DIFFER");
    }
    return {
      operation,
      endpoint: CAS_ENDPOINT,
      sourceRunKey,
      request: {
        ...meta,
        operation,
        state_key: stateKey,
        expected_version: expectedVersion,
        expected_state: expectedVersion === 0 ? null : expectedState,
        next_state: nextState,
        idempotency_key: idempotencyKey,
        source_run_key: sourceRunKey,
      },
    };
  }

  if (operation !== "READ" && operation !== "WRITE") throw new Error("INVALID_OPERATION");
  const base = {
    ...meta,
    task_id: safeToken(lines.get("Task_ID"), 128, "TASK_ID"),
    caller_identity: safeToken(lines.get("Caller_Identity"), 128, "CALLER_IDENTITY"),
    operation,
    dataset_id: safeToken(lines.get("Dataset_ID"), 128, "DATASET_ID"),
    instance_id: safeToken(lines.get("Instance_ID"), 128, "INSTANCE_ID"),
  };

  if (operation === "READ") {
    const selector = lines.get("Selector");
    let selectorObj: ReadSelector;
    if (selector === "CURRENT") selectorObj = { kind: "CURRENT" };
    else if (selector === "RECORD") selectorObj = { kind: "RECORD", record_key: safeToken(lines.get("Record_Key"), 256, "RECORD_KEY") };
    else if (selector === "AFTER") selectorObj = {
      kind: "AFTER",
      checkpoint_record_key: safeToken(lines.get("Checkpoint_Record_Key"), 256, "CHECKPOINT_RECORD_KEY"),
      limit: boundedLimit(lines.get("Limit")),
    };
    else if (selector === "TAIL") selectorObj = { kind: "TAIL", limit: boundedLimit(lines.get("Limit")) };
    else throw new Error("INVALID_SELECTOR");
    return { operation, endpoint: WORKOS_ENDPOINT, sourceRunKey, request: { ...base, selector: selectorObj } };
  }

  const payloadJson = lines.get("Payload_JSON");
  if (!payloadJson) throw new Error("MISSING_PAYLOAD_JSON");
  let payload: unknown;
  try { payload = JSON.parse(payloadJson); } catch { throw new Error("INVALID_PAYLOAD_JSON"); }
  const request: Record<string, unknown> = {
    ...base,
    idempotency_key: safeToken(lines.get("Idempotency_Key"), 128, "IDEMPOTENCY_KEY"),
    payload,
  };
  if (lines.get("Record_Key")) request.record_key = safeToken(lines.get("Record_Key"), 256, "RECORD_KEY");
  if (lines.get("Expected_Version")) {
    const v = lines.get("Expected_Version")!;
    if (!/^(0|[1-9][0-9]*)$/.test(v) || Number(v) > 2147483647) throw new Error("INVALID_EXPECTED_VERSION");
    request.expected_version = Number(v);
  }
  return { operation, endpoint: WORKOS_ENDPOINT, sourceRunKey, request };
}

function validateTerminal(operation: RuntimeOperation, status: number, body: Record<string, unknown>): void {
  if (operation === "READ" || operation === "WRITE") {
    if (status === 200 && body.status === "SUCCESS" && body.operation === operation) return;
    if ([403, 404, 409].includes(status) && body.status === "FAILED" && typeof body.error === "string" && body.error.length > 0) return;
    throw new Error(`UNEXPECTED_WORKOS_TERMINAL:${status}`);
  }
  if (operation === "TIME_ROUNDTRIP") {
    if (status === 200 && body.status === "SUCCESS" && body.operation === operation && body.stored_status === "RECORDED") return;
    throw new Error(`UNEXPECTED_TIME_TERMINAL:${status}`);
  }
  if (status === 200 && body.status === "SUCCESS" && body.operation === operation) return;
  if (status === 409 && body.status === "FAILED" && (body.error === "STALE_STATE" || body.error === "IDEMPOTENCY_CONFLICT")) return;
  throw new Error(`UNEXPECTED_CAS_TERMINAL:${status}`);
}

export async function invokeRuntime(
  request: Record<string, unknown>,
  operation: RuntimeOperation,
  endpoint: string,
  runtimeSecret: string,
  fetchImpl: typeof fetch = fetch,
  sourceRunKey?: string,
): Promise<RuntimeInvocationResult> {
  if (!runtimeSecret) throw new Error("RUNTIME_SECRET_MISSING");
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${runtimeSecret}`, "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  let body: unknown;
  try { body = await response.json(); } catch { throw new Error("RUNTIME_RESPONSE_NOT_JSON"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("RUNTIME_RESPONSE_INVALID");
  validateTerminal(operation, response.status, body as Record<string, unknown>);
  return { httpStatus: response.status, request, response: body as Record<string, unknown>, operation, endpoint, sourceRunKey };
}

export async function invokePersistence(
  request: PersistenceRequest,
  runtimeSecret: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RuntimeInvocationResult> {
  return invokeRuntime(request as unknown as Record<string, unknown>, request.operation, WORKOS_ENDPOINT, runtimeSecret, fetchImpl);
}

export function formatIssueTerminalResult(result: RuntimeInvocationResult): string {
  const r = result.response;
  if (result.operation === "READ" || result.operation === "WRITE") {
    return [
      "RUNTIME_INVOCATION_RESULT",
      `Status: ${String(r.status ?? "FAILED")}`,
      `HTTP: ${result.httpStatus}`,
      `Execution_Surface: ${String((result.request as any).execution_surface ?? "")}`,
      `Trigger_Mode: ${String((result.request as any).trigger_mode ?? "")}`,
      `Operation: ${result.operation}`,
      `Runtime_Result_JSON: ${JSON.stringify(r)}`,
      `Source_Run_Key: ${result.sourceRunKey ?? ""}`,
      "Return_Target: CALLER",
      "Transport: GITHUB_ACTIONS",
    ].join("\n");
  }
  if (result.operation === "TIME_ROUNDTRIP") {
    return [
      "RUNTIME_INVOCATION_RESULT",
      `Invocation_ID: ${String(r.invocation_id ?? "")}`,
      `Status: ${String(r.status ?? "FAILED")}`,
      `Execution_Surface: ${String((result.request as any).execution_surface ?? "")}`,
      `Trigger_Mode: ${String((result.request as any).trigger_mode ?? "")}`,
      "Operation: TIME_ROUNDTRIP",
      `Stored_Status: ${String(r.stored_status ?? "")}`,
      `DB_Written_At: ${String(r.db_written_at ?? "")}`,
      `DB_Read_At: ${String(r.db_read_at ?? "")}`,
      `Source_Run_Key: ${result.sourceRunKey ?? ""}`,
      "Return_Target: CALLER",
      "Transport: GITHUB_ACTIONS",
    ].join("\n");
  }
  if (r.status === "SUCCESS") {
    return [
      "RUNTIME_INVOCATION_RESULT",
      `Invocation_ID: ${String(r.invocation_id ?? "")}`,
      "Status: SUCCESS",
      `HTTP: ${result.httpStatus}`,
      `Execution_Surface: ${String((result.request as any).execution_surface ?? "")}`,
      `Trigger_Mode: ${String((result.request as any).trigger_mode ?? "")}`,
      "Operation: STATE_COMPARE_AND_SET",
      `State_Key: ${String(r.state_key ?? "")}`,
      `Previous_Version: ${String(r.previous_version ?? "")}`,
      `Previous_State: ${String(r.previous_state ?? "")}`,
      `Version: ${String(r.version ?? "")}`,
      `State: ${String(r.state ?? "")}`,
      `Idempotency_Key: ${String(r.idempotency_key ?? "")}`,
      `Replayed: ${String(r.replayed ?? "")}`,
      `DB_Written_At: ${String(r.db_written_at ?? "")}`,
      `DB_Read_At: ${String(r.db_read_at ?? "")}`,
      `Source_Run_Key: ${result.sourceRunKey ?? ""}`,
      "Return_Target: CALLER",
      "Transport: GITHUB_ACTIONS",
    ].join("\n");
  }
  return [
    "RUNTIME_INVOCATION_RESULT",
    "Status: FAILED",
    `HTTP: ${result.httpStatus}`,
    `Error: ${String(r.error ?? "")}`,
    `Execution_Surface: ${String((result.request as any).execution_surface ?? "")}`,
    `Trigger_Mode: ${String((result.request as any).trigger_mode ?? "")}`,
    "Operation: STATE_COMPARE_AND_SET",
    `State_Key: ${String((result.request as any).state_key ?? "")}`,
    `Current_Version: ${String(r.current_version ?? "")}`,
    `Current_State: ${String(r.current_state ?? "")}`,
    `Source_Run_Key: ${result.sourceRunKey ?? ""}`,
    "Return_Target: CALLER",
    "Transport: GITHUB_ACTIONS",
  ].join("\n");
}

export async function runIssueEvent(event: any, runtimeSecret: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const parsed = parseIssueInvocation(String(event?.issue?.title ?? ""), String(event?.issue?.body ?? ""), Number(event?.issue?.number));
  const result = await invokeRuntime(parsed.request, parsed.operation, parsed.endpoint, runtimeSecret, fetchImpl, parsed.sourceRunKey);
  return formatIssueTerminalResult(result);
}


async function cli(): Promise<void> {
  const eventPath = process.argv[2] ?? process.env.GITHUB_EVENT_PATH;
  const secret = process.env.RUNTIME_SECRET;
  if (!eventPath || !secret) throw new Error("ISSUE_ADAPTER_CLI_CONFIGURATION_MISSING");
  const event = JSON.parse(await readFile(eventPath, "utf8"));
  console.log(await runIssueEvent(event, secret));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli().catch((error) => { console.error(error); process.exitCode = 1; });
}
