/**
 * NONPRODUCTION ONLY: one D1 CURRENT generation for five registered WorkOS tasks.
 * Reuses the D1 pointer/CAS implementation, NEVER publishes or seeds a pointer.
 * This is a candidate reader adapter, not accepted production selector authority.
 */
import {
  readCandidatePointer, type CandidateD1, type Pointer,
} from "./workos_authority_pointer_candidate.js";
import {
  AGENTS_FILE_ID, REPOSITORY_CUTOVER_CONTROL_ID, loadControlPlane,
  type ExactControlPlaneReader, type LoadedControlPlane,
} from "./workos_control_plane_loader.js";

export const FIVE_TASK_IDS = [
  "COMPANY_SCREENING",
  "ROLLING_WEDGE_INVESTMENT",
  "US_JAPAN_FX_DIRECTION_REVIEW",
  "US_JAPAN_FX_FEEDBACK",
  "US_JAPAN_FX_POLICY",
] as const;
export type CommonTaskId = typeof FIVE_TASK_IDS[number];
export type ExecutableTaskId = "ROLLING_WEDGE_INVESTMENT" | "US_JAPAN_FX_POLICY";

export interface ExpectedCandidateGeneration {
  epoch: number;
  sourceFingerprint: string;
  bundleFingerprint: string;
  publicationId: string;
  publisherInvocationId: string;
}
export interface ManifestMember {
  Manifest_Set_ID: string;
  Task_ID: CommonTaskId;
  Manifest_File_ID: string;
  Manifest_Fingerprint: string;
  Projection_State: "ACTIVE";
}
export interface CandidateAuthorityBundle {
  authorityPublication: Record<string, string>;
  cutover: Record<string, string>;
  manifestMembers: ManifestMember[];
  compatibility?: {
    rollingWedgeCompanies?: string[];
    fxPolicyDatasets?: string[];
  };
}
export interface ResolvedCandidateAuthority {
  readonly pointer: Pointer;
  readonly bundle: CandidateAuthorityBundle;
  readonly generation: ExpectedCandidateGeneration;
  readonly memberByTask: Readonly<Record<CommonTaskId, ManifestMember>>;
}
const HEX = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9_-]{1,160}$/;
const AP = [
  "Authority_Scope_Fingerprint","Current_Committed_Cutover_ID",
  "Current_Activation_Epoch","Registry_Snapshot_ID","Manifest_Set_ID",
  "Gate_Config_Fingerprint","Workflow_Set_Fingerprint","Published_At",
] as const;
const CUTOVER = [
  "Cutover_ID","Cutover_State","Authority_Scope_Fingerprint",
  "Target_Registry_Snapshot_ID","Target_Registry_Fingerprint",
  "Target_Registry_File_ID","Target_Manifest_Set_ID",
  "Target_Workflow_Set_Fingerprint","Persistent_Data_Gate_Config_Fingerprint",
  "MIGRATION_WRITE_FENCE_State","Activation_Epoch","Target_Acceptance_Binding_ID",
] as const;
const MEM = ["Manifest_Set_ID","Task_ID","Manifest_File_ID",
  "Manifest_Fingerprint","Projection_State"] as const;
const owns = (v:object,k:string):boolean=>Object.prototype.hasOwnProperty.call(v,k);
function record(v:unknown,label:string):Record<string,string> {
  if(!v||typeof v!=="object"||Array.isArray(v))throw new Error(label+"_INVALID");
  const x=v as Record<string,unknown>;
  if(Object.values(x).some(a=>typeof a!=="string"))throw new Error(label+"_NOT_STRING_MAP");
  return x as Record<string,string>;
}
function requireFields(x:Record<string,string>,names:readonly string[],label:string):void {
  if(names.some(k=>!owns(x,k)||!x[k]))throw new Error(label+"_FIELDS_MISSING");
}
function validateBundle(pointer:Pointer):{bundle:CandidateAuthorityBundle;memberByTask:Readonly<Record<CommonTaskId,ManifestMember>>} {
  let raw:unknown;
  try{raw=JSON.parse(pointer.bundle_json);}catch{throw new Error("CANDIDATE_BUNDLE_JSON_INVALID");}
  if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error("CANDIDATE_BUNDLE_INVALID");
  const r=raw as Record<string,unknown>;
  const ap=record(r.authorityPublication,"AUTHORITY");
  const co=record(r.cutover,"CUTOVER");
  requireFields(ap,AP,"AUTHORITY");requireFields(co,CUTOVER,"CUTOVER");
  const ep=String(pointer.epoch);
  if(ap.Current_Activation_Epoch!==ep||co.Activation_Epoch!==ep||
     ap.Current_Committed_Cutover_ID!==co.Cutover_ID||
     ap.Authority_Scope_Fingerprint!==co.Authority_Scope_Fingerprint||
     ap.Registry_Snapshot_ID!==co.Target_Registry_Snapshot_ID||
     ap.Manifest_Set_ID!==co.Target_Manifest_Set_ID||
     ap.Gate_Config_Fingerprint!==co.Persistent_Data_Gate_Config_Fingerprint||
     ap.Workflow_Set_Fingerprint!==co.Target_Workflow_Set_Fingerprint||
     co.Cutover_State!=="COMPLETE"||co.MIGRATION_WRITE_FENCE_State!=="RELEASED"||
     !HEX.test(ap.Authority_Scope_Fingerprint)||
     !HEX.test(ap.Gate_Config_Fingerprint)||
     !HEX.test(ap.Workflow_Set_Fingerprint)||
     !ID.test(co.Target_Registry_File_ID)||
     !co.Target_Acceptance_Binding_ID)
    throw new Error("CANDIDATE_AUTHORITY_GENERATION_DRIFT");
  if(!Array.isArray(r.manifestMembers)||r.manifestMembers.length!==FIVE_TASK_IDS.length)
    throw new Error("CANDIDATE_MEMBER_SET_NOT_FIVE");
  const map:Partial<Record<CommonTaskId,ManifestMember>>={};
  for(const item of r.manifestMembers) {
    const m=record(item,"MEMBER");
    requireFields(m,MEM,"MEMBER");
    if(!FIVE_TASK_IDS.includes(m.Task_ID as CommonTaskId)||
       owns(map,m.Task_ID)||m.Manifest_Set_ID!==ap.Manifest_Set_ID||
       m.Projection_State!=="ACTIVE"||!ID.test(m.Manifest_File_ID)||
       !HEX.test(m.Manifest_Fingerprint))
      throw new Error("CANDIDATE_MEMBER_IDENTITY_DRIFT");
    map[m.Task_ID as CommonTaskId]=m as unknown as ManifestMember;
  }
  if(FIVE_TASK_IDS.some(t=>!map[t]))throw new Error("CANDIDATE_MEMBER_MISSING");
  const compatibility=r.compatibility;
  if(compatibility!==undefined){
    if(!compatibility||typeof compatibility!=="object"||Array.isArray(compatibility))
      throw new Error("CANDIDATE_COMPATIBILITY_INVALID");
    const c=compatibility as Record<string,unknown>;
    const rw=c.rollingWedgeCompanies, fx=c.fxPolicyDatasets;
    if(rw!==undefined &&
      (!Array.isArray(rw)||!["ENPLAS","SERVICENOW","FIGMA"].every(x=>rw.includes(x))))
      throw new Error("CANDIDATE_RW_LEGACY_COMPATIBILITY_DRIFT");
    if(fx!==undefined &&
      (!Array.isArray(fx)||!fx.includes("FX_POLICY_EVIDENCE_LOG")))
      throw new Error("CANDIDATE_FX_COMPATIBILITY_DRIFT");
  }
  return {bundle:{authorityPublication:ap,cutover:co,
    manifestMembers:r.manifestMembers as ManifestMember[],
    ...(compatibility?{compatibility:compatibility as CandidateAuthorityBundle["compatibility"]}:{})},
    memberByTask:map as Record<CommonTaskId,ManifestMember>};
}
function assertExpected(p:Pointer,e:ExpectedCandidateGeneration):void {
  if(!Number.isSafeInteger(e.epoch)||e.epoch<1||!HEX.test(e.sourceFingerprint)||
     !HEX.test(e.bundleFingerprint)||!e.publicationId||!e.publisherInvocationId)
    throw new Error("CANDIDATE_EXPECTED_GENERATION_MISSING");
  if(p.epoch!==e.epoch||p.source_fingerprint!==e.sourceFingerprint||
     p.bundle_fingerprint!==e.bundleFingerprint||p.publication_id!==e.publicationId||
     p.publisher_invocation_id!==e.publisherInvocationId)
    throw new Error("CANDIDATE_STALE_OR_UNTRUSTED_GENERATION");
}
export async function resolveCandidateAuthority(
  db:CandidateD1, expected:ExpectedCandidateGeneration,
):Promise<ResolvedCandidateAuthority> {
  // No Sheet fallback, cache, guessed "latest", or previous-Epoch retry.
  const pointer=await readCandidatePointer(db);
  assertExpected(pointer,expected);
  const {bundle,memberByTask}=validateBundle(pointer);
  return {pointer,bundle,memberByTask,generation:expected};
}
export async function assertCandidateGenerationUnchanged(
  db:CandidateD1, prior:ResolvedCandidateAuthority,
):Promise<void> {
  const current=await readCandidatePointer(db);
  assertExpected(current,prior.generation);
  // Include exact bytes and both publication identities, not merely Epoch.
  if(current.previous_epoch!==prior.pointer.previous_epoch||
     current.bundle_json!==prior.pointer.bundle_json||
     current.committed_at!==prior.pointer.committed_at)
    throw new Error("CANDIDATE_GENERATION_SWITCH_DURING_READ");
}
/**
 * Only the three legacy selector/control Sheet tabs are projected from a
 * hash-verified immutable D1 bundle. Remaining manifest/registry/ARCHIVE
 * Sheet reads are ordinary bounded DATA reads, not authority fallback.
 */
export function d1CandidateProjectionReader(
  underlying:ExactControlPlaneReader,resolved:ResolvedCandidateAuthority,
):ExactControlPlaneReader {
  const data:ExactControlPlaneReader={
    readDriveText:(id)=>underlying.readDriveText(id),
    async readSheet(id,tab,range){
      if(id===REPOSITORY_CUTOVER_CONTROL_ID){
        const map:Record<string,{headers:readonly string[];rows:Record<string,string>[]}>={
          Authority_Publication:{headers:AP,rows:[resolved.bundle.authorityPublication]},
          Cutovers:{headers:CUTOVER,rows:[resolved.bundle.cutover]},
          Manifest_Set_Members:{headers:MEM,rows:resolved.bundle.manifestMembers},
        };
        const target=map[tab];
        if(target){
          // Do not accept a different range/name or silently delegate selector reads.
          const expectedRange=tab==="Authority_Publication"?"A1:H5":
            tab==="Cutovers"?"A1:AC200":"A1:E200";
          if(range!==expectedRange)throw new Error("CANDIDATE_SELECTOR_RANGE_UNSUPPORTED");
          return [Array.from(target.headers),...target.rows.map(row=>target.headers.map(k=>row[k]))];
        }
      }
      return underlying.readSheet(id,tab,range);
    },
  };
  if(underlying.verifyBootstrapPublisher)
    data.verifyBootstrapPublisher=(e)=>underlying.verifyBootstrapPublisher!(e);
  return data;
}
/** Explicit opt-in candidate entry for the two concrete TypeScript loaders.
 * Other three Task readers may use resolveCandidateAuthority for nonprod
 * contract checks, but are NOT falsely counted as deployed integrations.
 */
export async function loadControlPlaneFromD1Candidate(
  underlying:ExactControlPlaneReader,task:ExecutableTaskId,
  db:CandidateD1,expected:ExpectedCandidateGeneration,
):Promise<LoadedControlPlane> {
  const selected=await resolveCandidateAuthority(db,expected);
  if(!selected.memberByTask[task])throw new Error("CANDIDATE_TASK_NOT_IN_GENERATION");
  const loaded=await loadControlPlane(d1CandidateProjectionReader(underlying,selected),task);
  if(loaded.manifestFileId!==selected.memberByTask[task].Manifest_File_ID ||
     loaded.manifestFingerprint!==selected.memberByTask[task].Manifest_Fingerprint)
    throw new Error("CANDIDATE_LOADER_MANIFEST_DRIFT");
  await assertCandidateGenerationUnchanged(db,selected);
  return loaded;
}
