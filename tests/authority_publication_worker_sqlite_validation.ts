// Local SQLite-backed D1-shaped integration test; trusted approval source is a fixture,
// NOT provider approval, real D1, IAM evidence, or independent PCV.
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import worker from "../src/index.js";
import {PUBLICATION_PATH,type VerifiedApproval,type PublicationBindingEnv} from "../src/authority_publication_binding.js";
import {type AuthorityTuple,type PublicationRequest} from "../src/authority_boundary_candidate.js";

const schema=readFileSync("migrations/0004_candidate_authority_publication_boundary.sql","utf8");
const generation=(epoch:number)=>{
 const s=String(epoch),t:AuthorityTuple=["fixture-scope","cut-"+s,epoch,"reg-"+s,"set-"+s,"gate-"+s,"wf-"+s,"time-"+s];
 const cutover={Cutover_ID:t[1],Authority_Scope_Fingerprint:t[0],Activation_Epoch:s,Target_Registry_File_ID:"regfile-"+s,Target_Registry_Snapshot_ID:t[3],Target_Registry_Fingerprint:"rf-"+s,Target_Archive_Schema_Catalog_File_ID:"schema",Target_Archive_Schema_Catalog_Fingerprint:"sf",Target_Manifest_Set_ID:t[4],Target_Manifest_Set_Fingerprint:"mf-"+s,Target_Workflow_Set_Fingerprint:t[6],Candidate_Workflow_File_IDs:"FX=wf",Persistent_Data_Gate_Config_Fingerprint:t[5],Target_Acceptance_Binding_ID:"ab-"+s,Preparation_Anchor_ID:"pa-"+s,Final_Activation_Approval_ID:"faa-"+s,Migration_Execution_Manifest_ID:"migration-"+s,AGENTS_Target_Revision:"rev-"+s,Predecessor_Committed_Cutover_ID:"cut-"+(epoch-1)};
 const manifestMembers=[{Manifest_Set_ID:t[4],Task_ID:"FX",Manifest_File_ID:"manifest-"+s,Manifest_Fingerprint:"fp-"+s,Projection_State:"ACTIVE"}];
 return {tuple:t,dependenciesJson:JSON.stringify({cutover,manifestMembers})};
};
const e10=generation(10),e11=generation(11),e9=generation(9);
function approval(id:string,over:Partial<PublicationRequest>={}):VerifiedApproval{
 return {request:{grantId:"grant-"+id,requestId:id,publisher:"publisher",sessionId:"session-"+id,expected:e10.tuple,target:e11.tuple,expectedDependencies:e10.dependenciesJson,targetDependencies:e11.dependenciesJson,frozenIdentity:'{"identity":"fixture-only"}',changeSpecId:"fixture-change",pcvId:"fixture-pcv",faa2Id:"FAA2_"+"a".repeat(64),...over},issuer:"owner",revoker:"revoker",expiresUnix:Math.floor(Date.now()/1000)+3600,selector:"D1",sessionOpen:true,eligible:true};
}
function fixture(){
 const db=new DatabaseSync(":memory:");
 db.exec("PRAGMA foreign_keys=ON;"+schema);
 db.prepare("INSERT INTO authority_boundary_seed VALUES(1,?,?)").run(JSON.stringify(e10.tuple),e10.dependenciesJson);
 const approvals=new Map<string,VerifiedApproval>();
 let writes=0,primaryReads=0,loseTerminal=false;
 const prepare=(sql:string)=>{
  let values:any[]=[];
  return {bind(...v:any[]){values=v;return this},async first(){return db.prepare(sql).get(...values)??null},async run(){writes++;const result=db.prepare(sql).run(...values);if(loseTerminal&&sql.startsWith("INSERT INTO authority_boundary_terminal")){loseTerminal=false;throw Error("fixture terminal response lost")}return{success:true,meta:{changes:Number(result.changes)}}}};
 };
 const env:PublicationBindingEnv={
  DB:{prepare,withSession(s:string){assert.equal(s,"first-primary");primaryReads++;return{prepare}}},
  RUNTIME_SECRET:"business-secret",AUTHORITY_READER_SECRET:"reader-secret",
  AUTHORITY_PUBLICATION_MODE:"ISOLATED_ONLY",AUTHORITY_PUBLISHER_SECRET:"publisher-secret",AUTHORITY_OWNER_SECRET:"owner-secret",AUTHORITY_REVOKER_SECRET:"revoker-secret",
  AUTHORITY_PUBLISHER_PRINCIPAL:"publisher",AUTHORITY_OWNER_PRINCIPAL:"owner",AUTHORITY_REVOKER_PRINCIPAL:"revoker",
  AUTHORITY_APPROVAL_VERIFIER:{async resolve(id){return approvals.get(id)??null}}
 };
 async function call(operation:string,requestId:string,role="publisher"){
  const result=await worker.fetch(new Request("https://fixture.invalid"+PUBLICATION_PATH,{method:"POST",headers:{Authorization:"Bearer "+role+"-secret"},body:JSON.stringify({operation,requestId})}),env as any);
  return {http:result.status,body:await result.json() as {status:string,error?:string,receipt?:{outcome:string,epoch:number}}};
 }
 return {db,approvals,call,count:(table:string)=>Number(db.prepare("SELECT COUNT(*) AS n FROM "+table).get()?.n),epoch:()=>db.prepare("SELECT epoch FROM authority_boundary_current").get()?.epoch,writes:()=>writes,primaryReads:()=>primaryReads,loseTerminal:()=>{loseTerminal=true}};
}
{
 const f=fixture(),a=approval("R1");f.approvals.set("R1",a);
 assert.equal((await f.call("ISSUE","R1","owner")).body.status,"ISSUED");
 assert.equal(f.count("authority_boundary_grant"),1);
 assert.equal((await f.call("ISSUE","R1","owner")).http,409);
 a.sessionOpen=false;
 assert.equal((await f.call("COMMIT","R1")).http,403);
 a.sessionOpen=true;
 a.eligible=false;
 assert.equal((await f.call("COMMIT","R1")).http,403);
 a.eligible=true;
 a.selector="SHEETS" as any;
 assert.equal((await f.call("COMMIT","R1")).http,403);
 a.selector="D1";
 const pcv=a.request.pcvId;a.request.pcvId="wrong-pcv";
 assert.equal((await f.call("COMMIT","R1")).http,409);
 a.request.pcvId=pcv;
 assert.equal(f.count("authority_boundary_terminal"),0);
 const committed=await f.call("COMMIT","R1");
 assert.equal(committed.body.status,"COMMITTED");assert.equal(committed.body.receipt?.epoch,11);
 assert.equal(f.epoch(),11);assert.equal(f.count("authority_boundary_terminal"),1);
 const n=f.writes();assert.equal((await f.call("COMMIT","R1")).http,409);
 assert.equal((await f.call("REVOKE","R1","revoker")).http,409);
 a.sessionOpen=false;
 assert.equal((await f.call("STATUS","R1")).body.status,"COMMITTED");
 assert.equal(f.writes(),n);assert.ok(f.primaryReads()>0);
 f.db.close();
}
{
 const f=fixture(),a=approval("stale",{expected:e9.tuple,target:e10.tuple,expectedDependencies:e9.dependenciesJson,targetDependencies:e10.dependenciesJson});f.approvals.set("stale",a);
 assert.equal((await f.call("ISSUE","stale","owner")).body.error,"STALE_GENERATION");assert.equal(f.writes(),0);
 const one=approval("one"),two=approval("two");f.approvals.set("one",one);f.approvals.set("two",two);
 assert.equal((await f.call("ISSUE","one","owner")).body.status,"ISSUED");assert.equal((await f.call("ISSUE","two","owner")).body.status,"ISSUED");
 assert.equal((await f.call("COMMIT","one")).body.status,"COMMITTED");
 assert.equal((await f.call("COMMIT","two")).body.error,"STALE_GENERATION");assert.equal(f.count("authority_boundary_terminal"),1);
 f.db.close();
}
{
 const f=fixture();f.approvals.set("cancel",approval("cancel"));
 assert.equal((await f.call("ISSUE","cancel","owner")).body.status,"ISSUED");
 assert.equal((await f.call("REVOKE","cancel","revoker")).body.status,"CANCELED");
 assert.equal((await f.call("COMMIT","cancel")).http,409);
 assert.equal((await f.call("STATUS","cancel")).body.status,"CANCELED");assert.equal(f.epoch(),10);
 const repeat=approval("new",{sessionId:"session-cancel"});f.approvals.set("new",repeat);
 assert.notEqual((await f.call("ISSUE","new","owner")).body.status,"ISSUED");assert.equal(f.count("authority_boundary_grant"),1);
 f.db.close();
}
{
 const f=fixture();f.approvals.set("lost",approval("lost"));
 assert.equal((await f.call("ISSUE","lost","owner")).body.status,"ISSUED");
 f.loseTerminal();assert.equal((await f.call("COMMIT","lost")).body.status,"COMMITTED");
 assert.equal((await f.call("STATUS","lost")).body.status,"COMMITTED");
 assert.equal(f.count("authority_boundary_terminal"),1);
 f.db.close();
}
console.log("AUTHORITY_PUBLICATION_WORKER_SQLITE_ADAPTER_VALIDATION_PASS");
