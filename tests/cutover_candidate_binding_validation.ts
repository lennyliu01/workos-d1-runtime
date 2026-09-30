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
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function k1b1(parts: readonly string[]): Uint8Array {
  const framed: Uint8Array[] = [enc.encode("K1B1"), u16be(parts.length)];
  for (const raw of parts) {
    const normalized = raw.normalize("NFC");
    const bytes = enc.encode(normalized);
    framed.push(new Uint8Array([0x53]), u32be(bytes.length), bytes);
  }
  return concat(framed);
}

async function sha256Hex(parts: readonly string[]): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", k1b1(parts));
  return Array.from(new Uint8Array(digest))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

function assertEqual(actual: string, expected: string, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

const repo = "lennyliu01/workos-d1-runtime";
const coreBlob = "d8168257f3ea524af49f5f35d0beef6ef713eaa4";
const fixtureBlob = "7109b1bbfb002be28ae97c7d0ff9954b2373d2aa";
const fixtureRoot = "GFR1_7bd591adcefe2c5b178eeb49af142e4b4f25b4da83caba8b6d44546617c1f40e";
const fixtureSheet = "11DKed3wVcnryEQrgHzfR276znYJLRAwM14ZOEwCkS1Y";
const denylist = "PDL1_8709a31da33beea711c91b74fae6834a592cb7f2e786f93349269a83c8076018";
const semanticId = "1Fx9H4_xJ1g6dr_E3D1rO0bLUajJ2DOErRiAsdrgztcA";
const semanticRevision = "ANLCKQlKEc3SdEIV92c1vHst-IRCr_ZWVmBr8nkdcyJfB6CJ98RtptAfRDthu_QkOyFtv2_rQrK7FGYgQjzEvebCK6iA7p1jWRT7nclz70A";
const normalEvidence = "RPC1_c2df95f9599ee609b5ae4bdc971ad504062996ddaa46f5cf22d5facd441b0410";
const ambiguousEvidence = "RPC1_43435eba26177a658fc1ec7b69db441da8ccf63f607a1e140c1c795661b0dac0";

async function main(): Promise<void> {
  const implementationBuild =
    "IB1_" +
    (await sha256Hex([
      "CWIR_BUILD_V1",
      repo,
      `src/cutover_executor.ts@blob:${coreBlob}`,
      `src/cutover_witness_fixture.ts@blob:${fixtureBlob}`,
    ]));
  assertEqual(
    implementationBuild,
    "IB1_d9dba728082b7b349d15d8a0a56bad41129d769210d372d9424fd14747a4fb4d",
    "Implementation_Build_ID",
  );

  const mutationAdapter = await sha256Hex([
    "CUTOVER_GOOGLE_MUTATION_ADAPTER_V1",
    `src/cutover_executor.ts@blob:${coreBlob}`,
    "GOOGLE_SHEETS_V4",
    "spreadsheets.batchUpdate/updateCells",
    "spreadsheets.values.get/UNFORMATTED_VALUE",
    "AMBIGUOUS=>EXACT_READBACK_NO_BLIND_RETRY",
    fixtureRoot,
    denylist,
  ]);
  assertEqual(
    mutationAdapter,
    "a6992fdf573ed8dd86c0cc6b5d74043748cee1cb80a98e3f2e17a488ecc52d19",
    "Mutation_Adapter_Fingerprint",
  );

  const providerConfig =
    "GSPC1_" +
    (await sha256Hex([
      "GSPC1",
      "GOOGLE_SHEETS_V4",
      "READ=spreadsheets.values.get/UNFORMATTED_VALUE",
      "MUTATE=spreadsheets.batchUpdate/updateCells/USER_ENTERED_VALUE",
      "FINALITY=AMBIGUOUS_THEN_EXACT_REGISTERED_READBACK_NO_BLIND_RETRY",
      "FAULT_BOUNDARY=AFTER_REAL_PROVIDER_OPERATION_WITNESS_ONLY",
    ]));
  assertEqual(
    providerConfig,
    "GSPC1_6a99cf8bf66b44a3e11b4a1536dad167745cd30ad2c89a4c229fff29a6c69352",
    "Provider_Config_ID",
  );

  const resourceScope = await sha256Hex([
    "CUTOVER_WITNESS_INFRA_RESOURCE_SCOPE_V1",
    semanticId,
    semanticRevision,
    fixtureRoot,
    fixtureSheet,
    denylist,
  ]);
  assertEqual(
    resourceScope,
    "e461d5a248cf1a5b9f6347540b3a76cb9a5b61bb4835b466ddedf48bfd0f5677",
    "Resource_Scope_Fingerprint",
  );

  const capabilityDigest = await sha256Hex([
    "PCM5_CUTOVER_GOOGLE_V1",
    implementationBuild,
    mutationAdapter,
    providerConfig,
    resourceScope,
    normalEvidence,
    ambiguousEvidence,
    "OWNER_VALIDATION_RUN=36649973965",
  ]);
  const capabilityMatrix = "PCM5_CUTOVER_GOOGLE_" + capabilityDigest.slice(0, 24);
  assertEqual(
    capabilityMatrix,
    "PCM5_CUTOVER_GOOGLE_a08f04a7e816d80d6fdedaf7",
    "Capability_Matrix_Version",
  );

  const acceptanceBinding =
    "AB1_" +
    (await sha256Hex([
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
    ]));
  assertEqual(
    acceptanceBinding,
    "AB1_5c47281c3804ce7ebb7f43d606d91e6a4a2d06faa25d92c18a78bdd15394ddea",
    "Acceptance_Binding_ID",
  );

  console.log(
    JSON.stringify(
      {
        candidate_binding_validation: "PASS",
        implementation_build_id: implementationBuild,
        mutation_adapter_fingerprint: mutationAdapter,
        provider_config_id: providerConfig,
        resource_scope_fingerprint: resourceScope,
        capability_matrix_version: capabilityMatrix,
        acceptance_binding_id: acceptanceBinding,
        official_migration_witness: "NOT_EXECUTED",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
