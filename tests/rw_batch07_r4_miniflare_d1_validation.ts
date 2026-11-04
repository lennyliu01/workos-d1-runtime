/**
 * R4 nonproduction integration: original 0003 D1 migration + actual
 * handleWorkOsCandidatePersistence + local Miniflare D1 binding.
 * An isolated trusted control-plane fixture stands in for live publisher
 * verification; this test is NOT a production publisher/signer witness.
 */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Miniflare} from "miniflare";
import {handleWorkOsCandidatePersistence} from "../src/workos_candidate.js";
import {
  WORKOS_D1_GATE_IMPLEMENTATION_ID,WORKOS_D1_GATE_IMPLEMENTATION_VERSION,
  ACCEPTED_GATE_CONFIG_FINGERPRINT,
  type GateProjectionSnapshot,type ManifestAccessRow,
} from "../src/workos_persistent_gate_projection.js";
import {initializeBaselineWithReadback,recoverBaselineReadbackOnly} from "../src/workos_initial_baseline_candidate.js";
import {RW_CURRENT_STATE_FIELDS,FROZEN_RESEARCH_FIELDS,FROZEN_SOURCE_FIELDS,canonicalRWJson,
  validateRWInitialBaselineWire} from "../src/rw_current_state_wire.js";

const mf=new Miniflare({
  modules:true,
  script:"export default {fetch(){return new Response('isolated')}}",
  compatibilityDate:"2026-08-06",
  d1Databases:{DB:"00000000-0000-4000-8000-000000000389"},
});
let checks=0;
const check=()=>{checks++};
try {
  const DB=await mf.getD1Database("DB");
  const ddl=readFileSync("migrations/0003_create_workos_candidate_persistence.sql","utf8")
    .split("\n").filter(line=>!line.trimStart().startsWith("--")).join("\n");
  await DB.exec(ddl);
  const env={DB,RUNTIME_SECRET:"isolated-r4-integration-only"} as any;
  const ids=["DSG","DOL","WSP","GIBA","NA","ENB","ATD"];
  const old=["ENPLAS","SERVICENOW","FIGMA"];
  const fields=[...RW_CURRENT_STATE_FIELDS];
  const issuedAtMs=Date.now()-60_000,expiresAtMs=Date.now()+3_600_000;
  const grantKey=(id:string)=>"R4.ISOLATED."+id;
  const grantFor=(id:string)=>({
    taskId:"ROLLING_WEDGE_INVESTMENT",manifestId:"R4_ISOLATED",
    manifestFingerprint:"MF_R4",authorityEpoch:"E_R4",
    datasetId:"RW_CURRENT_STATE",instanceId:id,logicalMember:"RW_CURRENT_STATE",
    writerId:"Rolling_Wedge_Workflow",readerId:"Rolling_Wedge_Workflow",
    fields:new Set<string>(fields),idempotencyKey:grantKey(id),state:"ACTIVE" as const,
    issuedAtMs,expiresAtMs,publisherProvenance:"NONPROD_SYNTHETIC_SIGNER",
    publisherVerified:true,
  });
  const grants=new Map(ids.map(id=>["RW_CURRENT_STATE\u0000"+id,grantFor(id)]));
  const access=(id:string,draft:boolean):ManifestAccessRow=>({
    datasetId:"RW_CURRENT_STATE",instanceId:id,logicalMember:"RW_CURRENT_STATE",
    contractFingerprint:"ISOLATED_FINGERPRINT",physicalContractFingerprint:"ISOLATED_FINGERPRINT",
    readers:new Set(["Rolling_Wedge_Workflow","MONITOR"]),
    writerScopes:[{writerId:"Rolling_Wedge_Workflow",operations:new Set(["CONDITIONAL_CURRENT_STATE"]),
      fields:draft?new Set(fields):null}],
    writeMode:"CURRENT_STATE",dynamicInstance:draft||id!=="ENPLAS",
    businessAuthorityState:draft?"DRAFT":"ACTIVE",
  });
  const gate:GateProjectionSnapshot={
    gateImplementationId:WORKOS_D1_GATE_IMPLEMENTATION_ID,
    gateImplementationVersion:WORKOS_D1_GATE_IMPLEMENTATION_VERSION,
    gateConfigFingerprint:ACCEPTED_GATE_CONFIG_FINGERPRINT,
    authorityPublicationState:"EXACT_ONE",
    authorityPublication:{
      authorityScopeFingerprint:"S",currentCommittedCutoverId:"C",
      currentActivationEpoch:"E_R4",registrySnapshotId:"R",manifestSetId:"M",
      gateConfigFingerprint:ACCEPTED_GATE_CONFIG_FINGERPRINT,workflowSetFingerprint:"W",
    },
    expectedAuthorityScopeFingerprint:"S",expectedCutoverId:"C",expectedActivationEpoch:"E_R4",
    expectedManifestSetId:"M",expectedGateConfigFingerprint:ACCEPTED_GATE_CONFIG_FINGERPRINT,
    expectedWorkflowSetFingerprint:"W",referencedCutoverState:"AUTHORITY_COMMITTED",
    currentRegistrySnapshotId:"R",currentRegistryFingerprint:"RF",
    manifestId:"R4_ISOLATED",taskId:"ROLLING_WEDGE_INVESTMENT",
    manifestState:"ACTIVE",manifestFingerprint:"MF_R4",bootstrapGrants:grants,
    manifestRegistrySnapshotId:"R",manifestRegistryFingerprint:"RF",
    migrationFenceActive:false,nonArchiveDatasetIds:new Set(["RW_CURRENT_STATE"]),
    pruneFenceIndexAvailable:true,pruneFencedKeys:new Set(),startedPruneKeys:new Set(),
    archivedIdentityKeys:new Set(),
    accesses:[...ids.map(id=>access(id,true)),...old.map(id=>access(id,false))],
  };
  const control=async()=>({task:{taskId:"ROLLING_WEDGE_INVESTMENT"},gate} as any);
  const wire=(id:string)=>{
    const source=Object.fromEntries(FROZEN_SOURCE_FIELDS.map(k=>[
      k,k==="Base_Source_Source_Status"?"SOURCE_STATUS: ACCEPTED; isolation fixture":
      k==="Frozen_Baseline_Status"?"FROZEN_CANDIDATE":k+"-fixture"
    ]));
    const research=Object.fromEntries(FROZEN_RESEARCH_FIELDS.map(k=>[k,k+"-fixture"]));
    const v={Company_ID:id,Company_Name:"Company "+id,Ticker:id,Exchange:"TSX",
      Currency:null,State_As_Of:null,Base_Source_Materials:"https://example.invalid/source",
      Structured_State_Content:canonicalRWJson({schema:"RW_INITIAL_FROZEN_RESEARCH_V1",source,research})};
    assert.ok(validateRWInitialBaselineWire(v,id));check();return v;
  };
  const payloads=new Map(ids.map(id=>[id,wire(id)]));
  const base=(id:string)=>({
    execution_surface:"WORK",trigger_mode:"HUMAN",
    task_id:"ROLLING_WEDGE_INVESTMENT",caller_identity:"Rolling_Wedge_Workflow",
    dataset_id:"RW_CURRENT_STATE",instance_id:id,
    authority_epoch:"E_R4",manifest_fingerprint:"MF_R4",
  });
  const write=(id:string,idem=grantKey(id))=>({
    ...base(id),operation:"WRITE",write_operation:"INITIAL_BASELINE",
    idempotency_key:idem,expected_version:0,fields,payload:payloads.get(id),
  });
  const read=(id:string)=>({
    ...base(id),operation:"READ",read_purpose:"INITIAL_BASELINE_READBACK",
    bootstrap_idempotency_key:grantKey(id),expected_version:1,
    selector:{kind:"CURRENT"},
  });
  const send=async(body:Record<string,unknown>,cp=control)=>{
    const response=await handleWorkOsCandidatePersistence(
      new Request("https://isolated.invalid/candidate/workos-persistence",{
        method:"POST",headers:{Authorization:"Bearer isolated-r4-integration-only"},
        body:JSON.stringify(body),
      }),env,cp);
    return {status:response.status,body:await response.json() as Record<string,unknown>};
  };
  const dbrow=async(id:string)=>DB.prepare("SELECT dataset_id,instance_id,version,previous_version,payload_json,invocation_id,idempotency_key FROM workos_current_state_versions WHERE dataset_id=? AND instance_id=? ORDER BY version DESC LIMIT 1")
    .bind("RW_CURRENT_STATE",id).first<any>();
  // Expiry, revoked/disabled, forged issuer, manifest/epoch drift must not write.
  const expMap=new Map(grants);expMap.set("RW_CURRENT_STATE\u0000DSG",{...grantFor("DSG"),expiresAtMs:Date.now()-1});
  assert.equal((await send(write("DSG"),async()=>({task:{taskId:"ROLLING_WEDGE_INVESTMENT"},gate:{...gate,bootstrapGrants:expMap}} as any))).status,403);check();
  const revMap=new Map(grants);revMap.set("RW_CURRENT_STATE\u0000DSG",{...grantFor("DSG"),state:"REVOKED" as const});
  assert.equal((await send(write("DSG"),async()=>({task:{taskId:"ROLLING_WEDGE_INVESTMENT"},gate:{...gate,bootstrapGrants:revMap}} as any))).status,403);check();
  const badIssuer=new Map(grants);badIssuer.set("RW_CURRENT_STATE\u0000DSG",{...grantFor("DSG"),publisherVerified:false});
  assert.equal((await send(write("DSG"),async()=>({task:{taskId:"ROLLING_WEDGE_INVESTMENT"},gate:{...gate,bootstrapGrants:badIssuer}} as any))).status,403);check();
  assert.equal((await send({...write("DSG"),authority_epoch:"OLD_EPOCH"})).status,403);check();
  assert.equal((await send({...write("DSG"),manifest_fingerprint:"OLD_MANIFEST"})).status,403);check();
  assert.equal(await dbrow("DSG"),null);check();
  // Two distinct invocations race on authentic D1 uniqueness/version CAS.
  const concurrent=await Promise.all([send(write("DSG")),send(write("DSG"))]);
  assert.equal(concurrent.filter(x=>x.status===200).length,1,"D1 race must have exactly one winner");check();
  assert.equal(concurrent.filter(x=>x.status!==200).length,1,"loser must not claim success");check();
  const persisted=await dbrow("DSG");
  assert.equal(persisted?.version,1);check();
  assert.equal(persisted?.previous_version,0);check();
  assert.equal(persisted?.idempotency_key,grantKey("DSG"));check();
  assert.deepEqual(JSON.parse(persisted.payload_json),payloads.get("DSG"));check();
  assert.equal((await send(write("DSG"))).status,409,"bootstrap replay must be consumed");check();
  assert.equal((await send(write("DSG","REPLAY_DIFFERENT_KEY"))).status,403);check();
  const rb=await send(read("DSG"));
  assert.equal(rb.status,200);assert.equal(rb.body.idempotency_key,grantKey("DSG"));
  assert.equal(rb.body.invocation_id,persisted.invocation_id);check();
  assert.deepEqual(rb.body.payload,payloads.get("DSG"));check();
  const wrongRead=await send({...read("DSG"),bootstrap_idempotency_key:"WRONG"});
  assert.equal(wrongRead.status,403);check();
  // Init + terminal exact readback + after-crash read-only recovery.
  const boundFetch=(async(_request:RequestInfo|URL,init?:RequestInit)=>handleWorkOsCandidatePersistence(
    new Request("https://isolated.invalid/candidate/workos-persistence",init),env,control
  )) as typeof fetch;
  const cp={task:{taskId:"ROLLING_WEDGE_INVESTMENT"},gate} as any;
  const init=await initializeBaselineWithReadback(cp,"DOL",payloads.get("DOL")!,"isolated-r4-integration-only",boundFetch);
  assert.equal(init.write.version,1);check();
  assert.equal(init.readback.idempotency_key,grantKey("DOL"));check();
  const recovered=await recoverBaselineReadbackOnly(cp,"DOL",payloads.get("DOL")!,"isolated-r4-integration-only",boundFetch);
  assert.equal(recovered.recovery,"READBACK_ONLY");check();
  assert.deepEqual(recovered.readback.payload,payloads.get("DOL"));check();
  assert.equal((await send(write("DOL"))).status,409);check();
  // Remaining DRAFT companies only permitted exact first write and readback.
  for (const id of ids.filter(x=>x!=="DSG"&&x!=="DOL")) {
    const w=await send(write(id));assert.equal(w.status,200);check();
    const rr=await send(read(id));assert.equal(rr.status,200);assert.deepEqual(rr.body.payload,payloads.get(id));check();
    assert.equal((await send(write(id))).status,409);check();
  }
  // Legacy ACTIVE company current-version and readback remain unchanged.
  for(const id of old){
    const legacyBase={task_id:"ROLLING_WEDGE_INVESTMENT",
      caller_identity:"Rolling_Wedge_Workflow",operation:"WRITE",
      dataset_id:"RW_CURRENT_STATE",instance_id:id};
    const w=await send({...legacyBase,idempotency_key:"LEGACY."+id+".V1",
      expected_version:0,payload:{legacy:true}});
    assert.equal(w.status,200);check();
    const rw=await send({...legacyBase,idempotency_key:"LEGACY."+id+".V2",
      expected_version:1,payload:{legacy:true,version:2}});
    assert.equal(rw.status,200);assert.equal(rw.body.version,2);check();
    const r=await send({...legacyBase,operation:"READ",caller_identity:"MONITOR",
      selector:{kind:"CURRENT"}});assert.equal(r.status,200);
    assert.deepEqual(r.body.payload,{legacy:true,version:2});check();
  }
  // FX append uses original static singleton permission, no RW grant.
  const fx=await send({task_id:"US_JAPAN_FX_POLICY",caller_identity:"COLLECTOR",
    operation:"WRITE",dataset_id:"FX_POLICY_EVIDENCE_LOG",instance_id:"SINGLETON",
    record_key:"R4_FX_001",idempotency_key:"R4_FX_001",payload:{fx:true}});
  assert.equal(fx.status,200,JSON.stringify(fx.body));check();
  const fxr=await send({task_id:"US_JAPAN_FX_POLICY",caller_identity:"COLLECTOR",
    operation:"READ",dataset_id:"FX_POLICY_EVIDENCE_LOG",instance_id:"SINGLETON",
    selector:{kind:"RECORD",record_key:"R4_FX_001"}});
  assert.equal(fxr.status,200);assert.deepEqual((fxr.body.record as any).payload,{fx:true});check();
  const fxreplay=await send({task_id:"US_JAPAN_FX_POLICY",caller_identity:"COLLECTOR",
    operation:"WRITE",dataset_id:"FX_POLICY_EVIDENCE_LOG",instance_id:"SINGLETON",
    record_key:"R4_FX_001",idempotency_key:"R4_FX_001",payload:{fx:true}});
  assert.equal(fxreplay.status,200);assert.equal(fxreplay.body.replayed,true);check();
  console.log(JSON.stringify({suite:"R4_MINIFLARE_ORIGINAL_D1_SCHEMA",checks,
    passed:checks,failed:0,scope:"NONPRODUCTION_LOCAL_ISOLATION",
    publisherSigner:"SYNTHETIC_FIXTURE_ONLY",productionAuthority:"UNCHANGED"}));
} finally {
  await mf.dispose();
}
