import { readFileSync } from "node:fs";

const enc = new TextEncoder();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function eq(actual: string, expected: string, label: string): void {
  if (actual !== expected) throw new Error(label + ": " + actual + " != " + expected);
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

async function main(): Promise<void> {
  const implementationBuild = "IB1_" + await ksha([
    "CUTOVER_WITNESS_DEPLOYMENT_CONFIG_BUILD_V1",
    "lennyliu01/workos-d1-runtime",
    "src/cutover_executor.ts@blob:3d6e165c754a585e085e6eeb750e2edd37aac0ee",
    "src/cutover_witness_fixture.ts@blob:4ef34e564be2ccf992877a3495f581d0a44218b0",
    "src/cutover_witness_invocation.ts@blob:66496c986f2f52ae07ac51c0376ace86638f391e",
    "src/cutover_witness_runtime_config.ts@blob:58984bae8edf7dc3b6daa9fe2995c497b3a66042",
    "src/cutover_witness_worker.ts@blob:12f363693a5e0e8b08a66e820cfbc90fa3e556f6",
    "wrangler.cutover-witness.jsonc@blob:3833f6b4f48183dcadb796a34ade01bbdfd43ea8",
    ".github/workflows/cutover-witness-governed-publication-readiness.yml@blob:328a6a31c658bae9f552252798efdc37abaa049c",
  ]);
  eq(
    implementationBuild,
    "IB1_72b49af80ef348ab279f30037bfbcf45d0c4a0c422cf01a46daa6f95011a17ed",
    "Implementation_Build_ID",
  );

  const evidence = JSON.parse(
    readFileSync(
      "candidate_evidence/cutover_witness_deployment_config_repair_20260930_01.json",
      "utf8",
    ),
  ) as Record<string, any>;

  eq(evidence.premerge_finalizable_identities.implementation_build_id, implementationBuild, "evidence build");
  eq(
    evidence.premerge_finalizable_identities.mutation_adapter_fingerprint,
    "94df6a7268cf3fd91569e55e8b343eff1e1b226df561198ed5ff937fcf7ddde7",
    "mutation adapter",
  );
  eq(
    evidence.premerge_finalizable_identities.credential_binding_id,
    "GCB2_7d8986c2f27085c14c3b5a2d4cdc15b46c3f9bad9352e6da1b682a2b0ff356c6",
    "credential binding",
  );
  eq(
    evidence.premerge_finalizable_identities.credential_lifecycle_id,
    "GCL1_538d093018ca96dfcc7cccf5a0f772e5f1f2009eec8d02f277e9105661baa396",
    "GCL1",
  );
  eq(
    evidence.premerge_finalizable_identities.resource_scope_fingerprint,
    "07c47193893d8683cab1bffff5f63249587ec9068d135bb83064264a68fc99eb",
    "resource scope",
  );

  eq(evidence.provider_config.provider_config_derivation_version, "GSPC3", "GSPC3 derivation");
  eq(evidence.provider_config.provider_config_sequencing_version, "GSPC3_ADMITTED_SHA_SEQ_V1", "sequencing");
  eq(evidence.provider_config.accepted_main_admission_mode, "EXACT_ACCEPTED_MAIN_ONLY", "admission mode");
  eq(
    evidence.provider_config.accepted_main_sha_binding,
    "POST_MERGE_EXACT_ACCEPTED_MAIN_SHA_REQUIRED",
    "accepted main SHA binding",
  );
  eq(evidence.successor_identities.provider_config_id, "NOT_MATERIALIZED_PRE_MERGE", "premerge GSPC3");
  eq(
    evidence.successor_identities.capability_matrix_version,
    "NOT_MATERIALIZED_PRE_FINAL_PROVIDER_CONFIG",
    "premerge PCM",
  );
  eq(
    evidence.successor_identities.acceptance_binding_id,
    "NOT_MATERIALIZED_PRE_FINAL_PROVIDER_CONFIG",
    "premerge acceptance binding",
  );
  eq(
    evidence.deployment_readiness.actual_dre1,
    "NOT_MATERIALIZED_PRE_DEPLOYMENT_READINESS",
    "predeployment DRE1",
  );
  eq(
    evidence.successor_identities.authority_status,
    "NON_AUTHORITATIVE_CANDIDATE_ONLY",
    "candidate authority status",
  );

  assert(
    evidence.provider_config.final_payload_template.accepted_main_admission_mode ===
      "EXACT_ACCEPTED_MAIN_ONLY",
    "final payload admission mode missing",
  );
  assert(
    evidence.provider_config.final_payload_template.accepted_main_sha ===
      "POST_MERGE_EXACT_ACCEPTED_MAIN_SHA_REQUIRED",
    "final payload explicit accepted_main_sha dependency missing",
  );
  assert(
    evidence.historical_invalid_preclosure_candidate_identities.provider_config_id ===
      "GSPC3_b052e34061c3acea0d92b899ddeb4ea435fac7c46f86c9830af8b402f135c236",
    "historical preclosure GSPC3 evidence missing",
  );
  assert(
    evidence.historical_invalid_preclosure_candidate_identities.disposition ===
      "HISTORICAL_PRE_CLOSURE_DERIVATION_ONLY_NOT_FINAL_NOT_ACTIVATION_VALID",
    "historical identity disposition drift",
  );

  console.log(JSON.stringify({
    deployment_config_candidate_binding_validation: "PASS",
    implementation_build_id: implementationBuild,
    provider_config_sequencing_version: "GSPC3_ADMITTED_SHA_SEQ_V1",
    premerge_provider_config_id: "NOT_MATERIALIZED_PRE_MERGE",
    premerge_capability_matrix_version: "NOT_MATERIALIZED_PRE_FINAL_PROVIDER_CONFIG",
    premerge_acceptance_binding_id: "NOT_MATERIALIZED_PRE_FINAL_PROVIDER_CONFIG",
    actual_dre1: "NOT_MATERIALIZED_PRE_DEPLOYMENT_READINESS",
    credential_lifecycle_id:
      "GCL1_538d093018ca96dfcc7cccf5a0f772e5f1f2009eec8d02f277e9105661baa396",
    authority_status: "NON_AUTHORITATIVE_CANDIDATE_ONLY",
    governed_witness_executed: false,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
