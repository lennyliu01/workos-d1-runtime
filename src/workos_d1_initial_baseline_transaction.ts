/**
 * R3 candidate. Publisher-issued Grant eligibility is verified earlier from
 * the ACTIVE Manifest. This is ONLY the durable consumption executor.
 *
 * Cloudflare D1 batch is transactional: state v0->v1 and consumption record
 * commit or roll back together. No grant is consumed by a pre-write HTTP call.
 * A duplicate/invalid ledger insert aborts the batch, rolling back state.
 */
export interface InitialGrantScope {
  authorityFingerprint:string;
  activationEpoch:string;
  manifestId:string;
  datasetId:"RW_CURRENT_STATE";
  instanceId:string;
  idempotencyKey:string;
}
export interface Statement {
  bind(...values:unknown[]):Statement;
}
export interface BatchResult {success:boolean;meta?:{changes?:number}}
export interface BatchD1 {
  prepare(sql:string):Statement;
  batch(statements:Statement[]):Promise<BatchResult[]>;
}
export async function atomicInitialBaselineInsert(
  db:BatchD1,scope:InitialGrantScope,payloadJson:string,
  payloadSha256:string,invocationId:string,
):Promise<void>{
  if(scope.datasetId!=="RW_CURRENT_STATE" ||
      !scope.authorityFingerprint || !scope.activationEpoch ||
      !scope.manifestId || !scope.instanceId || !scope.idempotencyKey ||
      !/^[0-9a-f]{64}$/.test(payloadSha256) ||
      !/^[0-9a-f-]{36}$/.test(invocationId)) {
    throw new Error("INITIAL_GRANT_SCOPE_INVALID");
  }
  const state=db.prepare(
    "INSERT INTO workos_current_state_versions "+
    "(dataset_id,instance_id,version,previous_version,payload_json,invocation_id,idempotency_key,db_written_at) "+
    "SELECT ?,?,1,0,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now') "+
    "WHERE NOT EXISTS (SELECT 1 FROM workos_current_state_versions WHERE dataset_id=? AND instance_id=?)"
  ).bind(scope.datasetId,scope.instanceId,payloadJson,invocationId,scope.idempotencyKey,
         scope.datasetId,scope.instanceId);

  // The invocation_id subquery MUST resolve exactly the first statement's
  // inserted version-1 row. If no row was inserted (stale/concurrent writer),
  // NOT NULL raises a constraint error, making D1 roll back the whole batch.
  const consume=db.prepare(
    "INSERT INTO workos_initial_baseline_consumptions "+
    "(authority_scope_fingerprint,activation_epoch,manifest_id,dataset_id,instance_id,"+
    "idempotency_key,payload_sha256,invocation_id,db_consumed_at) "+
    "VALUES (?,?,?,?,?,?,?,("+
    "SELECT invocation_id FROM workos_current_state_versions "+
    "WHERE dataset_id=? AND instance_id=? AND invocation_id=? AND version=1 "+
    "AND previous_version=0 AND idempotency_key=? AND payload_json=? LIMIT 1"+
    "),strftime('%Y-%m-%dT%H:%M:%fZ','now'))"
  ).bind(scope.authorityFingerprint,scope.activationEpoch,scope.manifestId,
         scope.datasetId,scope.instanceId,scope.idempotencyKey,payloadSha256,
         scope.datasetId,scope.instanceId,invocationId,scope.idempotencyKey,payloadJson);
  const result=await db.batch([state,consume]);
  if(result.length!==2 || result.some(x=>!x.success || x.meta?.changes!==1)) {
    // No retry. If D1's result is ambiguous, reconcile exact postconditions.
    throw new Error("INITIAL_GRANT_ATOMIC_POSTCONDITION_UNVERIFIED");
  }
}
