// Candidate integration only. No production credential, verifier, seed or Grant is installed.
import {publicationAttempt, publicationEnvelope, publicationStatus, readAuthorityGeneration, type AuthorityDB, type PublicationRequest, type Finality} from "./authority_boundary_candidate.js";
import {parseAuthorityGeneration, sameGeneration} from "./authority_reader_binding.js";

export const PUBLICATION_PATH="/candidate/authority-publication-operation";
export type PublicationOperation="ISSUE"|"COMMIT"|"REVOKE"|"STATUS";
export interface VerifiedApproval {
  request:PublicationRequest;
  issuer:string;
  revoker:string;
  expiresUnix:number;
  selector:"D1";
  sessionOpen:boolean;
  eligible:boolean;
}
// This is an integration seam for the incumbent owner-controlled approval source.
// It must freshly resolve authenticated FAA2, terminal PCV, sealed Change Spec,
// selected authority and session capability, not accept assertions from HTTP.
export interface IncumbentApprovalVerifier {
  resolve(requestId:string,operation:PublicationOperation):Promise<VerifiedApproval|null>;
}
export interface PublicationBindingEnv {
  DB:unknown;
  RUNTIME_SECRET?:string;
  AUTHORITY_READER_SECRET?:string;
  AUTHORITY_PUBLICATION_MODE?:string;
  AUTHORITY_PUBLISHER_SECRET?:string;
  AUTHORITY_OWNER_SECRET?:string;
  AUTHORITY_REVOKER_SECRET?:string;
  AUTHORITY_PUBLISHER_PRINCIPAL?:string;
  AUTHORITY_OWNER_PRINCIPAL?:string;
  AUTHORITY_REVOKER_PRINCIPAL?:string;
  AUTHORITY_APPROVAL_VERIFIER?:IncumbentApprovalVerifier;
}
export type PublicationTransport=(operation:"COMMIT"|"STATUS",requestId:string)=>Promise<Finality>;
type StoredGrant={grant_id:string;request_id:string;envelope:string;revoker:string;expires_unix:number};
const grantQuery="SELECT grant_id,request_id,envelope,revoker,expires_unix FROM authority_boundary_grant_envelope WHERE request_id=?";
const reply=(body:unknown,status:number)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
const deny=(error:string,status=403)=>reply({status:"DENIED",error},status);
const token=(s:unknown):s is string=>typeof s==="string"&&/^[A-Za-z0-9._:-]{1,256}$/.test(s);
const roles=(env:PublicationBindingEnv)=>[
  {secret:env.AUTHORITY_PUBLISHER_SECRET,actor:env.AUTHORITY_PUBLISHER_PRINCIPAL,role:"publisher"},
  {secret:env.AUTHORITY_OWNER_SECRET,actor:env.AUTHORITY_OWNER_PRINCIPAL,role:"owner"},
  {secret:env.AUTHORITY_REVOKER_SECRET,actor:env.AUTHORITY_REVOKER_PRINCIPAL,role:"revoker"}
] as const;
async function grant(db:AuthorityDB,id:string):Promise<StoredGrant|null>{
  return db.withSession("first-primary").prepare(grantQuery).bind(id).first<StoredGrant>();
}
function grantMatches(g:StoredGrant,a:VerifiedApproval):boolean{
  return g.grant_id===a.request.grantId&&g.request_id===a.request.requestId&&
    g.envelope===publicationEnvelope(a.request)&&g.revoker===a.revoker&&g.expires_unix===a.expiresUnix;
}
export async function handlePublicationOperation(http:Request,env:PublicationBindingEnv):Promise<Response>{
  const url=new URL(http.url);
  if(http.method!=="POST"||url.pathname!==PUBLICATION_PATH||url.search)return deny("OPERATION_DENIED",405);
  const identities=roles(env);
  const secrets=[env.RUNTIME_SECRET,env.AUTHORITY_READER_SECRET,...identities.map(x=>x.secret)];
  if(env.AUTHORITY_PUBLICATION_MODE!=="ISOLATED_ONLY"||!env.AUTHORITY_APPROVAL_VERIFIER||
    secrets.some(s=>typeof s!=="string"||!s.length)||new Set(secrets).size!==secrets.length||
    identities.some(x=>!token(x.actor)))return deny("INCUMBENT_BINDING_UNAVAILABLE",503);
  const principal=identities.find(x=>http.headers.get("Authorization")==="Bearer "+x.secret);
  if(!principal||!principal.actor)return deny("UNAUTHORIZED",401);
  let input:unknown;try{input=await http.json()}catch{return deny("INVALID_REQUEST",400)}
  if(!input||typeof input!=="object"||Array.isArray(input))return deny("INVALID_REQUEST",400);
  const obj=input as Record<string,unknown>,op=obj.operation,id=obj.requestId;
  if(Object.keys(obj).length!==2||!token(id)||!(op==="ISSUE"||op==="COMMIT"||op==="REVOKE"||op==="STATUS"))return deny("INVALID_REQUEST",400);
  if((op==="ISSUE"&&principal.role!=="owner")||(op==="COMMIT"&&principal.role!=="publisher")||
    (op==="REVOKE"&&principal.role!=="revoker")||(op==="STATUS"&&principal.role==="owner"))return deny("ROLE_DENIED");
  const db=env.DB as AuthorityDB;
  if(!db||typeof db.withSession!=="function")return deny("PRIMARY_UNAVAILABLE",503);
  try{
    const a=await env.AUTHORITY_APPROVAL_VERIFIER.resolve(id,op);
    if(!a||a.selector!=="D1"||a.request.requestId!==id||!token(a.request.sessionId)||
      !token(a.request.changeSpecId)||!token(a.request.pcvId)||!/^FAA2_[a-f0-9]{64}$/.test(a.request.faa2Id)||
      !Number.isSafeInteger(a.expiresUnix)||
      (principal.role==="publisher"&&a.request.publisher!==principal.actor)||
      (principal.role==="owner"&&a.issuer!==principal.actor)||
      (principal.role==="revoker"&&a.revoker!==principal.actor))return deny("EXACT_APPROVAL_OR_IDENTITY_DENIED");
    const r=a.request;
    const envelope=publicationEnvelope(r);
    const expected=parseAuthorityGeneration({tuple:r.expected,dependenciesJson:r.expectedDependencies});
    parseAuthorityGeneration({tuple:r.target,dependenciesJson:r.targetDependencies});
    const c={actor:principal.actor,sessionId:r.sessionId,frozenIdentity:r.frozenIdentity,eligible:a.eligible===true&&a.sessionOpen===true};
    let g=await grant(db,id);
    if(g&&!grantMatches(g,a))return deny("GRANT_IDENTITY_CONFLICT",409);
    if(op==="STATUS")return g?reply(await publicationStatus(db,r,c),200):reply({status:"UNKNOWN"},200);
    if(!c.eligible)return deny("SESSION_OR_APPROVAL_CLOSED");
    if(g){
      const terminal=await publicationStatus(db,r,c);
      // A terminal receipt closes this immutable grant/session for mutation.
      // Read-only status remains a separate operation.
      if(terminal.status!=="UNKNOWN")return deny("TERMINAL_OR_CONFLICT",409);
    }
    if(op==="ISSUE"){
      if(g)return deny("GRANT_ALREADY_EXISTS",409);
      if(a.expiresUnix<=Math.floor(Date.now()/1000))return deny("APPROVAL_EXPIRED");
      if(!sameGeneration(expected,await readAuthorityGeneration(db)))return deny("STALE_GENERATION",409);
      // Predecessor and expiry checked again inside the issuing INSERT.
      const sql="INSERT INTO authority_boundary_grant (grant_id,request_id,publisher,session_id,revoker,expected_tuple,target_tuple,expected_dependencies,target_dependencies,frozen_identity,change_spec_id,pcv_id,faa2_id,expires_unix) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM authority_boundary_current WHERE tuple_json=? AND dependencies_json=?) AND ?>CAST(strftime('%s','now') AS INTEGER)";
      const tuple=JSON.stringify(r.expected);
      try{await db.prepare(sql).bind(r.grantId,r.requestId,r.publisher,r.sessionId,a.revoker,tuple,JSON.stringify(r.target),r.expectedDependencies,r.targetDependencies,r.frozenIdentity,r.changeSpecId,r.pcvId,r.faa2Id,a.expiresUnix,tuple,r.expectedDependencies,a.expiresUnix).run()}catch{/* reconcile exact readback, never retry */}
      g=await grant(db,id);
      return g&&grantMatches(g,a)&&g.envelope===envelope?reply({status:"ISSUED",requestId:id},200):reply({status:"UNKNOWN"},503);
    }
    if(!g)return deny("GRANT_MISSING");
    if(op==="COMMIT"){
      if(a.expiresUnix<=Math.floor(Date.now()/1000))return deny("APPROVAL_EXPIRED");
      if(!sameGeneration(expected,await readAuthorityGeneration(db)))return deny("STALE_GENERATION",409);
    }
    return reply(await publicationAttempt(db,r,c,op==="COMMIT"?"COMMITTED":"CANCELED"),200);
  }catch{return deny("PUBLICATION_PRECONDITION_UNAVAILABLE",503)}
}

