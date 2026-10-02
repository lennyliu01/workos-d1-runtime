import { readFileSync } from "node:fs";
import {
  CUTOVER_WITNESS_CREDENTIAL_LIFECYCLE_ID,
  CUTOVER_WITNESS_CREDENTIAL_PROVISIONING_MECHANISM,
  CUTOVER_WITNESS_EXPIRY_MARGIN_SECONDS,
  CUTOVER_WITNESS_GOOGLE_AUTH_ACTION_SHA,
  CUTOVER_WITNESS_GOOGLE_SCOPE,
  CUTOVER_WITNESS_MAXIMUM_ACCESS_TOKEN_LIFETIME_SECONDS,
  CUTOVER_WITNESS_REQUESTED_ACCESS_TOKEN_LIFETIME_SECONDS,
  CUTOVER_WITNESS_REVOCATION_MODEL_VERSION,
  CUTOVER_WITNESS_ROTATION_MODEL_VERSION,
  CUTOVER_WITNESS_SECRET_NONDISCLOSURE_CONTRACT_VERSION,
  CUTOVER_WITNESS_SERVICE_PRINCIPAL,
  CUTOVER_WITNESS_WIF_AUDIENCE,
  CUTOVER_WITNESS_WIF_PROVIDER_FULL_NAME,
} from "../src/cutover_witness_runtime_config";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const workflow = readFileSync(
  ".github/workflows/cutover-witness-governed-publication-readiness.yml",
  "utf8",
);
const evidence = JSON.parse(
  readFileSync(
    "candidate_evidence/cutover_witness_deployment_config_repair_20260930_01.json",
    "utf8",
  ),
) as Record<string, any>;

function contains(text: string, label: string): void {
  assert(workflow.includes(text), "workflow missing " + label);
}

function excludes(text: string, label: string): void {
  assert(!workflow.includes(text), "workflow retains forbidden " + label);
}

async function main(): Promise<void> {
  assert(
    CUTOVER_WITNESS_CREDENTIAL_PROVISIONING_MECHANISM ===
      "GITHUB_ACTIONS_OIDC_TO_GOOGLE_WIF_TO_DEDICATED_SERVICE_PRINCIPAL_TO_SHORT_LIVED_OAUTH2_ACCESS_TOKEN_TO_CLOUDFLARE_WORKER_SECRET",
    "credential mechanism drift",
  );
  assert(
    CUTOVER_WITNESS_CREDENTIAL_LIFECYCLE_ID ===
      "GCL1_538d093018ca96dfcc7cccf5a0f772e5f1f2009eec8d02f277e9105661baa396",
    "GCL1 drift",
  );
  assert(
    CUTOVER_WITNESS_ROTATION_MODEL_VERSION === "CUTOVER_WIF_ROTATION_MODEL_V1",
    "rotation version drift",
  );
  assert(
    CUTOVER_WITNESS_REVOCATION_MODEL_VERSION === "CUTOVER_WIF_REVOCATION_MODEL_V1",
    "revocation version drift",
  );
  assert(
    CUTOVER_WITNESS_SECRET_NONDISCLOSURE_CONTRACT_VERSION ===
      "CUTOVER_WIF_SECRET_NONDISCLOSURE_V1",
    "nondisclosure version drift",
  );
  assert(CUTOVER_WITNESS_REQUESTED_ACCESS_TOKEN_LIFETIME_SECONDS === 1800, "token lifetime drift");
  assert(CUTOVER_WITNESS_MAXIMUM_ACCESS_TOKEN_LIFETIME_SECONDS === 3600, "max token lifetime drift");
  assert(CUTOVER_WITNESS_EXPIRY_MARGIN_SECONDS === 300, "expiry margin drift");

  contains("id-token: write", "id-token permission");
  contains(`google-github-actions/auth@${CUTOVER_WITNESS_GOOGLE_AUTH_ACTION_SHA}`, "pinned Google auth action");
  contains(`workload_identity_provider: ${CUTOVER_WITNESS_WIF_PROVIDER_FULL_NAME}`, "exact WIF provider");
  contains(`service_account: ${CUTOVER_WITNESS_SERVICE_PRINCIPAL}`, "exact service principal");
  contains(`audience: ${CUTOVER_WITNESS_WIF_AUDIENCE}`, "exact WIF audience");
  contains(`access_token_scopes: ${CUTOVER_WITNESS_GOOGLE_SCOPE}`, "exact Sheets scope");
  contains("access_token_lifetime: 1800s", "1800s token lifetime");
  contains("create_credentials_file: false", "no generated credential file");
  contains("export_environment_variables: false", "no ambient Google credential export");
  contains("github.ref == 'refs/heads/main' && github.workflow_sha == github.sha", "accepted-main job gate");
  contains("APPROVED_CANDIDATE_COMMIT=\"${PARENTS[1]}\"", "approved candidate second-parent derivation");
  contains("git diff --exit-code \"$APPROVED_CANDIDATE_COMMIT\" \"$GITHUB_SHA\"", "candidate/main equivalence");
  contains("$WORKFLOW_PATH", "workflow self-integrity surface");
  contains("DRE1_", "DRE1 derivation");
  contains("deployment-readiness-evidence.json", "DRE1 machine-readable evidence");
  contains("ACCEPTANCE_ACTIVATION_PERFORMED=FALSE", "no activation in readiness workflow");

  excludes("secrets.CUTOVER_WITNESS_GOOGLE_ACCESS_TOKEN", "persistent Google access-token repository secret dependency");
  excludes("credentials_json:", "service-account key credential path");
  excludes("refresh_token", "OAuth refresh-token path");
  excludes("github.event.inputs", "workflow-dispatch input authority");
  excludes("${{ inputs.", "workflow-dispatch input authority");
  excludes("inputs:\n", "free-form workflow-dispatch inputs");

  assert(
    evidence.credential_lifecycle?.credential_lifecycle_id === CUTOVER_WITNESS_CREDENTIAL_LIFECYCLE_ID,
    "candidate evidence GCL1 mismatch",
  );
  assert(
    evidence.credential_lifecycle?.rotation_model_version === CUTOVER_WITNESS_ROTATION_MODEL_VERSION,
    "candidate evidence rotation mismatch",
  );
  assert(
    evidence.credential_lifecycle?.revocation_model_version === CUTOVER_WITNESS_REVOCATION_MODEL_VERSION,
    "candidate evidence revocation mismatch",
  );
  assert(
    evidence.credential_lifecycle?.secret_nondisclosure_contract_version ===
      CUTOVER_WITNESS_SECRET_NONDISCLOSURE_CONTRACT_VERSION,
    "candidate evidence nondisclosure mismatch",
  );
  assert(evidence.credential_config?.persistent_google_credentials === false, "persistent credential evidence drift");
  assert(evidence.deployment_readiness?.version === "DRE1", "DRE1 evidence contract missing");
  assert(evidence.activation_fence?.stale_or_mismatched_readiness === "FAIL_CLOSED", "activation fence drift");

  console.log(JSON.stringify({
    cutover_wif_contract_validation: "PASS",
    credential_lifecycle_id: CUTOVER_WITNESS_CREDENTIAL_LIFECYCLE_ID,
    wif_provider: CUTOVER_WITNESS_WIF_PROVIDER_FULL_NAME,
    service_principal: CUTOVER_WITNESS_SERVICE_PRINCIPAL,
    google_scope: CUTOVER_WITNESS_GOOGLE_SCOPE,
    token_lifetime_seconds: CUTOVER_WITNESS_REQUESTED_ACCESS_TOKEN_LIFETIME_SECONDS,
    expiry_margin_seconds: CUTOVER_WITNESS_EXPIRY_MARGIN_SECONDS,
    persistent_google_credential_path: false,
    candidate_branch_mint_authority: false,
    deployment_readiness_evidence_version: "DRE1",
    governed_witness_executed: false,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
