/**
 * Isolated real Miniflare D1 tests for the candidate common Authority Reader.
 * This is NOT a deployed/accepted selector nor a real-provider parity witness.
 */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Miniflare} from "miniflare";
import {
  sha256Exact,publishCandidatePointer,type Pointer,type PublishRequest,
} from "../src/workos_authority_pointer_candidate.js";
import {
  FIVE_TASK_IDS,resolveCandidateAuthority,assertCandidateGenerationUnchanged,
  d1CandidateProjectionReader,type ExpectedCandidateGeneration,
} from "../src/workos_common_authority_reader_candidate.js";
import {REPOSITORY_CUTOVER_CONTROL_ID} from "../src/workos_control_plane_loader.js";

const mf=new Miniflare({modules:true,
  script:"export default { fetch(){ return new Response('isolated') } }",
  compatibilityDate:"2026-08-06",
  d1Databases:{DB:"00000000-0000-4000-8000-000000000411"},
});
let checks=0;
function ok(v:unknown,msg:string){assert.ok(v,msg);checks++;}
function eq(a:unknown,b:unknown,msg:string){assert.deepEqual(a,b,msg);checks++;}
async function rejects(fn:()=>Promise<unknown>,re:RegExp,msg:string){
  await assert.rejects(fn,re,msg);checks++;
}
const ap={
  Authority_Scope_Fingerprint:"50d5195aafbdb0c3ad71448b685f1773e7f505a790b43eb93e179a6967bab1f4",
  Current_Committed_Cutover_ID:"CUT1_ARCHIVE_REPOSITORY_20260928_01",
  Current_Activation_Epoch:"10",
  Registry_Snapshot_ID:"RS1_84f170ffef50fecc331de87458db2bee9aeebf1bdf7c4e079260c338d477d7e1",
  Manifest_Set_ID:"MSET1_2f76282f0cc13c1df38b414d0221bebcc7f739fcb749ac6d7012e438f42f1cbc",
  Gate_Config_Fingerprint:"ba3bb9599a034a764c9bdfd10a3dca79436fbae80960ace6a64e2786035909f8",
  Workflow_Set_Fingerprint:"a5f6447dd54fa3b5c5cdcb6ffada335cfe28fd8b3dad85b77693f522aab3c53f",
  Published_At:"2026-09-29T19:05:36+09:00",
};
const co={
  Cutover_ID:ap.Current_Committed_Cutover_ID,Cutover_State:"COMPLETE",
  Authority_Scope_Fingerprint:ap.Authority_Scope_Fingerprint,
  Target_Registry_Snapshot_ID:ap.Registry_Snapshot_ID,
  Target_Registry_Fingerprint:"84f170ffef50fecc331de87458db2bee9aeebf1bdf7c4e079260c338d477d7e1",
  Target_Registry_File_ID:"10aqM2xEzuCOCxvqzivNQJVCjl-trvrC12S5lXvzE9fY",
  Target_Manifest_Set_ID:ap.Manifest_Set_ID,
  Target_Workflow_Set_Fingerprint:ap.Workflow_Set_Fingerprint,
  Persistent_Data_Gate_Config_Fingerprint:ap.Gate_Config_Fingerprint,
  MIGRATION_WRITE_FENCE_State:"RELEASED",
  Activation_Epoch:"10",
  Target_Acceptance_Binding_ID:"AB1_033cc2303356f400eb36344e87dec0a2a430749521a759afe167e2e2fce12367",
};
const fileIds={
  COMPANY_SCREENING:"1ROEy5RyJ7pWNyZYm8hmzssV3cbwnvPNGCG3qxMSTDco",
  ROLLING_WEDGE_INVESTMENT:"1sO97-59J4m0FlO8AZOyVIq3qdKvkJQQaoSElksyyEXQ",
  US_JAPAN_FX_DIRECTION_REVIEW:"1ba86fQs0YH5a07OHcVDmsAKpYA0z95P9vIBc1fUxGuw",
  US_JAPAN_FX_FEEDBACK:"1Ny77wFr1LvJMc3LhLixFUwbqGYC_GdHTnQj1F3jq8h4",
  US_JAPAN_FX_POLICY:"1bfcfUsNtrfvGscstI3l9jIdYdAVg5nODpsLTTPQ3h5I",
};
const fps={
  COMPANY_SCREENING:"e5b5c7fd3cc3b7e18a76f9b28533fe39fdaf165f2a65366ca0fcd38c6f642bfa",
  ROLLING_WEDGE_INVESTMENT:"029e066b9bd2e4124afde370dabb9a15321b5fbe6ba64c116fb0c71800d45bd6",
  US_JAPAN_FX_DIRECTION_REVIEW:"9aa103267dbc9aab400ff0a364b75cdc5151de0bc31ec6f8639a58c224f598f4",
  US_JAPAN_FX_FEEDBACK:"93160840d974dfc74fe51814fa23f68e09701b2d899fbd11d619a9794288f266",
  US_JAPAN_FX_POLICY:"89f9f055a2e12056114b424c7756aeda0d10c0363e1ef925ae8ecb21d6710406",
};
const members=FIVE_TASK_IDS.map(t=>({
 Manifest_Set_ID:ap.Manifest_Set_ID,Task_ID:t,Manifest_File_ID:fileIds[t],
 Manifest_Fingerprint:fps[t],Projection_State:"ACTIVE",
}));
function bundle(epoch:number){
  return JSON.stringify({authorityPublication:{...ap,Current_Activation_Epoch:String(epoch)},
    cutover:{...co,Activation_Epoch:String(epoch)},manifestMembers:members,
    compatibility:{rollingWedgeCompanies:["ENPLAS","SERVICENOW","FIGMA"],
      fxPolicyDatasets:["FX_POLICY_EVIDENCE_LOG","FX_POLICY_RUN_LOG"]}});
}
const b10=bundle(10),f10=await sha256Exact(b10),
  src10=await sha256Exact("SHADOW_NONPRODUCTION_EPOCH_10_SOURCE");
const exp10:ExpectedCandidateGeneration={epoch:10,
 sourceFingerprint:src10,bundleFingerprint:f10,
 publicationId:"NONPROD_SEED_10",publisherInvocationId:"NONPROD_SEED_INV_10"};
const DB=await mf.getD1Database("DB");
try{
  const sql=readFileSync("migrations/0004_create_authority_pointer_candidate.sql","utf8")
    .split("\n").filter(x=>!x.trimStart().startsWith("--")).join("\n");
  for(const stmt of sql.split(";").map(s=>s.trim()).filter(Boolean))
    ok((await DB.prepare(stmt).run()).success,"migration applied");
  ok((await DB.prepare("INSERT INTO workos_authority_pointer_candidate (selector_key,epoch,previous_epoch,source_fingerprint,bundle_fingerprint,bundle_json,publication_id,publisher_invocation_id,status,committed_at) VALUES ('CURRENT',10,9,?,?,?,?,?,'COMMITTED','2026-11-04T00:00:00Z')")
    .bind(src10,f10,b10,exp10.publicationId,exp10.publisherInvocationId).run()).success,
    "fixture CURRENT inserted; not production");
  const initial=await resolveCandidateAuthority(DB,exp10);
  eq(initial.pointer.epoch,10,"fresh CURRENT");
  eq(Object.keys(initial.memberByTask).sort(),[...FIVE_TASK_IDS].sort(),"exact five membership");
  for(const task of FIVE_TASK_IDS){
    eq(initial.memberByTask[task].Manifest_File_ID,fileIds[task],task+" exact file id");
    eq(initial.memberByTask[task].Manifest_Fingerprint,fps[task],task+" exact fingerprint");
  }
  eq(initial.bundle.compatibility!.rollingWedgeCompanies,["ENPLAS","SERVICENOW","FIGMA"],
    "legacy RW three unchanged");
  ok(initial.bundle.compatibility!.fxPolicyDatasets!.includes("FX_POLICY_EVIDENCE_LOG"),
    "FX dataset retained");
  eq(initial.bundle.cutover.Target_Acceptance_Binding_ID,co.Target_Acceptance_Binding_ID,
    "DATA_ARCHIVE binding preserved as selected projection");
  const fresh=await Promise.all(Array.from({length:20},
    ()=>resolveCandidateAuthority(DB,exp10)));
  eq(new Set(fresh.map(x=>x.pointer.bundle_fingerprint)).size,1,"20 concurrent readers one generation");
  const calls:string[]=[];
  const provider={
    readDriveText:async()=>"# ordinary registered data",
    readSheet:async(id:string,tab:string)=>{
      calls.push(id+":"+tab);
      if(id===REPOSITORY_CUTOVER_CONTROL_ID)throw new Error("FORBIDDEN_SHEETS_AUTHORITY_FALLBACK");
      return [["ordinaryData"],["retained"]];
    },
  };
  const wrapped=d1CandidateProjectionReader(provider,initial);
  const a=await wrapped.readSheet(REPOSITORY_CUTOVER_CONTROL_ID,"Authority_Publication","A1:H5");
  eq(a[1][2],"10","D1-selected A2:H2 projection");
  const m=await wrapped.readSheet(REPOSITORY_CUTOVER_CONTROL_ID,"Manifest_Set_Members","A1:E200");
  eq(m.length,6,"D1 selector exact 5 members");
  const c=await wrapped.readSheet(REPOSITORY_CUTOVER_CONTROL_ID,"Cutovers","A1:AC200");
  eq(c[1][0],co.Cutover_ID,"D1 selected Cutover");
  eq(calls.length,0,"zero Sheets selector calls");
  eq((await wrapped.readSheet("manifest_id","Manifest_Metadata","A1:J5"))[1][0],
    "retained","ordinary authorized Sheets DATA read retained");
  eq(calls.length,1,"one ordinary data read");
  await rejects(()=>wrapped.readSheet(REPOSITORY_CUTOVER_CONTROL_ID,"Authority_Publication","A1:H2"),
    /SELECTOR_RANGE_UNSUPPORTED/,"noncanonical selector range fail closed");
  await rejects(()=>resolveCandidateAuthority(DB,{...exp10,epoch:9}),
    /STALE_OR_UNTRUSTED/,"old Epoch forbidden");
  await rejects(()=>resolveCandidateAuthority(DB,{...exp10,sourceFingerprint:"0".repeat(64)}),
    /STALE_OR_UNTRUSTED/,"source mismatch forbidden");
  await rejects(()=>resolveCandidateAuthority(DB,{...exp10,bundleFingerprint:"1".repeat(64)}),
    /STALE_OR_UNTRUSTED/,"fingerprint mismatch forbidden");
  await rejects(()=>resolveCandidateAuthority(DB,{...exp10,publicationId:"OLD_CLIENT"}),
    /STALE_OR_UNTRUSTED/,"old publisher identity forbidden");
  await DB.prepare("UPDATE workos_authority_pointer_candidate SET bundle_fingerprint=? WHERE selector_key='CURRENT'")
    .bind("f".repeat(64)).run();
  await rejects(()=>resolveCandidateAuthority(DB,exp10),/BUNDLE_DRIFT/,
    "tampered D1 bundle refuses without Sheet fallback");
  await DB.prepare("UPDATE workos_authority_pointer_candidate SET bundle_fingerprint=? WHERE selector_key='CURRENT'")
    .bind(f10).run();
  const malformed=JSON.stringify({...JSON.parse(b10),manifestMembers:members.slice(1)});
  const malformedHash=await sha256Exact(malformed);
  await DB.prepare("UPDATE workos_authority_pointer_candidate SET bundle_json=?,bundle_fingerprint=? WHERE selector_key='CURRENT'")
    .bind(malformed,malformedHash).run();
  await rejects(()=>resolveCandidateAuthority(DB,{...exp10,bundleFingerprint:malformedHash}),
    /MEMBER_SET_NOT_FIVE/,"four-member bundle forbidden even when hash matches");
  await DB.prepare("UPDATE workos_authority_pointer_candidate SET bundle_json=?,bundle_fingerprint=? WHERE selector_key='CURRENT'")
    .bind(b10,f10).run();
  const b11=bundle(11),f11=await sha256Exact(b11),src11=await sha256Exact("NONPROD_SOURCE_11");
  const request:PublishRequest={
    expected:{epoch:10,sourceFingerprint:src10,bundleFingerprint:f10},
    next:{epoch:11,sourceFingerprint:src11,bundleFingerprint:f11,bundleJson:b11,
      publicationId:"NONPROD_11",publisherInvocationId:"NONPROD_INV_11"},
  };
  const committed=await publishCandidatePointer(DB,request);
  eq(committed.status,"COMMITTED","reuse original D1 CAS successfully");
  await rejects(()=>assertCandidateGenerationUnchanged(DB,initial),
    /STALE_OR_UNTRUSTED|GENERATION_SWITCH/,"stale cached snapshot rejected after switch");
  await rejects(()=>resolveCandidateAuthority(DB,exp10),
    /STALE_OR_UNTRUSTED/,"cold-start old client rejected after switch");
  const exp11:ExpectedCandidateGeneration={epoch:11,sourceFingerprint:src11,bundleFingerprint:f11,
    publicationId:"NONPROD_11",publisherInvocationId:"NONPROD_INV_11"};
  const now=await resolveCandidateAuthority(DB,exp11);
  eq(now.pointer.previous_epoch,10,"same D1 CAS previous epoch");
  const fresh11=await Promise.all(FIVE_TASK_IDS.map(()=>resolveCandidateAuthority(DB,exp11)));
  eq(new Set(fresh11.map(x=>x.pointer.publisher_invocation_id)).size,1,
    "all five cold-start readers agree after switch");
  await DB.prepare("DELETE FROM workos_authority_pointer_candidate WHERE selector_key='CURRENT'").run();
  await rejects(()=>resolveCandidateAuthority(DB,exp11),/CURRENT_UNAVAILABLE/,
    "missing CURRENT always fail closed");
  eq(calls.length,1,"no Sheet authority fallback even on missing CURRENT");
  console.log(JSON.stringify({suite:"NONPRODUCTION_COMMON_D1_AUTHORITY_READER",
    checks,passed:checks,failed:0,actual_remote_d1_tests:0,
    production_deployed:false,full_live_reader_inventory:false}));
}finally{await mf.dispose();}
