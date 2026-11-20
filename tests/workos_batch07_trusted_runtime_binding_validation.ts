import assert from "node:assert/strict";
import { createTrustedDynamicD1Resolver, readExactCompanyIdentity } from "../src/workos_dynamic_d1_runtime_binding.js";
import { authorizeDynamicD1Request } from "../src/workos_d1_bootstrap_guard.js";
import {
  PINNED_GATE_LOCATOR,
  PINNED_GATE_BLOB,
  PINNED_GATE_CONFIG_FINGERPRINT,
  type GateProjectionSnapshot,
} from "../src/workos_persistent_gate_projection.js";
import type { ExactControlPlaneReader, LoadedControlPlane } from "../src/workos_control_plane_loader.js";

const BASE = "RW_REGISTRY_SELECTED_BASE";
const fields = [
  "Company_ID","Company_Name","Ticker","Exchange","Currency",
  "State_As_Of","Base_Source_Materials","Structured_State_Content",
] as const;
const baseline = `# Companies_Baseline.md
This file is the sole authority for \`Monitor_Enabled\`, \`State_Status\`, and \`Archived\`.
## DSG
- Company_ID: \`DSG\`
- Company: Descartes Systems Group
- Ticker: \`DSG\`
- Exchange: TSX
- Monitor_Enabled: \`FALSE\`
- Archived: \`FALSE\`
- State_Status: \`DRAFT\`
## ENPLAS
- Company_ID: \`ENPLAS\`
- Company: Enplas
- Ticker: \`6961\`
- Exchange: TSE
- Monitor_Enabled: \`TRUE\`
- Archived: \`FALSE\`
- State_Status: \`ACTIVE\`
`;
const grantHeader=[
  "Task_ID","Manifest_ID","Manifest_Fingerprint","Authority_Epoch","Dataset_ID",
  "Instance_ID","Logical_Member","Writer_ID","Reader_ID","Allowed_Fields",
  "Idempotency_Key","Grant_State","Payload_SHA256",
];
let grantState="ISSUED";
let grantDuplicate=false;
let grantAllowedFieldsOverride:string|undefined;
const reader: ExactControlPlaneReader = {
  async readDriveText() { throw new Error("UNAUTHORIZED_FAKE_LOADER"); },
  async readSheet(spreadsheetId,sheetName,range) {
    if(spreadsheetId!=="MAN-BATCH07-FILE" ||
       sheetName!=="Initial_Baseline_Grants" || range!=="A1:M250")
      throw new Error("UNAUTHORIZED_FAKE_LOADER");
    const hash=new Uint8Array(await crypto.subtle.digest("SHA-256",
      new TextEncoder().encode(JSON.stringify(request.payload))));
    return [grantHeader,[
      "ROLLING_WEDGE_INVESTMENT","MAN-BATCH07","MF-TEST","11",
      "RW_CURRENT_STATE","DSG","D1_BOUND_DATASET:RW_CURRENT_STATE;Binding=DB",
      "Rolling_Wedge_Workflow","Rolling_Wedge_Workflow",
      grantAllowedFieldsOverride??[...fields].sort().join(","),"DSG-GRANT-ONE",grantState,
      Array.from(hash,x=>x.toString(16).padStart(2,"0")).join(""),
    ]].concat(grantDuplicate ? [[
      "ROLLING_WEDGE_INVESTMENT","MAN-BATCH07","MF-TEST","11",
      "RW_CURRENT_STATE","DSG","D1_BOUND_DATASET:RW_CURRENT_STATE;Binding=DB",
      "Rolling_Wedge_Workflow","Rolling_Wedge_Workflow",
      [...fields].sort().join(","),"DSG-GRANT-ONE","ISSUED",
      Array.from(hash,x=>x.toString(16).padStart(2,"0")).join(""),
    ]] : []);
  },
};
const request = {
  task_id:"ROLLING_WEDGE_INVESTMENT",caller_identity:"Rolling_Wedge_Workflow",
  operation:"WRITE" as const,dataset_id:"RW_CURRENT_STATE",instance_id:"DSG",
  bootstrap_mode:"INITIAL_BASELINE",expected_version:0,
  idempotency_key:"DSG-GRANT-ONE",
  payload:{
    Company_ID:"DSG",Company_Name:"Descartes Systems Group",Ticker:"DSG",
    Exchange:"TSX",Currency:null,State_As_Of:null,
    Base_Source_Materials:"https://docs.google.com/document/d/dsg-base/edit",
    Structured_State_Content:{unaccepted_source:true},
  },
};

function gate():GateProjectionSnapshot{
  return {
    gateLocator:PINNED_GATE_LOCATOR,gateBlob:PINNED_GATE_BLOB,
    gateConfigFingerprint:PINNED_GATE_CONFIG_FINGERPRINT,
    authorityPublicationState:"EXACT_ONE",
    authorityPublication:{
      authorityScopeFingerprint:"SCOPE-BATCH07",
      currentCommittedCutoverId:"CUT-TEST",
      currentActivationEpoch:"11",
      registrySnapshotId:"RS-TEST",
      manifestSetId:"MSET-TEST",
      gateConfigFingerprint:PINNED_GATE_CONFIG_FINGERPRINT,
      workflowSetFingerprint:"WF-TEST",
    },
    expectedAuthorityScopeFingerprint:"SCOPE-BATCH07",
    expectedCutoverId:"CUT-TEST", expectedActivationEpoch:"11",
    expectedManifestSetId:"MSET-TEST",
    expectedGateConfigFingerprint:PINNED_GATE_CONFIG_FINGERPRINT,
    expectedWorkflowSetFingerprint:"WF-TEST",
    referencedCutoverState:"AUTHORITY_COMMITTED",
    currentRegistrySnapshotId:"RS-TEST",currentRegistryFingerprint:"RF-TEST",
    manifestId:"MAN-BATCH07",taskId:"ROLLING_WEDGE_INVESTMENT",
    manifestState:"ACTIVE",manifestRegistrySnapshotId:"RS-TEST",
    manifestRegistryFingerprint:"RF-TEST",
    migrationFenceActive:false,pruneFenceIndexAvailable:true,
    pruneFencedKeys:new Set(),startedPruneKeys:new Set(),archivedIdentityKeys:new Set(),
    accesses:[{
      datasetId:"RW_CURRENT_STATE",instanceId:"DSG",
      logicalMember:"D1_BOUND_DATASET:RW_CURRENT_STATE;Binding=DB",
      contractFingerprint:"RW-SCHEMA",physicalContractFingerprint:"RW-SCHEMA",
      readers:new Set(["Rolling_Wedge_Workflow"]),
      writerScopes:[{writerId:"Rolling_Wedge_Workflow",
        operations:new Set(["CONDITIONAL_CURRENT_STATE"]),
        fields:new Set(fields)}],
      writeMode:"CURRENT_STATE",dynamicInstance:true,businessAuthorityState:"DRAFT",
    }],
  };
}
function loaded():LoadedControlPlane{
  return {
    task:{
      taskId:"ROLLING_WEDGE_INVESTMENT",workflowName:"Rolling_Wedge_Workflow",
      workflowFileId:"WF",runtimeProfileFileId:"PROFILE",roleFileIds:{},
      companiesBaselineFileId:BASE,agentsManifestProjectionFileId:"MAN-BATCH07-FILE",
    },
    authority:{
      authorityScopeFingerprint:"SCOPE-BATCH07",currentCutoverId:"CUT-TEST",
      activationEpoch:"11",registrySnapshotId:"RS-TEST",
      registryFingerprint:"RF-TEST",manifestSetId:"MSET-TEST",
      gateConfigFingerprint:PINNED_GATE_CONFIG_FINGERPRINT,
      workflowSetFingerprint:"WF-TEST",referencedCutoverState:"AUTHORITY_COMMITTED",
      migrationWriteFenceState:"RELEASED",
      registryFileId:"REG-TEST",acceptanceBindingId:"AB-TEST",
    },
    manifestFileId:"MAN-BATCH07-FILE",manifestFingerprint:"MF-TEST",
    manifestMetadata:{Bootstrap_Grant_Projection_Tab:"Initial_Baseline_Grants"},gate:gate(),workflowText:"",runtimeProfileText:"",
    roleTexts:{},companiesBaselineText:baseline,
    registryCompaniesBaselineFileId:BASE,
  };
}
let checks=0;
async function check(label:string, test:()=>void|Promise<void>){
  await test(); checks++; console.log("PASS",label);
}
function resolver(cp:LoadedControlPlane, oneUse=false){
  let verifications=0;
  const issuer=oneUse?{async verifyExact(scope: {
    instanceId:string;activationEpoch:string;cutoverId:string;
    registrySnapshotId:string;manifestFingerprint:string;
    authorityFingerprint:string;payloadJson:string;idempotencyKey:string;
  }){
    assert.equal(scope.instanceId,"DSG");
    assert.equal(scope.activationEpoch,"11");
    assert.equal(scope.cutoverId,"CUT-TEST");
    assert.equal(scope.registrySnapshotId,"RS-TEST");
    assert.equal(scope.manifestFingerprint,"MF-TEST");
    assert.equal(scope.authorityFingerprint,"SCOPE-BATCH07");
    assert.equal(scope.idempotencyKey,"DSG-GRANT-ONE");
    assert.equal(JSON.parse(scope.payloadJson).Company_ID,"DSG");
    verifications++; return true;
  }}:undefined;
  return createTrustedDynamicD1Resolver(reader,issuer,async ()=>cp);
}

await check("registered DRAFT identity parsed exactly",()=>{
  assert.deepEqual(readExactCompanyIdentity(baseline,"DSG"),{
    companyId:"DSG",companyName:"Descartes Systems Group",ticker:"DSG",
    exchange:"TSX",stateStatus:"DRAFT",monitorEnabled:false,archived:false,
  });
});
await check("owner-approved once-only issuer receives accepted singleton binding",async()=>{
  const context=await resolver(loaded(),true)(request);
  await authorizeDynamicD1Request(request,context);
  // Read-only grant validation may repeat. Exactly-once effects belong to
  // the D1 v0->v1 + grant-consumption transaction, not this pre-write check.
  await authorizeDynamicD1Request(request,context);
  assert.equal(context.gate.authorityPublication?.currentActivationEpoch,"11");
});
await check("no external issuer denies DRAFT WRITE",async()=>{
  const context=await resolver(loaded())(request);
  await assert.rejects(()=>authorizeDynamicD1Request(request,context),
    /BOOTSTRAP_GRANT_UNAVAILABLE/);
});
await check("DRAFT CURRENT readback remains narrow",async()=>{
  const read={...request,operation:"READ" as const,
    selector:{kind:"CURRENT"},bootstrap_mode:undefined};
  const context=await resolver(loaded())(read);
  await authorizeDynamicD1Request(read,context);
  await assert.rejects(()=>authorizeDynamicD1Request(
    {...read,selector:{kind:"TAIL"}},context),/DRAFT_READBACK_ONLY/);
});
await check("identity is not loaded from an unverified registry",async()=>{
  const cp=loaded();cp.registryCompaniesBaselineFileId="OTHER";
  await assert.rejects(()=>resolver(cp,true)(request),/AUTHORITY_UNAVAILABLE/);
});
await check("AGENTS manifest projection drift denies runtime",async()=>{
  const cp=loaded();cp.projectionDrift={
    agentsManifestFileId:"UNSAFE",authoritativeManifestFileId:"MAN-BATCH07-FILE",
  };
  await assert.rejects(()=>resolver(cp,true)(request),/AUTHORITY_UNAVAILABLE/);
});
await check("stale authority state cannot bind a bootstrap grant",async()=>{
  const cp=loaded();cp.gate.authorityPublicationState="MISSING";
  await assert.rejects(()=>resolver(cp,true)(request),/AUTHORITY_UNAVAILABLE/);
});
await check("missing exact Manifest instance fails closed",async()=>{
  const cp=loaded();cp.gate.accesses=[];
  await assert.rejects(()=>resolver(cp,true)(request),/NOT_PROJECTED/);
});
await check("DRAFT activation mismatch fails closed",async()=>{
  const cp=loaded();cp.companiesBaselineText=baseline.replace(
    "- Monitor_Enabled: \`FALSE\`","- Monitor_Enabled: \`TRUE\`");
  await assert.rejects(()=>resolver(cp,true)(request),/ACTIVATION_INCONSISTENT/);
});
await check("unknown company, other task, and duplicate company denied",async()=>{
  assert.throws(()=>readExactCompanyIdentity(baseline,"DOL"),/NOT_UNIQUE/);
  assert.throws(()=>readExactCompanyIdentity(
    baseline+"\n## DSG\n- Company_ID: \`DSG\`\n","DSG"),/NOT_UNIQUE/);
  await assert.rejects(()=>resolver(loaded(),true)({
    ...request,task_id:"US_JAPAN_FX_POLICY"}),/TASK_SCOPE_DENIED/);
});
await check("revoked source grant denied even if mocked issuer is prepared",async()=>{
  grantState="REVOKED";
  try{
    const context=await resolver(loaded(),true)(request);
    await assert.rejects(()=>authorizeDynamicD1Request(request,context),
      /BOOTSTRAP_GRANT_DENIED/);
  }finally{grantState="ISSUED"}
});
await check("duplicate issued grant projection is not a unique issuer",async()=>{
  grantDuplicate=true;
  try{
    const context=await resolver(loaded(),true)(request);
    await assert.rejects(()=>authorizeDynamicD1Request(request,context),
      /BOOTSTRAP_GRANT_DENIED/);
  }finally{grantDuplicate=false}
});
await check("unregistered Manifest bootstrap tab denies issuance",async()=>{
  const cp=loaded();delete cp.manifestMetadata.Bootstrap_Grant_Projection_Tab;
  const context=await resolver(cp,true)(request);
  await assert.rejects(()=>authorizeDynamicD1Request(request,context),
    /BOOTSTRAP_GRANT_DENIED/);
});
await check("modified frozen source fails payload SHA binding",async()=>{
  const modified={...request,payload:{
    ...request.payload,Structured_State_Content:{unaccepted_source:false},
  }};
  const context=await resolver(loaded(),true)(modified);
  await assert.rejects(()=>authorizeDynamicD1Request(modified,context),
    /BOOTSTRAP_GRANT_DENIED/);
});
await check("incorrect eight-field issued grant scope denied",async()=>{
  grantAllowedFieldsOverride="Company_ID,Company_Name";
  try{
    const context=await resolver(loaded(),true)(request);
    await assert.rejects(()=>authorizeDynamicD1Request(request,context),
      /BOOTSTRAP_GRANT_DENIED/);
  }finally{grantAllowedFieldsOverride=undefined}
});
await check("real default loader cannot be replaced by caller values",async()=>{
  await assert.rejects(()=>createTrustedDynamicD1Resolver(reader)(request),
    /UNAUTHORIZED_FAKE_LOADER/);
});
console.log("R3_TRUSTED_RESOLVER_MOCK_ONLY_PASS",checks,
  "REAL_PRODUCTION_RESOLVER_CREDENTIAL_AND_ISSUER_NOT_BOUND");
