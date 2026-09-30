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
async function sha(parts: readonly string[]): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", k1b1(parts));
  return Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, "0")).join("");
}
function eq(actual: string, expected: string, label: string): void {
  if (actual !== expected) throw new Error(label + ": " + actual + " != " + expected);
}

async function main(): Promise<void> {
  const core = "3d6e165c754a585e085e6eeb750e2edd37aac0ee";
  const fixture = "4ef34e564be2ccf992877a3495f581d0a44218b0";
  const invocation = "66496c986f2f52ae07ac51c0376ace86638f391e";
  const runtimeConfig = "d77cbb8c5f6fbb55bf65c202186575171138e4b2";
  const witnessWorker = "b105541a470cabec455e29d081ad3509d92e6a9e";
  const wranglerConfig = "3833f6b4f48183dcadb796a34ade01bbdfd43ea8";
  const deploymentWorkflow = "8698ab550fee38a8501518668b053ef958ad8480";
  const fixtureRoot = "GFR1_7bd591adcefe2c5b178eeb49af142e4b4f25b4da83caba8b6d44546617c1f40e";
  const fixtureSheet = "11DKed3wVcnryEQrgHzfR276znYJLRAwM14ZOEwCkS1Y";
  const denylist = "PDL1_8709a31da33beea711c91b74fae6834a592cb7f2e786f93349269a83c8076018";
  const finality = "GFRF1_c5d4e2b54d63d5e2f8c0b31f4fc652a15703702e52515d7b8d52cc0211f9bb33";
  const service = "workos-cutover-witness";
  const workerUrl = "https://workos-cutover-witness.lennyliu01.workers.dev";

  const implementationBuild = "IB1_" + await sha([
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
  eq(
    implementationBuild,
    "IB1_789a9b7d63a0ffb64b1a30b06607c3390ab88f7b2eeb71abd3fb039c42199725",
    "Implementation_Build_ID",
  );

  const mutationAdapter = await sha([
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
  eq(
    mutationAdapter,
    "94df6a7268cf3fd91569e55e8b343eff1e1b226df561198ed5ff937fcf7ddde7",
    "Mutation_Adapter_Fingerprint",
  );

  const providerConfig = "GSPC2_" + await sha([
    "GSPC2",
    "GOOGLE_SHEETS_V4",
    "READ=spreadsheets.values.get/UNFORMATTED_VALUE",
    "MUTATE=spreadsheets.batchUpdate/updateCells",
    "FINALITY=AMBIGUOUS_THEN_EXACT_REGISTERED_READBACK_NO_BLIND_RETRY",
    "FAULT_BOUNDARY=AFTER_REAL_PROVIDER_OPERATION_WITNESS_ONLY",
    "AUTH_MODE=GOOGLE_OAUTH_BEARER_ACCESS_TOKEN_EPHEMERAL",
    "CREDENTIAL_BINDING=CUTOVER_WITNESS_GOOGLE_ACCESS_TOKEN",
    "CREDENTIAL_PROVISIONING=GITHUB_ACTIONS_REPOSITORY_SECRET_TO_CLOUDFLARE_WORKER_SECRET_VIA_WRANGLER_SECRETS_FILE",
    "CALLER_AUTH_BINDING=RUNTIME_SECRET",
    "WORKER_SERVICE=" + service,
    "WORKER_URL=" + workerUrl,
    "FORMAL_ROUTE=/cutover/witness",
    "READINESS_ROUTE=/cutover/witness/readiness",
    "RUNTIME_CONFIG_BLOB=" + runtimeConfig,
    "WRANGLER_CONFIG_BLOB=" + wranglerConfig,
    "DEPLOYMENT_WORKFLOW_BLOB=" + deploymentWorkflow,
    "FIXTURE_ROOT=" + fixtureRoot,
    "FIXTURE_SPREADSHEET=" + fixtureSheet,
    "PRODUCTION_DENYLIST=" + denylist,
  ]);
  eq(
    providerConfig,
    "GSPC2_4a41923184895a596e59f15ea82733f4245209c3eda752d60d045d75388e440f",
    "Provider_Config_ID",
  );

  const resourceScope = await sha([
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
  eq(
    resourceScope,
    "07c47193893d8683cab1bffff5f63249587ec9068d135bb83064264a68fc99eb",
    "Resource_Scope_Fingerprint",
  );

  const capabilityDigest = await sha([
    "PCM7_CUTOVER_GOOGLE_DEPLOYMENT_CONFIG_V1",
    implementationBuild,
    mutationAdapter,
    providerConfig,
    resourceScope,
    "CAP=EXACT_BUILD_DEPLOYMENT",
    "CAP=SECRET_BINDING_NONDISCLOSURE",
    "CAP=REAL_PROVIDER_READINESS_FIXTURE_ONLY",
    "CAP=AUTHENTICATED_FORMAL_ROUTE",
    "CAP=PRODUCTION_DENYLIST_PRE_PROVIDER",
    "CAP=CASE7_REGRESSION",
    "CAP=CASE8_REGRESSION",
    "CAP=FAULT_REGRESSION",
  ]);
  const capabilityMatrix = "PCM7_CUTOVER_GOOGLE_" + capabilityDigest.slice(0, 24);
  eq(
    capabilityMatrix,
    "PCM7_CUTOVER_GOOGLE_7065ad82bc987bb1555495ee",
    "Capability_Matrix_Version",
  );

  const acceptanceBinding = "AB1_" + await sha([
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
  ]);
  eq(
    acceptanceBinding,
    "AB1_e3daa9daebe477c58848214255df3041b3b72de20b803a4472f2426316eaeece",
    "Acceptance_Binding_ID",
  );

  console.log(JSON.stringify({
    deployment_config_candidate_binding_validation: "PASS",
    implementation_build_id: implementationBuild,
    mutation_adapter_fingerprint: mutationAdapter,
    provider_config_id: providerConfig,
    provider_config_derivation: "GSPC2 complete non-secret runtime dependency set",
    resource_scope_fingerprint: resourceScope,
    capability_matrix_version: capabilityMatrix,
    acceptance_binding_id: acceptanceBinding,
    credential_secret_bytes_in_derivation: false,
    governed_witness_executed: false,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
