import assert from "node:assert/strict";
import {handleWorkOsCandidatePersistence} from "../src/workos_candidate.js";
import {authorizePersistence, WORKOS_D1_GATE_IMPLEMENTATION_ID,WORKOS_D1_GATE_IMPLEMENTATION_VERSION,ACCEPTED_GATE_CONFIG_FINGERPRINT,type GateProjectionSnapshot, type ManifestAccessRow} from "../src/workos_persistent_gate_projection.js";
import {loadPublishedBootstrapGrants} from "../src/workos_control_plane_loader.js";
import {initializeBaselineWithReadback,projectRWInitialBaselineWire} from "../src/workos_initial_baseline_candidate.js";
import {RW_CURRENT_STATE_FIELDS,FROZEN_RESEARCH_FIELDS,FROZEN_SOURCE_FIELDS,canonicalRWJson,validateRWInitialBaselineWire} from "../src/rw_current_state_wire.js";

const ids=["DSG","DOL","WSP","GIBA","NA","ENB","ATD"];
const fields=[...RW_CURRENT_STATE_FIELDS];
const key=(id:string)=>`RW_BATCH_07_20261014.${id}.INITIAL_BASELINE`;
function researchPayload(id:string): Record<string,unknown> {
 return {
  Company_ID:id,Instance_ID:id,Security_Ticker:id==="GIBA"?"GIB.A":id,
  Exchange:"TSX",Identity:id==="GIBA"?"CGI Inc.":`Company ${id}`,
  Base_Source_Materials:"https://docs.google.com/document/d/accepted/edit",
  Base_Source_Source_Status:"SOURCE_STATUS: ACCEPTED; research evidence only",
  Frozen_Baseline_Candidate:"https://docs.google.com/document/d/frozen/edit",
  Frozen_Baseline_Status:"FROZEN_CANDIDATE",
  Predecessor_Run_ID:`RW_B_${id}_BASELINE_20261014_01`,
  Model2_Research_Version:`CA_TSX_MODEL2_${id}_20261013_01`,
  Company_Specific_Decision_Overrides:"NONE_PROPOSED",
  Belief_State_ID:null,Scenario_Probabilities:null,Confidence:null,
  Valuation_State_ID:null,Decision_State_ID:null,
  Next_Reality_Watch_Accepted:false,Material_Capital_Commitment_Accepted:false,
  Production_D1_Initialized:false,
  FREEZE_IDENTITY_AND_RESEARCH_CUTOFF:`frozen ${id}`,
  RESEARCH_OBJECTIVE:`objective ${id}`,WEDGE_DEFINITION:`wedge ${id}`,
  KEY_CAUSAL_MECHANISMS:`causal ${id}`,WHAT_MUST_BE_PROVEN:`proof ${id}`,
  FALSIFIERS:`falsifiers ${id}`,
  BEAR_BASE_WEDGE_WORKS_FROZEN_SCENARIO_DEFINITIONS:`scenarios ${id}`,
  MATERIAL_CAPITAL_COMMITMENT_CANDIDATE__REVISER_OWNED:"unaccepted commitment research",
  NEXT_REALITY_WATCH_CANDIDATE__REVISER_OWNED:"unaccepted watch research",
 };
}
const payload=(id:string)=>projectRWInitialBaselineWire(researchPayload(id));
const entries=ids.map(id=>({dataset_id:"RW_CURRENT_STATE",instance_id:id,business_state:"DRAFT",readers:["Rolling_Wedge_Workflow"],writers:[{writer_id:"Rolling_Wedge_Workflow",operations:["INITIAL_BASELINE"]}],bootstrap:{fields,idempotency_key:key(id)}}));
const env={RUNTIME_SECRET:"test-isolated-secret",RW_AUTHORITY_PROJECTION:JSON.stringify({state:"ACTIVE",authority_epoch:"E11",manifest_fingerprint:"MF11",bindings:entries}),RW_AUTHORITY_EPOCH:"E11",RW_MANIFEST_FINGERPRINT:"MF11"}; // adversarial legacy keys deliberately ignored

// Isolated fixture represents the result of an exact singleton-selected ACTIVE
// Manifest read. Deployment-supplied JSON is deliberately NOT trusted.
const dynamicAccesses:ManifestAccessRow[]=ids.map(id=>({
 datasetId:"RW_CURRENT_STATE",instanceId:id,logicalMember:"RW_CURRENT_STATE",
 contractFingerprint:"contract",physicalContractFingerprint:"contract",
 readers:new Set(["Rolling_Wedge_Workflow"]),
 writerScopes:[{writerId:"Rolling_Wedge_Workflow",
  operations:new Set(["CONDITIONAL_CURRENT_STATE"]),fields:new Set(fields)}],
 writeMode:"CURRENT_STATE",dynamicInstance:true,businessAuthorityState:"DRAFT",
}));
const syntheticGrants=new Map(ids.map(id=>["RW_CURRENT_STATE\u0000"+id,{
 taskId:"ROLLING_WEDGE_INVESTMENT",manifestId:"M1",manifestFingerprint:"MF11",
 authorityEpoch:"E11",datasetId:"RW_CURRENT_STATE",instanceId:id,
 logicalMember:"RW_CURRENT_STATE",writerId:"Rolling_Wedge_Workflow",
 readerId:"Rolling_Wedge_Workflow",fields:new Set(fields),
 idempotencyKey:key(id),state:"ACTIVE" as const,
}] as const));
const activeLegacyIds=["ENPLAS","SERVICENOW","FIGMA"] as const;
const activeLegacyAccesses:ManifestAccessRow[]=activeLegacyIds.map((id,i)=>({
 datasetId:"RW_CURRENT_STATE",instanceId:id,logicalMember:"RW_CURRENT_STATE",
 contractFingerprint:"contract",physicalContractFingerprint:"contract",
 readers:new Set(["Rolling_Wedge_Workflow","MONITOR"]),
 writerScopes:[{writerId:"Rolling_Wedge_Workflow",
  operations:new Set(["CONDITIONAL_CURRENT_STATE"]),fields:null}],
 writeMode:"CURRENT_STATE",dynamicInstance:i!==0,businessAuthorityState:"ACTIVE",
}));
const trustedGate:GateProjectionSnapshot={
 gateImplementationId:WORKOS_D1_GATE_IMPLEMENTATION_ID,gateImplementationVersion:WORKOS_D1_GATE_IMPLEMENTATION_VERSION,
 gateConfigFingerprint:ACCEPTED_GATE_CONFIG_FINGERPRINT,
 authorityPublicationState:"EXACT_ONE",
 authorityPublication:{authorityScopeFingerprint:"scope",currentCommittedCutoverId:"cut",
  currentActivationEpoch:"E11",registrySnapshotId:"rs",manifestSetId:"set",
  gateConfigFingerprint:ACCEPTED_GATE_CONFIG_FINGERPRINT,workflowSetFingerprint:"wf"},
 expectedAuthorityScopeFingerprint:"scope",expectedCutoverId:"cut",
 expectedActivationEpoch:"E11",expectedManifestSetId:"set",
 expectedGateConfigFingerprint:ACCEPTED_GATE_CONFIG_FINGERPRINT,
 expectedWorkflowSetFingerprint:"wf",referencedCutoverState:"AUTHORITY_COMMITTED",
 currentRegistrySnapshotId:"rs",currentRegistryFingerprint:"rf",
 manifestId:"M1",taskId:"ROLLING_WEDGE_INVESTMENT",manifestState:"ACTIVE",
 manifestRegistrySnapshotId:"rs",manifestRegistryFingerprint:"rf",
 manifestFingerprint:"MF11",bootstrapGrants:syntheticGrants,
 migrationFenceActive:false,pruneFenceIndexAvailable:true,
 pruneFencedKeys:new Set(),startedPruneKeys:new Set(),
 archivedIdentityKeys:new Set(),accesses:[...dynamicAccesses,...activeLegacyAccesses],
};
// gateImplementationId is inspected exclusively by authorizePersistence()
// on the Worker request path. This getter provides entry-level evidence.
let authorizePersistenceEntries=0;
Object.defineProperty(trustedGate,"gateImplementationId",{
 configurable:true,enumerable:true,
 get(){authorizePersistenceEntries++;return WORKOS_D1_GATE_IMPLEMENTATION_ID;}
});
const trustedCp={task:{taskId:"ROLLING_WEDGE_INVESTMENT"},gate:trustedGate};
const dbRecords=new Map<string,{dataset_id:string;instance_id:string;version:number;previous_version:number;payload_json:string;invocation_id:string;idempotency_key:string;db_written_at:string}>();
function db() {
 return {prepare:(q:string)=>{
  let args:unknown[]=[];
  const dbstmt={
   bind(...values:unknown[]){args=values;return dbstmt;},
   async first<T>():Promise<T|null>{
    if(q.includes("idempotency_key=? LIMIT 1"))return ([...dbRecords.values()].find(x=>x.idempotency_key===args[0])??null) as T|null;
    if(q.includes("invocation_id=? LIMIT 1"))return ([...dbRecords.values()].find(x=>x.invocation_id===args[0])??null) as T|null;
    if(q.includes("ORDER BY version DESC LIMIT 1"))return (dbRecords.get(`${args[0]}:${args[1]}`)??null) as T|null;
    throw Error(`unexpected FIRST: ${q}`);
   },
   async run(){
    if(!q.includes("INSERT INTO workos_current_state_versions"))throw Error("unexpected RUN");
    const [dataset,instance,pjson,invocation,idem]=args as string[];
    const dbkey=`${dataset}:${instance}`;
    if(dbRecords.has(dbkey) || [...dbRecords.values()].some(r=>r.idempotency_key===idem))return{success:true,meta:{changes:0}};
    dbRecords.set(dbkey,{dataset_id:dataset,instance_id:instance,version:1,previous_version:0,payload_json:pjson,invocation_id:invocation,idempotency_key:idem,db_written_at:"2026-10-14T00:00:00Z"});
    return{success:true,meta:{changes:1}};
   },async all<T>(){return{success:true,results:[] as T[]}}
  };return dbstmt;
 }};
}
const isolated={...env,DB:db()};
async function send(request:Record<string,unknown>,runtimeEnv:typeof isolated=isolated){
 const r=await handleWorkOsCandidatePersistence(new Request("https://isolated.invalid/candidate/workos-persistence",{method:"POST",headers:{Authorization:"Bearer test-isolated-secret"},body:JSON.stringify(request)}),runtimeEnv,async()=>trustedCp as any);
 return{status:r.status,body:await r.json() as Record<string,unknown>};
}
const base=(id:string)=>({task_id:"ROLLING_WEDGE_INVESTMENT",caller_identity:"Rolling_Wedge_Workflow",dataset_id:"RW_CURRENT_STATE",instance_id:id,authority_epoch:"E11",manifest_fingerprint:"MF11"});
const write=(id:string)=>({...base(id),operation:"WRITE",write_operation:"INITIAL_BASELINE",idempotency_key:key(id),payload:payload(id),fields,expected_version:0});
const read=(id:string)=>({...base(id),operation:"READ",read_purpose:"INITIAL_BASELINE_READBACK",bootstrap_idempotency_key:key(id),expected_version:1,selector:{kind:"CURRENT"}});
const fail=async(req:Record<string,unknown>)=>{
 const v=await send(req);assert.notEqual(v.status,200,`unexpected authorization success: ${JSON.stringify(req)}`);assert.equal(v.body.status,"FAILED");
};
let checks=0;
for(const id of ids){
 const w=await send(write(id));assert.equal(w.status,200,`DRAFT write ${id}: ${JSON.stringify(w.body)}`);
 assert.equal(w.body.version,1);
 const r=await send(read(id));assert.equal(r.status,200,`DRAFT read ${id}: ${JSON.stringify(r.body)}`);
 assert.deepEqual(r.body.payload,payload(id));checks+=2;
 const replay=await send(write(id));assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);checks++;
}
assert.equal(dbRecords.size,7);
for(const id of ids){const row=dbRecords.get(`RW_CURRENT_STATE:${id}`)!;assert.equal(row.version,1);assert.deepEqual(JSON.parse(row.payload_json),payload(id));checks++;}
// A forged environment projection cannot authorize without the trusted source.
const noSource=await handleWorkOsCandidatePersistence(
  new Request("https://isolated.invalid/candidate/workos-persistence",{
    method:"POST",headers:{Authorization:"Bearer test-isolated-secret"},
    body:JSON.stringify(write("DSG"))}),isolated);
assert.equal(noSource.status,403);checks++;
const revokedSource=async()=>({task:{taskId:"ROLLING_WEDGE_INVESTMENT"},
  gate:{...trustedGate,bootstrapGrants:new Map()}} as any);
const revoked=await handleWorkOsCandidatePersistence(
  new Request("https://isolated.invalid/candidate/workos-persistence",{
    method:"POST",headers:{Authorization:"Bearer test-isolated-secret"},
    body:JSON.stringify(write("DSG"))}),isolated,revokedSource);
assert.equal(revoked.status,403);checks++;
const driftedSource=async()=>({task:{taskId:"ROLLING_WEDGE_INVESTMENT"},
  gate:trustedGate,projectionDrift:{agentsManifestFileId:"old",authoritativeManifestFileId:"new"}} as any);
const drifted=await handleWorkOsCandidatePersistence(
  new Request("https://isolated.invalid/candidate/workos-persistence",{
    method:"POST",headers:{Authorization:"Bearer test-isolated-secret"},
    body:JSON.stringify(write("DSG"))}),isolated,driftedSource);
assert.equal(drifted.status,403);checks++;
await fail({...write("DSG"),payload:{...payload("DSG"),
  NEXT_REALITY_WATCH_CANDIDATE__REVISER_OWNED:"not accepted"},fields:[...fields,"NEXT_REALITY_WATCH_CANDIDATE__REVISER_OWNED"]});checks++;

await fail(write("UNREGISTERED"));checks++;
await fail({...write("DSG"),caller_identity:"MONITOR"});checks++;
await fail({...write("DSG"),caller_identity:"REVISER"});checks++;
await fail({...write("DSG"),caller_identity:"VALUATOR"});checks++;
await fail({...write("DSG"),caller_identity:"DECISION"});checks++;
await fail({...write("DSG"),dataset_id:"RW_EVIDENCE_HISTORY"});checks++;
await fail({...write("DSG"),write_operation:undefined});checks++;
await fail({...write("DSG"),fields:["Company_ID"]});checks++;
await fail({...write("DSG"),expected_version:1});checks++;
await fail({...write("DSG"),idempotency_key:"bad-key"});checks++;
await fail({...write("DSG"),manifest_fingerprint:"wrong"});checks++;
await fail({...write("DSG"),authority_epoch:"E10"});checks++;
await fail({...write("DSG"),payload:{...payload("DSG"),Belief_State_ID:"ACCEPTED"}});checks++;
await fail({...write("DSG"),payload:{...payload("DSG"),Structured_State_Content:"not-json"}});checks++;
await fail({...write("DSG"),payload:{...payload("DSG"),Currency:23}});checks++;
await fail({...write("DSG"),payload:{...payload("DSG"),Company_ID:"DOL"}});checks++;
await fail({...write("DSG"),payload:{...payload("DSG"),Extraneous_Field:"bad"}});checks++;
await fail({...read("DSG"),read_purpose:undefined});checks++;
await fail({...read("DSG"),caller_identity:"MONITOR"});checks++;
await fail({...read("DSG"),expected_version:2});checks++;
await fail({...read("DSG"),bootstrap_idempotency_key:"wrong"});checks++;
await fail({...read("DSG"),selector:{kind:"TAIL",limit:1}});checks++;
// Legacy request shape: Epoch/Fingerprint absent, resolved from trusted Gate.
for(const id of activeLegacyIds){
 const req={task_id:"ROLLING_WEDGE_INVESTMENT",caller_identity:"Rolling_Wedge_Workflow",
  operation:"WRITE",dataset_id:"RW_CURRENT_STATE",instance_id:id,
  idempotency_key:`LEGACY.${id}`,expected_version:0,payload:{Legacy:true}};
 let before=authorizePersistenceEntries;
 const result=await send(req);
 assert.equal(result.status,200,`legacy write ${id}: ${JSON.stringify(result.body)}`);
 assert.ok(authorizePersistenceEntries>before,`${id}: successful WRITE never entered authorizePersistence()`);
 checks+=2;
 const readReq={task_id:"ROLLING_WEDGE_INVESTMENT",caller_identity:"MONITOR",
  operation:"READ",dataset_id:"RW_CURRENT_STATE",instance_id:id,selector:{kind:"CURRENT"}};
 before=authorizePersistenceEntries;
 const readResult=await send(readReq);
 assert.equal(readResult.status,200,`legacy read ${id}: ${JSON.stringify(readResult.body)}`);
 assert.ok(authorizePersistenceEntries>before,`${id}: successful READ never entered authorizePersistence()`);
 assert.deepEqual(readResult.body.payload,{Legacy:true});checks+=3;
 await fail({...req,caller_identity:"MONITOR",idempotency_key:`DENIED.${id}`});checks++;
 await fail({...readReq,caller_identity:"COLLECTOR"});checks++;
 await fail({...req,authority_epoch:"E10"});checks++;
 await fail({...readReq,manifest_fingerprint:"MF10"});checks++;
}
// Legacy instances also fail closed if registration or publication loses trust.
const oldWrite={task_id:"ROLLING_WEDGE_INVESTMENT",caller_identity:"Rolling_Wedge_Workflow",
 operation:"WRITE",dataset_id:"RW_CURRENT_STATE",instance_id:"ENPLAS",
 idempotency_key:"LEGACY.ENPLAS.2",expected_version:1,payload:{Legacy:2}};
const legacyGateCall=async(req:Record<string,unknown>,snapshot:GateProjectionSnapshot)=>{
 const response=await handleWorkOsCandidatePersistence(
  new Request("https://isolated.invalid/candidate/workos-persistence",{
   method:"POST",headers:{Authorization:"Bearer test-isolated-secret"},
   body:JSON.stringify(req)}),isolated,
  async()=>({task:{taskId:"ROLLING_WEDGE_INVESTMENT"},gate:snapshot} as any));
 return response.status;
};
for(const badGate of [
 {...trustedGate,accesses:dynamicAccesses},
 {...trustedGate,accesses:trustedGate.accesses.map(x=>
  x.instanceId==="ENPLAS"?{...x,businessAuthorityState:"REVOKED"}:x)},
 {...trustedGate,expectedActivationEpoch:"E10"},
 {...trustedGate,authorityPublicationState:"UNAVAILABLE" as const},
 {...trustedGate,manifestRegistryFingerprint:"wrong"},
]){
 assert.equal(await legacyGateCall(oldWrite,badGate),403,"legacy authority/registration bypass");checks++;
}
const revokedReadGate={...trustedGate,accesses:trustedGate.accesses.map(x=>
 x.instanceId==="ENPLAS"?{...x,readers:new Set<string>()}:x)};
assert.equal(await legacyGateCall({
 task_id:"ROLLING_WEDGE_INVESTMENT",caller_identity:"MONITOR",operation:"READ",
 dataset_id:"RW_CURRENT_STATE",instance_id:"ENPLAS",selector:{kind:"CURRENT"}
},revokedReadGate),403,"empty reader grant bypass");checks++;
const noLegacySource=await handleWorkOsCandidatePersistence(
 new Request("https://isolated.invalid/candidate/workos-persistence",{
  method:"POST",headers:{Authorization:"Bearer test-isolated-secret"},
  body:JSON.stringify(oldWrite)}),isolated);
assert.equal(noLegacySource.status,403);checks++;
// TS gate synthetic accepted snapshot denies DRAFT absent trusted grant, and grants only exact.
const entry:ManifestAccessRow={datasetId:"RW_CURRENT_STATE",instanceId:"DSG",logicalMember:"RW_CURRENT_STATE",contractFingerprint:"contract",physicalContractFingerprint:"contract",readers:new Set(["Rolling_Wedge_Workflow"]),writerScopes:[{writerId:"Rolling_Wedge_Workflow",operations:new Set(["CONDITIONAL_CURRENT_STATE"]),fields:new Set(fields)}],writeMode:"CURRENT_STATE",dynamicInstance:true,businessAuthorityState:"DRAFT"};
const grant={taskId:"ROLLING_WEDGE_INVESTMENT",manifestId:"M1",manifestFingerprint:"MF11",authorityEpoch:"E11",datasetId:"RW_CURRENT_STATE",instanceId:"DSG",logicalMember:"RW_CURRENT_STATE",writerId:"Rolling_Wedge_Workflow",readerId:"Rolling_Wedge_Workflow",fields:new Set(fields),idempotencyKey:key("DSG"),state:"ACTIVE" as const};
const snapshot:GateProjectionSnapshot={
 gateImplementationId:WORKOS_D1_GATE_IMPLEMENTATION_ID,gateImplementationVersion:WORKOS_D1_GATE_IMPLEMENTATION_VERSION,gateConfigFingerprint:ACCEPTED_GATE_CONFIG_FINGERPRINT,
 authorityPublicationState:"EXACT_ONE",authorityPublication:{authorityScopeFingerprint:"scope",currentCommittedCutoverId:"cut",currentActivationEpoch:"E11",registrySnapshotId:"rs",manifestSetId:"set",gateConfigFingerprint:ACCEPTED_GATE_CONFIG_FINGERPRINT,workflowSetFingerprint:"wf"},
 expectedAuthorityScopeFingerprint:"scope",expectedCutoverId:"cut",expectedActivationEpoch:"E11",expectedManifestSetId:"set",expectedGateConfigFingerprint:ACCEPTED_GATE_CONFIG_FINGERPRINT,expectedWorkflowSetFingerprint:"wf",referencedCutoverState:"AUTHORITY_COMMITTED",
 currentRegistrySnapshotId:"rs",currentRegistryFingerprint:"rf",manifestId:"M1",taskId:"ROLLING_WEDGE_INVESTMENT",manifestState:"ACTIVE",manifestRegistrySnapshotId:"rs",manifestRegistryFingerprint:"rf",manifestFingerprint:"MF11",bootstrapGrants:new Map([["RW_CURRENT_STATE\u0000DSG",grant]]),
 migrationFenceActive:false,pruneFenceIndexAvailable:true,pruneFencedKeys:new Set(),startedPruneKeys:new Set(),archivedIdentityKeys:new Set(),accesses:[entry]
};
const authBase={taskId:"ROLLING_WEDGE_INVESTMENT",callerIdentity:"Rolling_Wedge_Workflow",manifestId:"M1",datasetId:"RW_CURRENT_STATE",instanceId:"DSG",logicalMember:"RW_CURRENT_STATE"};
const aw={...authBase,operation:"WRITE" as const,writeOperation:"INITIAL_BASELINE",fields:new Set(fields),expectedVersion:0,idempotencyKey:key("DSG")};
const ar={...authBase,operation:"READ" as const,readPurpose:"INITIAL_BASELINE_READBACK",expectedVersion:1,idempotencyKey:key("DSG")};
assert.equal(authorizePersistence(snapshot,aw),entry);assert.equal(authorizePersistence(snapshot,ar),entry);checks+=2;
assert.throws(()=>authorizePersistence({...snapshot,bootstrapGrants:new Map()},aw),/BUSINESS_AUTHORITY_NOT_READY/);checks++;
assert.throws(()=>authorizePersistence(snapshot,{...aw,writeOperation:"NORMAL"}),/BUSINESS_AUTHORITY_NOT_READY/);checks++;
assert.throws(()=>authorizePersistence(snapshot,{...aw,expectedVersion:1}),/BUSINESS_AUTHORITY_NOT_READY/);checks++;
assert.throws(()=>authorizePersistence({...snapshot,manifestFingerprint:"wrong"},aw),/BUSINESS_AUTHORITY_NOT_READY/);checks++;
assert.throws(()=>authorizePersistence({...snapshot,expectedActivationEpoch:"E10"},aw),/AUTHORITY_BINDING_MISMATCH/);checks++;
// Manual initializer remains disabled until trusted live grant is loaded.
const cp={task:{taskId:"ROLLING_WEDGE_INVESTMENT"},gate:{...snapshot,bootstrapGrants:undefined}};
await assert.rejects(()=>initializeBaselineWithReadback(cp as any,"DSG",payload("DSG"),"secret",fetch),/BOOTSTRAP_GRANT_OR_FIELDS_MISMATCH/);checks++;
// Integration: the only supported path is accepted projection Gate -> Worker -> D1 -> readback.
const boundFetch=(async(_input:RequestInfo|URL, init?:RequestInit)=>{
 return handleWorkOsCandidatePersistence(
   new Request("https://isolated.invalid/candidate/workos-persistence",init),
   isolated, async()=>trustedCp as any
 );
}) as typeof fetch;
const cpBound={task:{taskId:"ROLLING_WEDGE_INVESTMENT"},gate:snapshot};
const integrated=await initializeBaselineWithReadback(cpBound as any,"DSG",payload("DSG"),"test-isolated-secret",boundFetch);
assert.equal(integrated.write.version,1);
assert.deepEqual(integrated.readback.payload,payload("DSG"));
assert.equal(dbRecords.size,10);checks+=3;
await assert.rejects(()=>initializeBaselineWithReadback({task:{taskId:"ROLLING_WEDGE_INVESTMENT"},gate:{...snapshot,bootstrapGrants:new Map()}} as any,"DSG",payload("DSG"),"test-isolated-secret",boundFetch),/BOOTSTRAP_GRANT_OR_FIELDS_MISMATCH/);checks++;
// New control projection is read only from the ACTIVE manifest exact source.
const grantHeader=["Task_ID","Manifest_ID","Manifest_Fingerprint","Authority_Epoch",
 "Dataset_ID","Instance_ID","Logical_Member","Writer_ID","Reader_ID",
 "Allowed_Fields","Idempotency_Key","Grant_State"];
const manifestMeta={Manifest_ID:"M1",Manifest_Fingerprint:"MF11",Bootstrap_Grant_Projection_Tab:"Initial_Baseline_Grants"};
const grantRow=["ROLLING_WEDGE_INVESTMENT","M1","MF11","E11","RW_CURRENT_STATE","DSG","RW_CURRENT_STATE",
 "Rolling_Wedge_Workflow","Rolling_Wedge_Workflow",fields.join(","),key("DSG"),"ACTIVE"];
const grantReader={readDriveText:async()=>"",readSheet:async()=>[grantHeader,grantRow]};
const resolved=await loadPublishedBootstrapGrants(grantReader as any,"accepted-manifest-file",manifestMeta,"E11",[entry]);
assert.equal(resolved.size,1);checks++;
const missing=await loadPublishedBootstrapGrants(grantReader as any,"accepted-manifest-file",{Manifest_ID:"M1"},"E11",[entry]);
assert.equal(missing.size,0);checks++;
await assert.rejects(()=>loadPublishedBootstrapGrants(grantReader as any,"accepted-manifest-file",manifestMeta,"E10",[entry]),/BOOTSTRAP_PROJECTION_UNTRUSTED_OR_DRIFT/);checks++;
await assert.rejects(()=>loadPublishedBootstrapGrants({readDriveText:async()=>"",readSheet:async()=>[grantHeader,grantRow,grantRow]} as any,"accepted-manifest-file",manifestMeta,"E11",[entry]),/BOOTSTRAP_PROJECTION_DUPLICATE/);checks++;

const sourceResearch=researchPayload("GIBA");
const projected=projectRWInitialBaselineWire(sourceResearch);
assert.equal(Object.keys(sourceResearch).length,29);
assert.deepEqual(Object.keys(projected),fields);
assert.equal(projected.Ticker,"GIB.A");
assert.equal(projected.Currency,null);
assert.equal(projected.State_As_Of,null);
assert.equal(projected.Company_Name,"CGI Inc.");
const nested=JSON.parse(projected.Structured_State_Content as string) as Record<string,Record<string,string>>;
assert.deepEqual(Object.keys(nested.research).sort(),[...FROZEN_RESEARCH_FIELDS].sort());
assert.deepEqual(Object.keys(nested.source).sort(),[...FROZEN_SOURCE_FIELDS].sort());
for(const name of FROZEN_RESEARCH_FIELDS)assert.equal(nested.research[name],sourceResearch[name]);
for(const name of FROZEN_SOURCE_FIELDS)assert.equal(nested.source[name],sourceResearch[name]);
assert.equal(JSON.stringify(projected).includes("REVISER_OWNED"),false);
assert.equal(JSON.stringify(projected).includes("Production_D1_Initialized"),false);
assert.equal(JSON.stringify(projected).includes("Belief_State_ID"),false);
assert.equal(projected.Structured_State_Content,canonicalRWJson(nested));
assert.ok(validateRWInitialBaselineWire(projected,"GIBA"));
assert.throws(()=>projectRWInitialBaselineWire({...sourceResearch,Unexpected_Field:"untrusted"}),/RESEARCH_PAYLOAD_SCHEMA_MISMATCH/);
assert.throws(()=>projectRWInitialBaselineWire({...sourceResearch,Belief_State_ID:"unaccepted"}),/RESEARCH_PAYLOAD_OWNERSHIP_NOT_ACCEPTED/);
assert.throws(()=>projectRWInitialBaselineWire({...sourceResearch,Company_ID:"WRONG"}),/RESEARCH_PAYLOAD_OWNERSHIP_NOT_ACCEPTED/);
assert.throws(()=>projectRWInitialBaselineWire({...sourceResearch,KEY_CAUSAL_MECHANISMS:null}),/RESEARCH_PAYLOAD_OWNERSHIP_NOT_ACCEPTED/);
assert.equal(validateRWInitialBaselineWire({...projected,Extra:"bad"},"GIBA"),false);
assert.equal(validateRWInitialBaselineWire({...projected,Company_ID:"WRONG"},"GIBA"),false);
assert.equal(validateRWInitialBaselineWire({...projected,Currency:"CAD"},"GIBA"),false);
assert.equal(validateRWInitialBaselineWire({...projected,State_As_Of:"2026-10-13"},"GIBA"),false);
assert.equal(validateRWInitialBaselineWire({...projected,Structured_State_Content:"{bad"},"GIBA"),false);
assert.equal(validateRWInitialBaselineWire({...projected,Structured_State_Content:JSON.stringify({...nested,Production_D1_Initialized:false})},"GIBA"),false);
assert.equal(validateRWInitialBaselineWire({...projected,Structured_State_Content:JSON.stringify({...nested,source:{...nested.source,REVISER_OWNED:"bypass"}})},"GIBA"),false);
checks+=26;
// A former 27-field grant must not authorize the current eight-field wire.
const oldFields=new Set(["Company_ID","Instance_ID","Base_Source_Source_Status",
 "Belief_State_ID","Scenario_Probabilities","Confidence","Valuation_State_ID",
 "Decision_State_ID","Next_Reality_Watch_Accepted",
 "Material_Capital_Commitment_Accepted","Production_D1_Initialized"]);
const wrongGrant={...syntheticGrants.get("RW_CURRENT_STATE\\u0000GIBA")!,fields:oldFields};
await assert.rejects(()=>initializeBaselineWithReadback(
 {task:{taskId:"ROLLING_WEDGE_INVESTMENT"},
  gate:{...trustedGate,bootstrapGrants:new Map([
   ...syntheticGrants,["RW_CURRENT_STATE\\u0000GIBA",wrongGrant],
  ])}} as any,
 "GIBA",projected,"test-isolated-secret",boundFetch),
 /BOOTSTRAP_GRANT_OR_FIELDS_MISMATCH/);checks++;

const eleventh = "RW_VIRTUAL_11";
const virtualEntry: ManifestAccessRow = {...dynamicAccesses[0],instanceId:eleventh};
const virtualGrant = {...syntheticGrants.get("RW_CURRENT_STATE\u0000DSG")!,
 instanceId:eleventh,idempotencyKey:key(eleventh)};
const virtualGate: GateProjectionSnapshot = {...trustedGate,
 accesses:[...dynamicAccesses,virtualEntry],
 bootstrapGrants:new Map([...syntheticGrants,["RW_CURRENT_STATE\u0000"+eleventh,virtualGrant]])};
const futureSend=async(request:Record<string,unknown>,snapshot:GateProjectionSnapshot)=>{
 const response=await handleWorkOsCandidatePersistence(
  new Request("https://isolated.invalid/candidate/workos-persistence",{
   method:"POST",headers:{Authorization:"Bearer test-isolated-secret"},
   body:JSON.stringify(request)}),isolated,
   async()=>({task:{taskId:"ROLLING_WEDGE_INVESTMENT"},gate:snapshot} as any));
 return {status:response.status,body:await response.json() as Record<string,unknown>};
};
for(const forbidden of [
 [write(eleventh),trustedGate,"UNREGISTERED"],
 [{...write(eleventh),caller_identity:"MONITOR"},virtualGate,"WRONG_WRITER"],
 [{...write(eleventh),authority_epoch:"E10"},virtualGate,"STALE_EPOCH"],
 [{...write(eleventh),manifest_fingerprint:"MF10"},virtualGate,"WRONG_FINGERPRINT"],
 [read(eleventh),trustedGate,"UNREGISTERED_READ"],
 [{...read(eleventh),caller_identity:"MONITOR"},virtualGate,"WRONG_READER"],
 [{...write(eleventh),write_operation:undefined},virtualGate,"ORDINARY_DRAFT_WRITE"],
] as const){
 const r=await futureSend(forbidden[0],forbidden[1]);
 assert.equal(r.status,403,forbidden[2]+":"+JSON.stringify(r.body));checks++;
}
const vw=await futureSend(write(eleventh),virtualGate);
assert.equal(vw.status,200,JSON.stringify(vw.body));checks++;
const vr=await futureSend(read(eleventh),virtualGate);
assert.equal(vr.status,200,JSON.stringify(vr.body));
assert.deepEqual(vr.body.payload,payload(eleventh));checks++;
assert.equal(dbRecords.size,11);
for(const id of [...ids,eleventh])assert.equal(dbRecords.get(`RW_CURRENT_STATE:${id}`)?.version,1);
const differentReplay=await futureSend({...write(eleventh),payload:{...payload(eleventh),Company_Name:"forged"}},virtualGate);
assert.notEqual(differentReplay.status,200);assert.equal(dbRecords.size,11);checks++;
assert.equal(trustedGate.gateImplementationId,"WORKOS_D1_PERSISTENT_GATE");checks++;
assert.equal(trustedGate.gateImplementationVersion,"1.0.0-candidate");checks++;
assert.throws(()=>authorizePersistence({...trustedGate,gateImplementationVersion:"unapproved"},{
 taskId:"ROLLING_WEDGE_INVESTMENT",callerIdentity:"Rolling_Wedge_Workflow",
 manifestId:"M1",datasetId:"RW_CURRENT_STATE",instanceId:"DSG",
 logicalMember:"RW_CURRENT_STATE",operation:"READ",
 readPurpose:"INITIAL_BASELINE_READBACK",expectedVersion:1,idempotencyKey:key("DSG"),
}),/GATE_IMPLEMENTATION_VERSION_DRIFT/);checks++;
const gateSource=await (await import("node:fs/promises")).readFile(
 new URL("../src/workos_persistent_gate_projection.ts",import.meta.url),"utf8");
const loaderSource=await (await import("node:fs/promises")).readFile(
 new URL("../src/workos_control_plane_loader.ts",import.meta.url),"utf8");
for(const source of [gateSource,loaderSource]){
 assert.doesNotMatch(source,/data-archive-runtime|gate\\.py|PINNED_GATE_BLOB|PINNED_GATE_LOCATOR/);
 checks++;
}


// Isolated D1 append fixture: covers the unchanged FX compatibility route and
// ACTIVE dynamic instances without touching the production D1 binding.
type IsolatedAppend = {append_seq:number;dataset_id:string;instance_id:string;
 record_key:string;payload_json:string;invocation_id:string;idempotency_key:string;db_written_at:string};
const appendRecords:IsolatedAppend[]=[];
const appendDB={prepare:(sql:string)=>{
 let args:unknown[]=[];
 const stmt={
  bind(...v:unknown[]){args=v;return stmt;},
  async first<T>():Promise<T|null>{
   if(sql.includes("WHERE idempotency_key=?"))return (appendRecords.find(x=>x.idempotency_key===args[0])??null) as T|null;
   if(sql.includes("WHERE invocation_id=?"))return (appendRecords.find(x=>x.invocation_id===args[0])??null) as T|null;
   if(sql.includes("WHERE dataset_id=? AND instance_id=? AND record_key=?"))
     return (appendRecords.find(x=>x.dataset_id===args[0]&&x.instance_id===args[1]&&x.record_key===args[2])??null) as T|null;
   throw Error("unexpected append first:"+sql);
  },
  async run(){
   if(!sql.includes("INSERT INTO workos_append_records"))throw Error("unexpected append write:"+sql);
   const [dataset_id,instance_id,record_key,payload_json,invocation_id,idempotency_key]=args as string[];
   if(appendRecords.some(x=>(x.dataset_id===dataset_id&&x.instance_id===instance_id&&x.record_key===record_key)||x.idempotency_key===idempotency_key))
     return {success:true,meta:{changes:0}};
   appendRecords.push({append_seq:appendRecords.length+1,dataset_id,instance_id,record_key,
    payload_json,invocation_id,idempotency_key,db_written_at:"2026-10-14T00:00:00Z"});
   return {success:true,meta:{changes:1}};
  },
  async all<T>(){return {success:true,results:[] as T[]}}
 };
 return stmt;
}};
const appendEnv={...env,DB:appendDB};
async function appendSend(request:Record<string,unknown>,snapshot?:GateProjectionSnapshot){
 const response=await handleWorkOsCandidatePersistence(
  new Request("https://isolated.invalid/candidate/workos-persistence",{
   method:"POST",headers:{Authorization:"Bearer test-isolated-secret"},
   body:JSON.stringify(request)}),appendEnv,
  snapshot?async()=>({task:{taskId:"ROLLING_WEDGE_INVESTMENT"},gate:snapshot} as any):undefined);
 return {status:response.status,body:await response.json() as Record<string,unknown>};
}
const fxBase={task_id:"US_JAPAN_FX_POLICY",instance_id:"SINGLETON",dataset_id:"FX_POLICY_EVIDENCE_LOG"};
const fxWrite={...fxBase,operation:"WRITE",caller_identity:"COLLECTOR",record_key:"FX.ISOLATED.1",
 idempotency_key:"FX.ISOLATED.IDEMPOTENT.1",payload:{status:"ACCEPTED",value:42}};
const fxWritten=await appendSend(fxWrite);
assert.equal(fxWritten.status,200,JSON.stringify(fxWritten.body));checks++;
const fxReplay=await appendSend(fxWrite);
assert.equal(fxReplay.status,200);assert.equal(fxReplay.body.replayed,true);checks++;
const fxRead=await appendSend({...fxBase,operation:"READ",caller_identity:"READER",
 selector:{kind:"RECORD",record_key:"FX.ISOLATED.1"}});
assert.equal(fxRead.status,200,JSON.stringify(fxRead.body));
assert.deepEqual((fxRead.body.record as Record<string,unknown>).payload,fxWrite.payload);checks++;
const fxForbidden=await appendSend({...fxWrite,caller_identity:"REVISER"});
assert.equal(fxForbidden.status,403);checks++;
const fxConflict=await appendSend({...fxWrite,payload:{status:"ACCEPTED",value:99}});
assert.equal(fxConflict.status,409);checks++;
assert.equal(appendRecords.length,1);
const activeEleventh: ManifestAccessRow = {
 datasetId:"RW_EVIDENCE_HISTORY",instanceId:eleventh,logicalMember:"RW_EVIDENCE_HISTORY",
 contractFingerprint:"contract",physicalContractFingerprint:"contract",
 readers:new Set(["Rolling_Wedge_Workflow","REVISER"]),
 writerScopes:[{writerId:"MONITOR",operations:new Set(["APPEND_ONLY"]),fields:null}],
 writeMode:"APPEND_ONLY",dynamicInstance:true,businessAuthorityState:"ACTIVE",
};
const activeEleventhGate:GateProjectionSnapshot = {...trustedGate,
 accesses:[...dynamicAccesses,activeEleventh]};
const evidenceWrite={task_id:"ROLLING_WEDGE_INVESTMENT",caller_identity:"MONITOR",
 operation:"WRITE",dataset_id:"RW_EVIDENCE_HISTORY",instance_id:eleventh,
 authority_epoch:"E11",manifest_fingerprint:"MF11",record_key:"RW.VIRTUAL.ACTUAL.1",
 idempotency_key:"RW.VIRTUAL.IDEMPOTENT.1",payload:{kind:"TEST_ONLY"}};
const aw11=await appendSend(evidenceWrite,activeEleventhGate);
assert.equal(aw11.status,200,JSON.stringify(aw11.body));checks++;
const ar11=await appendSend({...evidenceWrite,operation:"READ",
 caller_identity:"REVISER",selector:{kind:"RECORD",record_key:"RW.VIRTUAL.ACTUAL.1"},
 record_key:undefined,idempotency_key:undefined,payload:undefined},activeEleventhGate);
assert.equal(ar11.status,200,JSON.stringify(ar11.body));checks++;
const denied11=await appendSend({...evidenceWrite,caller_identity:"DECISION"},activeEleventhGate);
assert.equal(denied11.status,403);checks++;
assert.equal(appendRecords.length,2);

console.log(`PASS rw_batch07_runtime_bootstrap_validation checks=${checks}; isolated D1 rows=${dbRecords.size}`);
