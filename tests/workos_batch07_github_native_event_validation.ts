import assert from "node:assert/strict";
import {CandidateGitHubNativeOwnerEventVerifier} from "../src/workos_batch07_github_native_event_candidate.js";
import {SCOPE_KEY,CODE_HEAD,REGISTRY_CONTRACT_FINGERPRINT} from "../src/workos_batch07_owner_terminal_candidate.js";
import {serializeWorkOsPayload,sha256PayloadHex} from "../src/workos_canonical_payload.js";
import type {ActiveOwnerReviewBinding} from "../src/workos_batch07_owner_terminal_candidate.js";
import type {GitHubInvokerPolicy} from "../src/workos_github_oidc_invoker.js";

const now=1780000000,runId="9988776655",actorId="64623756";
const workflow=".github/workflows/workos-owner-review.yml";
const branch="refs/heads/main";
const workflowRef="lennyliu01/workos-d1-runtime/"+workflow+"@"+branch;
const headSha="a".repeat(40);
const oidc:GitHubInvokerPolicy={
  audience:"workos-rw-batch07-owner-review",
  repositoryId:"1380735463",repository:"lennyliu01/workos-d1-runtime",
  workflowRef,ref:branch,eventName:"workflow_dispatch",
};
const binding:ActiveOwnerReviewBinding={
  state:"ACTIVE",scopeKey:SCOPE_KEY,owner:"ROLLING_WEDGE_WORKFLOW",
  datasetId:"RW_CURRENT_STATE",
  instances:["DSG","DOL","WSP","GIBA","NA","ENB","ATD"],
  fields:["Company_ID","Company_Name","Ticker","Exchange","Currency","State_As_Of",
    "Base_Source_Materials","Structured_State_Content"],
  candidateCodeSha:CODE_HEAD,
  registryContractFingerprint:REGISTRY_CONTRACT_FINGERPRINT,
  sealedChangeSpecSha256:"e".repeat(64),frozenSubjectSha256:"f".repeat(64),
  provider:"GITHUB_ACTIONS_OIDC",authorizedHumanProviderId:actorId,
  authorizationIssuerRef:"governed-human-approval-issuer",
  nativeEventVerifierRef:"independent-immutable-dispatch-verifier",
  notBefore:"2026-01-01T00:00:00Z",expiresAt:"2027-01-01T00:00:00Z"
};
const eventTime=new Date((now-10)*1000).toISOString();
const fiveChecks=[
  "EIGHT_FIELD_NULL_SEMANTICS","FROZEN_RESEARCH_FIDELITY",
  "ROLE_DECODER_AND_UNACCEPTED_FACT_EXCLUSION","DATASET_INSTANCE_IDENTITY",
  "D1_INITIALIZATION_WRITE_AND_VERSION1_READBACK_CONTRACT",
].map(x=>({item:x,decision:"ACCEPT"})) as any;
const run={
  id:Number(runId),repository_id:1380735463,actor_id:Number(actorId),
  triggering_actor_id:Number(actorId),event:"workflow_dispatch",
  head_sha:headSha,path:workflow+"@main",run_attempt:1,
  created_at:eventTime,status:"in_progress" as const,
};
const digestInput=serializeWorkOsPayload({
  scopeKey:SCOPE_KEY,provider:"GITHUB_ACTIONS_OIDC",runId,runAttempt:"1",
  actorId,exactSubjectSha256:binding.frozenSubjectSha256,
  nativeEventAt:eventTime,fiveChecks,overall:"ACCEPT",
})!;
const digest=await sha256PayloadHex(digestInput);
const anchor={
  externalAnchorRef:"immutable-anchor-ref",
  externalAnchorVerifierRef:binding.nativeEventVerifierRef,
  sourceRunId:runId,sourceRunAttempt:"1",sourceActorId:actorId,
  exactSubjectSha256:binding.frozenSubjectSha256,
  nativeEventAt:eventTime,fiveChecks,overall:"ACCEPT" as const,
  nativeEventDigest:digest,revoked:false,
};
const keyPair=await crypto.subtle.generateKey(
  {name:"RSASSA-PKCS1-v1_5",modulusLength:2048,
   publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"},true,["sign","verify"]
) as CryptoKeyPair;
const publicJwk=await crypto.subtle.exportKey("jwk",keyPair.publicKey);
const encode=(x:string|Uint8Array):string=>
  Buffer.from(typeof x==="string"?new TextEncoder().encode(x):x).toString("base64url");
async function sign(override:Record<string,unknown>={}){
  const claims={
    iss:"https://token.actions.githubusercontent.com",aud:oidc.audience,
    sub:"repo:lennyliu01/workos-d1-runtime:ref:"+branch,
    repository_id:oidc.repositoryId,repository:oidc.repository,
    workflow_ref:workflowRef,ref:branch,event_name:"workflow_dispatch",
    run_id:runId,run_attempt:"1",actor_id:actorId,
    iat:now-10,nbf:now-10,exp:now+300,...override,
  };
  const p1=encode(JSON.stringify({typ:"JWT",alg:"RS256",kid:"native-owner-kid"}));
  const p2=encode(JSON.stringify(claims));
  const encoded=p1+"."+p2;
  const sig=await crypto.subtle.sign("RSASSA-PKCS1-v1_5",
    keyPair.privateKey,new TextEncoder().encode(encoded));
  return encoded+"."+encode(new Uint8Array(sig));
}
const mockFetch=(async (url:RequestInfo|URL)=>{
  assert.equal(String(url),"https://token.actions.githubusercontent.com/.well-known/jwks");
  return Response.json({keys:[{...publicJwk,kid:"native-owner-kid",alg:"RS256",use:"sig"}]});
}) as typeof fetch;
function make(jwt:string,overrides:any={}){
  return new CandidateGitHubNativeOwnerEventVerifier(
    jwt,{oidc,expectedHeadSha:headSha,expectedRunPath:workflow+"@main"},
    {async readExactWorkflowRun(){return overrides.run??run}},
    {async readVerifiedAnchoredDispatch(){return overrides.anchor??anchor}},
    mockFetch,now
  );
}
async function denied(label:string,jwt:string,overrides:any={},b=binding){
  const got=await make(jwt,overrides).verifyExact("github-actions-run:"+runId+":1",b);
  assert.equal(got,null,label);
}
const jwt=await sign();
const positive=await make(jwt).verifyExact("github-actions-run:"+runId+":1",binding);
assert.equal(positive?.attributableHumanProviderId,actorId);
assert.equal(positive?.nativeEventDigest,digest);
assert.equal(positive?.overall,"ACCEPT");
await denied("wrong run actor",jwt,{run:{...run,actor_id:12}});
await denied("wrong triggering actor rerun",jwt,{run:{...run,triggering_actor_id:12}});
await denied("run attempt replay",jwt,{run:{...run,run_attempt:2}});
await denied("wrong repository",jwt,{run:{...run,repository_id:12}});
await denied("wrong SHA",jwt,{run:{...run,head_sha:"b".repeat(40)}});
await denied("wrong workflow",jwt,{run:{...run,path:"other@main"}});
await denied("unanchored subject",jwt,{anchor:{...anchor,exactSubjectSha256:"a".repeat(64)}});
await denied("revoked",jwt,{anchor:{...anchor,revoked:true}});
await denied("altered five checks",jwt,{anchor:{...anchor,fiveChecks:fiveChecks.slice(0,4)}});
await denied("digest substitution",jwt,{anchor:{...anchor,nativeEventDigest:"a".repeat(64)}});
await denied("wrong verifier",jwt,{anchor:{...anchor,externalAnchorVerifierRef:"self"}});
await denied("wrong author",await sign({actor_id:"1234"}));
await denied("OIDC actor id missing",await sign({actor_id:null}));
await denied("wrong OIDC event",await sign({event_name:"issue_comment"}));
await denied("wrong signer binding",jwt,{}, {...binding,authorizedHumanProviderId:"other"});
assert.equal(await make(jwt).verifyExact("github-actions-run:"+runId+":2",binding),null);
console.log("PASS: signed actor_ID + native GitHub run cross-check + separately anchored exact dispatch; 15 negative cases. MOCK provider; NO production verifier.");
