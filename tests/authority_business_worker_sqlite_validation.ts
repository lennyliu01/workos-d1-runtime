// SQLite-backed D1-shaped Worker, existing business tables and ACLs, fixture Gate only.
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import worker from "../src/index.js";
import {BUSINESS_SESSION_PATH,BUSINESS_PATH,type BusinessBindingEnv,type VerifiedGateSession,type VerifiedGateInvocation} from "../src/authority_business_binding.js";
import {type AuthorityTuple} from "../src/authority_boundary_candidate.js";
const t:AuthorityTuple=["scope","cut",10,"reg","set","gate","wf","time"];
const cutover={Cutover_ID:t[1],Authority_Scope_Fingerprint:t[0],Activation_Epoch:"10",Target_Registry_File_ID:"regfile",Target_Registry_Snapshot_ID:t[3],Target_Registry_Fingerprint:"rf",Target_Archive_Schema_Catalog_File_ID:"schema",Target_Archive_Schema_Catalog_Fingerprint:"sf",Target_Manifest_Set_ID:t[4],Target_Manifest_Set_Fingerprint:"mf",Target_Workflow_Set_Fingerprint:t[6],Candidate_Workflow_File_IDs:"FX=wf",Persistent_Data_Gate_Config_Fingerprint:t[5],Target_Acceptance_Binding_ID:"ab",Preparation_Anchor_ID:"pa",Final_Activation_Approval_ID:"faa",Migration_Execution_Manifest_ID:"migration",AGENTS_Target_Revision:"rev",Predecessor_Committed_Cutover_ID:"old"};
const generation={tuple:t,dependenciesJson:JSON.stringify({cutover,manifestMembers:[{Manifest_Set_ID:t[4],Task_ID:"FX",Manifest_File_ID:"manifest",Manifest_Fingerprint:"fp",Projection_State:"ACTIVE"}]})};
const db=new DatabaseSync(":memory:");
for(const p of ["0003_create_workos_candidate_persistence.sql","0004_candidate_authority_publication_boundary.sql","0005_candidate_authority_admission_session.sql"])db.exec(readFileSync("migrations/"+p,"utf8"));
db.prepare("INSERT INTO authority_boundary_seed VALUES(1,?,?)").run(JSON.stringify(t),generation.dependenciesJson);
let closeBeforeWrite=false,sqlWrites=0;
const prepare=(sql:string)=>{
 let args:any[]=[];
 return {bind(...v:any[]){args=v;return this},async first(){return db.prepare(sql).get(...args)??null},async all(){return{success:true,results:db.prepare(sql).all(...args)}},async run(){
  if(sql.startsWith("INSERT INTO workos_")){
   sqlWrites++;
   assert.match(sql,/authority_boundary_admission_session/);
   if(closeBeforeWrite){closeBeforeWrite=false;db.prepare("UPDATE authority_boundary_admission_session SET state='CLOSED' WHERE session_id='s2'").run()}
  }
  const r=db.prepare(sql).run(...args);return{success:true,meta:{changes:Number(r.changes)}}
 }};
};
const sessions=new Map<string,VerifiedGateSession>();
const proofs=new Map<string,VerifiedGateInvocation>();
const env:BusinessBindingEnv={
 DB:{prepare,withSession(s:string){assert.equal(s,"first-primary");return{prepare}}},
 RUNTIME_SECRET:"business",AUTHORITY_READER_SECRET:"reader",AUTHORITY_PUBLICATION_MODE:"ISOLATED_ONLY",AUTHORITY_GATE_SECRET:"gate-owner",AUTHORITY_GATE_PRINCIPAL:"existing-gate-owner",
 AUTHORITY_GATE_VERIFIER:{async resolveSession(id){return sessions.get(id)??null},async resolveInvocation(p){return proofs.get(p)??null}}
};
const newSession=(id:string):VerifiedGateSession=>({sessionId:id,principal:"provider-principal",issuer:"existing-gate-owner",generation,expiresUnix:Math.floor(Date.now()/1000)+3600,selector:"D1",sessionOpen:true,eligible:true});
async function session(id:string,operation:"OPEN"|"CLOSE",secret="gate-owner"){
 return worker.fetch(new Request("https://fixture.invalid"+BUSINESS_SESSION_PATH,{method:"POST",headers:{Authorization:"Bearer "+secret},body:JSON.stringify({operation,sessionId:id})}),env as any);
}
type Payload={task_id:string;caller_identity:string;dataset_id:string;instance_id:string;operation:"READ"|"WRITE";[key:string]:unknown};
async function business(body:Payload,id:string,over:Partial<VerifiedGateInvocation>={},sendProof=true){
 const raw=JSON.stringify(body);
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw))),x=>x.toString(16).padStart(2,"0")).join("");
 proofs.set("opaque-proof",{sessionId:id,principal:"provider-principal",generation,selector:"D1",sessionOpen:true,eligible:true,requestDigest:digest,taskId:body.task_id,callerIdentity:body.caller_identity,datasetId:body.dataset_id,instanceId:body.instance_id,operation:body.operation,...over});
 return worker.fetch(new Request("https://fixture.invalid"+BUSINESS_PATH,{method:"POST",headers:{Authorization:"Bearer business",...(sendProof?{"X-WorkOS-Admission":"opaque-proof"}:{})},body:raw}),env as any);
}
const s=newSession("s1");sessions.set("s1",s);
const base={task_id:"US_JAPAN_FX_POLICY",caller_identity:"COLLECTOR",dataset_id:"FX_POLICY_EVIDENCE_LOG",instance_id:"SINGLETON",operation:"WRITE" as const,record_key:"rec1",idempotency_key:"idem1",payload:{value:1}};
assert.equal((await session("s1","OPEN","business")).status,401);
assert.equal((await session("s1","OPEN")).status,200);
assert.equal((await session("s1","OPEN")).status,409);
assert.equal((await business(base,"s1",{},false)).status,403);
assert.equal((await business(base,"s1",{selector:"SHEETS" as any})).status,403);
assert.equal((await business(base,"s1",{requestDigest:"wrong"})).status,403);
assert.equal((await business(base,"s1",{sessionOpen:false})).status,403);
assert.equal((await business(base,"s1",{principal:"wrong"})).status,403);
assert.equal((await business(base,"s1",{generation:{...generation,tuple:[...t.slice(0,7),"wrong-time"] as AuthorityTuple}})).status,403);
assert.equal(sqlWrites,0);
assert.equal((await business({...base,caller_identity:"READER"},"s1")).status,403);
assert.equal(sqlWrites,0);
assert.equal((await business(base,"s1")).status,200);
assert.equal((await business(base,"s1")).status,200); // exact idempotent replay
assert.equal(sqlWrites,1);
const rw={task_id:"ROLLING_WEDGE_INVESTMENT",caller_identity:"Rolling_Wedge_Workflow",dataset_id:"RW_CURRENT_STATE",instance_id:"ENPLAS",operation:"WRITE" as const,expected_version:0,idempotency_key:"rw1",payload:{value:1}};
assert.equal((await business(rw,"s1")).status,200);
assert.equal((await business({...rw,expected_version:1,idempotency_key:"rw2",payload:{value:2}},"s1")).status,200);
assert.equal((await business({task_id:rw.task_id,caller_identity:rw.caller_identity,dataset_id:rw.dataset_id,instance_id:rw.instance_id,operation:"READ",selector:{kind:"CURRENT"}},"s1")).status,200);
s.sessionOpen=false;
assert.equal((await session("s1","CLOSE")).status,200);
assert.equal((await business(base,"s1")).status,403); // persisted close beats stale fixture approval
s.sessionOpen=true;
assert.equal((await session("s1","OPEN")).status,409);
const s2=newSession("s2");sessions.set("s2",s2);assert.equal((await session("s2","OPEN")).status,200);
closeBeforeWrite=true;
const raced=await business({...base,record_key:"late",idempotency_key:"late"},"s2");
assert.equal(raced.status,503);
assert.equal((await raced.json() as any).error,"ADMISSION_CHANGED_RESULT_UNKNOWN");
assert.equal(db.prepare("SELECT count(*) AS n FROM workos_append_records WHERE record_key='late'").get()?.n,0);
assert.throws(()=>db.prepare("UPDATE authority_boundary_admission_session SET state='OPEN' WHERE session_id='s2'").run());
assert.throws(()=>db.prepare("DELETE FROM authority_boundary_admission_session WHERE session_id='s2'").run());
db.close();
console.log("AUTHORITY_BUSINESS_WORKER_SQLITE_ADMISSION_VALIDATION_PASS");
