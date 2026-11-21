/**
 * Batch07 R2: candidate-only GitHub-native review event validation.
 * Strictly NO Worker route, production issuer, provider credentials or signature
 * authority. Required future independent WorkOS reviewer/provider owner binding
 * is NOT materialized here.
 */
import {
  verifyGitHubWorkOsInvoker,
  type GitHubInvokerPolicy,
} from "./workos_github_oidc_invoker.js";
import {
  SCOPE_KEY,
  type ActiveOwnerReviewBinding,
  type NativeEventVerifier,
  type VerifiedNativeOwnerDecision,
  type Decision,
  type ReviewItem,
} from "./workos_batch07_owner_terminal_candidate.js";
import {serializeWorkOsPayload,sha256PayloadHex} from "./workos_canonical_payload.js";

const GITHUB="GITHUB_ACTIONS_OIDC";
const SHA40=/^[0-9a-f]{40}$/;
const SHA64=/^[0-9a-f]{64}$/;
const ID=/^[0-9]{1,20}$/;
const REF=/^[A-Za-z0-9._:/#@-]{1,512}$/;
const ITEMS=[
  "EIGHT_FIELD_NULL_SEMANTICS",
  "FROZEN_RESEARCH_FIDELITY",
  "ROLE_DECODER_AND_UNACCEPTED_FACT_EXCLUSION",
  "DATASET_INSTANCE_IDENTITY",
  "D1_INITIALIZATION_WRITE_AND_VERSION1_READBACK_CONTRACT",
] as const;

export interface ProviderWorkflowRun {
  id:number;
  repository_id:number;
  actor_id:number;
  triggering_actor_id:number;
  event:string;
  head_sha:string;
  path:string;
  run_attempt:number;
  created_at:string;
  status:"queued"|"in_progress"|"completed";
}
export interface NativeRunReader {
  /** Must fetch independently from provider-authenticated GitHub REST. */
  readExactWorkflowRun(id:string):Promise<ProviderWorkflowRun|null>;
}
export interface SignedDispatchReview {
  /** An independent accepted immutable anchor is required, NOT a job log. */
  externalAnchorRef:string;
  externalAnchorVerifierRef:string;
  sourceRunId:string;
  sourceRunAttempt:string;
  sourceActorId:string;
  exactSubjectSha256:string;
  nativeEventAt:string;
  fiveChecks:readonly {item:ReviewItem;decision:Decision}[];
  overall:Decision;
  nativeEventDigest:string;
  revoked:boolean;
}
export interface IndependentDispatchAnchorReader {
  /**
   * Only an independently verified approved provider-evidence adapter may
   * implement this. Self-reported event JSON, Relay, GH review and mutable
   * Action logs are not accepted.
   */
  readVerifiedAnchoredDispatch(runId:string,attempt:string):Promise<SignedDispatchReview|null>;
}
export interface ApprovedGitHubReviewPolicy {
  oidc:GitHubInvokerPolicy;
  expectedHeadSha:string;
  expectedRunPath:string;
}
export class CandidateGitHubNativeOwnerEventVerifier implements NativeEventVerifier {
  constructor(
    private readonly signedWorkloadJwt:string,
    private readonly policy:ApprovedGitHubReviewPolicy,
    private readonly runs:NativeRunReader,
    private readonly anchors:IndependentDispatchAnchorReader,
    private readonly fetchImpl:typeof fetch,
    private readonly nowEpochSeconds:number,
  ) {}

  async verifyExact(
    eventRef:string,binding:ActiveOwnerReviewBinding,
  ):Promise<VerifiedNativeOwnerDecision|null> {
    try{
      // R3 policy pins signed JWT issuer, JWKS, repo/workflow/ref/event/branch.
      if(binding.provider!==GITHUB||
         binding.scopeKey!==SCOPE_KEY||
         this.policy.oidc.eventName!=="workflow_dispatch"||
         !SHA40.test(this.policy.expectedHeadSha)||
         !REF.test(this.policy.expectedRunPath))return null;
      const invoker=await verifyGitHubWorkOsInvoker(
        this.signedWorkloadJwt,this.policy.oidc,this.fetchImpl,this.nowEpochSeconds);
      if(!invoker.actorId || !ID.test(invoker.actorId) ||
         invoker.actorId!==binding.authorizedHumanProviderId ||
         invoker.runAttempt!=="1" ||
         eventRef!==`github-actions-run:${invoker.runId}:1`) return null;
      const run=await this.runs.readExactWorkflowRun(invoker.runId);
      if(!run || !Number.isSafeInteger(run.id) ||
         String(run.id)!==invoker.runId ||
         !Number.isSafeInteger(run.repository_id) ||
         String(run.repository_id)!==invoker.repositoryId ||
         !Number.isSafeInteger(run.actor_id) ||
         String(run.actor_id)!==invoker.actorId ||
         !Number.isSafeInteger(run.triggering_actor_id) ||
         String(run.triggering_actor_id)!==invoker.actorId ||
         run.run_attempt!==1 ||
         run.event!=="workflow_dispatch" ||
         run.head_sha!==this.policy.expectedHeadSha ||
         run.path!==this.policy.expectedRunPath ||
         !["queued","in_progress","completed"].includes(run.status))return null;
      const anchored=await this.anchors.readVerifiedAnchoredDispatch(
        invoker.runId,invoker.runAttempt);
      if(!anchored || anchored.revoked ||
         !REF.test(anchored.externalAnchorRef)||
         anchored.externalAnchorVerifierRef!==binding.nativeEventVerifierRef ||
         anchored.sourceRunId!==invoker.runId ||
         anchored.sourceRunAttempt!==invoker.runAttempt ||
         anchored.sourceActorId!==invoker.actorId ||
         anchored.exactSubjectSha256!==binding.frozenSubjectSha256 ||
         !SHA64.test(anchored.nativeEventDigest) ||
         anchored.nativeEventAt!==run.created_at ||
         anchored.fiveChecks.length!==ITEMS.length ||
         !anchored.fiveChecks.every((d,i)=>
           d.item===ITEMS[i] && (d.decision==="ACCEPT"||d.decision==="REJECT")) ||
         (anchored.overall==="ACCEPT")!==anchored.fiveChecks.every(x=>x.decision==="ACCEPT")
      )return null;
      const digestInput=serializeWorkOsPayload({
        scopeKey:SCOPE_KEY,provider:GITHUB,runId:invoker.runId,
        runAttempt:invoker.runAttempt,actorId:invoker.actorId,
        exactSubjectSha256:anchored.exactSubjectSha256,
        nativeEventAt:anchored.nativeEventAt,
        fiveChecks:anchored.fiveChecks,overall:anchored.overall,
      });
      if(!digestInput ||
         await sha256PayloadHex(digestInput)!==anchored.nativeEventDigest)
         return null;
      return {
        provider:GITHUB,
        nativeEventId:`github_run_${invoker.runId}_1`,
        nativeEventDigest:anchored.nativeEventDigest,
        attributableHumanProviderId:invoker.actorId,
        nativeEventAt:anchored.nativeEventAt,
        authorizedIssuerRef:binding.authorizationIssuerRef,
        verifierRef:binding.nativeEventVerifierRef,
        evidenceAnchorRef:anchored.externalAnchorRef,
        exactSubjectSha256:binding.frozenSubjectSha256,
        fiveChecks:anchored.fiveChecks,
        overall:anchored.overall,
        revoked:false,
      };
    }catch{
      // No guessed fallback, no mutable Github Review, and no blind retry.
      return null;
    }
  }
}
