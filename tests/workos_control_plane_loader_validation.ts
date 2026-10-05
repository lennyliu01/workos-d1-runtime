import assert from "node:assert/strict";
import { AGENTS_FILE_ID, REPOSITORY_CUTOVER_CONTROL_ID, loadControlPlane, type ExactControlPlaneReader } from "../src/workos_control_plane_loader.js";
import { loadLiveGateContext } from "../src/workos_live_gate_context.js";
import { PINNED_GATE_BLOB, PINNED_GATE_CONFIG_FINGERPRINT, authorizePersistence, type ManifestAccessRow } from "../src/workos_persistent_gate_projection.js";

const REG="REG", MAN="MAN", ACC="ACC", MIG="MIG", PRUNE="PRUNE", TX="TX", ROUTE="ROUTE", SHARD="SHARD", BASE="BASE";
const workflowId="WF",profileId="PROFILE",collectorId="COLLECTOR",readerId="READER";
const agents=`# AGENTS.md
## TASK_ID: US_JAPAN_FX_POLICY
### Workflow
**Name:** \`US_Japan_FX_Policy_Workflow\`
**Cloud Location:** \`https://docs.google.com/document/d/${workflowId}/edit\`
**Persistent Manifest:** \`https://docs.google.com/spreadsheets/d/${MAN}/edit\`
**Runtime Profile:** \`FX_PROFILE\` — owner-local projection: \`https://docs.google.com/document/d/${profileId}/edit\`.
### ROLE: COLLECTOR
**Spec:** Collector — \`https://drive.google.com/file/d/${collectorId}/view\`
### ROLE: READER
**Spec:** Reader — \`https://docs.google.com/document/d/${readerId}/edit\`
`;
const baseline=(state="ACTIVE",monitor="TRUE",archived="FALSE")=>`# Companies Baseline
This file is the sole authority for \`Monitor_Enabled\`, \`State_Status\`, and \`Archived\`.
## ENPLAS
- Monitor_Enabled: \`${monitor}\`
- Archived: \`${archived}\`
- State_Status: \`${state}\`
`;

type Fault="pruneUnavailable"|"physicalDrift"|"migrationActive"|"pruneStarted"|"archived"|"baselineDraft";
class FakeReader implements ExactControlPlaneReader {
  readonly driveReads:string[]=[]; readonly sheetReads:string[]=[];
  constructor(private readonly fault?:Fault){}
  async readDriveText(id:string){
    this.driveReads.push(id);
    const map:Record<string,string>={[AGENTS_FILE_ID]:agents,[workflowId]:"workflow",[profileId]:"profile",[collectorId]:"collector",[readerId]:"reader",[BASE]:this.fault==="baselineDraft"?baseline("DRAFT"):baseline()};
    if(!(id in map)) throw new Error(`unexpected drive id ${id}`);
    return map[id];
  }
  async readSheet(id:string,sheet:string,_range:string):Promise<string[][]>{
    this.sheetReads.push(`${id}:${sheet}`);
    if(id===REPOSITORY_CUTOVER_CONTROL_ID&&sheet==="Authority_Publication") return [
      ["Authority_Scope_Fingerprint","Current_Committed_Cutover_ID","Current_Activation_Epoch","Registry_Snapshot_ID","Manifest_Set_ID","Gate_Config_Fingerprint","Workflow_Set_Fingerprint","Published_At"],
      ["scope","CUT","10","RS1","MSET1",PINNED_GATE_CONFIG_FINGERPRINT,"WFSET","time"],
    ];
    if(id===REPOSITORY_CUTOVER_CONTROL_ID&&sheet==="Cutovers") return [
      ["Cutover_ID","Cutover_State","Authority_Scope_Fingerprint","Target_Registry_Snapshot_ID","Target_Registry_Fingerprint","Target_Registry_File_ID","Target_Manifest_Set_ID","Target_Workflow_Set_Fingerprint","Persistent_Data_Gate_Config_Fingerprint","MIGRATION_WRITE_FENCE_State","Activation_Epoch","Target_Acceptance_Binding_ID"],
      ["CUT","COMPLETE","scope","RS1","RF",REG,"MSET1","WFSET",PINNED_GATE_CONFIG_FINGERPRINT,"RELEASED","10","AB"],
    ];
    if(id===REPOSITORY_CUTOVER_CONTROL_ID&&sheet==="Manifest_Set_Members") return [
      ["Manifest_Set_ID","Task_ID","Manifest_File_ID","Manifest_Fingerprint","Projection_State"],
      ["MSET1","US_JAPAN_FX_POLICY",MAN,"MF1","ACTIVE"],
    ];
    if(id===MAN&&sheet==="Manifest_Metadata") return [
      ["Task_ID","Manifest_ID","Registry_Snapshot_ID","Registry_Fingerprint","Manifest_Fingerprint","Generated_At","Readback_At","Manifest_State","Manifest_Set_ID"],
      ["US_JAPAN_FX_POLICY","MS1","RS1","RF","MF1","g","r","ACTIVE","MSET1"],
    ];
    if(id===MAN&&sheet==="Write_Projection") return [
      ["Dataset_ID","Writer_Identity","Operation_Mode","Exact_Member_Or_Resource_Class","Instance_Rule","Schema_Contract_Fingerprint","Gate_Requirements"],
      ["FX_POLICY_RUN_LOG","COLLECTOR","APPEND_ONLY","D1","SINGLETON_RESOURCE:SINGLETON","schema","FIELD_SCOPE=ALL_REGISTERED_FIELDS"],
    ];
    if(id===MAN&&sheet==="Read_Projection") return [
      ["Dataset_ID","Exact_Member_Or_Resource_Class","Instance_Rule","Schema_Contract_Fingerprint","Read_Gate_Requirements"],
      ["FX_POLICY_RUN_LOG","D1","SINGLETON_RESOURCE:SINGLETON","schema","CONTRACT_MATCH"],
    ];
    if(id===MAN&&sheet==="Instance_Projection") return [
      ["Dataset_ID","Projection_Mode","Parent_Instance_Registry_ID","Exact_Resource_Resolution_Rule","Presence_Rule"],
      ["FX_POLICY_RUN_LOG","D1_SINGLETON","","D1_BINDING=DB;Dataset_ID=FX_POLICY_RUN_LOG;Instance_ID=SINGLETON","REQUIRED|ALWAYS"],
    ];
    if(id===REG&&sheet==="Registry_Metadata") return [
      ["Registry_State","Active_Registry_Snapshot_ID","Active_Registry_Fingerprint"],["ACTIVE","RS1","RF"],
    ];
    if(id===REG&&sheet==="Resource_Projection") return [
      ["Dataset_ID","Instance_Projection_Mode","Source_Instance_ID_Expression","Exact_File_ID","Exact_Member_Name","Parent_Instance_Registry_ID","Presence_Requirement","Presence_Condition","Resource_Class_Predicate","Projection_Fingerprint"],
      ["FX_POLICY_RUN_LOG","D1_SINGLETON","Instance_ID=SINGLETON","","FX_POLICY_RUN_LOG","","REQUIRED","ALWAYS","D1","rfx"],
      ["RW_CURRENT_STATE","D1_REGISTERED_PARENT","PARENT=RW_COMPANY_REGISTRY;KEY=Company_ID","","RW_CURRENT_STATE","RW_COMPANY_REGISTRY","REQUIRED","REGISTERED_PARENT","D1","rrw"],
      ["RW_COMPANY_REGISTRY","SINGLETON_RESOURCE","",BASE,"Companies_Baseline.md","","REQUIRED","ALWAYS","FILE","rbase"],
      ["SYS_ARCHIVE_ACCEPTANCE_RESULT","SINGLETON_RESOURCE","",ACC,"Acceptance_Results","","REQUIRED","ALWAYS","SHEET","r1"],
      ["SYS_RUNTIME_COMPONENT_PROJECTION","SINGLETON_RESOURCE","",ACC,"Runtime_Component_Projection","","REQUIRED","ALWAYS","SHEET","r2"],
      ["SYS_MIGRATION_WRITE_FENCE","SINGLETON_RESOURCE","",MIG,"MIGRATION_WRITE_FENCE","","REQUIRED","ALWAYS","SHEET","r3"],
      ["SYS_ARCHIVE_PRUNE_FENCE_INDEX","SINGLETON_RESOURCE","",PRUNE,"Archive_Prune_Fence_Index","","REQUIRED","ALWAYS","SHEET","r4"],
      ["SYS_ARCHIVE_TRANSACTION_REGISTRY","SINGLETON_RESOURCE","",TX,"Archive_Transaction_Registry","","REQUIRED","ALWAYS","SHEET","r5"],
      ["SYS_ARCHIVE_TRANSACTION_MEMBERS","SINGLETON_RESOURCE","",TX,"Archive_Transaction_Members","","REQUIRED","ALWAYS","SHEET","r6"],
      ["SYS_ARCHIVE_INDEX_ROUTE_DIRECTORY","SINGLETON_RESOURCE","",ROUTE,"*","","REQUIRED","ALWAYS","SHEET","r7"],
    ];
    if(id===REG&&sheet==="Contract_Fingerprints") return [
      ["Registry_Snapshot_ID","Dataset_ID","Registry_Contract_Fingerprint","Registry_Snapshot_Fingerprint"],
      ["RS1","FX_POLICY_RUN_LOG",this.fault==="physicalDrift"?"wrong":"schema","RF"],
      ["RS1","RW_CURRENT_STATE","rw-schema","RF"],
    ];
    if(id===REG&&sheet==="Dataset_Contracts") return [
      ["Dataset_ID","Task_ID","Dataset_Contract_Owner","Contract_Status","Business_Write_Mode","Business_Time_Semantics","Archive_Enabled","Historical_Resolution_Mode","Registry_Contract_Fingerprint"],
      ["FX_POLICY_RUN_LOG","US_JAPAN_FX_POLICY","FX","ACTIVE","APPEND_ONLY","EVENT_TIME","TRUE","EXACT_RECORD",this.fault==="physicalDrift"?"wrong":"schema"],
      ["RW_CURRENT_STATE","ROLLING_WEDGE_INVESTMENT","RW","ACTIVE","GOVERNED_CURRENT","CURRENT","TRUE","ACTIVE_ONLY","rw-schema"],
    ];
    if(id===ACC&&sheet==="Runtime_Component_Projection") return [
      ["Acceptance_Binding_ID","Component_ID","Locator_Type","Exact_Locator","Evidence_Ref","Projection_State"],
      ["AB","D1_PROVIDER_INVOCATION_CONTRACT","DRIVE_FILE_ID","contract","e","ACTIVE"],
    ];
    if(id===ACC&&sheet==="Acceptance_Results") return [
      ["Acceptance_Result_ID","Acceptance_Binding_ID","Test_Case_ID","Test_Layer","Dataset_ID","Resource_Scope_Fingerprint","Registry_Snapshot_ID","Implementation_Build_ID","Expected_Result","Observed_Result","Result","Evidence_Ref","Verified_At"],
      ...["D1_APPEND_WRITE_SAFETY","D1_CURRENT_STATE_CAS","D1_BOUNDED_READ","ACTIVATION_TIME_D1_CAPABILITY_RECONFIRMATION"].map((x,i)=>[`A${i}`,"AB",x,"REAL","","","RS1","","PASS","PASS","PASS","e","t"]),
    ];
    if(id===MIG&&sheet==="MIGRATION_WRITE_FENCE") return [
      ["Fence_ID","Dataset_ID","Source_Instance_ID","Fence_State","Cutover_ID","Migration_Execution_Manifest_ID","Created_At","Activated_At","Released_At","Reason"],
      ["F1","FX_POLICY_RUN_LOG","",this.fault==="migrationActive"?"ACTIVE":"RELEASED","CUT","M","c","a","r","x"],
      ["F2","RW_CURRENT_STATE","",this.fault==="migrationActive"?"ACTIVE":"RELEASED","CUT","M","c","a","r","x"],
    ];
    if(id===PRUNE&&sheet==="Archive_Prune_Fence_Index"){
      if(this.fault==="pruneUnavailable") throw new Error("source unavailable");
      const h=["Archive_Unit_ID","Archive_Transaction_ID","Fence_State","Registry_Contract_Fingerprint","Exact_Member_Set_Fingerprint","Exact_K1_Set","Blocked_Dependency_Write_Scope","Affected_Source_Instances","Created_At","Started_At","Updated_At"];
      return this.fault==="pruneStarted"?[h,["U1","T1","STARTED","schema","members","FX_POLICY_RUN_LOG:K1","scope","SINGLETON","c","s","u"]]:[h];
    }
    if(id===TX&&sheet==="Archive_Transaction_Registry") return [
      ["Archive_Transaction_ID","Archive_Run_ID","Archive_Run_Epoch","Archive_Unit_ID","Unit_Type","Task_ID","Dataset_ID","Source_Instance_ID","Archive_Group_Key","Transaction_State","Disposition","Registry_Contract_Fingerprint","Target_Partition_ID","Reserved_Capacity_Units","Blocked_Dependency_Write_Scope_Fingerprint","Active_Fence_State","Last_Mutation_Attempt_ID","Created_At","Updated_At","Error_Code"],
      ["T1","R","1","U1","RECORD","US_JAPAN_FX_POLICY","FX_POLICY_RUN_LOG","SINGLETON","","PRUNE_STARTED","ACTIVE","schema","","","scope","STARTED","","c","u",""],
    ];
    if(id===TX&&sheet==="Archive_Transaction_Members") return [
      ["Archive_Transaction_ID","Member_Ordinal","Dataset_ID","Source_Instance_ID","Record_Key_Canonical","Archive_Record_ID","Record_Locator_ID","Expected_Record_Fingerprint","Source_Locator","Target_Partition_ID","Target_Row","Member_State","Last_Mutation_Attempt_ID","Updated_At"],
      ["T1","1","FX_POLICY_RUN_LOG","SINGLETON","K1","AR","RL","fp","src","p","1","PRUNE_STARTED","","u"],
    ];
    if(id===ROUTE&&sheet==="Index_Metadata") return [
      ["Index_ID","Index_State","Index_Version","Routing_Version","Active_Routing_Fingerprint"],["ARCHIVE_LOCATOR_INDEX","ACTIVE","ALI_V1","ROUTE_V1","routefp"],
    ];
    if(id===ROUTE&&sheet==="Shard_Routes") return [
      ["Route_ID","Logical_Table","Task_ID","Bucket_Start","Bucket_End","Shard_ID","Shard_File_ID","Shard_Tab_Name","Route_State","Routing_Fingerprint"],
      ["R1","Record_Locators","*","00","ff","S1",SHARD,"Record_Locators","ACTIVE","routefp"],
    ];
    if(id===SHARD&&sheet==="Record_Locators"){
      const h=["Record_Locator_ID","Dataset_ID","Record_Key_Canonical","Source_Instance_ID","Archive_Group_Key","Anchor_Value","Archive_Year","Partition_ID","Archive_Row_Number","Archive_Record_ID","Record_Fingerprint","Registry_Contract_Fingerprint_At_Copy","Archive_Payload_Schema_Fingerprint","Index_State","Archive_Verified_At","Active_Prune_Verified_At","Archive_Run_ID"];
      return this.fault==="archived"?[h,["RL","FX_POLICY_RUN_LOG","K1","SINGLETON","","","2026","P","1","AR","rfp","schema","pfp","ARCHIVED","v","p","run"]]:[h];
    }
    throw new Error(`unexpected sheet read ${id}:${sheet}`);
  }
}

const reader=new FakeReader();
const cp=await loadControlPlane(reader,"US_JAPAN_FX_POLICY");
assert.equal(cp.manifestFileId,MAN);
assert.equal(cp.gate.gateBlob,PINNED_GATE_BLOB);
assert.equal(cp.gate.migrationFenceActive,false);
assert.equal(cp.gate.pruneFenceIndexAvailable,true);
assert.equal(cp.gate.pruneFencedKeys.size,0);
assert.equal(cp.gate.archivedIdentityKeys.size,0);
assert.equal(cp.gate.accesses[0].physicalContractFingerprint,"schema");
assert.equal(cp.gate.accesses[0].businessAuthorityState,"NOT_APPLICABLE");
assert.equal(reader.driveReads[0],AGENTS_FILE_ID);

await assert.rejects(()=>loadControlPlane(new FakeReader("pruneUnavailable"),"US_JAPAN_FX_POLICY"),/LIVE_GATE_CONTEXT/);
await assert.rejects(()=>loadControlPlane(new FakeReader("physicalDrift"),"US_JAPAN_FX_POLICY"),/MANIFEST_PHYSICAL_CONTRACT/);

const migration=await loadControlPlane(new FakeReader("migrationActive"),"US_JAPAN_FX_POLICY");
assert.equal(migration.gate.migrationFenceActive,true);
const writeReq={taskId:"US_JAPAN_FX_POLICY",callerIdentity:"COLLECTOR",manifestId:"MS1",datasetId:"FX_POLICY_RUN_LOG",instanceId:"SINGLETON",logicalMember:"D1",operation:"WRITE" as const,writeOperation:"APPEND_ONLY",fields:new Set<string>()};
assert.throws(()=>authorizePersistence(migration.gate,writeReq),/MIGRATION_WRITE_FENCE_ACTIVE/);

const prune=await loadControlPlane(new FakeReader("pruneStarted"),"US_JAPAN_FX_POLICY");
assert.equal(prune.gate.pruneFencedKeys.has("FX_POLICY_RUN_LOG\u0000K1"),true);
assert.equal(prune.gate.startedPruneKeys.has("FX_POLICY_RUN_LOG\u0000K1"),true);
assert.throws(()=>authorizePersistence(prune.gate,{...writeReq,logicalK1:"K1"}),/PRUNE_FENCE_CONFLICT/);
const readReq={taskId:"US_JAPAN_FX_POLICY",callerIdentity:"US_Japan_FX_Policy_Workflow",manifestId:"MS1",datasetId:"FX_POLICY_RUN_LOG",instanceId:"SINGLETON",logicalMember:"D1",operation:"READ" as const,logicalK1:"K1"};
assert.throws(()=>authorizePersistence(prune.gate,readReq),/READ_ARCHIVE_PRUNE_IN_PROGRESS/);

const archived=await loadControlPlane(new FakeReader("archived"),"US_JAPAN_FX_POLICY");
assert.equal(archived.gate.archivedIdentityKeys.has("FX_POLICY_RUN_LOG\u0000K1"),true);

const rwAccess:ManifestAccessRow={
  datasetId:"RW_CURRENT_STATE",instanceId:"ENPLAS",logicalMember:"D1_RW",contractFingerprint:"rw-schema",physicalContractFingerprint:null,
  readers:new Set(["MONITOR"]),writerScopes:[{writerId:"MONITOR",operations:new Set(["CONDITIONAL_CURRENT_STATE"]),fields:null}],
  writeMode:"CURRENT_STATE",dynamicInstance:true,businessAuthorityState:"UNRESOLVED",
};
const liveRw=await loadLiveGateContext(new FakeReader(),{
  taskId:"ROLLING_WEDGE_INVESTMENT",currentCutoverId:"CUT",currentRegistryFileId:REG,currentRegistrySnapshotId:"RS1",currentRegistryFingerprint:"RF",currentAcceptanceBindingId:"AB",accesses:[rwAccess],
});
assert.equal(liveRw.businessAuthorityStates.get("RW_CURRENT_STATE\u0000ENPLAS"),"ACTIVE");
const blockedRw=await loadLiveGateContext(new FakeReader("baselineDraft"),{
  taskId:"ROLLING_WEDGE_INVESTMENT",currentCutoverId:"CUT",currentRegistryFileId:REG,currentRegistrySnapshotId:"RS1",currentRegistryFingerprint:"RF",currentAcceptanceBindingId:"AB",accesses:[rwAccess],
});
assert.equal(blockedRw.businessAuthorityStates.get("RW_CURRENT_STATE\u0000ENPLAS"),"DRAFT");

console.log("workos_control_plane_loader_validation: PASS");
