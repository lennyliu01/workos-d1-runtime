// Candidate-only reuse of the incumbent Worker and existing Gate/Session owner.
// The verifier is an unbound trusted integration seam; no credentials, production
// grants, or independent service are created here. Ordinary runtime bearer is transport only.
import {type AuthorityDB} from "./authority_boundary_candidate.js";
import {parseAuthorityGeneration,type AuthorityGeneration} from "./authority_reader_binding.js";
import {authorityFencePredicate,authorityFenceValues,type AuthorityFence} from "./authority_admission_fence.js";
import {type PublicationBindingEnv} from "./authority_publication_binding.js";
import {handleWorkOsCandidatePersistence} from "./workos_candidate.js";
export const BUSINESS_SESSION_PATH="/candidate/authority-admission-session";
export const BUSINESS_PATH="/candidate/workos-persistence";
export interface VerifiedGateSession {
  sessionId:string;principal:string;issuer:string;generation:AuthorityGeneration;
  expiresUnix:number;selector:"D1";sessionOpen:boolean;eligible:boolean;
}
export interface VerifiedGateInvocation {
  sessionId:string;principal:string;generation:AuthorityGeneration;selector:"D1";
  sessionOpen:boolean;eligible:boolean;requestDigest:string;
  taskId:string;callerIdentity:string;datasetId:string;instanceId:string;operation:"READ"|"WRITE";
}
export interface IncumbentGateVerifier {
  resolveSession(sessionId:string,operation:"OPEN"|"CLOSE"):Promise<VerifiedGateSession|null>;
  resolveInvocation(opaqueProof:string,requestDigest:string):Promise<VerifiedGateInvocation|null>;
}
export interface BusinessBindingEnv extends PublicationBindingEnv {
  AUTHORITY_GATE_SECRET?:string;
  AUTHORITY_GATE_PRINCIPAL?:string;
  AUTHORITY_GATE_VERIFIER?:IncumbentGateVerifier;
}
type SessionRow={session_id:string;principal:string;tuple_json:string;dependencies_json:string;expires_unix:number;state:"OPEN"|"CLOSED"};
const token=(x:unknown):x is string=>typeof x==="string"&&/^[A-Za-z0-9._:-]{1,256}$/.test(x);
const fail=(error:string,status=403)=>Response.json({status:"FAILED",error},{status,headers:{"Cache-Control":"no-store"}});
const configured=(e:BusinessBindingEnv)=>{
  const others=[e.RUNTIME_SECRET,e.AUTHORITY_READER_SECRET,e.AUTHORITY_PUBLISHER_SECRET,e.AUTHORITY_OWNER_SECRET,e.AUTHORITY_REVOKER_SECRET];
  return e.AUTHORITY_PUBLICATION_MODE==="ISOLATED_ONLY"&&!!e.AUTHORITY_GATE_VERIFIER&&!!e.RUNTIME_SECRET&&
    !!e.AUTHORITY_GATE_SECRET&&!others.includes(e.AUTHORITY_GATE_SECRET)&&token(e.AUTHORITY_GATE_PRINCIPAL);
};
const toFence=(v:{sessionId:string;principal:string;generation:AuthorityGeneration}):AuthorityFence=>{
  const g=parseAuthorityGeneration(v.generation);
  return {sessionId:v.sessionId,principal:v.principal,tupleJson:JSON.stringify(g.tuple),dependenciesJson:g.dependenciesJson};
};
function exactSession(s:SessionRow,f:AuthorityFence,expires:number):boolean{
  return s.session_id===f.sessionId&&s.principal===f.principal&&s.tuple_json===f.tupleJson&&s.dependencies_json===f.dependenciesJson&&s.expires_unix===expires;
}
async function getSession(db:AuthorityDB,id:string){
 return db.withSession("first-primary").prepare("SELECT session_id,principal,tuple_json,dependencies_json,expires_unix,state FROM authority_boundary_admission_session WHERE session_id=?").bind(id).first<SessionRow>();
}
export async function admissionCurrent(db:AuthorityDB,f:AuthorityFence):Promise<boolean>{
  const row=await db.withSession("first-primary").prepare("SELECT 1 AS allowed WHERE "+authorityFencePredicate).bind(...authorityFenceValues(f)).first<{allowed:number}>();
  return row?.allowed===1;
}
export async function handleBusinessSession(request:Request,env:BusinessBindingEnv):Promise<Response>{
  const url=new URL(request.url);
  if(request.method!=="POST"||url.pathname!==BUSINESS_SESSION_PATH||url.search)return fail("OPERATION_DENIED",405);
  if(!configured(env))return fail("AUTHORITY_GATE_BINDING_UNAVAILABLE",503);
  if(request.headers.get("Authorization")!=="Bearer "+env.AUTHORITY_GATE_SECRET)return fail("UNAUTHORIZED",401);
  let raw:unknown;try{raw=await request.json()}catch{return fail("INVALID_REQUEST",400)}
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return fail("INVALID_REQUEST",400);
  const o=raw as Record<string,unknown>,op=o.operation,id=o.sessionId;
  if(Object.keys(o).length!==2||!token(id)||(op!=="OPEN"&&op!=="CLOSE"))return fail("INVALID_REQUEST",400);
  const db=env.DB as AuthorityDB;
  if(!db||typeof db.withSession!=="function")return fail("PRIMARY_UNAVAILABLE",503);
  try{
    const v=await env.AUTHORITY_GATE_VERIFIER!.resolveSession(id,op);
    if(!v||v.sessionId!==id||!token(v.principal)||v.issuer!==env.AUTHORITY_GATE_PRINCIPAL||
       !Number.isSafeInteger(v.expiresUnix)||v.selector!=="D1"||v.eligible!==true||
       v.sessionOpen!==(op==="OPEN"))return fail("SESSION_OWNER_PROOF_DENIED");
    const f=toFence(v);
    const before=await getSession(db,id);
    if(op==="OPEN"){
      if(before)return fail("SESSION_ALREADY_EXISTS",409);
      try{await db.prepare("INSERT INTO authority_boundary_admission_session (session_id,principal,tuple_json,dependencies_json,expires_unix,state) SELECT ?,?,?,?,?,'OPEN' WHERE EXISTS(SELECT 1 FROM authority_boundary_current WHERE tuple_json=? AND dependencies_json=?) AND ?>CAST(strftime('%s','now') AS INTEGER)").bind(...authorityFenceValues(f),v.expiresUnix,f.tupleJson,f.dependenciesJson,v.expiresUnix).run()}catch{/* exact readback only */}
    }else{
      if(!before||!exactSession(before,f,v.expiresUnix))return fail("SESSION_IDENTITY_CONFLICT",409);
      if(before.state==="OPEN"){
        try{await db.prepare("UPDATE authority_boundary_admission_session SET state='CLOSED' WHERE session_id=? AND principal=? AND tuple_json=? AND dependencies_json=? AND expires_unix=? AND state='OPEN'").bind(...authorityFenceValues(f),v.expiresUnix).run()}catch{/* exact readback only */}
      }
    }
    const after=await getSession(db,id);
    if(!after||!exactSession(after,f,v.expiresUnix)||after.state!==(op==="OPEN"?"OPEN":"CLOSED"))return fail("SESSION_FINALITY_UNKNOWN",503);
    if(op==="OPEN"&&!await admissionCurrent(db,f))return fail("SESSION_FINALITY_UNKNOWN",503);
    return Response.json({status:after.state,sessionId:id},{headers:{"Cache-Control":"no-store"}});
  }catch{return fail("SESSION_PROOF_OR_PROVIDER_UNAVAILABLE",503)}
}
export async function handleBusinessAdmission(request:Request,env:BusinessBindingEnv):Promise<Response>{
  const url=new URL(request.url);
  if(request.method!=="POST"||url.pathname!==BUSINESS_PATH||url.search)return fail("OPERATION_DENIED",405);
  if(!configured(env))return fail("AUTHORITY_BOUNDARY_ADMISSION_UNBOUND");
  if(request.headers.get("Authorization")!=="Bearer "+env.RUNTIME_SECRET)return fail("UNAUTHORIZED",401);
  const proof=request.headers.get("X-WorkOS-Admission");
  if(!proof||proof.length>8192||[env.RUNTIME_SECRET,env.AUTHORITY_READER_SECRET,env.AUTHORITY_GATE_SECRET,env.AUTHORITY_PUBLISHER_SECRET,env.AUTHORITY_OWNER_SECRET,env.AUTHORITY_REVOKER_SECRET].includes(proof))return fail("TRUSTED_GATE_PROOF_REQUIRED");
  const db=env.DB as AuthorityDB;
  if(!db||typeof db.withSession!=="function")return fail("PRIMARY_UNAVAILABLE",503);
  try{
    const bytes=await request.clone().arrayBuffer();
    if(bytes.byteLength>1_048_576)return fail("REQUEST_TOO_LARGE",413);
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
    const body=JSON.parse(new TextDecoder().decode(bytes)) as Record<string,unknown>;
    if(!body||typeof body!=="object"||Array.isArray(body))return fail("INVALID_REQUEST",400);
    const v=await env.AUTHORITY_GATE_VERIFIER!.resolveInvocation(proof,digest);
    if(!v||!token(v.sessionId)||!token(v.principal)||v.selector!=="D1"||v.eligible!==true||v.sessionOpen!==true||
       v.requestDigest!==digest||v.taskId!==body.task_id||v.callerIdentity!==body.caller_identity||
       v.datasetId!==body.dataset_id||v.instanceId!==body.instance_id||v.operation!==body.operation||
       (v.operation!=="READ"&&v.operation!=="WRITE"))return fail("GATE_INVOCATION_PROOF_DENIED");
    const f=toFence(v);
    if(!await admissionCurrent(db,f))return fail("STALE_OR_CLOSED_ADMISSION");
    // Handler preserves existing business ACL/validation. Its actual INSERTs use the
    // same session/generation predicate atomically, not this preflight alone.
    const result=await handleWorkOsCandidatePersistence(request,{DB:env.DB as Parameters<typeof handleWorkOsCandidatePersistence>[1]["DB"],RUNTIME_SECRET:env.RUNTIME_SECRET,authorityFence:f});
    if(!await admissionCurrent(db,f))return fail(v.operation==="WRITE"?"ADMISSION_CHANGED_RESULT_UNKNOWN":"STALE_OR_CLOSED_ADMISSION",v.operation==="WRITE"?503:403);
    return result;
  }catch{return fail("ADMISSION_OR_PROVIDER_UNAVAILABLE",503)}
}
