import assert from "node:assert/strict";
import { AGENTS_FILE_ID, REPOSITORY_CUTOVER_CONTROL_ID, loadControlPlane, type ExactControlPlaneReader } from "../src/workos_control_plane_loader.js";
import { PINNED_GATE_BLOB, PINNED_GATE_CONFIG_FINGERPRINT } from "../src/workos_persistent_gate_projection.js";

const workflowId="1WorkflowExactIdABCDEFGHIJKLMNOP", profileId="1ProfileExactIdABCDEFGHIJKLMNOPQ", collectorId="1CollectorExactIdABCDEFGHIJKLMNOP", readerId="1ReaderExactIdABCDEFGHIJKLMNOPXX";
const staleManifestId="1StaleManifestABCDEFGHIJKLMNOPXX", currentManifestId="1CurrentManifestABCDEFGHIJKLMNOPX";
const agents=`# AGENTS.md\n## TASK_ID: US_JAPAN_FX_POLICY\n### Workflow\n**Name:** \`US_Japan_FX_Policy_Workflow\`\n**Cloud Location:** \`https://docs.google.com/document/d/${workflowId}/edit\`\n**Persistent Manifest:** \`https://docs.google.com/spreadsheets/d/${staleManifestId}/edit\`\n**Runtime Profile:** \`FX_PROFILE\` — owner-local projection: \`https://docs.google.com/document/d/${profileId}/edit\`.\n### ROLE: COLLECTOR\n**Spec:** Collector — \`https://drive.google.com/file/d/${collectorId}/view\`\n### ROLE: READER\n**Spec:** Reader — \`https://docs.google.com/document/d/${readerId}/edit\`\n`;
class FakeReader implements ExactControlPlaneReader {
  readonly driveReads:string[]=[]; readonly sheetReads:string[]=[];
  constructor(private readonly staleAuthority=false){}
  async readDriveText(id:string){this.driveReads.push(id);const map:Record<string,string>={[AGENTS_FILE_ID]:agents,[workflowId]:"workflow",[profileId]:"profile",[collectorId]:"collector",[readerId]:"reader"};if(!(id in map))throw new Error(`unexpected drive id ${id}`);return map[id]}
  async readSheet(id:string,sheet:string,range:string):Promise<string[][]>{
    this.sheetReads.push(`${id}:${sheet}:${range}`);
    if(id===REPOSITORY_CUTOVER_CONTROL_ID&&sheet==="Authority_Publication")return [["Authority_Scope_Fingerprint","Current_Committed_Cutover_ID","Current_Activation_Epoch","Registry_Snapshot_ID","Manifest_Set_ID","Gate_Config_Fingerprint","Workflow_Set_Fingerprint","Published_At"],["scope","CUT","10",this.staleAuthority?"RS_BAD":"RS1","MSET1",PINNED_GATE_CONFIG_FINGERPRINT,"WFSET","time"]];
    if(id===REPOSITORY_CUTOVER_CONTROL_ID&&sheet==="Cutovers")return [["Cutover_ID","Cutover_State","Authority_Scope_Fingerprint","Target_Registry_Snapshot_ID","Target_Registry_Fingerprint","Target_Manifest_Set_ID","Target_Workflow_Set_Fingerprint","Persistent_Data_Gate_Config_Fingerprint","MIGRATION_WRITE_FENCE_State","Activation_Epoch"],["CUT","COMPLETE","scope","RS1","RF","MSET1","WFSET",PINNED_GATE_CONFIG_FINGERPRINT,"RELEASED","10"]];
    if(id===REPOSITORY_CUTOVER_CONTROL_ID&&sheet==="Manifest_Set_Members")return [["Manifest_Set_ID","Task_ID","Manifest_File_ID","Manifest_Fingerprint","Projection_State"],["MSET1","US_JAPAN_FX_POLICY",currentManifestId,"MF1","ACTIVE"]];
    if(id===currentManifestId&&sheet==="Manifest_Metadata")return [["Task_ID","Manifest_ID","Registry_Snapshot_ID","Registry_Fingerprint","Manifest_Fingerprint","Generated_At","Readback_At","Manifest_State","Manifest_Set_ID"],["US_JAPAN_FX_POLICY","MS1","RS1","RF","MF1","g","r","ACTIVE","MSET1"]];
    if(id===currentManifestId&&sheet==="Write_Projection")return [["Dataset_ID","Writer_Identity","Operation_Mode","Exact_Member_Or_Resource_Class","Instance_Rule","Schema_Contract_Fingerprint","Gate_Requirements"],["FX_POLICY_RUN_LOG","COLLECTOR","APPEND_ONLY","D1","SINGLETON_RESOURCE:SINGLETON","schema","MANIFEST_REGISTRY_MATCH;CONTRACT_MATCH;BUSINESS_AUTHORITY_ACTIVE;MIGRATION_FENCE_CLEAR;FIELD_SCOPE=ALL_REGISTERED_FIELDS"]];
    if(id===currentManifestId&&sheet==="Read_Projection")return [["Dataset_ID","Exact_Member_Or_Resource_Class","Instance_Rule","Schema_Contract_Fingerprint","Read_Gate_Requirements"],["FX_POLICY_RUN_LOG","D1","SINGLETON_RESOURCE:SINGLETON","schema","MANIFEST_REGISTRY_MATCH;CONTRACT_MATCH;BUSINESS_AUTHORITY_ACTIVE"]];
    if(id===currentManifestId&&sheet==="Instance_Projection")return [["Dataset_ID","Projection_Mode","Parent_Instance_Registry_ID","Exact_Resource_Resolution_Rule","Presence_Rule"],["FX_POLICY_RUN_LOG","D1_SINGLETON","","D1_BINDING=DB;Dataset_ID=FX_POLICY_RUN_LOG;Instance_ID=SINGLETON","REQUIRED|ALWAYS"]];
    throw new Error(`unexpected sheet read ${id}:${sheet}`);
  }
}
const reader=new FakeReader();const cp=await loadControlPlane(reader,"US_JAPAN_FX_POLICY");
assert.equal(cp.manifestFileId,currentManifestId);assert.equal(cp.projectionDrift?.agentsManifestFileId,staleManifestId);assert.equal(cp.gate.gateBlob,PINNED_GATE_BLOB);assert.equal(cp.gate.expectedCutoverId,"CUT");assert.equal(cp.gate.currentRegistryFingerprint,"RF");assert.equal(cp.gate.migrationFenceActive,false);assert.equal(cp.gate.accesses[0].logicalMember,"D1");assert.equal(cp.gate.accesses[0].physicalContractFingerprint,"schema");assert.equal(reader.driveReads[0],AGENTS_FILE_ID);assert.ok(reader.sheetReads.every(x=>!x.includes("search")));
await assert.rejects(()=>loadControlPlane(new FakeReader(true),"US_JAPAN_FX_POLICY"),/MANIFEST_AUTHORITY_MISMATCH/);
console.log("workos_control_plane_loader_validation: PASS");
