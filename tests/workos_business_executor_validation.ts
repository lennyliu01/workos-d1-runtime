import assert from "node:assert/strict";
import { capabilitiesFor } from "../src/workos_capability_profiles.js";
import { deterministicCycleId, isProductionFenceEnabled, taskForCron, validateRoleReturn, validateWorkflowTransition, FX_CRON, RW_CRON } from "../src/workos_business_executor.js";

assert.equal(taskForCron(FX_CRON), "US_JAPAN_FX_POLICY");
assert.equal(taskForCron(RW_CRON), "ROLLING_WEDGE_INVESTMENT");
assert.throws(() => taskForCron("0 0 * * *"), /UNKNOWN_SCHEDULE/);
assert.equal(isProductionFenceEnabled("US_JAPAN_FX_POLICY", {}), false);
assert.equal(isProductionFenceEnabled("ROLLING_WEDGE_INVESTMENT", {}), false);
assert.equal(isProductionFenceEnabled("US_JAPAN_FX_POLICY", { WORKOS_EXECUTOR_FX_ENABLED: "true" } as any), true);
assert.equal(deterministicCycleId("US_JAPAN_FX_POLICY", "2026-10-05T02:00:00Z"), deterministicCycleId("US_JAPAN_FX_POLICY", "2026-10-05T02:00:00Z"));
assert.notEqual(deterministicCycleId("US_JAPAN_FX_POLICY", "2026-10-05T02:00:00Z"), deterministicCycleId("ROLLING_WEDGE_INVESTMENT", "2026-10-05T02:00:00Z"));
validateWorkflowTransition("US_JAPAN_FX_POLICY", { kind: "DISPATCH_ROLE", role: "COLLECTOR", payload: {}, reason: null });
assert.throws(() => validateWorkflowTransition("US_JAPAN_FX_POLICY", { kind: "DISPATCH_ROLE", role: "MONITOR", payload: {}, reason: null }), /UNREGISTERED_ROLE_DISPATCH/);
validateRoleReturn({ kind: "ROLE_RESULT", status: "COMPLETED", return_target: "WORKFLOW", payload: {}, reason: null });
assert.equal(capabilitiesFor("FX_READER").has("web_search"), false);
assert.equal(capabilitiesFor("RW_DECISION").has("web_search"), false);
assert.equal(capabilitiesFor("RW_WORKFLOW").has("market_quote"), true);
console.log("workos_business_executor_validation: PASS");
import { authorizePersistence, PINNED_GATE_CONFIG_FINGERPRINT, PINNED_GATE_LOCATOR } from "../src/workos_persistent_gate_projection.js";
import { runStructuredModelContext } from "../src/workos_model_runtime.js";

const gate = {
  gateLocator: PINNED_GATE_LOCATOR, gateConfigFingerprint: PINNED_GATE_CONFIG_FINGERPRINT,
  taskId: "US_JAPAN_FX_POLICY", registrySnapshotId: "RS1", manifestSetId: "MSET1", manifestState: "ACTIVE",
  accesses: [{ datasetId: "FX_POLICY_RUN_LOG", instanceId: "SINGLETON", readers: new Set(["US_Japan_FX_Policy_Workflow"]), writers: new Set(["COLLECTOR"]), writeMode: "APPEND_ONLY" as const }],
};
authorizePersistence(gate, { taskId: "US_JAPAN_FX_POLICY", callerIdentity: "US_Japan_FX_Policy_Workflow", datasetId: "FX_POLICY_RUN_LOG", instanceId: "SINGLETON", operation: "READ" });
assert.throws(() => authorizePersistence(gate, { taskId: "ROLLING_WEDGE_INVESTMENT", callerIdentity: "US_Japan_FX_Policy_Workflow", datasetId: "FX_POLICY_RUN_LOG", instanceId: "SINGLETON", operation: "READ" }), /TASK_AUTHORITY_MISMATCH/);
assert.throws(() => authorizePersistence({ ...gate, gateConfigFingerprint: "bad" }, { taskId: "US_JAPAN_FX_POLICY", callerIdentity: "US_Japan_FX_Policy_Workflow", datasetId: "FX_POLICY_RUN_LOG", instanceId: "SINGLETON", operation: "READ" }), /GATE_CONFIG_FINGERPRINT_DRIFT/);

const fakeClient: any = { responses: { create: async () => ({ id: "r1", output: [], output_text: "{\"bad\":true}" }) } };
await assert.rejects(() => runStructuredModelContext(fakeClient, {
  context: "FX_WORKFLOW", taskId: "US_JAPAN_FX_POLICY", callerIdentity: "US_Japan_FX_Policy_Workflow",
  instructionText: "spec", runtimeProfileText: "profile", input: {}, kind: "WORKFLOW",
}, { workosRead: async()=>({}), workosWrite: async()=>({}), marketQuote: async()=>({}), sourceVerify: async()=>({}) }), /MODEL_WORKFLOW_OUTPUT_INVALID/);

import { invokeWriteWithFinality } from "../src/workos_business_executor.js";
import { runBoundedWebLookup } from "../src/workos_model_runtime.js";

const appendControlPlane: any = {
  gate: {
    gateLocator: PINNED_GATE_LOCATOR,
    gateConfigFingerprint: PINNED_GATE_CONFIG_FINGERPRINT,
    taskId: "US_JAPAN_FX_POLICY",
    registrySnapshotId: "RS1",
    manifestSetId: "MSET1",
    manifestState: "ACTIVE",
    accesses: [{
      datasetId: "FX_POLICY_RUN_LOG", instanceId: "SINGLETON",
      readers: new Set(["COLLECTOR", "US_Japan_FX_Policy_Workflow"]),
      writers: new Set(["COLLECTOR"]), writeMode: "APPEND_ONLY",
    }],
  },
};
const writeRequest: any = {
  execution_surface: "WORK", trigger_mode: "SCHEDULE", task_id: "US_JAPAN_FX_POLICY",
  caller_identity: "COLLECTOR", operation: "WRITE", dataset_id: "FX_POLICY_RUN_LOG", instance_id: "SINGLETON",
  idempotency_key: "cycle.role.runlog", record_key: "run-1", payload: { status: "Completed", n: 1 },
};

let calls = 0;
const retryAfterAbsence: any = async (_url: string, init: any) => {
  calls += 1;
  const body = JSON.parse(init.body);
  if (calls === 1) throw new Error("simulated transport ambiguity");
  if (calls === 2) {
    assert.equal(body.operation, "READ");
    return { status: 404, json: async () => ({ status: "FAILED", error: "NOT_FOUND" }) };
  }
  assert.equal(body.operation, "WRITE");
  assert.equal(body.idempotency_key, "cycle.role.runlog");
  return { status: 200, json: async () => ({ status: "SUCCESS", operation: "WRITE", idempotency_key: body.idempotency_key }) };
};
const retried = await invokeWriteWithFinality(appendControlPlane, writeRequest, "secret", retryAfterAbsence);
assert.equal(retried.status, "SUCCESS");
assert.equal(calls, 3, "write must be replayed only after exact absence readback");

calls = 0;
const confirmedByReadback: any = async (_url: string, init: any) => {
  calls += 1;
  const body = JSON.parse(init.body);
  if (calls === 1) throw new Error("simulated response loss");
  assert.equal(body.operation, "READ");
  return { status: 200, json: async () => ({ status: "SUCCESS", operation: "READ", record: { payload: { n: 1, status: "Completed" } } }) };
};
const recovered = await invokeWriteWithFinality(appendControlPlane, writeRequest, "secret", confirmedByReadback);
assert.equal(recovered.recovered_from_finality, true);
assert.equal(calls, 2, "confirmed ambiguous mutation must not be replayed");

calls = 0;
const mismatchReadback: any = async (_url: string, init: any) => {
  calls += 1;
  if (calls === 1) throw new Error("simulated response loss");
  return { status: 200, json: async () => ({ status: "SUCCESS", operation: "READ", record: { payload: { status: "Different" } } }) };
};
await assert.rejects(() => invokeWriteWithFinality(appendControlPlane, writeRequest, "secret", mismatchReadback), /AMBIGUOUS_WRITE_FINALITY_MISMATCH/);
assert.equal(calls, 2, "mismatched finality must fail closed without replay");

const fakeWebClient: any = { responses: { create: async (input: any) => {
  assert.equal(input.tools[0].type, "web_search");
  return { id: "web1", output_text: "bounded lookup result" };
} } };
const market = await runBoundedWebLookup(fakeWebClient, { purpose: "MARKET_QUOTE", query: { symbol: "TEST", purpose: "valuation input" } });
assert.equal(market.status, "SUCCESS");

const validWorkflowClient: any = { responses: { create: async () => ({ id: "r2", output: [], output_text: JSON.stringify({ kind: "STOP", role: null, payload_json: "{}", reason: "done" }) }) } };
const validWorkflow = await runStructuredModelContext(validWorkflowClient, {
  context: "FX_WORKFLOW", taskId: "US_JAPAN_FX_POLICY", callerIdentity: "US_Japan_FX_Policy_Workflow",
  instructionText: "spec", runtimeProfileText: "profile", input: {}, kind: "WORKFLOW",
}, { workosRead: async()=>({}), workosWrite: async()=>({}), marketQuote: async()=>({}), sourceVerify: async()=>({}) });
assert.equal(validWorkflow.kind, "STOP");

const invalidRoleClient: any = { responses: { create: async () => ({ id: "r3", output: [], output_text: JSON.stringify({ kind: "ROLE_RESULT", status: "COMPLETED", return_target: "REVISER", payload_json: "{}", reason: null }) }) } };
await assert.rejects(() => runStructuredModelContext(invalidRoleClient, {
  context: "RW_MONITOR", taskId: "ROLLING_WEDGE_INVESTMENT", callerIdentity: "MONITOR",
  instructionText: "spec", runtimeProfileText: "profile", input: {}, kind: "ROLE",
}, { workosRead: async()=>({}), workosWrite: async()=>({}), marketQuote: async()=>({}), sourceVerify: async()=>({}) }), /MODEL_ROLE_RESULT_INVALID/);

console.log("workos_business_executor_extended_validation: PASS");
