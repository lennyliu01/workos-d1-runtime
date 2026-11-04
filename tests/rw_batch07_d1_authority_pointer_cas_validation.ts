/**
 * D1 Authority Pointer CAS: genuine isolated Miniflare D1 / 0003 + 0004 schema.
 * NO live Cloudflare account, Publisher signing, accepted Epoch, or production switch.
 */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Miniflare} from "miniflare";
import {
  sha256Exact,readCandidatePointer,publishCandidatePointer,recoverOwnCandidateCommit,
  candidateFencedCurrentInsert,candidateFencedAppendInsert,
  type PublishRequest,type GenerationFence,type CandidateD1,
} from "../src/workos_authority_pointer_candidate.js";

const mf=new Miniflare({
  modules:true,script:"export default { fetch(){return new Response('isolated')}}",
  compatibilityDate:"2026-08-06",
  d1Databases:{DB:"00000000-0000-4000-8000-000000000410"},
});
let checks=0;
function check(condition:unknown,message:string){assert.ok(condition,message);checks++}
function eq(a:unknown,b:unknown,msg:string){assert.deepEqual(a,b,msg);checks++}
const five={
  COMPANY_SCREENING:"M_SCREEN_10",
  ROLLING_WEDGE_INVESTMENT:"M_RW_10",
  US_JAPAN_FX_DIRECTION_REVIEW:"M_FX_DIRECTION_10",
  US_JAPAN_FX_FEEDBACK:"M_FX_FEEDBACK_10",
  US_JAPAN_FX_POLICY:"M_FX_POLICY_10",
};
const legacy=["ENPLAS","SERVICENOW","FIGMA"];
const fxDataset="FX_POLICY_EVIDENCE_LOG";
const bundle=(rev:number)=>JSON.stringify({
  status:"NONPRODUCTION_CANDIDATE_FIXTURE",registrySnapshotId:"REGISTRY_10",
  manifestSetId:"MSET_10",cutoverId:"CUTOVER_10",gateConfigFingerprint:"GATE_10",
  manifestMembers:five,
  compatibility:{rollingWedgeCompanies:legacy,fxPolicyDatasets:[fxDataset]},
  revision:rev,
});
function makeWrap(db:any,mode:"before"|"after"|"missing-readback"):CandidateD1 {
  return {prepare(sql:string){
    const stmt=db.prepare(sql);
    return {
      first:async<T>()=>{
        if(mode==="missing-readback"&&sql.startsWith("SELECT selector_key"))return null;
        return stmt.first<T>();
      },
      bind(...xs:unknown[]){
        const bound=stmt.bind(...xs);
        return {
          first:<T>()=>bound.first<T>(),
          bind:()=>{throw new Error("UNEXPECTED_BIND");},
          run:async()=>{
            if(sql.startsWith("UPDATE workos_authority_pointer_candidate")){
              if(mode==="before")throw new Error("SIMULATED_BEFORE_COMMIT_TIMEOUT");
              if(mode==="after"){await bound.run();throw new Error("SIMULATED_AFTER_COMMIT_ACK_LOSS");}
            }
            return bound.run();
          },
        };
      },
      run:()=>stmt.run(),
    } as any;
  }} as CandidateD1;
}
try {
  const DB=await mf.getD1Database("DB");
  for(const path of [
    "migrations/0003_create_workos_candidate_persistence.sql",
    "migrations/0004_create_authority_pointer_candidate.sql",
  ]){
    const sql=readFileSync(path,"utf8").split("\n")
      .filter(line=>!line.trimStart().startsWith("--")).join("\n");
    for(const st of sql.split(";").map(x=>x.trim()).filter(Boolean)){
      const result=await DB.prepare(st).run();
      check(result.success,"original and candidate schema must apply");
    }
  }
  const source10=await sha256Exact("NONPROD_EXACT_GOOGLE_SHEETS_EPOCH_10_SOURCE_FIXTURE");
  const source11=await sha256Exact("NONPROD_SIGNED_SOURCE_EPOCH_11");
  const source12=await sha256Exact("NONPROD_SIGNED_SOURCE_EPOCH_12");
  const source13=await sha256Exact("NONPROD_SIGNED_SOURCE_EPOCH_13");
  const source14=await sha256Exact("NONPROD_SIGNED_SOURCE_EPOCH_14");
  const b10=bundle(10),b11=bundle(11),b12=bundle(12),b13=bundle(13),b14=bundle(14);
  const f10=await sha256Exact(b10),f11=await sha256Exact(b11),
        f12=await sha256Exact(b12),f13=await sha256Exact(b13),f14=await sha256Exact(b14);
  // Seed is fixture-only; the migration never seeds or flips a production pointer.
  const seeded=await DB.prepare(
    "INSERT INTO workos_authority_pointer_candidate (selector_key,epoch,previous_epoch,source_fingerprint,bundle_fingerprint,bundle_json,publication_id,publisher_invocation_id,status,committed_at) VALUES ('CURRENT',10,9,?,?,?,?,?,'COMMITTED','2026-11-04T00:00:00Z')"
  ).bind(source10,f10,b10,"FIXTURE_SEED_10","FIXTURE_INVOCATION_10").run();
  check(seeded.success&&seeded.meta.changes===1,"fixture seeding");
  const request=(expectedEpoch:number,expectedSource:string,expectedBundle:string,
    epoch:number,nextSource:string,nextBundleJson:string,nextBundle:string,id:string):PublishRequest=>({
      expected:{epoch:expectedEpoch,sourceFingerprint:expectedSource,bundleFingerprint:expectedBundle},
      next:{epoch,sourceFingerprint:nextSource,bundleFingerprint:nextBundle,
        bundleJson:nextBundleJson,publicationId:"PUB_"+id,publisherInvocationId:"INV_"+id},
    });
  const before=await readCandidatePointer(DB);
  eq(before.epoch,10,"seed epoch");
  eq(before.bundle_json,b10,"exact source projection");
  const a=request(10,source10,f10,11,source11,b11,f11,"RACE_A");
  const b=request(10,source10,f10,11,source11,b11,f11,"RACE_B");
  const raced=await Promise.all([publishCandidatePointer(DB,a),publishCandidatePointer(DB,b)]);
  eq(raced.filter(r=>r.status==="COMMITTED").length,1,"exactly one native D1 CAS winner");
  eq(raced.filter(r=>r.status==="CONFLICT").length,1,"loser conflict");
  const winner=raced[0].status==="COMMITTED"?a:b;
  const loser=raced[0].status==="COMMITTED"?b:a;
  const at11=await readCandidatePointer(DB);
  eq(at11.epoch,11,"single epoch increment");
  eq(at11.previous_epoch,10,"predecessor");
  eq(at11.publisher_invocation_id,winner.next.publisherInvocationId,"winner identity");
  check(at11.publisher_invocation_id!==loser.next.publisherInvocationId,"no losing publisher attribution");
  eq(at11.bundle_json,b11,"exact full committed bundle bytes");
  eq(await sha256Exact(at11.bundle_json),at11.bundle_fingerprint,"post-CAS hash readback");
  eq(Object.keys(JSON.parse(at11.bundle_json).manifestMembers).sort(),Object.keys(five).sort(),
    "five Task Manifest identities preserved");
  eq(JSON.parse(at11.bundle_json).compatibility.rollingWedgeCompanies,legacy,
    "three legacy companies present");
  eq(JSON.parse(at11.bundle_json).compatibility.fxPolicyDatasets,[fxDataset],"FX present");
  eq((await recoverOwnCandidateCommit(DB,loser)).status,"UNKNOWN",
    "loser cannot impersonate winner even with same payload");
  eq((await recoverOwnCandidateCommit(DB,winner)).status,"RECOVERED_OWN_COMMIT",
    "exact winner-only recovery");
  // Epoch, source fingerprint and old bundle fingerprint drift are separately rejected.
  eq((await publishCandidatePointer(DB,a)).status,"CONFLICT","stale Epoch");
  eq((await publishCandidatePointer(DB,
    request(11,source10,f11,12,source12,b12,f12,"STALE_SOURCE"))).status,
    "CONFLICT","stale source fingerprint");
  eq((await publishCandidatePointer(DB,
    request(11,source11,f10,12,source12,b12,f12,"STALE_BUNDLE"))).status,
    "CONFLICT","stale bundle fingerprint");
  eq((await readCandidatePointer(DB)).epoch,11,"all drift attempts left pointer unchanged");
  await assert.rejects(
    publishCandidatePointer(DB,request(11,source11,f11,12,source12,b12,f11,"BAD_TARGET")),
    /TARGET_BUNDLE_DRIFT/);checks++;
  eq((await readCandidatePointer(DB)).epoch,11,"bad target never writes");
  // Same-statement fence proof on the EXISTING R4 D1 current/append table shapes.
  const g11:GenerationFence={epoch:11,sourceFingerprint:source11,bundleFingerprint:f11};
  const g12:GenerationFence={epoch:12,sourceFingerprint:source12,bundleFingerprint:f12};
  for(const id of legacy){
    eq(await candidateFencedCurrentInsert(DB,g11,{datasetId:"RW_CURRENT_STATE",
      instanceId:id,expectedVersion:0,payloadJson:JSON.stringify({legacy:id,version:1}),
      invocationId:"LEGACY_"+id+"_1",idempotencyKey:"LEGACY_"+id+"_1"}),true,
      "old RW current-state first write retained for "+id);
  }
  eq(await candidateFencedAppendInsert(DB,g11,{datasetId:fxDataset,instanceId:"SINGLETON",
    recordKey:"FX_BEFORE",payloadJson:'{"fx":true}',invocationId:"FX_1",idempotencyKey:"FX_1"}),
    true,"FX append at old valid epoch");
  // Simulate old request reading g11, pausing, and then resuming after authority switch.
  const p12=request(11,source11,f11,12,source12,b12,f12,"SWITCH_12");
  eq((await publishCandidatePointer(DB,p12)).status,"COMMITTED","switch to candidate epoch 12");
  eq(await candidateFencedCurrentInsert(DB,g11,{datasetId:"RW_CURRENT_STATE",
    instanceId:"ENPLAS",expectedVersion:1,payloadJson:'{"stale":true}',
    invocationId:"STALE_OLD_ENPLAS",idempotencyKey:"STALE_OLD_ENPLAS"}),
    false,"paused old RW write fenced at SQL mutation");
  eq(await candidateFencedAppendInsert(DB,g11,{datasetId:fxDataset,instanceId:"SINGLETON",
    recordKey:"FX_STALE",payloadJson:'{"stale":true}',
    invocationId:"FX_STALE",idempotencyKey:"FX_STALE"}),false,
    "paused old FX write fenced at SQL mutation");
  for(const id of legacy){
    const row=await DB.prepare(
      "SELECT version,payload_json FROM workos_current_state_versions WHERE dataset_id='RW_CURRENT_STATE' AND instance_id=? ORDER BY version DESC LIMIT 1")
      .bind(id).first<any>();
    eq(row.version,1,"stale write did not mutate "+id);
    eq(JSON.parse(row.payload_json).legacy,id,"legacy content unchanged "+id);
    eq(await candidateFencedCurrentInsert(DB,g12,{datasetId:"RW_CURRENT_STATE",
      instanceId:id,expectedVersion:1,payloadJson:JSON.stringify({legacy:id,version:2}),
      invocationId:"LEGACY_"+id+"_2",idempotencyKey:"LEGACY_"+id+"_2"}),true,
      "old RW company remains writable at fresh generation: "+id);
  }
  eq(await candidateFencedAppendInsert(DB,g12,{datasetId:fxDataset,instanceId:"SINGLETON",
    recordKey:"FX_AFTER",payloadJson:'{"fx":true,"version":2}',
    invocationId:"FX_2",idempotencyKey:"FX_2"}),true,"FX fresh generation writable");
  const fxRows=await DB.prepare(
    "SELECT record_key FROM workos_append_records WHERE dataset_id=? ORDER BY append_seq"
  ).bind(fxDataset).all<any>();
  eq(fxRows.results.map(x=>x.record_key),["FX_BEFORE","FX_AFTER"],
    "old FX late write absent; existing append path intact");
  // Crash before CAS: no claim; exact readback still epoch12, no retry.
  const p13=request(12,source12,f12,13,source13,b13,f13,"RECOVERY_13");
  eq((await publishCandidatePointer(makeWrap(DB,"before"),p13)).status,"UNKNOWN",
    "before-commit ambiguous failure stays unknown");
  eq((await readCandidatePointer(DB)).epoch,12,"before CAS failure left epoch unchanged");
  // Crash AFTER successful native CAS but before acknowledgement: readback proves own commit.
  eq((await publishCandidatePointer(makeWrap(DB,"after"),p13)).status,
    "RECOVERED_OWN_COMMIT","ambiguous ACK recovered only via exact invocation");
  eq((await readCandidatePointer(DB)).epoch,13,"after-commit recovery has no retry");
  eq((await publishCandidatePointer(DB,p13)).status,"CONFLICT",
    "same invocation cannot double publish");
  const p14=request(13,source13,f13,14,source14,b14,f14,"READBACK_14");
  eq((await publishCandidatePointer(makeWrap(DB,"missing-readback"),p14)).status,"UNKNOWN",
    "unverifiable postwrite readback must not return success");
  eq((await recoverOwnCandidateCommit(DB,p14)).status,"RECOVERED_OWN_COMMIT",
    "fresh exact readback reconciles timeout");
  const at14=await readCandidatePointer(DB);
  eq(at14.epoch,14,"end epoch");
  eq(at14.bundle_json,b14,"exact end bundle readback");
  eq(at14.publisher_invocation_id,p14.next.publisherInvocationId,"exact invocation identity");
  // Reusing CURRENT's invocation/Publication ID at next epoch is forbidden.
  eq((await publishCandidatePointer(DB,
    request(14,source14,f14,15,source14,bundle(15),await sha256Exact(bundle(15)),"READBACK_14"))).status,
    "CONFLICT","cannot reuse immediate prior publication/invocation");
  // A mutated carrier is not authoritative even if row still exists.
  await DB.prepare("UPDATE workos_authority_pointer_candidate SET bundle_json='{\"tampered\":true}' WHERE selector_key='CURRENT'").run();
  await assert.rejects(readCandidatePointer(DB),/BUNDLE_DRIFT/);checks++;
  console.log(JSON.stringify({suite:"RW_BATCH07_D1_AUTHORITY_POINTER_CAS",checks,passed:checks,
    failed:0,engine:"MINIFLARE_LOCAL_D1_SQLITE",productionEquivalent:false,
    actualPublisherVerification:false,productionAuthority:"UNCHANGED",
    verified:["native_single_winner","stale_epoch","source_drift","bundle_drift",
      "same_statement_old_request_fence_RW_and_FX","before_and_after_commit_recovery",
      "exact_invocation_bundle_readback","legacy_three_companies","FX"]}));
}finally {await mf.dispose();}
