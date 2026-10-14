import assert from "node:assert/strict";
import {handleWorkOsCandidatePersistence} from "../src/workos_candidate.js";
import {authorizePersistence, PINNED_GATE_LOCATOR,PINNED_GATE_BLOB,PINNED_GATE_CONFIG_FINGERPRINT,type GateProjectionSnapshot, type ManifestAccessRow} from "../src/workos_persistent_gate_projection.js";
import {loadPublishedBootstrapGrants} from "../src/workos_control_plane_loader.js";
import {initializeBaselineWithReadback} from "../src/workos_initial_baseline_candidate.js";

const ids=["DSG","DOL","WSP","GIBA","NA","ENB","ATD"];
const fields=["Company_ID","Instance_ID","Base_Source_Source_Status","Belief_State_ID","Valuation_State_ID","Decision_State_ID","Scenario_Probabilities","Confidence","Next_Reality_Watch_Accepted","Material_Capital_Commitment_Accepted","Production_D1_Initialized"];
const key=(id:string)=>`RW_BATCH_07_20261014.${id}.INITIAL_BASELINE`;
const payload=(id:string)=>({Company_ID:id,Instance_ID:id,Base_Source_Source_Status:"SOURCE_STATUS: ACCEPTED; research evidence only",Belief_State_ID:null,Valuation_State_ID:null,Decision_State_ID:null,Scenario_Probabilities:null,Confidence:null,Next_Reality_Watch_Accepted:false,Material_Capital_Commitment_Accepted:false,Production_D1_Initialized:false});
const entries=ids.map(id=>({dataset_id:"RW_CURRENT_STATE",instance_id:id,business_state:"DRAFT",readers:["Rolling_Wedge_Workflow"],writers:[{writer_id:"Rolling_Wedge_Workflow",operations:["INITIAL_BASELINE"]}],bootstrap:{fields,idempotency_key:key(id)}}));
const env={RUNTIME_SECRET:"test-isolated-secret",RW_AUTHORITY_PROJECTION:JSON.stringify({state:"ACTIVE",authority_epoch:"E11",manifest_fingerprint:"MF11",bindings:entries}),RW_AUTHORITY_EPOCH:"E11",RW_MANIFEST_FINGERPRINT:"MF11"};
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
 const r=await handleWorkOsCandidatePersistence(new Request("https://isolated.invalid/candidate/workos-persistence",{method:"POST",headers:{Authorization:"Bearer test-isolated-secret"},body:JSON.stringify(request)}),runtimeEnv);
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
await fail({...read("DSG"),read_purpose:undefined});checks++;
await fail({...read("DSG"),caller_identity:"MONITOR"});checks++;
await fail({...read("DSG"),expected_version:2});checks++;
await fail({...read("DSG"),bootstrap_idempotency_key:"wrong"});checks++;
await fail({...read("DSG"),selector:{kind:"TAIL",limit:1}});checks++;
// Legacy three-company control remains available with previous request shape.
for(const id of ["ENPLAS","SERVICENOW","FIGMA"]){
 const req={task_id:"ROLLING_WEDGE_INVESTMENT",caller_identity:"Rolling_Wedge_Workflow",operation:"WRITE",dataset_id:"RW_CURRENT_STATE",instance_id:id,idempotency_key:`LEGACY.${id}`,expected_version:0,payload:{Legacy:true}};
 const result=await send(req);assert.equal(result.status,200,`legacy regression ${id}`);checks++;
}
// TS gate synthetic accepted snapshot denies DRAFT absent trusted grant, and grants only exact.
const entry:ManifestAccessRow={datasetId:"RW_CURRENT_STATE",instanceId:"DSG",logicalMember:"RW_CURRENT_STATE",contractFingerprint:"contract",physicalContractFingerprint:"contract",readers:new Set(["Rolling_Wedge_Workflow"]),writerScopes:[{writerId:"Rolling_Wedge_Workflow",operations:new Set(["CONDITIONAL_CURRENT_STATE"]),fields:new Set(fields)}],writeMode:"CURRENT_STATE",dynamicInstance:true,businessAuthorityState:"DRAFT"};
const grant={taskId:"ROLLING_WEDGE_INVESTMENT",manifestId:"M1",manifestFingerprint:"MF11",authorityEpoch:"E11",datasetId:"RW_CURRENT_STATE",instanceId:"DSG",logicalMember:"RW_CURRENT_STATE",writerId:"Rolling_Wedge_Workflow",readerId:"Rolling_Wedge_Workflow",fields:new Set(fields),idempotencyKey:key("DSG"),state:"ACTIVE" as const};
const snapshot:GateProjectionSnapshot={
 gateLocator:PINNED_GATE_LOCATOR,gateBlob:PINNED_GATE_BLOB,gateConfigFingerprint:PINNED_GATE_CONFIG_FINGERPRINT,
 authorityPublicationState:"EXACT_ONE",authorityPublication:{authorityScopeFingerprint:"scope",currentCommittedCutoverId:"cut",currentActivationEpoch:"E11",registrySnapshotId:"rs",manifestSetId:"set",gateConfigFingerprint:PINNED_GATE_CONFIG_FINGERPRINT,workflowSetFingerprint:"wf"},
 expectedAuthorityScopeFingerprint:"scope",expectedCutoverId:"cut",expectedActivationEpoch:"E11",expectedManifestSetId:"set",expectedGateConfigFingerprint:PINNED_GATE_CONFIG_FINGERPRINT,expectedWorkflowSetFingerprint:"wf",referencedCutoverState:"AUTHORITY_COMMITTED",
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
console.log(`PASS rw_batch07_runtime_bootstrap_validation checks=${checks}; isolated D1 rows=${dbRecords.size}`);
