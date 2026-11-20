import {
  loadControlPlane,
  type ExactControlPlaneReader,
  type LoadedControlPlane,
  type SupportedTaskId,
} from "./workos_control_plane_loader.js";
import type {
  DynamicPersistenceRequest,
  TrustedDynamicInstanceContext,
} from "./workos_d1_bootstrap_guard.js";
import type { GitHubInvokerIdentity } from "./workos_github_oidc_invoker.js";
import { publishedInitialBaselineGrantIsEligible } from "./workos_initial_baseline_grant_projection.js";

/**
 * R3 candidate: bind only to the singleton-selected ACTIVE Registry/Manifest/Gate.
 * A provider token or a user-controlled caller_identity is NEVER a WorkOS Grant.
 * Production issuer and credential acquisition remain separate owner-governed
 * deployment dependencies. If either is absent, first-baseline WRITE fails closed.
 */
type InitialScope = Parameters<
  NonNullable<TrustedDynamicInstanceContext["authorizeInitialBaseline"]>
>[0];

export interface OnceOnlyInitialBaselineIssuer {
  /** An authenticated external owner-issued grant: exactly one durable consume. */
  consumeExact(scope: InitialScope & {
    activationEpoch: string;
    cutoverId: string;
    registrySnapshotId: string;
    manifestFingerprint: string;
    // Cloudflare Worker binds this via verified GitHub OIDC; nonproduction
    // unit tests may omit it but any real issuer MUST reject missing proof.
    verifiedInvoker?: GitHubInvokerIdentity;
  }): Promise<boolean>;
}

function field(block: string, label: string): string {
  const lines = block.split("\n");
  const candidates = lines.filter(line => line.startsWith("- " + label + ": "));
  if (candidates.length !== 1) {
    throw new Error("TRUSTED_COMPANY_FIELD_NOT_UNIQUE:" + label);
  }
  const value = candidates[0].slice(("- " + label + ": ").length).trim();
  const unquoted = value.startsWith("`") && value.endsWith("`")
    ? value.slice(1,-1) : value;
  if (!unquoted || unquoted.includes("\n")) {
    throw new Error("TRUSTED_COMPANY_FIELD_INVALID:" + label);
  }
  return unquoted;
}

export function readExactCompanyIdentity(baseline: string, id: string) {
  if (!/^[A-Z0-9._:-]{1,64}$/.test(id)) {
    throw new Error("TRUSTED_COMPANY_ID_INVALID");
  }
  const lines = baseline.split("\n");
  const headings = lines.map((line,index) =>
    line.trim() === "## " + id ? index : -1).filter(i => i >= 0);
  if (headings.length !== 1) {
    throw new Error("TRUSTED_COMPANY_NOT_UNIQUE:" + id);
  }
  const start = headings[0];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ") || lines[i].startsWith("# ")) {
      end = i; break;
    }
  }
  const block = lines.slice(start, end).join("\n");
  const companyId = field(block,"Company_ID");
  if (companyId !== id) throw new Error("TRUSTED_COMPANY_IDENTITY_DRIFT");
  const state = field(block, "State_Status");
  if (state !== "ACTIVE" && state !== "DRAFT") {
    throw new Error("TRUSTED_COMPANY_STATE_NOT_ELIGIBLE");
  }
  const enabled = field(block,"Monitor_Enabled"), archived = field(block,"Archived");
  if (!["TRUE","FALSE"].includes(enabled) || !["TRUE","FALSE"].includes(archived)) {
    throw new Error("TRUSTED_COMPANY_BOOLEAN_INVALID");
  }
  if ((state === "DRAFT" && enabled !== "FALSE") ||
      (state === "ACTIVE" && enabled !== "TRUE") || archived !== "FALSE") {
    throw new Error("TRUSTED_COMPANY_ACTIVATION_INCONSISTENT");
  }
  return {
    companyId,
    companyName: field(block,"Company"),
    ticker: field(block,"Ticker"),
    exchange: field(block,"Exchange"),
    stateStatus: state,
    monitorEnabled: enabled === "TRUE",
    archived: false,
  };
}

function exactLoadedPlane(cp: LoadedControlPlane, request: DynamicPersistenceRequest) {
  if (cp.task.taskId !== "ROLLING_WEDGE_INVESTMENT" ||
      cp.projectionDrift || !cp.companiesBaselineText ||
      !cp.registryCompaniesBaselineFileId ||
      cp.registryCompaniesBaselineFileId !== cp.task.companiesBaselineFileId ||
      cp.gate.taskId !== "ROLLING_WEDGE_INVESTMENT" ||
      cp.gate.manifestState !== "ACTIVE" ||
      cp.gate.authorityPublicationState !== "EXACT_ONE" ||
      !cp.gate.authorityPublication ||
      !cp.authority.activationEpoch || !cp.manifestFingerprint) {
    throw new Error("TRUSTED_DYNAMIC_AUTHORITY_UNAVAILABLE");
  }
  const matching = cp.gate.accesses.filter(access =>
    access.instanceId === request.instance_id &&
    access.datasetId === request.dataset_id);
  if (matching.length !== 1 || !matching[0].dynamicInstance ||
      matching[0].logicalMember !==
        "D1_BOUND_DATASET:" + request.dataset_id + ";Binding=DB") {
    throw new Error("TRUSTED_DYNAMIC_INSTANCE_NOT_PROJECTED");
  }
  const registry = readExactCompanyIdentity(cp.companiesBaselineText,request.instance_id);
  if (matching[0].businessAuthorityState !== registry.stateStatus) {
    throw new Error("TRUSTED_COMPANY_GATE_STATE_DRIFT");
  }
  return registry;
}

export function createTrustedDynamicD1Resolver(
  reader: ExactControlPlaneReader,
  issuer?: OnceOnlyInitialBaselineIssuer,
  // Candidate unit seam; Worker always uses default authoritative loader.
  load: (reader: ExactControlPlaneReader, taskId: SupportedTaskId) => Promise<LoadedControlPlane> =
    loadControlPlane,
): (request: DynamicPersistenceRequest) => Promise<TrustedDynamicInstanceContext> {
  return async (request) => {
    if (request.task_id !== "ROLLING_WEDGE_INVESTMENT" ||
        typeof request.instance_id !== "string" ||
        typeof request.dataset_id !== "string") {
      throw new Error("TRUSTED_DYNAMIC_TASK_SCOPE_DENIED");
    }
    // Fresh per request, never cached or passed from HTTP. loadControlPlane
    // enforces singleton, target Cutover, Manifest, physical Gate, and fences.
    const cp = await load(reader, "ROLLING_WEDGE_INVESTMENT");
    const registry = exactLoadedPlane(cp, request);
    return {
      gate: cp.gate,
      registry,
      ...(issuer ? {
        authorizeInitialBaseline: async (scope: InitialScope) => {
          if (request.operation !== "WRITE" || registry.stateStatus !== "DRAFT" ||
              scope.instanceId !== request.instance_id ||
              scope.manifestId !== cp.gate.manifestId ||
              scope.authorityFingerprint !== cp.authority.authorityScopeFingerprint ||
              scope.expectedVersion !== 0 ||
              scope.datasetId !== "RW_CURRENT_STATE" ||
              scope.callerIdentity !== "Rolling_Wedge_Workflow" ||
              scope.idempotencyKey !== request.idempotency_key) return false;
          // Grant State is read only from the current ACTIVE Manifest's
          // Publisher-selected projection, NEVER from HTTP JSON or a cached
          // snapshot. Exact payload SHA256 blocks substitution under the same
          // granted idempotency key.
          const issued = await publishedInitialBaselineGrantIsEligible(reader, cp, {
            ...scope,
            activationEpoch: cp.authority.activationEpoch,
            manifestFingerprint: cp.manifestFingerprint,
          });
          if(!issued)return false;
          // Issued eligibility != consumed: the independent issuer/consumer
          // and D1 expected_version=0 CAS still must both succeed.
          return issuer.consumeExact({
            ...scope,
            activationEpoch: cp.authority.activationEpoch,
            cutoverId: cp.authority.currentCutoverId,
            registrySnapshotId: cp.authority.registrySnapshotId,
            manifestFingerprint: cp.manifestFingerprint,
          });
        },
      } : {}),
    };
  };
}
