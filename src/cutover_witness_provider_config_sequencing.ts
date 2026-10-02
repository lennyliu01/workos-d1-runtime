import {
  CUTOVER_WITNESS_CREDENTIAL_LIFECYCLE_ID,
  CUTOVER_WITNESS_GOOGLE_AUTH_ACTION_SHA,
  CUTOVER_WITNESS_GOOGLE_SCOPE,
  CUTOVER_WITNESS_SERVICE_PRINCIPAL,
  CUTOVER_WITNESS_WIF_AUDIENCE,
  CUTOVER_WITNESS_WIF_POOL_FULL_NAME,
  CUTOVER_WITNESS_WIF_PROVIDER_FULL_NAME,
  CUTOVER_WITNESS_WORKER_SERVICE,
  CUTOVER_WITNESS_WORKER_URL,
} from "./cutover_witness_runtime_config";
import {
  MATERIALIZED_FIXTURE_PRODUCTION_DENYLIST_ID,
  MATERIALIZED_FIXTURE_ROOT_ID,
  MATERIALIZED_FIXTURE_SPREADSHEET_ID,
} from "./cutover_witness_fixture";

const enc = new TextEncoder();

export const CUTOVER_PROVIDER_CONFIG_DERIVATION_VERSION = "GSPC3";
export const CUTOVER_PROVIDER_CONFIG_SEQUENCING_VERSION = "GSPC3_ADMITTED_SHA_SEQ_V1";
export const CUTOVER_ACCEPTED_MAIN_ADMISSION_MODE = "EXACT_ACCEPTED_MAIN_ONLY";
export const CUTOVER_ACCEPTED_MAIN_SHA_BINDING =
  "POST_MERGE_EXACT_ACCEPTED_MAIN_SHA_REQUIRED";
export const CUTOVER_PREMERGE_PROVIDER_CONFIG_ID = "NOT_MATERIALIZED_PRE_MERGE";
export const CUTOVER_PREMERGE_CAPABILITY_MATRIX_VERSION =
  "NOT_MATERIALIZED_PRE_FINAL_PROVIDER_CONFIG";
export const CUTOVER_PREMERGE_ACCEPTANCE_BINDING_ID =
  "NOT_MATERIALIZED_PRE_FINAL_PROVIDER_CONFIG";
export const CUTOVER_PREMERGE_ACTUAL_DRE1 =
  "NOT_MATERIALIZED_PRE_DEPLOYMENT_READINESS";
export const CUTOVER_PREMERGE_AUTHORITY_STATUS =
  "NON_AUTHORITATIVE_CANDIDATE_ONLY";
export const CUTOVER_ACCEPTED_MAIN_SOURCE =
  "FRESH_READ_REFS_HEADS_MAIN_AFTER_GOVERNED_MERGE";
export const CUTOVER_ACTIVATION_FENCE =
  "EXACT_POST_MERGE_PROVIDER_ADMISSION_AND_DRE1_FENCE";

export const CUTOVER_EXPECTED_WIF_ATTRIBUTE_MAPPING = Object.freeze({
  "google.subject": "assertion.sub",
  "attribute.repository_id": "assertion.repository_id",
  "attribute.repository_owner_id": "assertion.repository_owner_id",
  "attribute.workflow_ref": "assertion.workflow_ref",
  "attribute.ref": "assertion.ref",
  "attribute.sha": "assertion.sha",
  "attribute.workflow_sha": "assertion.workflow_sha",
  "attribute.event_name": "assertion.event_name",
} as const);

const CAPABILITIES = Object.freeze([
  "EXACT_BUILD_DEPLOYMENT",
  "OIDC_TRUST_PROVENANCE",
  "WIF_TOKEN_MINT",
  "SERVICE_PRINCIPAL_ISOLATION",
  "SHORT_LIVED_ACCESS_TOKEN_LIFECYCLE",
  "FRESHNESS_AND_RERUN",
  "REVOCATION_FAIL_CLOSED",
  "SECRET_NONDISCLOSURE",
  "REAL_PROVIDER_READINESS_FIXTURE_ONLY",
  "DEPLOYMENT_READINESS_DRE1",
  "ACTIVATION_FENCE_DRE1",
  "AUTHENTICATED_FORMAL_ROUTE",
  "PRODUCTION_DENYLIST_PRE_PROVIDER",
  "CASE7_REGRESSION",
  "CASE8_REGRESSION",
  "FAULT_REGRESSION",
] as const);

export interface WifProviderAdmissionReadback {
  provider_full_name: string;
  state: "ACTIVE" | string;
  issuer: string;
  audience: string;
  attribute_mapping: Record<string, string>;
  attribute_condition: string;
  admitted_sha: string;
}

export interface FixedIdentityInputs {
  implementationBuildId: string;
  mutationAdapterFingerprint: string;
  resourceScopeFingerprint: string;
  credentialBindingId: string;
}

export interface PostMergeMaterialization {
  acceptedMainSha: string;
  approvedBaseMain: string;
  approvedCandidateCommit: string;
  workflowBlob: string;
  wifProviderAdmittedSha: string;
  wifProviderAdmissionReadbackFingerprint: string;
  providerConfigId: string;
  capabilityMatrixVersion: string;
  acceptanceBindingId: string;
  credentialLifecycleId: string;
  authorityStatus: "DERIVATION_ONLY_PENDING_DRE1_AND_ACTIVATION_FENCE";
  fixed: FixedIdentityInputs;
}

export interface Dre1FenceEvidence {
  accepted_main_commit: string;
  approved_candidate_commit: string;
  provider_config_id: string;
  acceptance_binding_id: string;
  credential_lifecycle_id: string;
  wif_provider_admitted_sha: string;
  wif_provider_admission_readback_fingerprint: string;
  terminal_finality: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function assertSha40(value: string, label: string): void {
  assert(/^[0-9a-f]{40}$/.test(value), label + "_MUST_BE_EXACT_40_HEX_SHA");
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const obj = value as Record<string, unknown>;
  return (
    "{" +
    Object.keys(obj)
      .sort()
      .map((key) => JSON.stringify(key) + ":" + canonical(obj[key]))
      .join(",") +
    "}"
  );
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function u16be(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, false);
  return out;
}

function u32be(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function k1b1(parts: readonly string[]): Uint8Array {
  const framed: Uint8Array[] = [enc.encode("K1B1"), u16be(parts.length)];
  for (const raw of parts) {
    const bytes = enc.encode(raw.normalize("NFC"));
    framed.push(new Uint8Array([0x53]), u32be(bytes.length), bytes);
  }
  return concat(framed);
}

async function ksha(parts: readonly string[]): Promise<string> {
  const framed = k1b1(parts);\n  const digest = await crypto.subtle.digest("SHA-256", framed.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function expectedWifAttributeCondition(acceptedMainSha: string): string {
  assertSha40(acceptedMainSha, "ACCEPTED_MAIN_SHA");
  return (
    "assertion.repository_id=='1380735463' && " +
    "assertion.repository_owner_id=='64623756' && " +
    "assertion.repository=='lennyliu01/workos-d1-runtime' && " +
    "assertion.ref=='refs/heads/main' && " +
    "assertion.workflow_ref=='lennyliu01/workos-d1-runtime/.github/workflows/cutover-witness-governed-publication-readiness.yml@refs/heads/main' && " +
    "assertion.event_name=='workflow_dispatch' && " +
    "assertion.workflow_sha==assertion.sha && " +
    "assertion.sha=='" +
    acceptedMainSha +
    "'"
  );
}

function exactMapping(readback: WifProviderAdmissionReadback): boolean {
  return canonical(readback.attribute_mapping) === canonical(CUTOVER_EXPECTED_WIF_ATTRIBUTE_MAPPING);
}

export async function assertAndFingerprintWifProviderReadback(
  readback: WifProviderAdmissionReadback,
  acceptedMainSha: string,
): Promise<string> {
  assertSha40(acceptedMainSha, "ACCEPTED_MAIN_SHA");
  assert(readback.provider_full_name === CUTOVER_WITNESS_WIF_PROVIDER_FULL_NAME, "WIF_PROVIDER_FULL_NAME_DRIFT");
  assert(readback.state === "ACTIVE", "WIF_PROVIDER_NOT_ACTIVE");
  assert(readback.issuer === "https://token.actions.githubusercontent.com", "WIF_ISSUER_DRIFT");
  assert(readback.audience === CUTOVER_WITNESS_WIF_AUDIENCE, "WIF_AUDIENCE_DRIFT");
  assert(exactMapping(readback), "WIF_ATTRIBUTE_MAPPING_DRIFT");
  assert(
    readback.attribute_condition === expectedWifAttributeCondition(acceptedMainSha),
    "WIF_TRUST_SCHEMA_OR_ADMITTED_SHA_DRIFT",
  );
  assert(readback.admitted_sha === acceptedMainSha, "WIF_ADMITTED_SHA_MISMATCH");
  return sha256Hex(
    canonical({
      provider_full_name: readback.provider_full_name,
      state: readback.state,
      issuer: readback.issuer,
      audience: readback.audience,
      attribute_mapping: readback.attribute_mapping,
      attribute_condition: readback.attribute_condition,
      admitted_sha: readback.admitted_sha,
    }),
  );
}

export function finalProviderPayload(
  acceptedMainSha: string,
  workflowBlob: string,
  credentialBindingId: string,
): Record<string, unknown> {
  assertSha40(acceptedMainSha, "ACCEPTED_MAIN_SHA");
  assertSha40(workflowBlob, "WORKFLOW_BLOB");
  return {
    accepted_main_admission_mode: CUTOVER_ACCEPTED_MAIN_ADMISSION_MODE,
    accepted_main_sha: acceptedMainSha,
    caller_auth_binding: "RUNTIME_SECRET",
    credential_binding_id: credentialBindingId,
    credential_lifecycle_id: CUTOVER_WITNESS_CREDENTIAL_LIFECYCLE_ID,
    deployment_mechanism: {
      approved_candidate_provenance: "SECOND_PARENT_OF_EXACT_ACCEPTED_MAIN_MERGE_COMMIT",
      auth_action_sha: CUTOVER_WITNESS_GOOGLE_AUTH_ACTION_SHA,
      candidate_evidence_path:
        "candidate_evidence/cutover_witness_deployment_config_repair_20260930_01.json",
      workflow_blob: workflowBlob,
      workflow_path:
        ".github/workflows/cutover-witness-governed-publication-readiness.yml",
    },
    fixture_root_id: MATERIALIZED_FIXTURE_ROOT_ID,
    fixture_spreadsheet_id: MATERIALIZED_FIXTURE_SPREADSHEET_ID,
    google_scope_set: [CUTOVER_WITNESS_GOOGLE_SCOPE],
    mutation_finality: "AMBIGUOUS_THEN_EXACT_REGISTERED_READBACK_NO_BLIND_RETRY",
    production_denylist_id: MATERIALIZED_FIXTURE_PRODUCTION_DENYLIST_ID,
    provider_primitives: {
      fault_boundary: "AFTER_REAL_PROVIDER_OPERATION_WITNESS_ONLY",
      mutate: "spreadsheets.batchUpdate/updateCells",
      read: "spreadsheets.values.get/UNFORMATTED_VALUE",
    },
    runtime_config_blob: "58984bae8edf7dc3b6daa9fe2995c497b3a66042",
    service_principal_email: CUTOVER_WITNESS_SERVICE_PRINCIPAL,
    wif_pool_full_name: CUTOVER_WITNESS_WIF_POOL_FULL_NAME,
    wif_provider_full_name: CUTOVER_WITNESS_WIF_PROVIDER_FULL_NAME,
    worker_service: CUTOVER_WITNESS_WORKER_SERVICE,
    worker_url: CUTOVER_WITNESS_WORKER_URL,
    formal_route: "/cutover/witness",
    readiness_route: "/cutover/witness/readiness",
  };
}

export async function deriveFinalProviderConfigId(
  acceptedMainSha: string,
  workflowBlob: string,
  credentialBindingId: string,
): Promise<string> {
  const payload = finalProviderPayload(acceptedMainSha, workflowBlob, credentialBindingId);
  return (
    "GSPC3_" +
    (await sha256Hex(
      canonical(["GSPC3", "CUTOVER_GOOGLE_PROVIDER_CONFIG", payload]),
    ))
  );
}

export async function deriveFinalCapabilityMatrixVersion(
  providerConfigId: string,
  fixed: FixedIdentityInputs,
): Promise<string> {
  assert(providerConfigId.startsWith("GSPC3_"), "FINAL_PROVIDER_CONFIG_REQUIRED");
  const digest = await ksha([
    "PCM8_CUTOVER_WIF_DEPLOYMENT_CONFIG_V1",
    fixed.implementationBuildId,
    fixed.mutationAdapterFingerprint,
    providerConfigId,
    fixed.resourceScopeFingerprint,
    fixed.credentialBindingId,
    CUTOVER_WITNESS_CREDENTIAL_LIFECYCLE_ID,
    ...CAPABILITIES.map((capability) => "CAP=" + capability),
  ]);
  return "PCM8_CUTOVER_WIF_" + digest.slice(0, 24);
}

export async function deriveFinalAcceptanceBindingId(
  providerConfigId: string,
  capabilityMatrixVersion: string,
  fixed: FixedIdentityInputs,
): Promise<string> {
  assert(providerConfigId.startsWith("GSPC3_"), "FINAL_PROVIDER_CONFIG_REQUIRED");
  assert(
    capabilityMatrixVersion.startsWith("PCM8_CUTOVER_WIF_"),
    "FINAL_CAPABILITY_MATRIX_REQUIRED",
  );
  return (
    "AB1_" +
    (await ksha([
      fixed.implementationBuildId,
      "a5f6447dd54fa3b5c5cdcb6ffada335cfe28fd8b3dad85b77693f522aab3c53f",
      "ba3bb9599a034a764c9bdfd10a3dca79436fbae80960ace6a64e2786035909f8",
      fixed.mutationAdapterFingerprint,
      providerConfigId,
      "RS1_84f170ffef50fecc331de87458db2bee9aeebf1bdf7c4e079260c338d477d7e1",
      "84f170ffef50fecc331de87458db2bee9aeebf1bdf7c4e079260c338d477d7e1",
      "MSET1_2f76282f0cc13c1df38b414d0221bebcc7f739fcb749ac6d7012e438f42f1cbc",
      "f9ae8ed9716b5dd447bad5f9951baef2bfb3f29161120a8118280204a1290ca7",
      "ROUTE_V1",
      "SHARED_ARCHIVE_INFRASTRUCTURE",
      fixed.resourceScopeFingerprint,
      capabilityMatrixVersion,
      fixed.credentialBindingId,
      CUTOVER_WITNESS_CREDENTIAL_LIFECYCLE_ID,
      "DEPLOYMENT_READINESS_EVIDENCE_VERSION=DRE1",
      "ACTIVATION_FENCE=EXACT_POST_MERGE_PROVIDER_ADMISSION_AND_DRE1_FENCE",
    ]))
  );
}

export async function materializePostMergeIdentities(input: {
  acceptedMainSource: string;
  currentMainSha: string;
  mergeParents: readonly string[];
  approvedBaseMain: string;
  approvedCandidateCommit: string;
  workflowBlob: string;
  wifProviderReadback: WifProviderAdmissionReadback;
  fixed: FixedIdentityInputs;
}): Promise<PostMergeMaterialization> {
  assert(
    input.acceptedMainSource === CUTOVER_ACCEPTED_MAIN_SOURCE,
    "ACCEPTED_MAIN_SHA_SOURCE_NOT_GOVERNED_FRESH_READ",
  );
  assertSha40(input.currentMainSha, "CURRENT_MAIN_SHA");
  assert(input.mergeParents.length === 2, "GOVERNED_MERGE_MUST_HAVE_EXACTLY_TWO_PARENTS");
  assert(
    input.mergeParents[0] === input.approvedBaseMain,
    "GOVERNED_MERGE_FIRST_PARENT_MISMATCH",
  );
  assert(
    input.mergeParents[1] === input.approvedCandidateCommit,
    "GOVERNED_MERGE_SECOND_PARENT_MISMATCH",
  );
  const fingerprint = await assertAndFingerprintWifProviderReadback(
    input.wifProviderReadback,
    input.currentMainSha,
  );
  const providerConfigId = await deriveFinalProviderConfigId(
    input.currentMainSha,
    input.workflowBlob,
    input.fixed.credentialBindingId,
  );
  const capabilityMatrixVersion = await deriveFinalCapabilityMatrixVersion(
    providerConfigId,
    input.fixed,
  );
  const acceptanceBindingId = await deriveFinalAcceptanceBindingId(
    providerConfigId,
    capabilityMatrixVersion,
    input.fixed,
  );
  return {
    acceptedMainSha: input.currentMainSha,
    approvedBaseMain: input.approvedBaseMain,
    approvedCandidateCommit: input.approvedCandidateCommit,
    workflowBlob: input.workflowBlob,
    wifProviderAdmittedSha: input.wifProviderReadback.admitted_sha,
    wifProviderAdmissionReadbackFingerprint: fingerprint,
    providerConfigId,
    capabilityMatrixVersion,
    acceptanceBindingId,
    credentialLifecycleId: CUTOVER_WITNESS_CREDENTIAL_LIFECYCLE_ID,
    authorityStatus: "DERIVATION_ONLY_PENDING_DRE1_AND_ACTIVATION_FENCE",
    fixed: input.fixed,
  };
}

export async function assertActivationFence(input: {
  currentMainSha: string;
  mergeParents: readonly string[];
  approvedBaseMain: string;
  approvedCandidateCommit: string;
  materialization: PostMergeMaterialization;
  freshWifProviderReadback: WifProviderAdmissionReadback;
  dre1?: Dre1FenceEvidence;
}): Promise<"PASS"> {
  const dre1 = input.dre1;
  assert(dre1, "DRE1_MISSING");
  assertSha40(input.currentMainSha, "CURRENT_MAIN_SHA");
  assert(input.mergeParents.length === 2, "GOVERNED_MERGE_MUST_HAVE_EXACTLY_TWO_PARENTS");
  assert(input.mergeParents[0] === input.approvedBaseMain, "ACTIVATION_FIRST_PARENT_MISMATCH");
  assert(
    input.mergeParents[1] === input.approvedCandidateCommit,
    "ACTIVATION_SECOND_PARENT_MISMATCH",
  );
  assert(
    input.materialization.acceptedMainSha === input.currentMainSha,
    "FINAL_GSPC3_ACCEPTED_MAIN_SHA_MISMATCH",
  );

  const freshFingerprint = await assertAndFingerprintWifProviderReadback(
    input.freshWifProviderReadback,
    input.currentMainSha,
  );
  assert(
    freshFingerprint === input.materialization.wifProviderAdmissionReadbackFingerprint,
    "WIF_PROVIDER_ADMISSION_READBACK_FINGERPRINT_DRIFT",
  );

  const recomputedProvider = await deriveFinalProviderConfigId(
    input.currentMainSha,
    input.materialization.workflowBlob,
    input.materialization.fixed.credentialBindingId,
  );
  assert(
    recomputedProvider === input.materialization.providerConfigId,
    "FINAL_PROVIDER_CONFIG_RECOMPUTATION_MISMATCH",
  );
  const recomputedPcm = await deriveFinalCapabilityMatrixVersion(
    recomputedProvider,
    input.materialization.fixed,
  );
  assert(
    recomputedPcm === input.materialization.capabilityMatrixVersion,
    "FINAL_CAPABILITY_MATRIX_RECOMPUTATION_MISMATCH",
  );
  const recomputedBinding = await deriveFinalAcceptanceBindingId(
    recomputedProvider,
    recomputedPcm,
    input.materialization.fixed,
  );
  assert(
    recomputedBinding === input.materialization.acceptanceBindingId,
    "FINAL_ACCEPTANCE_BINDING_RECOMPUTATION_MISMATCH",
  );

  assert(dre1.accepted_main_commit === input.currentMainSha, "DRE1_ACCEPTED_MAIN_MISMATCH");
  assert(
    dre1.approved_candidate_commit === input.approvedCandidateCommit,
    "DRE1_APPROVED_CANDIDATE_MISMATCH",
  );
  assert(
    dre1.provider_config_id === recomputedProvider,
    "DRE1_PROVIDER_CONFIG_MISMATCH",
  );
  assert(
    dre1.acceptance_binding_id === recomputedBinding,
    "DRE1_ACCEPTANCE_BINDING_MISMATCH",
  );
  assert(
    dre1.credential_lifecycle_id === CUTOVER_WITNESS_CREDENTIAL_LIFECYCLE_ID,
    "DRE1_CREDENTIAL_LIFECYCLE_MISMATCH",
  );
  assert(
    dre1.wif_provider_admitted_sha === input.currentMainSha,
    "DRE1_WIF_ADMITTED_SHA_MISMATCH",
  );
  assert(
    dre1.wif_provider_admission_readback_fingerprint === freshFingerprint,
    "DRE1_WIF_READBACK_FINGERPRINT_MISMATCH",
  );
  assert(dre1.terminal_finality === "PASS", "DRE1_TERMINAL_FINALITY_NOT_PASS");
  return "PASS";
}
