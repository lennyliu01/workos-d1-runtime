import assert from "node:assert/strict";
import { handleWorkOsCandidatePersistence } from "../src/workos_candidate.js";

const companies = ["DSG", "DOL", "WSP", "GIBA", "NA", "ENB", "ATD"];
const datasets = [
  "RW_CURRENT_STATE", "RW_EVIDENCE_HISTORY", "RW_REVISION_HISTORY",
  "RW_VALUATION_HISTORY", "RW_RUN_LOG",
];
let dbCalls = 0;
const DB = {
  prepare(_sql: string) {
    dbCalls += 1;
    return {
      bind(..._args: unknown[]) {
        return {
          first: async () => null,
          all: async () => ({ success: true, results: [] }),
          run: async () => { throw Error("test must not write D1"); },
        };
      },
    };
  },
};
const endpoint = "https://example.invalid/candidate/workos-persistence";
function readBody(instance: string, dataset = "RW_CURRENT_STATE") {
  return {
    task_id: "ROLLING_WEDGE_INVESTMENT",
    caller_identity: "Rolling_Wedge_Workflow",
    operation: "READ",
    dataset_id: dataset,
    instance_id: instance,
    selector: dataset === "RW_CURRENT_STATE" ? { kind: "CURRENT" } : { kind: "TAIL", limit: 1 },
  };
}
function accepted(scope: Record<string, unknown>) {
  return {
    ...scope,
    authority_selection: "SINGLETON_CURRENT",
    selected_manifest_id: "MS1_TEST_ACTIVE_SELECTED",
    manifest_state: "ACTIVE",
    business_authority_state: "ACTIVE",
    permitted: true,
  };
}
async function invoke(body: unknown, authorizeActiveManifestScope?: (scope: any) => Promise<any>) {
  return handleWorkOsCandidatePersistence(
    new Request(endpoint, {
      method: "POST",
      headers: { Authorization: "Bearer test-only-secret", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { RUNTIME_SECRET: "test-only-secret", DB, authorizeActiveManifestScope },
  );
}
async function expectError(body: unknown, authorizer: ((scope: any) => Promise<any>) | undefined, status: number, code: string) {
  const r = await invoke(body, authorizer);
  assert.equal(r.status, status);
  assert.equal((await r.json() as any).error, code);
}

for (const company of companies) {
  for (const dataset of datasets) {
    const prior = dbCalls;
    await expectError(readBody(company, dataset), undefined, 403, "ACTIVE_MANIFEST_GATE_REQUIRED");
    assert.equal(dbCalls, prior, "new candidate must not reach DB without ACTIVE Manifest/Gate");
  }
}
for (const company of companies) {
  const r = await invoke(readBody(company), async (scope) => accepted(scope));
  assert.equal(r.status, 404, "authorized new CURRENT read reaches empty fake D1");
  assert.equal((await r.json() as any).error, "NOT_FOUND");
}
const old = await invoke(readBody("ENPLAS"));
assert.equal(old.status, 404, "existing company remains on the unchanged candidate read path");
await expectError(readBody("FOREIGN"), async scope => accepted(scope), 403, "CONTROL_DENIED");
await expectError(readBody("DSG", "FX_POLICY_RUN_LOG"), async scope => accepted(scope), 403, "CONTROL_DENIED");

for (const deviation of [
  { permitted: false },
  { manifest_state: "CANDIDATE" },
  { authority_selection: "LATEST" },
  { business_authority_state: "DRAFT" },
  { selected_manifest_id: "" },
  { instance_id: "ENPLAS" },
  { dataset_id: "RW_RUN_LOG" },
  { caller_identity: "MONITOR" },
  { operation: "WRITE" },
  { resource_binding: "OTHER" },
]) {
  const prior = dbCalls;
  await expectError(readBody("DSG"), async scope => ({ ...accepted(scope), ...deviation }), 403, "ACTIVE_MANIFEST_SCOPE_DENIED");
  assert.equal(dbCalls, prior, "invalid Gate result must not reach DB");
}
await expectError(readBody("DSG"), async () => null, 403, "ACTIVE_MANIFEST_SCOPE_DENIED");
await expectError(readBody("DSG"), async () => { throw Error("gate offline"); }, 503, "ACTIVE_MANIFEST_GATE_UNAVAILABLE");

for (const company of companies) {
  const writeBody = {
    ...readBody(company),
    caller_identity: "Rolling_Wedge_Workflow",
    operation: "WRITE",
    idempotency_key: "test-only-idempotency",
    expected_version: 0,
    payload: { Company_ID: company },
  };
  delete (writeBody as any).selector;
  const prior = dbCalls;
  await expectError(writeBody, undefined, 403, "ACTIVE_MANIFEST_GATE_REQUIRED");
  assert.equal(dbCalls, prior, "no unauthenticated initial baseline write");
}
console.log("workos_batch07_instance_compat_validation: PASS (7x5 fail closed, 7 read paths, negative Gate, existing company; no D1 writes)");
