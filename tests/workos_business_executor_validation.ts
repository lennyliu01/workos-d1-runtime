import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { capabilitiesFor } from "../src/workos_capability_profiles.js";
import {
  deterministicCycleId, isProductionFenceEnabled, taskForCron, validateRoleReturn,
  validateWorkflowTransition, invokeWriteWithFinality, FX_CRON, RW_CRON,
} from "../src/workos_business_executor.js";
import {
  authorizePersistence, PINNED_GATE_BLOB, PINNED_GATE_CONFIG_FINGERPRINT, PINNED_GATE_LOCATOR,
  type GateProjectionSnapshot,
} from "../src/workos_persistent_gate_projection.js";
import {
  loadOpenAIWorkloadIdentityConfig, modelToolsForContext, runBoundedWebLookup, runStructuredModelContext,
} from "../src/workos_model_runtime.js";

assert.equal(taskForCron(FX_CRON), "US_JAPAN_FX_POLICY");
assert.equal(taskForCron(RW_CRON), "ROLLING_WEDGE_INVESTMENT");
assert.throws(() => taskForCron("0 0 * * *"), /UNKNOWN_SCHEDULE/);
assert.equal(isProductionFenceEnabled("US_JAPAN_FX_POLICY", {}), false);
assert.equal(isProductionFenceEnabled("ROLLING_WEDGE_INVESTMENT", {}), false);
assert.equal(isProductionFenceEnabled("US_JAPAN_FX_POLICY", { WORKOS_EXECUTOR_FX_ENABLED: "true" } as any), true);
const occurrence = "2026-10-05T11:00:00+09:00";
assert.equal(deterministicCycleId("US_JAPAN_FX_POLICY", occurrence), deterministicCycleId("US_JAPAN_FX_POLICY", occurrence));
assert.notEqual(deterministicCycleId("US_JAPAN_FX_POLICY", occurrence), deterministicCycleId("ROLLING_WEDGE_INVESTMENT", occurrence));
assert.notEqual(deterministicCycleId("US_JAPAN_FX_POLICY", occurrence), deterministicCycleId("US_JAPAN_FX_POLICY", "2026-10-06T11:00:00+09:00"));
validateWorkflowTransition("US_JAPAN_FX_POLICY", { kind: "DISPATCH_ROLE", role: "COLLECTOR", payload: {}, reason: null });
assert.throws(() => validateWorkflowTransition("US_JAPAN_FX_POLICY", { kind: "DISPATCH_ROLE", role: "MONITOR", payload: {}, reason: null }), /UNREGISTERED_ROLE_DISPATCH/);
validateRoleReturn({ kind: "ROLE_RESULT", status: "COMPLETED", return_target: "WORKFLOW", payload: {}, reason: null });
assert.equal(capabilitiesFor("FX_READER").has("web_search"), false);
assert.equal(capabilitiesFor("RW_DECISION").has("web_search"), false);
assert.equal(capabilitiesFor("RW_WORKFLOW").has("market_quote"), true);

const workflowYaml = await readFile(".github/workflows/workos-business-executor.yml", "utf8");
assert.match(workflowYaml, /workos-business-executor-\$\{\{/);
assert.match(workflowYaml, /'US_JAPAN_FX_POLICY'/);
assert.match(workflowYaml, /'ROLLING_WEDGE_INVESTMENT'/);
assert.doesNotMatch(workflowYaml, /github\.run_id/);
assert.match(workflowYaml, /T11:00:00\+09:00/);
assert.match(workflowYaml, /T13:15:00\+09:00/);
assert.doesNotMatch(workflowYaml, /OPENAI_WIF_TOKEN_EXCHANGE_URL/);

const sdkEnv = {
  GITHUB_REPOSITORY: "lennyliu01/workos-d1-runtime",
  GITHUB_REF: "refs/heads/main",
  GITHUB_WORKFLOW_REF: "lennyliu01/workos-d1-runtime/.github/workflows/workos-business-executor.yml@refs/heads/main",
  OPENAI_WIF_AUDIENCE: "https://api.openai.com/v1",
  OPENAI_IDENTITY_PROVIDER_ID: "idp-test",
  OPENAI_SERVICE_ACCOUNT_ID: "sa-test",
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://example.invalid/oidc",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "runner-token",
};
const sdkConfig = loadOpenAIWorkloadIdentityConfig(sdkEnv);
assert.equal(sdkConfig.identityProviderId, "idp-test");
assert.equal((sdkConfig as any).exchangeUrl, undefined);
assert.throws(() => loadOpenAIWorkloadIdentityConfig({ ...sdkEnv, OPENAI_API_KEY: "forbidden" }), /OPENAI_API_KEY_FORBIDDEN/);

for (const context of ["FX_WORKFLOW","FX_COLLECTOR","FX_READER","RW_WORKFLOW","RW_MONITOR","RW_REVISER","RW_VALUATOR","RW_DECISION"] as const) {
  for (const tool of modelToolsForContext(context).filter((x:any)=>x.type==="function")) {
    assert.equal(tool.strict, true);
    assert.equal(tool.parameters.additionalProperties, false);
    assert.deepEqual([...tool.parameters.required].sort(), Object.keys(tool.parameters.properties).sort());
  }
}

function baseGate(): GateProjectionSnapshot {
  return {
    gateLocator: PINNED_GATE_LOCATOR,
    gateBlob: PINNED_GATE_BLOB,
    gateConfigFingerprint: PINNED_GATE_CONFIG_FINGERPRINT,
    authorityPublicationState: "EXACT_ONE",
    authorityPublication: {
      authorityScopeFingerprint: "scope", currentCommittedCutoverId: "CUT", currentActivationEpoch: "10",
      registrySnapshotId: "RS1", manifestSetId: "MSET1", gateConfigFingerprint: PINNED_GATE_CONFIG_FINGERPRINT,
      workflowSetFingerprint: "WFSET",
    },
    expectedAuthorityScopeFingerprint: "scope", expectedCutoverId: "CUT", expectedActivationEpoch: "10",
    expectedManifestSetId: "MSET1", expectedGateConfigFingerprint: PINNED_GATE_CONFIG_FINGERPRINT,
    expectedWorkflowSetFingerprint: "WFSET", referencedCutoverState: "COMPLETE",
    currentRegistrySnapshotId: "RS1", currentRegistryFingerprint: "RF",
    manifestId: "MS1", taskId: "US_JAPAN_FX_POLICY", manifestState: "ACTIVE",
    manifestRegistrySnapshotId: "RS1", manifestRegistryFingerprint: "RF",
    migrationFenceActive: false, pruneFenceIndexAvailable: true,
    pruneFencedKeys: new Set(), startedPruneKeys: new Set(), archivedIdentityKeys: new Set(),
    accesses: [{
      datasetId: "FX_POLICY_RUN_LOG", instanceId: "SINGLETON", logicalMember: "D1_BOUND_DATASET:FX_POLICY_RUN_LOG;Binding=DB",
      contractFingerprint: "schema", physicalContractFingerprint: "schema",
      readers: new Set(["COLLECTOR", "US_Japan_FX_Policy_Workflow"]),
      writerScopes: [{ writerId: "COLLECTOR", operations: new Set(["APPEND_ONLY"]), fields: null }],
      writeMode: "APPEND_ONLY", dynamicInstance: false, businessAuthorityState: "ACTIVE",
    }],
  };
}
const readReq = { taskId:"US_JAPAN_FX_POLICY", callerIdentity:"US_Japan_FX_Policy_Workflow", manifestId:"MS1", datasetId:"FX_POLICY_RUN_LOG", instanceId:"SINGLETON", logicalMember:"D1_BOUND_DATASET:FX_POLICY_RUN_LOG;Binding=DB", operation:"READ" as const };
const writeReq = { taskId:"US_JAPAN_FX_POLICY", callerIdentity:"COLLECTOR", manifestId:"MS1", datasetId:"FX_POLICY_RUN_LOG", instanceId:"SINGLETON", logicalMember:"D1_BOUND_DATASET:FX_POLICY_RUN_LOG;Binding=DB", operation:"WRITE" as const, writeOperation:"APPEND_ONLY", fields:new Set<string>() };
authorizePersistence(baseGate(), readReq);
authorizePersistence(baseGate(), writeReq);
assert.throws(()=>authorizePersistence({...baseGate(),authorityPublication:{...baseGate().authorityPublication!,currentActivationEpoch:"9"}},readReq),/AUTHORITY_BINDING_MISMATCH/);
assert.throws(()=>authorizePersistence({...baseGate(),referencedCutoverState:"PREPARED"},readReq),/AUTHORITY_CUTOVER_NOT_COMMITTED/);
assert.throws(()=>authorizePersistence({...baseGate(),manifestRegistryFingerprint:"BAD"},readReq),/MANIFEST_REGISTRY_CONFLICT/);
assert.throws(()=>authorizePersistence({...baseGate(),migrationFenceActive:true},writeReq),/MIGRATION_WRITE_FENCE_ACTIVE/);
assert.throws(()=>authorizePersistence(baseGate(),{...readReq,logicalMember:"WRONG"}),/DATASET_NOT_REGISTERED/);
const dyn=baseGate(); dyn.accesses=[{...dyn.accesses[0],dynamicInstance:true,businessAuthorityState:"SUSPENDED"}];
assert.throws(()=>authorizePersistence(dyn,readReq),/BUSINESS_AUTHORITY_NOT_READY/);
assert.throws(()=>authorizePersistence(baseGate(),{...writeReq,writeOperation:"DELETE"}),/WRITE_SCOPE_VIOLATION/);
const field=baseGate(); field.accesses=[{...field.accesses[0],writerScopes:[{writerId:"COLLECTOR",operations:new Set(["APPEND_ONLY"]),fields:new Set(["allowed"])}]}];
assert.throws(()=>authorizePersistence(field,{...writeReq,fields:new Set(["blocked"])}),/WRITE_SCOPE_VIOLATION:field scope/);
assert.throws(()=>authorizePersistence({...baseGate(),accesses:[{...baseGate().accesses[0],physicalContractFingerprint:null}]},readReq),/UNRESOLVED/);
assert.throws(()=>authorizePersistence({...baseGate(),accesses:[{...baseGate().accesses[0],physicalContractFingerprint:"bad"}]},readReq),/ARCHIVE_CONTRACT_DRIFT/);
assert.throws(()=>authorizePersistence({...baseGate(),pruneFencedKeys:new Set(["FX_POLICY_RUN_LOG\u0000K1"])},{...writeReq,logicalK1:"K1"}),/PRUNE_FENCE_CONFLICT/);
const archived=baseGate(); archived.accesses=[{...archived.accesses[0],writerScopes:[{writerId:"COLLECTOR",operations:new Set(["CREATE_RECORD"]),fields:null}]}]; archived.archivedIdentityKeys=new Set(["FX_POLICY_RUN_LOG\u0000K1"]);
assert.throws(()=>authorizePersistence(archived,{...writeReq,writeOperation:"CREATE_RECORD",logicalK1:"K1"}),/ARCHIVED_IDENTITY_CONFLICT/);
assert.throws(()=>authorizePersistence({...baseGate(),pruneFenceIndexAvailable:false},readReq),/PRUNE_FENCE_UNAVAILABLE/);
assert.throws(()=>authorizePersistence({...baseGate(),startedPruneKeys:new Set(["FX_POLICY_RUN_LOG\u0000K1"])},{...readReq,logicalK1:"K1"}),/READ_ARCHIVE_PRUNE_IN_PROGRESS/);

const fakeClient:any={responses:{create:async()=>({id:"r1",output:[],output_text:"{\"bad\":true}"})}};
await assert.rejects(()=>runStructuredModelContext(fakeClient,{context:"FX_WORKFLOW",taskId:"US_JAPAN_FX_POLICY",callerIdentity:"US_Japan_FX_Policy_Workflow",instructionText:"spec",runtimeProfileText:"profile",input:{},kind:"WORKFLOW"},{workosRead:async()=>({}),workosWrite:async()=>({}),marketQuote:async()=>({}),sourceVerify:async()=>({})}),/MODEL_WORKFLOW_OUTPUT_INVALID/);

const appendControlPlane:any={gate:baseGate()};
const writeRequest:any={execution_surface:"WORK",trigger_mode:"SCHEDULE",task_id:"US_JAPAN_FX_POLICY",caller_identity:"COLLECTOR",operation:"WRITE",dataset_id:"FX_POLICY_RUN_LOG",instance_id:"SINGLETON",idempotency_key:"cycle.role.runlog",record_key:"run-1",payload:{status:"Completed",n:1}};
let calls=0;
const retryAfterAbsence:any=async(_url:string,init:any)=>{calls++;const body=JSON.parse(init.body);if(calls===1)throw new Error("simulated transport ambiguity");if(calls===2){assert.equal(body.operation,"READ");return{status:404,json:async()=>({status:"FAILED",error:"NOT_FOUND"})}}assert.equal(body.operation,"WRITE");return{status:200,json:async()=>({status:"SUCCESS",operation:"WRITE",idempotency_key:body.idempotency_key})}};
const retried=await invokeWriteWithFinality(appendControlPlane,writeRequest,"secret",retryAfterAbsence);assert.equal(retried.status,"SUCCESS");assert.equal(calls,3);
calls=0;
const confirmed:any=async(_url:string,init:any)=>{calls++;const body=JSON.parse(init.body);if(calls===1)throw new Error("simulated response loss");assert.equal(body.operation,"READ");return{status:200,json:async()=>({status:"SUCCESS",operation:"READ",record:{payload:{n:1,status:"Completed"}}})}};
const recovered=await invokeWriteWithFinality(appendControlPlane,writeRequest,"secret",confirmed);assert.equal(recovered.recovered_from_finality,true);assert.equal(calls,2);

const fakeWebClient:any={responses:{create:async(input:any)=>{assert.equal(input.tools[0].type,"web_search");return{id:"web1",output_text:"bounded lookup result"}}}};
assert.equal((await runBoundedWebLookup(fakeWebClient,{purpose:"MARKET_QUOTE",query:{query:"TEST",symbol:null,as_of:null}})).status,"SUCCESS");
const validWorkflowClient:any={responses:{create:async(input:any)=>{for(const tool of input.tools.filter((x:any)=>x.type==="function")){assert.equal(tool.strict,true);assert.equal(tool.parameters.additionalProperties,false)}return{id:"r2",output:[],output_text:JSON.stringify({kind:"STOP",role:null,payload_json:"{}",reason:"done"})}}}};
assert.equal((await runStructuredModelContext(validWorkflowClient,{context:"FX_WORKFLOW",taskId:"US_JAPAN_FX_POLICY",callerIdentity:"US_Japan_FX_Policy_Workflow",instructionText:"spec",runtimeProfileText:"profile",input:{},kind:"WORKFLOW"},{workosRead:async()=>({}),workosWrite:async()=>({}),marketQuote:async()=>({}),sourceVerify:async()=>({})}) as any).kind,"STOP");
const invalidRoleClient:any={responses:{create:async()=>({id:"r3",output:[],output_text:JSON.stringify({kind:"ROLE_RESULT",status:"COMPLETED",return_target:"REVISER",payload_json:"{}",reason:null})})}};
await assert.rejects(()=>runStructuredModelContext(invalidRoleClient,{context:"RW_MONITOR",taskId:"ROLLING_WEDGE_INVESTMENT",callerIdentity:"MONITOR",instructionText:"spec",runtimeProfileText:"profile",input:{},kind:"ROLE"},{workosRead:async()=>({}),workosWrite:async()=>({}),marketQuote:async()=>({}),sourceVerify:async()=>({})}),/MODEL_ROLE_RESULT_INVALID/);

console.log("workos_business_executor_validation: PASS");
