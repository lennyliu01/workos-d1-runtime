/**
 * D1 authority selector CAS — ISOLATED CANDIDATE, never deployed as authority.
 * No endpoint, live issuer, reader switch, Grant creation or production migration.
 * Reuses the existing WorkOS D1 bindings/table shapes; does not modify R4 Gate.
 * An external, accepted owner must validate source fingerprints and bundle inputs.
 */
export interface CandidateD1Run {success:boolean;meta?:{changes?:number}}
export interface CandidateD1Statement {
  bind(...values:unknown[]):CandidateD1Statement;
  first<T=Record<string,unknown>>():Promise<T|null>;
  run():Promise<CandidateD1Run>;
}
export interface CandidateD1 {prepare(sql:string):CandidateD1Statement}
export interface Pointer {
  selector_key:"CURRENT";
  epoch:number;
  previous_epoch:number;
  source_fingerprint:string;
  bundle_fingerprint:string;
  bundle_json:string;
  publication_id:string;
  publisher_invocation_id:string;
  status:"COMMITTED";
  committed_at:string;
}
export interface PublishRequest {
  expected:{epoch:number;sourceFingerprint:string;bundleFingerprint:string};
  next:{epoch:number;sourceFingerprint:string;bundleFingerprint:string;bundleJson:string;
    publicationId:string;publisherInvocationId:string};
}
export type PublishOutcome =
  | {status:"COMMITTED"|"RECOVERED_OWN_COMMIT";pointer:Pointer}
  | {status:"CONFLICT"|"UNKNOWN";reason:string};
export interface GenerationFence {epoch:number;sourceFingerprint:string;bundleFingerprint:string}
const HEX=/^[0-9a-f]{64}$/;
const IDENT=/^[A-Za-z0-9._:-]{1,160}$/;
export async function sha256Exact(text:string):Promise<string>{
  const bytes=new TextEncoder().encode(text);
  const hash=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
function assertFingerprint(v:string):void {
  if(!HEX.test(v))throw new Error("INVALID_FINGERPRINT");
}
export async function readCandidatePointer(db:CandidateD1):Promise<Pointer>{
  const row=await db.prepare(
    "SELECT selector_key,epoch,previous_epoch,source_fingerprint,bundle_fingerprint,bundle_json,publication_id,publisher_invocation_id,status,committed_at FROM workos_authority_pointer_candidate WHERE selector_key='CURRENT'"
  ).first<Pointer>();
  if(!row)throw new Error("CURRENT_UNAVAILABLE");
  if(row.selector_key!=="CURRENT"||row.status!=="COMMITTED"||
     !Number.isSafeInteger(row.epoch)||!Number.isSafeInteger(row.previous_epoch)||
     row.previous_epoch>=row.epoch||!IDENT.test(row.publication_id)||
     !IDENT.test(row.publisher_invocation_id))throw new Error("CURRENT_CORRUPT");
  assertFingerprint(row.source_fingerprint);
  assertFingerprint(row.bundle_fingerprint);
  if(await sha256Exact(row.bundle_json)!==row.bundle_fingerprint)throw new Error("BUNDLE_DRIFT");
  return row;
}
export async function assertPublishRequest(r:PublishRequest):Promise<void>{
  if(!Number.isSafeInteger(r.expected.epoch)||r.expected.epoch<0||
     !Number.isSafeInteger(r.next.epoch)||r.next.epoch!==r.expected.epoch+1||
     !IDENT.test(r.next.publicationId)||!IDENT.test(r.next.publisherInvocationId))
    throw new Error("INVALID_PUBLICATION_SHAPE");
  for(const f of [r.expected.sourceFingerprint,r.expected.bundleFingerprint,
    r.next.sourceFingerprint,r.next.bundleFingerprint])assertFingerprint(f);
  if(!r.next.bundleJson||typeof JSON.parse(r.next.bundleJson)!=="object"||
     JSON.parse(r.next.bundleJson)===null||Array.isArray(JSON.parse(r.next.bundleJson)))
    throw new Error("INVALID_BUNDLE");
  if(await sha256Exact(r.next.bundleJson)!==r.next.bundleFingerprint)
    throw new Error("TARGET_BUNDLE_DRIFT");
}
function isOwn(p:Pointer,r:PublishRequest):boolean {
  return p.epoch===r.next.epoch&&p.previous_epoch===r.expected.epoch&&
    p.source_fingerprint===r.next.sourceFingerprint&&
    p.bundle_fingerprint===r.next.bundleFingerprint&&
    p.bundle_json===r.next.bundleJson&&
    p.publication_id===r.next.publicationId&&
    p.publisher_invocation_id===r.next.publisherInvocationId&&p.status==="COMMITTED";
}
/** Ambiguous outcomes may ONLY be reconciled by exact own invocation and content. */
export async function recoverOwnCandidateCommit(db:CandidateD1,r:PublishRequest):Promise<PublishOutcome>{
  await assertPublishRequest(r);
  try {
    const p=await readCandidatePointer(db);
    return isOwn(p,r)?{status:"RECOVERED_OWN_COMMIT",pointer:p}
      :{status:"UNKNOWN",reason:"NOT_EXACT_OWN_INVOCATION_OR_SUPERSEDED"};
  }catch{return {status:"UNKNOWN",reason:"READBACK_UNAVAILABLE_OR_DRIFT"};}
}
/** One UPDATE is the native D1/SQLite CAS. No blind retries. */
export async function publishCandidatePointer(db:CandidateD1,r:PublishRequest):Promise<PublishOutcome>{
  await assertPublishRequest(r);
  let res:CandidateD1Run;
  try {
    res=await db.prepare(`UPDATE workos_authority_pointer_candidate
      SET epoch=?,previous_epoch=?,source_fingerprint=?,bundle_fingerprint=?,
          bundle_json=?,publication_id=?,publisher_invocation_id=?,
          status='COMMITTED',committed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE selector_key='CURRENT' AND epoch=? AND source_fingerprint=?
        AND bundle_fingerprint=? AND publisher_invocation_id<>? AND publication_id<>?`)
      .bind(r.next.epoch,r.expected.epoch,r.next.sourceFingerprint,r.next.bundleFingerprint,
        r.next.bundleJson,r.next.publicationId,r.next.publisherInvocationId,
        r.expected.epoch,r.expected.sourceFingerprint,r.expected.bundleFingerprint,
        r.next.publisherInvocationId,r.next.publicationId).run();
  }catch{
    return recoverOwnCandidateCommit(db,r);
  }
  if(res.success!==true)return recoverOwnCandidateCommit(db,r);
  if(res.meta?.changes!==1)return {status:"CONFLICT",reason:"NATIVE_CAS_ZERO_ROWS"};
  try {
    const p=await readCandidatePointer(db);
    return isOwn(p,r)?{status:"COMMITTED",pointer:p}
      :{status:"UNKNOWN",reason:"POST_COMMIT_READBACK_NOT_EXACT_OWN_INVOCATION"};
  }catch{return {status:"UNKNOWN",reason:"POST_COMMIT_READBACK_FAILED"};}
}
/**
 * Example of a same-statement D1 generation fence for existing current-state
 * version INSERT. This is NOT an alternate Grant authorization path: only a
 * trusted, already-authorized Worker should invoke it after existing Gate checks.
 * The production Worker has deliberately NOT been wired to this candidate.
 */
export async function candidateFencedCurrentInsert(
  db:CandidateD1, g:GenerationFence,
  write:{datasetId:string;instanceId:string;expectedVersion:number;
    payloadJson:string;invocationId:string;idempotencyKey:string}
):Promise<boolean>{
  if(!Number.isSafeInteger(g.epoch)||g.epoch<0||
     !Number.isSafeInteger(write.expectedVersion)||write.expectedVersion<0)
    throw new Error("INVALID_FENCE_INPUT");
  assertFingerprint(g.sourceFingerprint);assertFingerprint(g.bundleFingerprint);
  const base=`INSERT INTO workos_current_state_versions
    (dataset_id,instance_id,version,previous_version,payload_json,invocation_id,idempotency_key,db_written_at)`;
  let result:CandidateD1Run;
  if(write.expectedVersion===0){
    result=await db.prepare(base+` SELECT ?,?,1,0,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE EXISTS (SELECT 1 FROM workos_authority_pointer_candidate
        WHERE selector_key='CURRENT' AND epoch=? AND source_fingerprint=? AND bundle_fingerprint=?)
      AND NOT EXISTS (SELECT 1 FROM workos_current_state_versions
        WHERE dataset_id=? AND instance_id=?)`)
      .bind(write.datasetId,write.instanceId,write.payloadJson,write.invocationId,write.idempotencyKey,
        g.epoch,g.sourceFingerprint,g.bundleFingerprint,write.datasetId,write.instanceId).run();
  }else{
    result=await db.prepare(base+` SELECT ?,?,latest.version+1,latest.version,?,?,?,
      strftime('%Y-%m-%dT%H:%M:%fZ','now')
      FROM (SELECT version FROM workos_current_state_versions
        WHERE dataset_id=? AND instance_id=? ORDER BY version DESC LIMIT 1) AS latest
      WHERE latest.version=? AND EXISTS
        (SELECT 1 FROM workos_authority_pointer_candidate
          WHERE selector_key='CURRENT' AND epoch=? AND source_fingerprint=? AND bundle_fingerprint=?)`)
      .bind(write.datasetId,write.instanceId,write.payloadJson,write.invocationId,write.idempotencyKey,
        write.datasetId,write.instanceId,write.expectedVersion,
        g.epoch,g.sourceFingerprint,g.bundleFingerprint).run();
  }
  if(!result.success)throw new Error("FENCED_WRITE_AMBIGUOUS");
  return result.meta?.changes===1;
}
/** Same-statement generation fence for the existing FX append-only table. */
export async function candidateFencedAppendInsert(
  db:CandidateD1,g:GenerationFence,
  write:{datasetId:string;instanceId:string;recordKey:string;payloadJson:string;
    invocationId:string;idempotencyKey:string}
):Promise<boolean>{
  assertFingerprint(g.sourceFingerprint);assertFingerprint(g.bundleFingerprint);
  const result=await db.prepare(`INSERT INTO workos_append_records
    (dataset_id,instance_id,record_key,payload_json,invocation_id,idempotency_key,db_written_at)
    SELECT ?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE EXISTS (SELECT 1 FROM workos_authority_pointer_candidate
      WHERE selector_key='CURRENT' AND epoch=? AND source_fingerprint=? AND bundle_fingerprint=?)`)
    .bind(write.datasetId,write.instanceId,write.recordKey,write.payloadJson,write.invocationId,
      write.idempotencyKey,g.epoch,g.sourceFingerprint,g.bundleFingerprint).run();
  if(!result.success)throw new Error("FENCED_APPEND_AMBIGUOUS");
  return result.meta?.changes===1;
}
