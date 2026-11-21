/**
 * CANDIDATE ONLY — No production route, signer service or new Publisher.
 * A future approved WorkOS authority reader and independently admitted native
 * provider event verifier must be wired before this can be invoked.
 * GitHub login, Google Drive ACL, chat and Agent Relay are NOT owner decisions.
 */
export const SCOPE_KEY = "RW_BATCH07_RW_CURRENT_STATE_OWNER_REVIEW_20261014" as const;
export const DATASET_ID = "RW_CURRENT_STATE" as const;
export const CODE_HEAD = "d6b90092ae9832c1c2823e1b843b380dc01fa691" as const;
export const REGISTRY_CONTRACT_FINGERPRINT =
  "ddf697bdeefa21d669e2ba8c02e12fe056e20b2cdb04ff29df9b0cb1bacadb4e" as const;
const INSTANCES = ["DSG","DOL","WSP","GIBA","NA","ENB","ATD"] as const;
const FIELDS = [
  "Company_ID","Company_Name","Ticker","Exchange","Currency",
  "State_As_Of","Base_Source_Materials","Structured_State_Content",
] as const;
const HEX64=/^[0-9a-f]{64}$/;
const SAFE_REF=/^[A-Za-z0-9._:/@#-]{1,512}$/;
const ISO_TIME=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/;
const REVIEW_ITEMS = [
  "EIGHT_FIELD_NULL_SEMANTICS",
  "FROZEN_RESEARCH_FIDELITY",
  "ROLE_DECODER_AND_UNACCEPTED_FACT_EXCLUSION",
  "DATASET_INSTANCE_IDENTITY",
  "D1_INITIALIZATION_WRITE_AND_VERSION1_READBACK_CONTRACT",
] as const;
export type ReviewItem = typeof REVIEW_ITEMS[number];
export type Decision = "ACCEPT" | "REJECT";

/** Only the currently accepted server-side governance projection may supply this. */
export interface ActiveOwnerReviewBinding {
  state:"ACTIVE";
  scopeKey:typeof SCOPE_KEY;
  owner:"ROLLING_WEDGE_WORKFLOW";
  datasetId:typeof DATASET_ID;
  instances:readonly string[];
  fields:readonly string[];
  candidateCodeSha:typeof CODE_HEAD;
  registryContractFingerprint:typeof REGISTRY_CONTRACT_FINGERPRINT;
  sealedChangeSpecSha256:string;
  frozenSubjectSha256:string;
  provider:string;
  authorizedHumanProviderId:string;
  authorizationIssuerRef:string;
  nativeEventVerifierRef:string;
  notBefore:string;
  expiresAt:string;
}
/** Only an independently authenticated provider adapter may return this. */
export interface VerifiedNativeOwnerDecision {
  provider:string;
  nativeEventId:string;
  nativeEventDigest:string;
  attributableHumanProviderId:string;
  nativeEventAt:string;
  authorizedIssuerRef:string;
  verifierRef:string;
  evidenceAnchorRef:string;
  exactSubjectSha256:string;
  fiveChecks:readonly {item:ReviewItem;decision:Decision}[];
  overall:Decision;
  revoked:false;
}
export interface CurrentOwnerAuthorityReader {
  readExactBinding():Promise<ActiveOwnerReviewBinding|null>;
}
export interface NativeEventVerifier {
  verifyExact(ref:string,binding:ActiveOwnerReviewBinding):Promise<VerifiedNativeOwnerDecision|null>;
}
export interface OneRowD1Statement {
  bind(...values:unknown[]):OneRowD1Statement;
  run():Promise<{success:boolean;meta?:{changes?:number}}>;
  first<T>():Promise<T|null>;
}
export interface OneRowD1 {prepare(sql:string):OneRowD1Statement}
export type TerminalReceipt = Readonly<{
  scopeKey:typeof SCOPE_KEY;status:"COMMITTED_VERIFIED";decision:Decision;
  eventId:string;subjectSha256:string;eventDigest:string;
}>;
function validTime(value:string):number|null {
  if(!ISO_TIME.test(value))return null;
  const n=Date.parse(value);return Number.isFinite(n)?n:null;
}
function exact(a:readonly string[],b:readonly string[]):boolean {
  return a.length===b.length&&a.every((x,i)=>x===b[i]);
}
function checkBinding(b:ActiveOwnerReviewBinding|null,now:number):b is ActiveOwnerReviewBinding {
  if(!b||b.state!=="ACTIVE"||b.scopeKey!==SCOPE_KEY||
     b.owner!=="ROLLING_WEDGE_WORKFLOW"||b.datasetId!==DATASET_ID||
     !exact(b.instances,INSTANCES)||!exact(b.fields,FIELDS)||
     b.candidateCodeSha!==CODE_HEAD||
     b.registryContractFingerprint!==REGISTRY_CONTRACT_FINGERPRINT||
     !HEX64.test(b.sealedChangeSpecSha256)||
     !HEX64.test(b.frozenSubjectSha256)||!b.provider||
     !SAFE_REF.test(b.authorizedHumanProviderId)||
     !SAFE_REF.test(b.authorizationIssuerRef)||
     !SAFE_REF.test(b.nativeEventVerifierRef))return false;
  const from=validTime(b.notBefore),until=validTime(b.expiresAt);
  return from!==null&&until!==null&&from<=now&&now<until;
}
function checkNativeEvent(e:VerifiedNativeOwnerDecision|null,b:ActiveOwnerReviewBinding,now:number):e is VerifiedNativeOwnerDecision {
  if(!e||e.provider!==b.provider||
     e.attributableHumanProviderId!==b.authorizedHumanProviderId||
     e.authorizedIssuerRef!==b.authorizationIssuerRef||
     e.verifierRef!==b.nativeEventVerifierRef||
     e.exactSubjectSha256!==b.frozenSubjectSha256||
     !HEX64.test(e.nativeEventDigest)||
     !SAFE_REF.test(e.nativeEventId)||
     !SAFE_REF.test(e.evidenceAnchorRef)||
     e.revoked!==false||
     !["ACCEPT","REJECT"].includes(e.overall)||
     e.fiveChecks.length!==REVIEW_ITEMS.length)return false;
  const at=validTime(e.nativeEventAt);
  if(at===null||at>now||at<(validTime(b.notBefore)??Infinity)||
     at>=(validTime(b.expiresAt)??-Infinity))return false;
  if(!e.fiveChecks.every((c,i)=>
    c.item===REVIEW_ITEMS[i]&&(c.decision==="ACCEPT"||c.decision==="REJECT")))return false;
  const allAccept=e.fiveChecks.every(x=>x.decision==="ACCEPT");
  return (e.overall==="ACCEPT")===allAccept;
}
const INSERT=`INSERT INTO workos_batch07_owner_terminal_decision
(scope_key,subject_sha256,change_spec_sha256,decision,checks_json,
provider,actor_provider_id,native_event_id,native_event_digest,
native_event_at,issuer_ref,verifier_ref,evidence_anchor_ref,committed_at)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;
const READ=`SELECT scope_key,subject_sha256,change_spec_sha256,decision,
checks_json,provider,actor_provider_id,native_event_id,native_event_digest,
native_event_at,issuer_ref,verifier_ref,evidence_anchor_ref
FROM workos_batch07_owner_terminal_decision WHERE scope_key=?`;
type Row={scope_key:string;subject_sha256:string;change_spec_sha256:string;
  decision:string;checks_json:string;provider:string;actor_provider_id:string;
  native_event_id:string;native_event_digest:string;native_event_at:string;
  issuer_ref:string;verifier_ref:string;evidence_anchor_ref:string};

/** Candidate-only; deliberately not registered in Worker src/index.ts. */
export async function submitCandidateOwnerDecision(
  eventRef:string,
  deps:{authority:CurrentOwnerAuthorityReader;events:NativeEventVerifier;db:OneRowD1},
  now:number=Date.now(),
):Promise<TerminalReceipt>{
  if(!SAFE_REF.test(eventRef)||!Number.isFinite(now))
    throw new Error("OWNER_EVENT_REFERENCE_INVALID");
  const binding=await deps.authority.readExactBinding();
  if(!checkBinding(binding,now))
    throw new Error("OWNER_AUTHORITY_NOT_ACTIVE_OR_EXPIRED");
  const proof=await deps.events.verifyExact(eventRef,binding);
  if(!checkNativeEvent(proof,binding,now))
    throw new Error("OWNER_NATIVE_EVENT_NOT_VERIFIED");
  const values=[
    SCOPE_KEY,binding.frozenSubjectSha256,binding.sealedChangeSpecSha256,
    proof.overall,JSON.stringify(proof.fiveChecks),
    proof.provider,proof.attributableHumanProviderId,proof.nativeEventId,
    proof.nativeEventDigest,proof.nativeEventAt,proof.authorizedIssuerRef,
    proof.verifierRef,proof.evidenceAnchorRef,
  ] as const;
  try{
    const result=await deps.db.prepare(INSERT).bind(...values).run();
    if(!result.success||result.meta?.changes!==1)
      throw new Error("OWNER_TERMINAL_COMMIT_UNCERTAIN");
  }catch{
    // Conflict, retry and ambiguous provider result all STOP. Never blindly retry.
    throw new Error("OWNER_TERMINAL_CONFLICT_OR_UNCERTAIN");
  }
  let row:Row|null;
  try{row=await deps.db.prepare(READ).bind(SCOPE_KEY).first<Row>();}
  catch{throw new Error("OWNER_TERMINAL_READBACK_UNAVAILABLE");}
  const columns=[
    "scope_key","subject_sha256","change_spec_sha256","decision",
    "checks_json","provider","actor_provider_id","native_event_id",
    "native_event_digest","native_event_at","issuer_ref","verifier_ref","evidence_anchor_ref",
  ] as const;
  if(!row||Object.keys(row).length!==values.length||
     values.some((v,i)=>row![columns[i]]!==v))
    throw new Error("OWNER_TERMINAL_READBACK_MISMATCH");
  return {scopeKey:SCOPE_KEY,status:"COMMITTED_VERIFIED",
    decision:proof.overall,eventId:proof.nativeEventId,
    subjectSha256:binding.frozenSubjectSha256,eventDigest:proof.nativeEventDigest};
}
