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
  const invocation = "aae39b71d10e5920318dbaec43fc68abb7edd7c5";
  const index = "ac433e9a101963a314a5276f2966b09c608fa09f";
  const fixtureRoot = "GFR1_7bd591adcefe2c5b178eeb49af142e4b4f25b4da83caba8b6d44546617c1f40e";
  const denylist = "PDL1_8709a31da33beea711c91b74fae6834a592cb7f2e786f93349269a83c8076018";
  const finality = "GFRF1_c5d4e2b54d63d5e2f8c0b31f4fc652a15703702e52515d7b8d52cc0211f9bb33";

  const ib = "IB1_" + await sha([
    "CUTOVER_WITNESS_POSTPUB_BUILD_V1",
    "lennyliu01/workos-d1-runtime",
    "src/cutover_executor.ts@blob:" + core,
    "src/cutover_witness_fixture.ts@blob:" + fixture,
    "src/cutover_witness_invocation.ts@blob:" + invocation,
    "src/index.ts@blob:" + index,
  ]);
  eq(ib, "IB1_02fbc9da958ff1a1064782a2262c7c4c0173085a7ec6f204acb1ad5a27fcd63c", "Implementation_Build_ID");

  const adapter = await sha([
    "CUTOVER_GOOGLE_MUTATION_ADAPTER_V2",
    "src/cutover_executor.ts@blob:" + core,
    "src/cutover_witness_invocation.ts@blob:" + invocation,
    "GOOGLE_SHEETS_V4",
    "spreadsheets.batchUpdate/updateCells",
    "spreadsheets.values.get/UNFORMATTED_VALUE",
    "PARTIAL_RECOVERY=CONTIGUOUS_SAME_TRANSITION_FORWARD_PREFIX",
    "AMBIGUOUS=>EXACT_READBACK_NO_BLIND_RETRY",
    fixtureRoot, denylist, finality,
  ]);
  eq(adapter, "6b28258e9d478f4c2a3a9c605995b0fc9213f3e1e93fe19fce16eb60fdb43ebd", "Mutation_Adapter_Fingerprint");

  const provider = "GSPC1_" + await sha([
    "GSPC1","GOOGLE_SHEETS_V4",
    "READ=spreadsheets.values.get/UNFORMATTED_VALUE",
    "MUTATE=spreadsheets.batchUpdate/updateCells/USER_ENTERED_VALUE",
    "FINALITY=AMBIGUOUS_THEN_EXACT_REGISTERED_READBACK_NO_BLIND_RETRY",
    "FAULT_BOUNDARY=AFTER_REAL_PROVIDER_OPERATION_WITNESS_ONLY",
  ]);
  eq(provider, "GSPC1_6a99cf8bf66b44a3e11b4a1536dad167745cd30ad2c89a4c229fff29a6c69352", "Provider_Config_ID");

  const resource = await sha([
    "CUTOVER_WITNESS_POSTPUB_RESOURCE_SCOPE_V1",
    "1n1YPmM6V8j4VCeVHZo1e2AvKjoVz4KFjXlpqBPqRnx8",
    "ANLCKQnVVo_A0bKw5-d20euYCumAHyWKf4iTtmuElesL5B9xXwjt9moQdHxdEGC4NcoH6wGxMM-MqcRoP_0bZM5AdkXJWIWyZSktXrQzSVA",
    fixtureRoot,
    "11DKed3wVcnryEQrgHzfR276znYJLRAwM14ZOEwCkS1Y",
    denylist, finality,
    "FORMAL_INVOCATION=POST /cutover/witness",
  ]);
  eq(resource, "4918f1009c2d4776956b5d18859ab50ae82626aa15e6d7a92eeb371d5d538e17", "Resource_Scope_Fingerprint");

  const pcmDigest = await sha([
    "PCM6_CUTOVER_GOOGLE_V1", ib, adapter, provider, resource,
    "RPC2_876ebf449027572c78e74fc14fa1ab01f82ecc1be97baace54670de5f3a76eee",
    "RPC2_dc26fc898190029377fc508f428dadbc8b54c05a95c76ee0933d4ce2907ce7ab",
    "OWNER_VALIDATION_RUN=36667658870",
  ]);
  const pcm = "PCM6_CUTOVER_GOOGLE_" + pcmDigest.slice(0, 24);
  eq(pcm, "PCM6_CUTOVER_GOOGLE_734df3e510e850d8e5b470a7", "Capability_Matrix_Version");

  const binding = "AB1_" + await sha([
    ib,
    "a5f6447dd54fa3b5c5cdcb6ffada335cfe28fd8b3dad85b77693f522aab3c53f",
    "ba3bb9599a034a764c9bdfd10a3dca79436fbae80960ace6a64e2786035909f8",
    adapter, provider,
    "RS1_84f170ffef50fecc331de87458db2bee9aeebf1bdf7c4e079260c338d477d7e1",
    "84f170ffef50fecc331de87458db2bee9aeebf1bdf7c4e079260c338d477d7e1",
    "MSET1_2f76282f0cc13c1df38b414d0221bebcc7f739fcb749ac6d7012e438f42f1cbc",
    "f9ae8ed9716b5dd447bad5f9951baef2bfb3f29161120a8118280204a1290ca7",
    "ROUTE_V1","SHARED_ARCHIVE_INFRASTRUCTURE",resource,pcm,
  ]);
  eq(binding, "AB1_885cedf836775e6625bd212eec4ebb0aee793d4eab53bd95f6b41ce9a18d9dc7", "Acceptance_Binding_ID");

  console.log(JSON.stringify({
    post_publication_candidate_binding_validation: "PASS",
    implementation_build_id: ib,
    mutation_adapter_fingerprint: adapter,
    provider_config_id: provider,
    provider_config_disposition: "MECHANICALLY_PROVEN_UNCHANGED",
    resource_scope_fingerprint: resource,
    capability_matrix_version: pcm,
    acceptance_binding_id: binding,
    governed_witness_executed: false,
  }, null, 2));
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
