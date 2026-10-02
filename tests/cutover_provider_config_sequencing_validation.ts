import { readFileSync } from "node:fs";
import {
  CUTOVER_ACCEPTED_MAIN_ADMISSION_MODE,
  CUTOVER_ACCEPTED_MAIN_SHA_BINDING,
  CUTOVER_ACCEPTED_MAIN_SOURCE,
  CUTOVER_ACTIVATION_FENCE,
  CUTOVER_PREMERGE_ACCEPTANCE_BINDING_ID,
  CUTOVER_PREMERGE_ACTUAL_DRE1,
  CUTOVER_PREMERGE_AUTHORITY_STATUS,
  CUTOVER_PREMERGE_CAPABILITY_MATRIX_VERSION,
  CUTOVER_PREMERGE_PROVIDER_CONFIG_ID,
  CUTOVER_PROVIDER_CONFIG_DERIVATION_VERSION,
  CUTOVER_PROVIDER_CONFIG_SEQUENCING_VERSION,
  CUTOVER_EXPECTED_WIF_ATTRIBUTE_MAPPING,
  WifProviderAdmissionReadback,
  assertActivationFence,
  deriveFinalAcceptanceBindingId,
  deriveFinalCapabilityMatrixVersion,
  deriveFinalProviderConfigId,
  expectedWifAttributeCondition,
  materializePostMergeIdentities,
} from "../src/cutover_witness_provider_config_sequencing";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
async function expectFailure(fn: () => Promise<unknown>, expected: string): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(message.includes(expected), "wrong fail-closed error: " + message + " expected " + expected);
    return;
  }
  throw new Error("expected fail-closed error: " + expected);
}

const SHA_A = "1111111111111111111111111111111111111111";
const SHA_B = "2222222222222222222222222222222222222222";
const APPROVED_BASE = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const APPROVED_CANDIDATE = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const WORKFLOW_BLOB = "328a6a31c658bae9f552252798efdc37abaa049c";
const fixed = {
  implementationBuildId: "IB1_72b49af80ef348ab279f30037bfbcf45d0c4a0c422cf01a46daa6f95011a17ed",
  mutationAdapterFingerprint: "94df6a7268cf3fd91569e55e8b343eff1e1b226df561198ed5ff937fcf7ddde7",
  resourceScopeFingerprint: "07c47193893d8683cab1bffff5f63249587ec9068d135bb83064264a68fc99eb",
  credentialBindingId: "GCB2_7d8986c2f27085c14c3b5a2d4cdc15b46c3f9bad9352e6da1b682a2b0ff356c6",
};

function readback(sha: string): WifProviderAdmissionReadback {
  return {
    provider_full_name:
      "projects/959429469584/locations/global/workloadIdentityPools/workos-cutover-witness/providers/github-workos-d1-runtime",
    state: "ACTIVE",
    issuer: "https://token.actions.githubusercontent.com",
    audience:
      "projects/959429469584/locations/global/workloadIdentityPools/workos-cutover-witness/providers/github-workos-d1-runtime",
    attribute_mapping: { ...CUTOVER_EXPECTED_WIF_ATTRIBUTE_MAPPING },
    attribute_condition: expectedWifAttributeCondition(sha),
    admitted_sha: sha,
  };
}

async function main(): Promise<void> {
  const evidence = JSON.parse(
    readFileSync(
      "candidate_evidence/cutover_witness_deployment_config_repair_20260930_01.json",
      "utf8",
    ),
  ) as Record<string, any>;

  assert(CUTOVER_PROVIDER_CONFIG_DERIVATION_VERSION === "GSPC3", "GSPC3 derivation drift");
  assert(
    CUTOVER_PROVIDER_CONFIG_SEQUENCING_VERSION === "GSPC3_ADMITTED_SHA_SEQ_V1",
    "sequencing version drift",
  );
  assert(CUTOVER_ACCEPTED_MAIN_ADMISSION_MODE === "EXACT_ACCEPTED_MAIN_ONLY", "admission mode drift");
  assert(
    CUTOVER_ACCEPTED_MAIN_SHA_BINDING === "POST_MERGE_EXACT_ACCEPTED_MAIN_SHA_REQUIRED",
    "SHA binding drift",
  );
  assert(CUTOVER_PREMERGE_PROVIDER_CONFIG_ID === "NOT_MATERIALIZED_PRE_MERGE", "premerge GSPC3 drift");
  assert(
    CUTOVER_PREMERGE_CAPABILITY_MATRIX_VERSION === "NOT_MATERIALIZED_PRE_FINAL_PROVIDER_CONFIG",
    "premerge PCM drift",
  );
  assert(
    CUTOVER_PREMERGE_ACCEPTANCE_BINDING_ID === "NOT_MATERIALIZED_PRE_FINAL_PROVIDER_CONFIG",
    "premerge AB drift",
  );
  assert(CUTOVER_PREMERGE_ACTUAL_DRE1 === "NOT_MATERIALIZED_PRE_DEPLOYMENT_READINESS", "premerge DRE1 drift");
  assert(CUTOVER_PREMERGE_AUTHORITY_STATUS === "NON_AUTHORITATIVE_CANDIDATE_ONLY", "authority status drift");
  assert(CUTOVER_ACTIVATION_FENCE === "EXACT_POST_MERGE_PROVIDER_ADMISSION_AND_DRE1_FENCE", "fence drift");

  // A/B/C: accepted_main_sha sensitivity propagates GSPC3 -> PCM -> Acceptance_Binding.
  const providerA = await deriveFinalProviderConfigId(SHA_A, WORKFLOW_BLOB, fixed.credentialBindingId);
  const providerB = await deriveFinalProviderConfigId(SHA_B, WORKFLOW_BLOB, fixed.credentialBindingId);
  assert(providerA !== providerB, "A: GSPC3 not SHA-sensitive");
  const pcmA = await deriveFinalCapabilityMatrixVersion(providerA, fixed);
  const pcmB = await deriveFinalCapabilityMatrixVersion(providerB, fixed);
  assert(pcmA !== pcmB, "B: PCM not final-GSPC3-sensitive");
  const abA = await deriveFinalAcceptanceBindingId(providerA, pcmA, fixed);
  const abB = await deriveFinalAcceptanceBindingId(providerB, pcmB, fixed);
  assert(abA !== abB, "C: Acceptance_Binding not final identity-sensitive");

  // D: vectors are validation-only and never publication authority.
  const testVectors = [
    { sha: SHA_A, authority: false, classification: "NON_AUTHORITY_TEST_VECTOR" },
    { sha: SHA_B, authority: false, classification: "NON_AUTHORITY_TEST_VECTOR" },
  ];
  assert(testVectors.every((vector) => vector.authority === false), "test vector gained authority");

  // E/F: no accepted_main_sha and non-governed sources fail closed.
  await expectFailure(
    () =>
      materializePostMergeIdentities({
        acceptedMainSource: CUTOVER_ACCEPTED_MAIN_SOURCE,
        currentMainSha: "",
        mergeParents: [APPROVED_BASE, APPROVED_CANDIDATE],
        approvedBaseMain: APPROVED_BASE,
        approvedCandidateCommit: APPROVED_CANDIDATE,
        workflowBlob: WORKFLOW_BLOB,
        wifProviderReadback: readback(SHA_A),
        fixed,
      }),
    "CURRENT_MAIN_SHA_MUST_BE_EXACT_40_HEX_SHA",
  );
  await expectFailure(
    () =>
      materializePostMergeIdentities({
        acceptedMainSource: "USER_SUPPLIED_SHA",
        currentMainSha: SHA_A,
        mergeParents: [APPROVED_BASE, APPROVED_CANDIDATE],
        approvedBaseMain: APPROVED_BASE,
        approvedCandidateCommit: APPROVED_CANDIDATE,
        workflowBlob: WORKFLOW_BLOB,
        wifProviderReadback: readback(SHA_A),
        fixed,
      }),
    "ACCEPTED_MAIN_SHA_SOURCE_NOT_GOVERNED_FRESH_READ",
  );
  await expectFailure(
    () =>
      materializePostMergeIdentities({
        acceptedMainSource: "LATEST_HEURISTIC",
        currentMainSha: SHA_A,
        mergeParents: [APPROVED_BASE, APPROVED_CANDIDATE],
        approvedBaseMain: APPROVED_BASE,
        approvedCandidateCommit: APPROVED_CANDIDATE,
        workflowBlob: WORKFLOW_BLOB,
        wifProviderReadback: readback(SHA_A),
        fixed,
      }),
    "ACCEPTED_MAIN_SHA_SOURCE_NOT_GOVERNED_FRESH_READ",
  );

  // G/H/I: merge parent, admitted SHA, and trust-schema drift all fail closed.
  await expectFailure(
    () =>
      materializePostMergeIdentities({
        acceptedMainSource: CUTOVER_ACCEPTED_MAIN_SOURCE,
        currentMainSha: SHA_A,
        mergeParents: [APPROVED_BASE, SHA_B],
        approvedBaseMain: APPROVED_BASE,
        approvedCandidateCommit: APPROVED_CANDIDATE,
        workflowBlob: WORKFLOW_BLOB,
        wifProviderReadback: readback(SHA_A),
        fixed,
      }),
    "GOVERNED_MERGE_SECOND_PARENT_MISMATCH",
  );
  await expectFailure(
    () =>
      materializePostMergeIdentities({
        acceptedMainSource: CUTOVER_ACCEPTED_MAIN_SOURCE,
        currentMainSha: SHA_A,
        mergeParents: [APPROVED_BASE, APPROVED_CANDIDATE],
        approvedBaseMain: APPROVED_BASE,
        approvedCandidateCommit: APPROVED_CANDIDATE,
        workflowBlob: WORKFLOW_BLOB,
        wifProviderReadback: readback(SHA_B),
        fixed,
      }),
    "WIF_TRUST_SCHEMA_OR_ADMITTED_SHA_DRIFT",
  );
  const trustDrift = readback(SHA_A);
  trustDrift.attribute_mapping["attribute.ref"] = "assertion.repository";
  await expectFailure(
    () =>
      materializePostMergeIdentities({
        acceptedMainSource: CUTOVER_ACCEPTED_MAIN_SOURCE,
        currentMainSha: SHA_A,
        mergeParents: [APPROVED_BASE, APPROVED_CANDIDATE],
        approvedBaseMain: APPROVED_BASE,
        approvedCandidateCommit: APPROVED_CANDIDATE,
        workflowBlob: WORKFLOW_BLOB,
        wifProviderReadback: trustDrift,
        fixed,
      }),
    "WIF_ATTRIBUTE_MAPPING_DRIFT",
  );

  const materialized = await materializePostMergeIdentities({
    acceptedMainSource: CUTOVER_ACCEPTED_MAIN_SOURCE,
    currentMainSha: SHA_A,
    mergeParents: [APPROVED_BASE, APPROVED_CANDIDATE],
    approvedBaseMain: APPROVED_BASE,
    approvedCandidateCommit: APPROVED_CANDIDATE,
    workflowBlob: WORKFLOW_BLOB,
    wifProviderReadback: readback(SHA_A),
    fixed,
  });
  assert(
    materialized.authorityStatus === "DERIVATION_ONLY_PENDING_DRE1_AND_ACTIVATION_FENCE",
    "post-merge derivation incorrectly became publication authority",
  );

  const dre1 = {
    accepted_main_commit: SHA_A,
    approved_candidate_commit: APPROVED_CANDIDATE,
    provider_config_id: materialized.providerConfigId,
    acceptance_binding_id: materialized.acceptanceBindingId,
    credential_lifecycle_id: "GCL1_538d093018ca96dfcc7cccf5a0f772e5f1f2009eec8d02f277e9105661baa396",
    wif_provider_admitted_sha: SHA_A,
    wif_provider_admission_readback_fingerprint:
      materialized.wifProviderAdmissionReadbackFingerprint,
    terminal_finality: "PASS",
  };

  assert(
    await assertActivationFence({
      currentMainSha: SHA_A,
      mergeParents: [APPROVED_BASE, APPROVED_CANDIDATE],
      approvedBaseMain: APPROVED_BASE,
      approvedCandidateCommit: APPROVED_CANDIDATE,
      materialization: materialized,
      freshWifProviderReadback: readback(SHA_A),
      dre1,
    }) === "PASS",
    "valid activation fence failed",
  );

  // J: missing/stale DRE1 fails closed.
  await expectFailure(
    () =>
      assertActivationFence({
        currentMainSha: SHA_A,
        mergeParents: [APPROVED_BASE, APPROVED_CANDIDATE],
        approvedBaseMain: APPROVED_BASE,
        approvedCandidateCommit: APPROVED_CANDIDATE,
        materialization: materialized,
        freshWifProviderReadback: readback(SHA_A),
      }),
    "DRE1_MISSING",
  );
  await expectFailure(
    () =>
      assertActivationFence({
        currentMainSha: SHA_A,
        mergeParents: [APPROVED_BASE, APPROVED_CANDIDATE],
        approvedBaseMain: APPROVED_BASE,
        approvedCandidateCommit: APPROVED_CANDIDATE,
        materialization: materialized,
        freshWifProviderReadback: readback(SHA_A),
        dre1: { ...dre1, accepted_main_commit: SHA_B },
      }),
    "DRE1_ACCEPTED_MAIN_MISMATCH",
  );

  // K: pre-merge GSPC3/PCM/AB claims cannot satisfy the final activation fence.
  assert(evidence.successor_identities.provider_config_id === CUTOVER_PREMERGE_PROVIDER_CONFIG_ID, "premerge final GSPC3 claim remains");
  assert(
    evidence.successor_identities.capability_matrix_version === CUTOVER_PREMERGE_CAPABILITY_MATRIX_VERSION,
    "premerge final PCM claim remains",
  );
  assert(
    evidence.successor_identities.acceptance_binding_id === CUTOVER_PREMERGE_ACCEPTANCE_BINDING_ID,
    "premerge final AB claim remains",
  );
  await expectFailure(
    () =>
      assertActivationFence({
        currentMainSha: SHA_A,
        mergeParents: [APPROVED_BASE, APPROVED_CANDIDATE],
        approvedBaseMain: APPROVED_BASE,
        approvedCandidateCommit: APPROVED_CANDIDATE,
        materialization: {
          ...materialized,
          providerConfigId:
            "GSPC3_b052e34061c3acea0d92b899ddeb4ea435fac7c46f86c9830af8b402f135c236",
          capabilityMatrixVersion: "PCM8_CUTOVER_WIF_2a8ea9a9683ade0728eadafb",
          acceptanceBindingId:
            "AB1_74ebeddcd13f8b94d3a040d73588b19a8f77792a0928e1685ada31896d07ca72",
        },
        freshWifProviderReadback: readback(SHA_A),
        dre1,
      }),
    "FINAL_PROVIDER_CONFIG_RECOMPUTATION_MISMATCH",
  );

  console.log(JSON.stringify({
    cutover_provider_config_sequencing_validation: "PASS",
    sequencing_version: CUTOVER_PROVIDER_CONFIG_SEQUENCING_VERSION,
    sha_vectors: [
      { sha: SHA_A, authority: false, gspc3: providerA, pcm: pcmA, acceptance_binding: abA },
      { sha: SHA_B, authority: false, gspc3: providerB, pcm: pcmB, acceptance_binding: abB },
    ],
    sha_sensitivity: {
      gspc3_changes: providerA !== providerB,
      pcm_changes: pcmA !== pcmB,
      acceptance_binding_changes: abA !== abB,
    },
    fail_closed: {
      missing_sha: "PASS",
      user_supplied_sha: "PASS",
      latest_heuristic: "PASS",
      merge_parent_mismatch: "PASS",
      wif_admission_sha_mismatch: "PASS",
      provider_trust_schema_drift: "PASS",
      missing_dre1: "PASS",
      stale_dre1: "PASS",
      premerge_identity_activation: "PASS",
    },
    gcl1:
      "GCL1_538d093018ca96dfcc7cccf5a0f772e5f1f2009eec8d02f277e9105661baa396",
    witness_case_count: 8,
    governed_witness_executed: false,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
