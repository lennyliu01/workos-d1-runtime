import assert from "node:assert/strict";
import { formatIssueTerminalResult, invokePersistence, parseIssueInvocation } from "../src/runtime_invocation_client.js";

const readBody = [
  "Execution_Surface: WORK", "Trigger_Mode: SCHEDULE", "Task_ID: US_JAPAN_FX_POLICY",
  "Caller_Identity: US_Japan_FX_Policy_Workflow", "Operation: READ", "Dataset_ID: FX_POLICY_RUN_LOG",
  "Instance_ID: SINGLETON", "Selector: TAIL", "Limit: 1",
].join("\n");
const parsed = parseIssueInvocation("[RUNTIME_INVOCATION] READ", readBody, 42);
assert.equal(parsed.request.operation, "READ");
assert.deepEqual((parsed.request as any).selector, { kind: "TAIL", limit: 1 });
assert.equal(parsed.sourceRunKey, "github-issue-42");
assert.throws(() => parseIssueInvocation("[RUNTIME_INVOCATION] WRITE", readBody, 42), /TITLE_OPERATION_MISMATCH/);

const fakeFetch: typeof fetch = async (_url: any, init?: any) => {
  const req = JSON.parse(init.body);
  return new Response(JSON.stringify({ status: "SUCCESS", operation: req.operation, task_id: req.task_id, dataset_id: req.dataset_id, instance_id: req.instance_id }), { status: 200, headers: { "content-type": "application/json" } });
};
const result = await invokePersistence({
  execution_surface: "WORK", trigger_mode: "SCHEDULE", task_id: "US_JAPAN_FX_POLICY",
  caller_identity: "US_Japan_FX_Policy_Workflow", operation: "READ", dataset_id: "FX_POLICY_RUN_LOG",
  instance_id: "SINGLETON", selector: { kind: "TAIL", limit: 1 },
}, "test-secret", fakeFetch);
assert.equal(result.response.status, "SUCCESS");
assert.match(formatIssueTerminalResult({ ...result, sourceRunKey: "github-issue-42" }), /Transport: GITHUB_ACTIONS/);
console.log("workos_runtime_client_equivalence_validation: PASS");
