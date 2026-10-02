import { readFileSync } from "node:fs";

const enc = new TextEncoder();

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
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
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
  const digest = await crypto.subtle.digest("SHA-256", k1b1(parts));
  return Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, "0")).join("");
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const obj = value as Record<string, unknown>;
  return "{" + Object.keys(obj).sort().map(k => JSON.stringify(k) + ":" + canonical(obj[k])).join(",") + "}";
}
async function canonicalId(prefix: string, domain: string, payload: Record<string, unknown>): Promise<string> {
  const root = [prefix, domain, payload];
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(canonical(root)));
  return prefix + "_" + Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, "0")).join("");
}
function eq(actual: string, expected: string, label: string): void {
  if (actual !== expected) throw new Error(label + ": " + actual + " != " + expected);
}

async function main(): Promise<void> {
  const core = "3d6e165c754a585e085e6eeb750e2edd37aac0ee";
  const fixture = "4ef34e564be2ccf992877a3495f581d0a44218b0";
  const invocation = "66496c986f2f52ae07ac51c0376ace86638f391e";
  const runtimeConfig = "58984bae8edf7dc3b6daa9fe2995c497b3a66042";
  const witnessWorker = "12f363693a5e0e8b08a66e820cfbc90fa3e556f6";
  const wranglerConfig = "3833f6b4f48183dcadb796a34ade01bbdfd43ea8";
  const deploymentWorkflow = "dbf427a9bcbe423d14e5c425130b921e91cf6658";
  const fixtureRoot = "GFR1_7bd591adcefe2c5b178eeb49af142e4b4f25b4da83caba8b6d44546617c1f40e";
  const fixtureSheet = "11DKed3wVcnryEQrgHzfR276znYJLRAwM14ZOEwCkS1Y";
  const denylist = "PDL1_8709a31da33beea711c91b74fae6834a592cb7f2e786f93349269a83c8076018";
  const finality = "GFRF1_c5d4e2b54d63d5e2f8c0b31f4fc652a15703702e52515d7b8d52cc0211f9bb33";
  const service = "workos-cutover-witness";
  const workerUrl = "https://workos-cutover-witness.lennyliu01.workers.dev";
  const gcl1 = "GCL1_538d093018ca96dfcc7cccf5a0f772e5f1f2009eec8d02f277e9105661baa396";
  const wifPool = "projects/959429469584/locations/global/workloadIdentityPools/workos-cutover-witness";
  const wifProvider = "projects/959429469584/locations/global/workloadIdentityPools/workos-cutover-witness/providers/github-workos-d1-runtime";
  const servicePrincipal = "workos-cutover-witness@workos-control-plane.iam.gserviceaccount.com";
  const googleScope = "https://www.googleapis.com/auth/spreadsheets";
  const authActionSha = "7c6bc770dae815cd3e89ee6cdf493a5fab2cc093";

  const implementationBuild = "IB1_" + await ksha([
    "CUTOVER_WITNESS_DEPLOYMENT_CONFIG_BUILD_V1",
    "lennyliu01/workos-d1-runtime",
    "src/cutover_executor.ts@blob:" + core,
    "src/cutover_witness_fixture.ts@blob:" + fixture,
    "src/cutover_witness_invocation.ts@blob:" + invocation,
    "src/cutover_witness_runtime_config.ts@blob:" + runtimeConfig,
    "src/cutover_witness_worker.ts@blob:" + witnessWorker,
    "wrangler.cutover-witness.jsonc@blob:" + wranglerConfig,
    ".github/workflows/cutover-witness-governed-publication-readiness.yml@blob:" + deploymentWorkflow,
  ]);
  eq(implementationBuild, "IB1_07ce2edced7ba96969373c6733a35899fdb54e2b5fcd473ea56f13cc74c35203", "Implementation_Build_ID");

  const mutationAdapter = await ksha([
    "CUTOVER_GOOGLE_MUTATION_ADAPTER_V3",
    "src/cutover_executor.ts@blob:" + core,
    "src/cutover_witness_invocation.ts@blob:" + invocation,
    "GOOGLE_SHEETS_V4",
    "spreadsheets.batchUpdate/updateCells",
    "spreadsheets.values.get/UNFORMATTED_VALUE",
    "PARTIAL_RECOVERY=CONTIGUOUS_SAME_TRANSITION_FORWARD_PREFIX",
    "AMBIGUOUS=>EXACT_READBACK_NO_BLIND_RETRY",
    fixtureRoot,
    denylist,
    finality,
  ]);
  eq(mutationAdapter, "94df6a7268cf3fd91569e55e8b343eff1e1b226df561198ed5ff937fcf7ddde7", "Mutation_Adapter_Fingerprint");

  const credentialBindingPayload = {"binding_name":"CUTOVER_WITNESS_GOOGLE_ACCESS_TOKEN","credential_lifecycle_id":"GCL1_538d093018ca96dfcc7cccf5a0f772e5f1f2009eec8d02f277e9105661baa396","google_scope_set":["https://www.googleapis.com/auth/spreadsheets"],"persistent_google_credentials":false,"provisioning_mechanism":"GITHUB_ACTIONS_OIDC_TO_GOOGLE_WIF_TO_DEDICATED_SERVICE_PRINCIPAL_TO_SHORT_LIVED_OAUTH2_ACCESS_TOKEN_TO_CLOUDFLARE_WORKER_SECRET","requested_access_token_lifetime":"1800s","expiry_margin":"300s","runtime_class":"CLOUDFLARE_WORKER_SECRET_TRANSIENT_ACCESS_TOKEN","secret_nondisclosure_contract_version":"CUTOVER_WIF_SECRET_NONDISCLOSURE_V1","service_principal_email":"workos-cutover-witness@workos-control-plane.iam.gserviceaccount.com","source_class":"GITHUB_ACTIONS_OIDC_WIF_SHORT_LIVED_ACCESS_TOKEN","wif_provider_full_name":"projects/959429469584/locations/global/workloadIdentityPools/workos-cutover-witness/providers/github-workos-d1-runtime"} as Record<string, unknown>;
  const credentialBinding = await canonicalId(
    "GCB2",
    "CUTOVER_WITNESS_WIF_CREDENTIAL_BINDING",
    credentialBindingPayload,
  );
  eq(credentialBinding, "GCB2_7d8986c2f27085c14c3b5a2d4cdc15b46c3f9bad9352e6da1b682a2b0ff356c6", "Credential_Binding_ID");

  const providerPayload = {"accepted_main_admission":"EXACT_ACCEPTED_MAIN_ONLY_SET_BY_GOVERNED_PUBLICATION","caller_auth_binding":"RUNTIME_SECRET","credential_binding_id":"GCB2_7d8986c2f27085c14c3b5a2d4cdc15b46c3f9bad9352e6da1b682a2b0ff356c6","credential_lifecycle_id":"GCL1_538d093018ca96dfcc7cccf5a0f772e5f1f2009eec8d02f277e9105661baa396","deployment_mechanism":{"approved_candidate_provenance":"SECOND_PARENT_OF_EXACT_ACCEPTED_MAIN_MERGE_COMMIT","auth_action_sha":"7c6bc770dae815cd3e89ee6cdf493a5fab2cc093","candidate_evidence_path":"candidate_evidence/cutover_witness_deployment_config_repair_20260930_01.json","workflow_blob":"dbf427a9bcbe423d14e5c425130b921e91cf6658","workflow_path":".github/workflows/cutover-witness-governed-publication-readiness.yml"},"fixture_root_id":"GFR1_7bd591adcefe2c5b178eeb49af142e4b4f25b4da83caba8b6d44546617c1f40e","fixture_spreadsheet_id":"11DKed3wVcnryEQrgHzfR276znYJLRAwM14ZOEwCkS1Y","google_scope_set":["https://www.googleapis.com/auth/spreadsheets"],"mutation_finality":"AMBIGUOUS_THEN_EXACT_REGISTERED_READBACK_NO_BLIND_RETRY","production_denylist_id":"PDL1_8709a31da33beea711c91b74fae6834a592cb7f2e786f93349269a83c8076018","provider_primitives":{"fault_boundary":"AFTER_REAL_PROVIDER_OPERATION_WITNESS_ONLY","mutate":"spreadsheets.batchUpdate/updateCells","read":"spreadsheets.values.get/UNFORMATTED_VALUE"},"runtime_config_blob":"58984bae8edf7dc3b6daa9fe2995c497b3a66042","service_principal_email":"workos-cutover-witness@workos-control-plane.iam.gserviceaccount.com","wif_pool_full_name":"projects/959429469584/locations/global/workloadIdentityPools/workos-cutover-witness","wif_provider_full_name":"projects/959429469584/locations/global/workloadIdentityPools/workos-cutover-witness/providers/github-workos-d1-runtime","worker_service":"workos-cutover-witness","worker_url":"https://workos-cutover-witness.lennyliu01.workers.dev","formal_route":"/cutover/witness","readiness_route":"/cutover/witness/readiness"} as Record<string, unknown>;
  const providerConfig = await canonicalId(
    "GSPC3",
    "CUTOVER_GOOGLE_PROVIDER_CONFIG",
    providerPayload,
  );
  eq(providerConfig, "GSPC3_b052e34061c3acea0d92b899ddeb4ea435fac7c46f86c9830af8b402f135c236", "Provider_Config_ID");

  const resourceScope = await ksha([
    "CUTOVER_WITNESS_DEPLOYMENT_CONFIG_RESOURCE_SCOPE_V1",
    "1n1YPmM6V8j4VCeVHZo1e2AvKjoVz4KFjXlpqBPqRnx8",
    "ANLCKQnVVo_A0bKw5-d20euYCumAHyWKf4iTtmuElesL5B9xXwjt9moQdHxdEGC4NcoH6wGxMM-MqcRoP_0bZM5AdkXJWIWyZSktXrQzSVA",
    fixtureRoot,
    fixtureSheet,
    denylist,
    finality,
    "WORKER_SERVICE=" + service,
    "WORKER_URL=" + workerUrl,
    "FORMAL_ROUTE=/cutover/witness",
    "READINESS_ROUTE=/cutover/witness/readiness",
    "CREDENTIAL_BINDING=CUTOVER_WITNESS_GOOGLE_ACCESS_TOKEN",
  ]);
  eq(resourceScope, "07c47193893d8683cab1bffff5f63249587ec9068d135bb83064264a68fc99eb", "Resource_Scope_Fingerprint");

  const capabilityDigest = await ksha([
    "PCM8_CUTOVER_WIF_DEPLOYMENT_CONFIG_V1",
    implementationBuild,
    mutationAdapter,
    providerConfig,
    resourceScope,
    credentialBinding,
    gcl1,
    "CAP=EXACT_BUILD_DEPLOYMENT","CAP=OIDC_TRUST_PROVENANCE","CAP=WIF_TOKEN_MINT","CAP=SERVICE_PRINCIPAL_ISOLATION","CAP=SHORT_LIVED_ACCESS_TOKEN_LIFECYCLE","CAP=FRESHNESS_AND_RERUN","CAP=REVOCATION_FAIL_CLOSED","CAP=SECRET_NONDISCLOSURE","CAP=REAL_PROVIDER_READINESS_FIXTURE_ONLY","CAP=DEPLOYMENT_READINESS_DRE1","CAP=ACTIVATION_FENCE_DRE1","CAP=AUTHENTICATED_FORMAL_ROUTE","CAP=PRODUCTION_DENYLIST_PRE_PROVIDER","CAP=CASE7_REGRESSION","CAP=CASE8_REGRESSION","CAP=FAULT_REGRESSION"
  ]);
  const capabilityMatrix = "PCM8_CUTOVER_WIF_" + capabilityDigest.slice(0, 24);
  eq(capabilityMatrix, "PCM8_CUTOVER_WIF_2a8ea9a9683ade0728eadafb", "Capability_Matrix_Version");

  const acceptanceBinding = "AB1_" + await ksha([
    implementationBuild,
    "a5f6447dd54fa3b5c5cdcb6ffada335cfe28fd8b3dad85b77693f522aab3c53f",
    "ba3bb9599a034a764c9bdfd10a3dca79436fbae80960ace6a64e2786035909f8",
    mutationAdapter,
    providerConfig,
    "RS1_84f170ffef50fecc331de87458db2bee9aeebf1bdf7c4e079260c338d477d7e1",
    "84f170ffef50fecc331de87458db2bee9aeebf1bdf7c4e079260c338d477d7e1",
    "MSET1_2f76282f0cc13c1df38b414d0221bebcc7f739fcb749ac6d7012e438f42f1cbc",
    "f9ae8ed9716b5dd447bad5f9951baef2bfb3f29161120a8118280204a1290ca7",
    "ROUTE_V1",
    "SHARED_ARCHIVE_INFRASTRUCTURE",
    resourceScope,
    capabilityMatrix,
    credentialBinding,
    gcl1,
    "DEPLOYMENT_READINESS_EVIDENCE_VERSION=DRE1",
    "ACTIVATION_FENCE=EXACT_MATCH_TERMINAL_PASS_DRE1",
  ]);
  eq(acceptanceBinding, "AB1_74ebeddcd13f8b94d3a040d73588b19a8f77792a0928e1685ada31896d07ca72", "Acceptance_Binding_ID");

  const evidence = JSON.parse(
    readFileSync("candidate_evidence/cutover_witness_deployment_config_repair_20260930_01.json", "utf8"),
  ) as Record<string, any>;
  eq(evidence.successor_identities.implementation_build_id, implementationBuild, "evidence build");
  eq(evidence.successor_identities.mutation_adapter_fingerprint, mutationAdapter, "evidence adapter");
  eq(evidence.successor_identities.credential_binding_id, credentialBinding, "evidence credential binding");
  eq(evidence.successor_identities.provider_config_id, providerConfig, "evidence provider config");
  eq(evidence.successor_identities.resource_scope_fingerprint, resourceScope, "evidence resource scope");
  eq(evidence.successor_identities.capability_matrix_version, capabilityMatrix, "evidence capability matrix");
  eq(evidence.successor_identities.acceptance_binding_id, acceptanceBinding, "evidence acceptance binding");

  console.log(JSON.stringify({
    deployment_config_candidate_binding_validation: "PASS",
    implementation_build_id: implementationBuild,
    mutation_adapter_fingerprint: mutationAdapter,
    credential_binding_id: credentialBinding,
    credential_lifecycle_id: gcl1,
    provider_config_id: providerConfig,
    provider_config_derivation: "GSPC3 canonical non-secret WIF/GCL1 dependency set",
    resource_scope_fingerprint: resourceScope,
    capability_matrix_version: capabilityMatrix,
    acceptance_binding_id: acceptanceBinding,
    deployment_readiness_evidence_version: "DRE1",
    credential_secret_bytes_in_derivation: false,
    governed_witness_executed: false,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
