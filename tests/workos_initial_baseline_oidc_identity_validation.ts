import assert from "node:assert/strict";
import { verifyGitHubWorkOsInvoker, type GitHubInvokerPolicy } from "../src/workos_github_oidc_invoker.js";

const now=1780000000;
const policy:GitHubInvokerPolicy={
  audience:"workos-initial-baseline-draft",
  repositoryId:"1380735463",repository:"lennyliu01/workos-d1-runtime",
  workflowRef:"lennyliu01/workos-d1-runtime/.github/workflows/workos-business-executor.yml@refs/heads/main",
  ref:"refs/heads/main",eventName:"workflow_dispatch",
};
const keyPair=await crypto.subtle.generateKey(
  {name:"RSASSA-PKCS1-v1_5",modulusLength:2048,
   publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"},
  true,["sign","verify"]) as CryptoKeyPair;
const publicJwk=await crypto.subtle.exportKey("jwk",keyPair.publicKey);
function encode(value:Uint8Array|string){
  const bytes=typeof value==="string"?new TextEncoder().encode(value):value;
  return Buffer.from(bytes).toString("base64url");
}
const baseClaims={
  iss:"https://token.actions.githubusercontent.com",aud:policy.audience,
  sub:"repo:lennyliu01/workos-d1-runtime:ref:refs/heads/main",
  repository_id:policy.repositoryId,repository:policy.repository,
  workflow_ref:policy.workflowRef,ref:policy.ref,
  event_name:policy.eventName,run_id:"9988776655",run_attempt:"2",
  iat:now-10,nbf:now-10,exp:now+300,
};
async function sign(payload:Record<string,unknown>, header:Record<string,unknown>={}){
  const p1=encode(JSON.stringify({typ:"JWT",alg:"RS256",kid:"test-kid",...header}));
  const p2=encode(JSON.stringify(payload));
  const input=p1+"."+p2;
  const signature=await crypto.subtle.sign("RSASSA-PKCS1-v1_5",keyPair.privateKey,new TextEncoder().encode(input));
  return input+"."+encode(new Uint8Array(signature));
}
let fetchCalls:string[]=[];
const mockFetch=(async (url:RequestInfo|URL)=>{
  fetchCalls.push(String(url));
  return Response.json({keys:[{...publicJwk,kid:"test-kid",alg:"RS256",use:"sig"}]});
}) as typeof fetch;
async function mustDeny(name:string,jwt:string|null,regex:RegExp,config=policy){
  await assert.rejects(()=>verifyGitHubWorkOsInvoker(jwt,config,mockFetch,now),regex,name);
  console.log("PASS deny",name);
}
const good=await sign(baseClaims);
const verified=await verifyGitHubWorkOsInvoker(good,policy,mockFetch,now);
assert.equal(verified.repositoryId,"1380735463");
assert.equal(verified.runId,"9988776655");
assert.deepEqual(fetchCalls,["https://token.actions.githubusercontent.com/.well-known/jwks"]);
console.log("PASS signed exact main-branch workflow_dispatch identity");
await mustDeny("missing credential",null,/UNCONFIGURED_OR_MISSING/);
await mustDeny("unsigned JWT",await sign(baseClaims,{alg:"none"}),/ALGORITHM_OR_KID/);
await mustDeny("wrong audience",await sign({...baseClaims,aud:"wrong"}),/PRINCIPAL_OR_SCOPE_MISMATCH/);
await mustDeny("wrong repo identity",await sign({...baseClaims,repository_id:"1"}),/PRINCIPAL_OR_SCOPE_MISMATCH/);
await mustDeny("untrusted repository rename",await sign({...baseClaims,repository:"another/repo"}),/PRINCIPAL_OR_SCOPE_MISMATCH/);
await mustDeny("issue-based invoker workflow",await sign({...baseClaims,workflow_ref:
  "lennyliu01/workos-d1-runtime/.github/workflows/runtime-invocation-adapter.yml@refs/heads/main"}),/PRINCIPAL_OR_SCOPE_MISMATCH/);
await mustDeny("pull_request branch",await sign({...baseClaims,ref:"refs/pull/1765/merge"}),/PRINCIPAL_OR_SCOPE_MISMATCH/);
await mustDeny("issue event",await sign({...baseClaims,event_name:"issues"}),/PRINCIPAL_OR_SCOPE_MISMATCH/);
await mustDeny("expired JWT",await sign({...baseClaims,exp:now-1}),/EXPIRED_OR_FUTURE/);
await mustDeny("future issued JWT",await sign({...baseClaims,iat:now+120}),/EXPIRED_OR_FUTURE/);
await mustDeny("subject mismatch",await sign({...baseClaims,sub:"repo:other/ref"}),/SUBJECT_MISMATCH/);
const tampered=good.split(".");
tampered[1]=encode(JSON.stringify({...baseClaims,run_id:"111111"}));
await mustDeny("tampered signature",tampered.join("."),/SIGNATURE_INVALID/);
console.log("workos_initial_baseline_oidc_identity_validation: PASS");
