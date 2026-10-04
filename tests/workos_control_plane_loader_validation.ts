import assert from "node:assert/strict";
import { AGENTS_FILE_ID, REPOSITORY_CUTOVER_CONTROL_ID, loadControlPlane, type ExactControlPlaneReader } from "../src/workos_control_plane_loader.js";
import { PINNED_GATE_CONFIG_FINGERPRINT } from "../src/workos_persistent_gate_projection.js";

const workflowId = "1WorkflowExactIdABCDEFGHIJKLMNOP";
const profileId = "1ProfileExactIdABCDEFGHIJKLMNOPQ";
const collectorId = "1CollectorExactIdABCDEFGHIJKLMNOP";
const readerId = "1ReaderExactIdABCDEFGHIJKLMNOPXX";
const staleManifestId = "1StaleManifestABCDEFGHIJKLMNOPXX";
const currentManifestId = "1CurrentManifestABCDEFGHIJKLMNOPX";

const agents = `# AGENTS.md\n## TASK_ID: US_JAPAN_FX_POLICY\n### Workflow\n**Name:** \`US_Japan_FX_Policy_Workflow\`\n**Cloud Location:** \`https://docs.google.com/document/d/${workflowId}/edit\`\n**Persistent Manifest:** \`https://docs.google.com/spreadsheets/d/${staleManifestId}/edit\`\n**Runtime Profile:** \`FX_PROFILE\` — owner-local projection: \`https://docs.google.com/document/d/${profileId}/edit\`.\n### ROLE: COLLECTOR\n**Spec:** Collector — \`https://drive.google.com/file/d/${collectorId}/view\`\n### ROLE: READER\n**Spec:** Reader — \`https://docs.google.com/document/d/${readerId}/edit\`\n`;

class FakeReader implements ExactControlPlaneReader {
  readonly driveReads: string[] = [];
  readonly sheetReads: string[] = [];
  constructor(private readonly staleAuthority = false) {}
  async readDriveText(id: string): Promise<string> {
    this.driveReads.push(id);
    const map: Record<string,string> = {
      [AGENTS_FILE_ID]: agents, [workflowId]: "workflow", [profileId]: "profile", [collectorId]: "collector", [readerId]: "reader",
    };
    if (!(id in map)) throw new Error(`unexpected drive id ${id}`);
    return map[id];
  }
  async readSheet(id: string, sheet: string, range: string): Promise<string[][]> {
    this.sheetReads.push(`${id}:${sheet}:${range}`);
    if (id === REPOSITORY_CUTOVER_CONTROL_ID && sheet === "Authority_Publication") return [
      ["Authority_Scope_Fingerprint","Current_Committed_Cutover_ID","Current_Activation_Epoch","Registry_Snapshot_ID","Manifest_Set_ID","Gate_Config_Fingerprint","Workflow_Set_Fingerprint","Published_At"],
      ["scope","CUT","10",this.staleAuthority ? "RS_BAD" : "RS1","MSET1",PINNED_GATE_CONFIG_FINGERPRINT,"WFSET","time"],
    ];
    if (id === REPOSITORY_CUTOVER_CONTROL_ID && sheet === "Manifest_Set_Members") return [
      ["Manifest_Set_ID","Task_ID","Manifest_File_ID","Manifest_Fingerprint","Projection_State"],
      ["MSET1","US_JAPAN_FX_POLICY",currentManifestId,"MF1","ACTIVE"],
    ];
    if (id === currentManifestId && sheet === "Manifest_Metadata") return [
      ["Task_ID","Manifest_ID","Registry_Snapshot_ID","Registry_Fingerprint","Manifest_Fingerprint","Generated_At","Readback_At","Manifest_State","Manifest_Set_ID"],
      ["US_JAPAN_FX_POLICY","MS1","RS1","RF","MF1","g","r","ACTIVE","MSET1"],
    ];
    if (id === currentManifestId && sheet === "Write_Projection") return [
      ["Dataset_ID","Writer_Identity","Operation_Mode","Exact_Member_Or_Resource_Class","Instance_Rule","Schema_Contract_Fingerprint","Gate_Requirements"],
      ["FX_POLICY_RUN_LOG","COLLECTOR","APPEND_ONLY","D1","SINGLETON_RESOURCE:SINGLETON","schema","gate"],
    ];
    if (id === currentManifestId && sheet === "Instance_Projection") return [
      ["Dataset_ID","Projection_Mode","Parent_Instance_Registry_ID","Exact_Resource_Resolution_Rule","Presence_Rule"],
      ["FX_POLICY_RUN_LOG","D1_SINGLETON","","D1_BINDING=DB;Dataset_ID=FX_POLICY_RUN_LOG;Instance_ID=SINGLETON","REQUIRED"],
    ];
    throw new Error(`unexpected sheet read ${id}:${sheet}`);
  }
}

const reader = new FakeReader();
const cp = await loadControlPlane(reader, "US_JAPAN_FX_POLICY");
assert.equal(cp.manifestFileId, currentManifestId);
assert.equal(cp.projectionDrift?.agentsManifestFileId, staleManifestId);
assert.equal(cp.projectionDrift?.authoritativeManifestFileId, currentManifestId);
assert.equal(reader.driveReads[0], AGENTS_FILE_ID);
assert.ok(reader.sheetReads.every((x) => !x.includes("search")));
assert.equal(cp.gate.accesses[0].instanceId, "SINGLETON");
await assert.rejects(() => loadControlPlane(new FakeReader(true), "US_JAPAN_FX_POLICY"), /MANIFEST_AUTHORITY_MISMATCH/);
console.log("workos_control_plane_loader_validation: PASS");
