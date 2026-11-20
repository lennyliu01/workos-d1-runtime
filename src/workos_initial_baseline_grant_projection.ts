import type { ExactControlPlaneReader, LoadedControlPlane } from "./workos_control_plane_loader.js";

/**
 * R3 candidate-only implementation of the issued-grant READ side. It is not
 * the WorkOS publisher or a new grant issuer. The accepted current ACTIVE
 * Manifest must explicitly select this tab, and the grant row must have been
 * issued through the governed Publisher path.
 *
 * Payload_SHA256 is a proposed additional anti-substitution field. Its schema
 * and contract fingerprint are NOT active and need R1/R2/R5 acceptance.
 */
const TAB = "Initial_Baseline_Grants";
const HEADER = [
  "Task_ID","Manifest_ID","Manifest_Fingerprint","Authority_Epoch",
  "Dataset_ID","Instance_ID","Logical_Member","Writer_ID","Reader_ID",
  "Allowed_Fields","Idempotency_Key","Grant_State","Payload_SHA256",
] as const;
const INITIAL_FIELDS = [
  "Base_Source_Materials","Company_ID","Company_Name","Currency","Exchange",
  "State_As_Of","Structured_State_Content","Ticker",
] as const;
const expectedFields = [...INITIAL_FIELDS].sort().join(",");
const idPattern=/^[A-Za-z0-9._:-]{1,128}$/;
const hexPattern=/^[0-9a-f]{64}$/;

export type InitialBaselineGrantScope = {
  manifestId:string;manifestFingerprint:string;authorityFingerprint:string;
  activationEpoch:string;datasetId:"RW_CURRENT_STATE";
  instanceId:string;callerIdentity:"Rolling_Wedge_Workflow";
  idempotencyKey:string;payloadJson:string;
};

export async function publishedInitialBaselineGrantIsEligible(
  reader: ExactControlPlaneReader,
  cp: LoadedControlPlane,
  scope:InitialBaselineGrantScope,
):Promise<boolean> {
  if(cp.task.taskId!=="ROLLING_WEDGE_INVESTMENT" ||
     cp.projectionDrift ||
     cp.gate.manifestState!=="ACTIVE" ||
     cp.gate.authorityPublicationState!=="EXACT_ONE" ||
     !cp.gate.authorityPublication ||
     cp.manifestMetadata.Bootstrap_Grant_Projection_Tab!==TAB ||
     scope.manifestId!==cp.gate.manifestId ||
     scope.manifestFingerprint!==cp.manifestFingerprint ||
     scope.authorityFingerprint!==cp.authority.authorityScopeFingerprint ||
     scope.activationEpoch!==cp.authority.activationEpoch ||
     scope.datasetId!=="RW_CURRENT_STATE" ||
     scope.callerIdentity!=="Rolling_Wedge_Workflow" ||
     !idPattern.test(scope.instanceId) ||
     !idPattern.test(scope.idempotencyKey)) {
    return false;
  }
  let rows:string[][];
  try {
    rows=await reader.readSheet(cp.manifestFileId,TAB,"A1:M250");
  } catch {return false}
  if(!rows.length || rows[0].length!==HEADER.length ||
     HEADER.some((header,i)=>rows[0][i]!==header)) return false;
  const parsed=rows.slice(1).filter(r=>r.some(x=>x!==""));
  if(parsed.some(r=>r.length!==HEADER.length))return false;
  const candidates=parsed.filter(r=>r[5]===scope.instanceId && r[4]===scope.datasetId);
  if(candidates.length!==1)return false;
  const r=candidates[0];
  const target=[
    "ROLLING_WEDGE_INVESTMENT",scope.manifestId,scope.manifestFingerprint,
    scope.activationEpoch,scope.datasetId,scope.instanceId,
    "D1_BOUND_DATASET:RW_CURRENT_STATE;Binding=DB",
    "Rolling_Wedge_Workflow","Rolling_Wedge_Workflow",
  ];
  if(target.some((x,i)=>r[i]!==x))return false;
  if(r[9].split(",").map(x=>x.trim()).sort().join(",")!==expectedFields ||
     r[10]!==scope.idempotencyKey || r[11]!=="ISSUED" ||
     !hexPattern.test(r[12])) return false;
  const hash=new Uint8Array(await crypto.subtle.digest(
    "SHA-256",new TextEncoder().encode(scope.payloadJson)));
  const computed=Array.from(hash,x=>x.toString(16).padStart(2,"0")).join("");
  return computed===r[12];
}
