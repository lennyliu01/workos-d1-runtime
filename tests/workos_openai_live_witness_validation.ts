import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assertOpenAILiveWitnessEnvironment,
  OPENAI_LIVE_WITNESS_EXPECTED_STATUS,
  OPENAI_LIVE_WITNESS_MODEL,
  runOpenAILiveWitness,
} from "../src/workos_openai_live_witness.js";

const workflow = await readFile(".github/workflows/workos-business-executor.yml", "utf8");
const witnessSource = await readFile("src/workos_openai_live_witness.ts", "utf8");

assert.equal((workflow.match(/- cron: '0 2 \* \* \*'/g) ?? []).length, 1);
assert.equal((workflow.match(/- cron: '15 4 \* \* \*'/g) ?? []).length, 1);
assert.match(workflow, /WORKOS_EXECUTOR_FX_ENABLED/);
assert.match(workflow, /WORKOS_EXECUTOR_RW_ENABLED/);
assert.match(workflow, /witness_mode:/);
assert.match(workflow, /- openai_live/);
assert.match(workflow, /openai_witness=true/);
assert.match(workflow, /npx tsx src\/workos_openai_live_witness\.ts/);

const openaiStepStart = workflow.indexOf("- name: Execute isolated OpenAI WIF + Responses live witness");
const businessStepStart = workflow.indexOf("- name: Execute registered WorkOS Workflow or READ-only witness", openaiStepStart);
assert.ok(openaiStepStart >= 0);
assert.ok(businessStepStart > openaiStepStart);
const openaiStep = workflow.slice(openaiStepStart, businessStepStart);
assert.match(openaiStep, /WORKOS_OPENAI_LIVE_WITNESS: 'true'/);
assert.match(openaiStep, /WORKOS_PRODUCTION_WRITES_ENABLED: 'false'/);
assert.doesNotMatch(openaiStep, /WORKOS_TASK_ID/);
assert.doesNotMatch(openaiStep, /GOOGLE_OAUTH_ACCESS_TOKEN/);
assert.doesNotMatch(openaiStep, /RUNTIME_SECRET/);

assert.doesNotMatch(witnessSource, /workos_business_executor\.js/);
assert.doesNotMatch(witnessSource, /workos_control_plane_loader\.js/);
assert.doesNotMatch(witnessSource, /runtime_invocation_client\.js/);
assert.doesNotMatch(witnessSource, /workos_persistent_gate_projection\.js/);

const witnessEnv = {
  GITHUB_EVENT_NAME: "workflow_dispatch",
  WORKOS_OPENAI_LIVE_WITNESS: "true",
  WORKOS_PRODUCTION_WRITES_ENABLED: "false",
};
assert.doesNotThrow(() => assertOpenAILiveWitnessEnvironment(witnessEnv));
assert.throws(
  () => assertOpenAILiveWitnessEnvironment({ ...witnessEnv, GITHUB_EVENT_NAME: "schedule" }),
  /REQUIRES_WORKFLOW_DISPATCH/,
);
assert.throws(
  () => assertOpenAILiveWitnessEnvironment({ ...witnessEnv, WORKOS_TASK_ID: "US_JAPAN_FX_POLICY" }),
  /FORBIDDEN_ENV:WORKOS_TASK_ID/,
);
assert.throws(
  () => assertOpenAILiveWitnessEnvironment({ ...witnessEnv, GOOGLE_OAUTH_ACCESS_TOKEN: "forbidden" }),
  /FORBIDDEN_ENV:GOOGLE_OAUTH_ACCESS_TOKEN/,
);
assert.throws(
  () => assertOpenAILiveWitnessEnvironment({ ...witnessEnv, RUNTIME_SECRET: "forbidden" }),
  /FORBIDDEN_ENV:RUNTIME_SECRET/,
);

let captured: Record<string, unknown> | undefined;
const fakeClient: any = {
  responses: {
    create: async (input: Record<string, unknown>) => {
      captured = input;
      return {
        id: "resp_openai_witness_test",
        output_text: JSON.stringify({ status: OPENAI_LIVE_WITNESS_EXPECTED_STATUS }),
      };
    },
  },
};
const result = await runOpenAILiveWitness(fakeClient);
assert.equal(captured?.model, OPENAI_LIVE_WITNESS_MODEL);
assert.equal(captured?.max_output_tokens, 64);
assert.equal(Object.prototype.hasOwnProperty.call(captured, "tools"), false);
assert.equal((captured as any).text.format.strict, true);
assert.deepEqual((captured as any).text.format.schema.required, ["status"]);
assert.equal(result.status, "SUCCESS");
assert.equal(result.requested_model, "gpt-5.6");
assert.equal(result.response_id, "resp_openai_witness_test");
assert.equal(result.output_assertion, "PASS");

const badClient: any = {
  responses: {
    create: async () => ({
      id: "resp_bad",
      output_text: JSON.stringify({ status: "WRONG" }),
    }),
  },
};
await assert.rejects(() => runOpenAILiveWitness(badClient), /ASSERTION_FAILED/);

console.log("workos_openai_live_witness_validation: PASS");
