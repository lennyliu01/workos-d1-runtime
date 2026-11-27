// Unbound candidate for the existing Worker and incumbent CUTOVER_EXECUTOR.
// No HTTP route, credential issuance, Grant issuance or production selector activation.
interface Statement {
  bind(...values: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
}
interface PrimarySession { prepare(sql: string): Statement }
export interface AuthorityDB extends PrimarySession { withSession(constraint: 'first-primary'): PrimarySession }
export type AuthorityTuple = readonly [string,string,number,string,string,string,string,string];
export interface PublicationRequest {
  grantId: string; requestId: string; publisher: string; sessionId: string;
  expected: AuthorityTuple; target: AuthorityTuple;
  expectedDependencies: string; targetDependencies: string; frozenIdentity: string;
  changeSpecId: string; pcvId: string; faa2Id: string;
}
// Must originate from the authenticated incumbent provider boundary, NEVER HTTP body.
// Actual mapping / fresh owner-side preconditions are intentionally not implemented here.
export interface TrustedPublicationContext { actor: string; sessionId: string; frozenIdentity: string; eligible: boolean }
export interface Receipt { request_id: string; grant_id: string; envelope: string; outcome: 'COMMITTED'|'CANCELED'; epoch: number|null; recorded_at: string }
export type Finality = { status: 'COMMITTED'|'CANCELED'; receipt: Receipt } | { status: 'UNKNOWN'|'CONFLICT'|'DENIED' };
const tupleValid = (v: AuthorityTuple): boolean => Array.isArray(v) && v.length===8 && v.every((x,i)=>i===2?Number.isSafeInteger(x)&&Number(x)>=0:typeof x==='string'&&x.length>0);
export function publicationEnvelope(r: PublicationRequest): string {
  if (!tupleValid(r.expected)||!tupleValid(r.target)||r.expected[0]!==r.target[0]||r.target[2]!==r.expected[2]+1) throw new Error('INVALID_TUPLE');
  for(const x of [r.expectedDependencies,r.targetDependencies,r.frozenIdentity]) {
    const o: unknown=JSON.parse(x); if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).length===0) throw new Error('INVALID_DEPENDENCIES');
  }
  const fields=[r.grantId,r.requestId,r.publisher,r.sessionId,JSON.stringify(r.expected),JSON.stringify(r.target),r.expectedDependencies,r.targetDependencies,r.frozenIdentity,r.changeSpecId,r.pcvId,r.faa2Id];
  if(fields.some(x=>typeof x!=='string'||!x.length)) throw new Error('INVALID_ENVELOPE');
  return JSON.stringify(fields);
}
interface Grant { grant_id:string; request_id:string; publisher:string; revoker:string; session_id:string; envelope:string }
const grantSQL='SELECT grant_id,request_id,publisher,revoker,session_id,envelope FROM authority_boundary_grant_envelope WHERE request_id=?';
const receiptSQL='SELECT request_id,grant_id,envelope,outcome,epoch,recorded_at FROM authority_boundary_terminal WHERE request_id=?';
export async function publicationStatus(db: AuthorityDB,r: PublicationRequest,c: TrustedPublicationContext): Promise<Finality> {
  let envelope:string; try{envelope=publicationEnvelope(r)}catch{return {status:'CONFLICT'}}
  try {
    const primary=db.withSession('first-primary');
    const g=await primary.prepare(grantSQL).bind(r.requestId).first<Grant>();
    if(!g)return {status:'UNKNOWN'};
    if(c.sessionId!==g.session_id||(c.actor!==g.publisher&&c.actor!==g.revoker))return {status:'DENIED'};
    if(g.envelope!==envelope||g.grant_id!==r.grantId)return {status:'CONFLICT'};
    // Independently primary-first; a missing receipt is never proof of non-commit.
    const receipt=await db.withSession('first-primary').prepare(receiptSQL).bind(r.requestId).first<Receipt>();
    if(!receipt)return {status:'UNKNOWN'};
    if(receipt.envelope!==envelope||receipt.grant_id!==r.grantId)return {status:'CONFLICT'};
    return {status:receipt.outcome,receipt};
  }catch{return {status:'UNKNOWN'}}
}
export async function publicationAttempt(db: AuthorityDB,r: PublicationRequest,c: TrustedPublicationContext,outcome:'COMMITTED'|'CANCELED'): Promise<Finality> {
  if(!c.eligible||c.sessionId!==r.sessionId||(outcome==='COMMITTED'&&c.frozenIdentity!==r.frozenIdentity))return {status:'DENIED'};
  let envelope:string; try{envelope=publicationEnvelope(r)}catch{return {status:'CONFLICT'}}
  const known=await publicationStatus(db,r,c);
  if(known.status!=='UNKNOWN')return known;
  if(outcome==='COMMITTED') {
    try {
      const claim=await db.prepare('INSERT INTO authority_boundary_started (request_id,grant_id,envelope,actor,session_id,frozen_identity) VALUES (?,?,?,?,?,?)')
        .bind(r.requestId,r.grantId,envelope,c.actor,c.sessionId,c.frozenIdentity).run();
      if(!claim.success||claim.meta?.changes!==1)return publicationStatus(db,r,c);
    }catch{return publicationStatus(db,r,c)}
  }
  // Only the confirmed first claim may dispatch commit; lost claim/commit stays UNKNOWN.
  // No retry loop. Grant, complete predecessor, frozen identity, expiry and terminal uniqueness
  // are enforced in the single INSERT by the database trigger and unique constraints.
  try {
    await db.prepare('INSERT INTO authority_boundary_terminal (request_id,grant_id,envelope,outcome,epoch,actor,session_id,frozen_identity) VALUES (?,?,?,?,?,?,?,?)')
      .bind(r.requestId,r.grantId,envelope,outcome,outcome==='COMMITTED'?r.target[2]:null,c.actor,c.sessionId,r.frozenIdentity).run();
  }catch{/* May be rejected or may have committed before response loss. Reconcile once. */}
  return publicationStatus(db,r,c);
}
export async function readAuthorityGeneration(db: AuthorityDB): Promise<{tuple: AuthorityTuple; dependenciesJson: string}> {
  const row=await db.withSession('first-primary').prepare('SELECT tuple_json,dependencies_json FROM authority_boundary_current').first<{tuple_json:string;dependencies_json:string}>();
  if(!row)throw new Error('AUTHORITY_UNAVAILABLE');
  const tuple=JSON.parse(row.tuple_json) as AuthorityTuple;
  if(!tupleValid(tuple))throw new Error('AUTHORITY_TUPLE_INVALID');
  return {tuple,dependenciesJson:row.dependencies_json};
}
