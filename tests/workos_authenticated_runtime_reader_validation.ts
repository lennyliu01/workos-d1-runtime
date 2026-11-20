import assert from "node:assert/strict";
import { getVerifiedWorkOsReader } from "../src/workos_authenticated_runtime_reader.js";
import type { GitHubInvokerIdentity, GitHubInvokerPolicy } from "../src/workos_github_oidc_invoker.js";

const audience="workos-initial-baseline-draft";
const ACCESS="ya29."+"a".repeat(120);
const OIDC="signed-test-jwt-value";
let checks=0;
const issuer="https://token.actions.githubusercontent.com" as const;
const identity:GitHubInvokerIdentity={
  issuer,audience,repositoryId:"1380735463",
  repository:"lennyliu01/workos-d1-runtime",
  workflowRef:"lennyliu01/workos-d1-runtime/.github/workflows/workos-business-executor.yml@refs/heads/main",
  ref:"refs/heads/main",eventName:"workflow_dispatch",
  runId:"1000001",runAttempt:"1",
  subject:"repo:lennyliu01/workos-d1-runtime:ref:refs/heads/main",
};
const checked:GitHubInvokerPolicy[]=[];
const verify=async (_jwt:string,policy:GitHubInvokerPolicy)=>{
  checked.push(policy);
  assert.equal(_jwt,OIDC);
  assert.equal(policy.audience,audience);
  assert.equal(policy.repositoryId,"1380735463");
  assert.equal(policy.eventName,"workflow_dispatch");
  assert.equal(policy.ref,"refs/heads/main");
  return identity;
};
const headers=new Headers({
  "X-WorkOS-Google-Reader-Token":ACCESS,
  "X-WorkOS-Invoker-OIDC":OIDC,
});
const read=await getVerifiedWorkOsReader(headers,audience,fetch,verify);
assert.equal(read?.accessToken,ACCESS);
assert.equal(read?.invoker.repositoryId,"1380735463");
checks++;
assert.equal(await getVerifiedWorkOsReader(new Headers(),audience,fetch,verify),null);
checks++;
assert.equal(await getVerifiedWorkOsReader(headers,undefined,fetch,verify),null);
checks++;
assert.equal(await getVerifiedWorkOsReader(new Headers({
  "X-WorkOS-Google-Reader-Token":ACCESS}),audience,fetch,verify),null);
checks++;
assert.equal(await getVerifiedWorkOsReader(new Headers({
  "X-WorkOS-Google-Reader-Token":"bad", "X-WorkOS-Invoker-OIDC":OIDC,
}),audience,fetch,verify),null);
checks++;
assert.equal(await getVerifiedWorkOsReader(new Headers({
  "X-WorkOS-Google-Reader-Token":ACCESS+"\\nINJECT", "X-WorkOS-Invoker-OIDC":OIDC,
}),audience,fetch,verify),null);
checks++;
const failedVerify=async()=>{throw new Error("JWT_INVALID")};
assert.equal(await getVerifiedWorkOsReader(headers,audience,fetch,failedVerify),null);
checks++;
assert.equal(checked.length,1);
console.log("workos_authenticated_runtime_reader_validation: PASS",checks,"NO_LIVE_CREDENTIALS");
