import { authorizePersistence, type GateProjectionSnapshot } from "./workos_persistent_gate_projection.js";

/**
 * Candidate-only adapter boundary. A production adapter must independently resolve
 * these values from the CURRENT singleton -> ACTIVE Manifest -> Registry/Gate.
 * Never accept this object from HTTP JSON, client headers, or a caller assertion.
 */
export interface TrustedDynamicInstanceContext {
  gate: GateProjectionSnapshot;
  registry: {
    companyId: string;
    companyName: string;
    ticker: string;
    exchange: string;
    stateStatus: string;
    monitorEnabled: boolean;
    archived: boolean;
  };
  authorizeInitialBaseline?: (scope: {
    manifestId: string;
    authorityFingerprint: string;
    datasetId: "RW_CURRENT_STATE";
    instanceId: string;
    callerIdentity: "Rolling_Wedge_Workflow";
    expectedVersion: 0;
    idempotencyKey: string;
    payloadJson: string;
  }) => Promise<boolean>;
}

export interface DynamicPersistenceRequest {
  task_id: string;
  caller_identity: string;
  operation: "READ" | "WRITE";
  dataset_id: string;
  instance_id: string;
  bootstrap_mode?: string;
  expected_version?: number;
  idempotency_key?: string;
  payload?: unknown;
  selector?: { kind: string };
}

const RW_DATASETS = new Set([
  "RW_CURRENT_STATE", "RW_EVIDENCE_HISTORY", "RW_REVISION_HISTORY",
  "RW_VALUATION_HISTORY", "RW_RUN_LOG",
]);
const INITIAL_FIELDS = [
  "Company_ID", "Company_Name", "Ticker", "Exchange", "Currency",
  "State_As_Of", "Base_Source_Materials", "Structured_State_Content",
] as const;

function deny(reason: string): never {
  throw new Error("D1_DYNAMIC_AUTHORITY_DENIED:" + reason);
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireInitialPayload(
  payload: unknown,
  instanceId: string,
  registry: TrustedDynamicInstanceContext["registry"],
): Record<string, unknown> {
  if (!plainRecord(payload)) return deny("INITIAL_PAYLOAD_NOT_OBJECT");
  const keys = Object.keys(payload).sort();
  if (keys.length !== INITIAL_FIELDS.length ||
      keys.some((key, index) => key !== [...INITIAL_FIELDS].sort()[index])) {
    return deny("INITIAL_FIELD_SCOPE");
  }
  if (payload.Company_ID !== instanceId || payload.Company_Name !== registry.companyName ||
      payload.Ticker !== registry.ticker || payload.Exchange !== registry.exchange) {
    return deny("INITIAL_IDENTITY_MISMATCH");
  }
  if (payload.Currency !== null || payload.State_As_Of !== null) {
    return deny("INITIAL_UNACCEPTED_STATE");
  }
  if (typeof payload.Base_Source_Materials !== "string" ||
      !payload.Base_Source_Materials.startsWith("https://docs.google.com/document/d/")) {
    return deny("INITIAL_SOURCE_UNVERIFIED");
  }
  if (!plainRecord(payload.Structured_State_Content) &&
      typeof payload.Structured_State_Content !== "string") {
    return deny("INITIAL_CONTENT_INVALID");
  }
  return payload;
}

/**
 * An authorization check, not a publisher, Gate replacement or grant issuer.
 * The instance is selected by ONE exact active Manifest member, not a wildcard.
 * DRAFT controls business activation; businessAuthorityState controls whether
 * the independently accepted persistent instance can be written at all.
 */
export async function authorizeDynamicD1Request(
  request: DynamicPersistenceRequest,
  context: TrustedDynamicInstanceContext,
): Promise<void> {
  if (request.task_id !== "ROLLING_WEDGE_INVESTMENT" ||
      !RW_DATASETS.has(request.dataset_id)) return deny("TASK_OR_DATASET");
  if (!context || !context.gate || !context.registry) return deny("CONTEXT_MISSING");
  const registry = context.registry;
  if (registry.companyId !== request.instance_id || !registry.companyId ||
      !registry.companyName || !registry.ticker || !registry.exchange ||
      registry.archived) return deny("REGISTRY_IDENTITY_OR_ARCHIVED");
  if (registry.stateStatus !== "DRAFT" && registry.stateStatus !== "ACTIVE") {
    return deny("REGISTRY_STATE");
  }
  if (registry.stateStatus === "DRAFT" && registry.monitorEnabled) {
    return deny("DRAFT_MONITOR_ENABLED");
  }
  if (registry.stateStatus === "ACTIVE" && !registry.monitorEnabled) {
    return deny("ACTIVE_MONITOR_DISABLED");
  }

  const matches = context.gate.accesses.filter((entry) =>
    entry.datasetId === request.dataset_id && entry.instanceId === request.instance_id);
  if (matches.length !== 1) return deny("INSTANCE_NOT_EXACTLY_REGISTERED");
  const entry = matches[0];
  if (!entry.dynamicInstance ||
      entry.logicalMember !== "D1_BOUND_DATASET:" + request.dataset_id + ";Binding=DB" ||
      entry.businessAuthorityState !== "ACTIVE") {
    return deny("PHYSICAL_OR_BUSINESS_AUTHORITY");
  }

  // Separate DRAFT company activation from the persistence authority. DRAFT
  // grants only a narrow first-current-state initialization and exact readback.
  if (registry.stateStatus === "DRAFT") {
    if (request.dataset_id !== "RW_CURRENT_STATE" ||
        request.caller_identity !== "Rolling_Wedge_Workflow") {
      return deny("DRAFT_ONLY_WORKFLOW_CURRENT_STATE");
    }
    if (request.operation === "READ") {
      if (request.bootstrap_mode !== undefined || request.selector?.kind !== "CURRENT") {
        return deny("DRAFT_READBACK_ONLY");
      }
    } else {
      if (request.bootstrap_mode !== "INITIAL_BASELINE" ||
          request.expected_version !== 0 || !request.idempotency_key) {
        return deny("DRAFT_ONLY_INITIAL_V0");
      }
      requireInitialPayload(request.payload, request.instance_id, registry);
    }
  } else if (request.bootstrap_mode !== undefined) {
    return deny("ACTIVE_BOOTSTRAP_MODE_FORBIDDEN");
  }

  const scopes = entry.writerScopes.filter((x) => x.writerId === request.caller_identity);
  const operation = request.dataset_id === "RW_CURRENT_STATE"
    ? "CONDITIONAL_CURRENT_STATE" : "APPEND_ONLY";
  if (request.operation === "READ" && !entry.readers.has(request.caller_identity)) {
    return deny("READER_NOT_IN_MANIFEST");
  }
  if (request.operation === "WRITE" && (scopes.length !== 1 ||
      !scopes[0].operations.has(operation))) {
    return deny("WRITER_NOT_IN_MANIFEST");
  }

  // Existing pinned Persistent_Data_Gate projection enforces singleton,
  // ACTIVE Manifest, exact Instance/Writer, contract and fence invariants.
  authorizePersistence(context.gate, {
    taskId: request.task_id,
    callerIdentity: request.caller_identity,
    manifestId: context.gate.manifestId,
    datasetId: request.dataset_id,
    instanceId: request.instance_id,
    logicalMember: entry.logicalMember,
    operation: request.operation,
    ...(request.operation === "WRITE" ? {
      writeOperation: operation,
      fields: plainRecord(request.payload) ? new Set(Object.keys(request.payload)) : new Set<string>(),
    } : {}),
  });

  if (registry.stateStatus === "DRAFT" && request.operation === "WRITE") {
    // A Gate ALLOW does not itself create an INITIAL_BASELINE grant. The
    // authenticated external issuer/consumption route is still an owner gate.
    if (!context.authorizeInitialBaseline) return deny("BOOTSTRAP_GRANT_UNAVAILABLE");
    const payloadJson = JSON.stringify(request.payload);
    const authorized = await context.authorizeInitialBaseline({
      manifestId: context.gate.manifestId,
      authorityFingerprint: context.gate.authorityPublication?.authorityScopeFingerprint ?? "",
      datasetId: "RW_CURRENT_STATE",
      instanceId: request.instance_id,
      callerIdentity: "Rolling_Wedge_Workflow",
      expectedVersion: 0,
      idempotencyKey: request.idempotency_key!,
      payloadJson,
    });
    if (authorized !== true) return deny("BOOTSTRAP_GRANT_DENIED");
  }
}
