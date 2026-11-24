/** TEST ONLY. No network, credentials, production D1, publication, or dynamic Manifest loader.
 * Gate: exact pinned Python #12. Static handler: #1848. Codec: exact #389.
 * Initializer sequence adapted from #389 to the static Worker request format.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { handleWorkOsCandidatePersistence } from "../src/workos_candidate.js";
import { projectRWInitialBaselineWire, validateRWInitialBaselineWire, FROZEN_RESEARCH_FIELDS, FROZEN_SOURCE_FIELDS, canonicalRWJson } from "./fixtures/batch07_joined/rw_current_state_wire.js";

const task_id="ROLLING_WEDGE_INVESTMENT", caller_identity="Rolling_Wedge_Workflow", dataset_id="RW_CURRENT_STATE";
const fixture=fileURLToPath(new URL("./fixtures/batch07_joined/gate_bridge.py",import.meta.url));
const source={
  Company_ID:"DSG",Instance_ID:"DSG",Security_Ticker:"DSG",Exchange:"TSX",
  Identity:"The Descartes Systems Group Inc.",Base_Source_Materials:"TEST ONLY synthetic research",
  ...Object.fromEntries([...FROZEN_RESEARCH_FIELDS,...FROZEN_SOURCE_FIELDS].map(k=>[k,"TEST ONLY "+k])),
  Base_Source_Source_Status:"SOURCE_STATUS: ACCEPTED (TEST ONLY)",
  Frozen_Baseline_Status:"FROZEN_CANDIDATE TEST ONLY",
  Belief_State_ID:null,Scenario_Probabilities:null,Confidence:null,Valuation_State_ID:null,Decision_State_ID:null,
  Next_Reality_Watch_Accepted:false,Material_Capital_Commitment_Accepted:false,Production_D1_Initialized:false,
  MATERIAL_CAPITAL_COMMITMENT_CANDIDATE__REVISER_OWNED:"TEST ONLY",
  NEXT_REALITY_WATCH_CANDIDATE__REVISER_OWNED:"TEST ONLY"
};
const payload=projectRWInitialBaselineWire(source);
assert.equal(Object.keys(payload).length,8);
assert.ok(validateRWInitialBaselineWire(payload,"DSG"));

type Req=Record<string,any>;
let checks=0;
function pass(name:string){checks++;console.log("JOINED PASS "+name);}
function isolated(){
  // Actual existing migration and Worker SQL, executed against local SQLite.
  // D1's network/binding transport is replaced; its SQL CAS is not mocked.
  const db=new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0003_create_workos_candidate_persistence.sql",import.meta.url),"utf8"));
  let queries=0;
  const DB={prepare(sql:string){
    queries++;
    const stmt=db.prepare(sql);
    return {bind(...args:any[]){
      return {
        async first(){return stmt.get(...args)??null},
        async all(){return {success:true,results:stmt.all(...args)}},
        async run(){return {success:true,meta:{changes:Number(stmt.run(...args).changes)}}}
      };
    }};
  }};
  const env={DB:DB as any,RUNTIME_SECRET:"TEST_ONLY_LOCAL"};
  const scopes=new Map<string,{epoch:string;expires:number;payload:string}>();
  const now=100;
  // Fixture authorization is deliberately not a production Grant issuer.
  // Separate scoped test requests permit competing CAS0 attempts.
  function issue(key:string,expires=200){scopes.set(key,{epoch:"11",expires,payload:canonicalRWJson(payload)});}
  async function worker(body:Req){
    const response=await handleWorkOsCandidatePersistence(new Request("https://isolated.invalid/candidate/workos-persistence",{
      method:"POST",headers:{Authorization:"Bearer TEST_ONLY_LOCAL","Content-Type":"application/json"},body:JSON.stringify(body)
    }),env);
    return {status:response.status,body:await response.json() as Req};
  }
  async function gated(req:Req){
    const gateProcess=spawnSync("python3",[fixture],{input:JSON.stringify(req),encoding:"utf8",env:{...process.env,PYTHONDONTWRITEBYTECODE:"1"}});
    assert.equal(gateProcess.status,0,gateProcess.stderr);
    const gate=JSON.parse(gateProcess.stdout);
    if(!gate.allowed)return {status:403,body:{error:gate.code}};
    // The test scope is server-side, never a caller-supplied allow flag.
    const {epoch,mode,readback_key,...body}=req;
    if(req.instance_id==="DSG"){
      const key=req.operation==="WRITE"?req.idempotency_key:readback_key;
      const auth=scopes.get(key);
      if(!auth||auth.epoch!==epoch||auth.expires<=now||req.task_id!==task_id||
        req.caller_identity!==caller_identity||req.dataset_id!==dataset_id||
        (req.operation==="WRITE"?
          mode!=="INIT"||req.expected_version!==0||!validateRWInitialBaselineWire(req.payload,"DSG")||
          canonicalRWJson(req.payload)!==auth.payload:
          mode!=="READBACK"||req.selector?.kind!=="CURRENT"))
        return {status:403,body:{error:"TEST_ONLY_SCOPE_DENIED"}};
    }else if(mode!==undefined)return {status:403,body:{error:"TEST_ONLY_SCOPE_DENIED"}};
    const result=await worker(body);
    if(req.instance_id==="DSG" && mode==="READBACK" && result.status===200){
      const row=db.prepare("SELECT idempotency_key,version,previous_version,payload_json FROM workos_current_state_versions WHERE invocation_id=?").get(result.body.invocation_id) as Req|undefined;
      if(!row||row.idempotency_key!==readback_key||row.version!==1||row.previous_version!==0||
          canonicalRWJson(JSON.parse(row.payload_json))!==scopes.get(readback_key)?.payload)
        return {status:403,body:{error:"TEST_ONLY_READBACK_BINDING_MISMATCH"}};
    }
    return result;
  }
  const rows=()=>db.prepare("SELECT * FROM workos_current_state_versions ORDER BY instance_id,version").all() as Req[];
  const history=()=>db.prepare("SELECT * FROM workos_append_records").all();
  return {db,issue,gated,worker,rows,history,queries:()=>queries};
}
const init=(key:string,extra:Req={}):Req=>({task_id,caller_identity,dataset_id,instance_id:"DSG",operation:"WRITE",expected_version:0,idempotency_key:key,payload,epoch:"11",mode:"INIT",...extra});
const readback=(key:string,extra:Req={}):Req=>({task_id,caller_identity,dataset_id,instance_id:"DSG",operation:"READ",selector:{kind:"CURRENT"},epoch:"11",mode:"READBACK",readback_key:key,...extra});
const f=isolated();
f.issue("TEST-INIT-1");f.issue("TEST-INIT-2");f.issue("TEST-EXPIRED",99);
const positive=await f.gated(init("TEST-INIT-1"));
assert.equal(positive.status,200,JSON.stringify(positive));
assert.equal(positive.body.previous_version,0);
assert.equal(positive.body.version,1);
assert.equal(positive.body.idempotency_key,"TEST-INIT-1");
assert.equal(positive.body.replayed,false);
pass("registered DRAFT fixture -> real Gate -> TEST ONLY scope -> existing Writer -> SQL CAS0 v1");
const rb=await f.gated(readback("TEST-INIT-1"));
assert.equal(rb.status,200,JSON.stringify(rb));
assert.equal(rb.body.version,1);assert.equal(rb.body.previous_version,0);
assert.deepEqual(rb.body.payload,payload);
const raw=f.rows()[0];
assert.equal(raw.idempotency_key,"TEST-INIT-1");assert.equal(raw.invocation_id,rb.body.invocation_id);
assert.deepEqual(JSON.parse(raw.payload_json),payload);
pass("exact payload/version/key readback (key via isolated row and invocation; static CURRENT API omits key)");
const replay=await f.gated(init("TEST-INIT-1"));
assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);
assert.equal(replay.body.invocation_id,positive.body.invocation_id);assert.equal(f.rows().length,1);
pass("identical replay");
const stale=await f.gated(init("TEST-INIT-2"));
assert.equal(stale.status,409,JSON.stringify(stale));assert.equal(stale.body.error,"STALE_STATE");
assert.equal(f.rows().length,1);pass("second distinct authorized TEST ONLY CAS0 denied by Writer");
const otherRead=await f.gated(readback("TEST-INIT-2"));
assert.equal(otherRead.status,403);assert.equal(otherRead.body.error,"TEST_ONLY_READBACK_BINDING_MISMATCH");
pass("readback cannot use another issued request key");
const race=isolated();race.issue("TEST-RACE-1");race.issue("TEST-RACE-2");
const competing=await Promise.all([race.gated(init("TEST-RACE-1")),race.gated(init("TEST-RACE-2"))]);
assert.deepEqual(competing.map(x=>x.status).sort(),[200,409]);
assert.equal(race.rows().length,1);pass("concurrent competing CAS0 exactly one success");
race.db.close();
for(const [name,req] of [
  ["wrong Writer",init("TEST-INIT-1",{caller_identity:"REVISER"})],
  ["wrong Instance",init("TEST-INIT-1",{instance_id:"DOL"})],
  ["wrong Dataset",init("TEST-INIT-1",{dataset_id:"RW_UNKNOWN"})],
  ["extra field",init("TEST-INIT-1",{payload:{...payload,Extra:"bad"}})],
  ["missing field",init("TEST-INIT-1",{payload:Object.fromEntries(Object.entries(payload).filter(([k])=>k!=="Currency"))})],
  ["invalid codec",init("TEST-INIT-1",{payload:{...payload,Currency:"CAD"}})],
  ["old Epoch",init("TEST-INIT-1",{epoch:"10"})],
  ["expired authorization",init("TEST-EXPIRED")],
  ["missing authorization",init("TEST-NOT-ISSUED")],
  ["ordinary DRAFT update",init("TEST-INIT-1",{mode:undefined,expected_version:1})],
  ["DRAFT nonzero INIT",init("TEST-INIT-1",{expected_version:1})],
  ["MONITOR read",readback("TEST-INIT-1",{mode:undefined,caller_identity:"MONITOR"})],
  ["MONITOR write",init("TEST-INIT-1",{caller_identity:"MONITOR"})],
  ["History append",init("TEST-INIT-1",{dataset_id:"RW_EVIDENCE_HISTORY",caller_identity:"MONITOR",mode:undefined,record_key:"TEST-HISTORY"})],
  ["wrong readback key",readback("TEST-NOT-ISSUED")],
] as [string,Req][]){
  const before=f.queries();const result=await f.gated(req);
  assert.equal(result.status,403,name+":"+JSON.stringify(result));
  assert.equal(f.queries(),before,name+" must not reach SQL");
  pass(name+" denied "+result.body.error);
}
assert.equal(f.rows().length,1);assert.equal(f.history().length,0);
for(const id of ["ENPLAS","SERVICENOW","FIGMA"]){
  const base={task_id,caller_identity,dataset_id,instance_id:id,epoch:"11"};
  const original={Company_ID:id,Company_Name:"TEST "+id,Ticker:id,Exchange:"TEST",Currency:null,State_As_Of:null,Base_Source_Materials:"TEST",Structured_State_Content:"{}"};
  const w=await f.gated({...base,operation:"WRITE",expected_version:0,idempotency_key:"TEST-"+id,payload:original});
  assert.equal(w.status,200,JSON.stringify(w));assert.equal(w.body.version,1);
  const r=await f.gated({...base,operation:"READ",selector:{kind:"CURRENT"}});
  assert.equal(r.status,200);assert.deepEqual(r.body.payload,original);
  pass(id+" incumbent normal Gate and existing Writer read/write");
}
assert.equal(f.rows().length,4);
f.db.close();
console.log("JOINED ISOLATED PASS checks="+checks+"; real Gate + real static Worker + exact Codec + actual migration SQL, TEST ONLY scope and local SQLite transport; no production authority.");
