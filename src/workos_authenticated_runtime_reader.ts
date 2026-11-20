import { verifyGitHubWorkOsInvoker, type GitHubInvokerIdentity, type GitHubInvokerPolicy } from "./workos_github_oidc_invoker.js";

/**
 * Admits a short-lived Google WIF access token only from the exact signed
 * GitHub Actions workload. Never trust token headers from an HTTP caller alone.
 * Cloudflare Worker does not need a stored static Google service account key.
 */
export async function getVerifiedWorkOsReader(
  headers:Headers,
  audience:string|undefined,
  fetchImpl:typeof fetch=fetch,
  verify:typeof verifyGitHubWorkOsInvoker=verifyGitHubWorkOsInvoker,
):Promise<{accessToken:string;invoker:GitHubInvokerIdentity}|null>{
  if(!audience || audience.length>300)return null;
  const accessToken=headers.get("X-WorkOS-Google-Reader-Token");
  const jwt=headers.get("X-WorkOS-Invoker-OIDC");
  if(!accessToken || accessToken.length<40 || accessToken.length>8192 ||
     !/^[A-Za-z0-9._~-]+$/.test(accessToken) || !jwt)return null;
  const policy:GitHubInvokerPolicy={
    audience,
    repositoryId:"1380735463",
    repository:"lennyliu01/workos-d1-runtime",
    workflowRef:"lennyliu01/workos-d1-runtime/.github/workflows/workos-business-executor.yml@refs/heads/main",
    ref:"refs/heads/main",
    eventName:"workflow_dispatch",
  };
  try{
    const invoker=await verify(jwt,policy,fetchImpl);
    return{accessToken,invoker};
  }catch{return null}
}
