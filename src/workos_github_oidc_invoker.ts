/**
 * R3: Verify the invoking GitHub Actions workload identity, independently of
 * RUNTIME_SECRET, request JSON, and any claimed caller_identity.
 *
 * This is NOT an INITIAL_BASELINE grant. It is a prerequisite for asking the
 * separately governed grant issuer to approve exact D1 v0->v1 initialization.
 * Pinned key URL prevents untrusted JWT headers from selecting a key source.
 */
const ISSUER = "https://token.actions.githubusercontent.com";
const JWKS_URL = ISSUER + "/.well-known/jwks";
const ID_PATTERN = /^[0-9]{1,20}$/;

export interface GitHubInvokerIdentity {
  issuer: typeof ISSUER;
  audience: string;
  repositoryId: string;
  repository: string;
  workflowRef: string;
  ref: string;
  eventName: string;
  runId: string;
  runAttempt: string;
  // Signed GitHub person-account ID. Optional for R3 compatibility;
  // R2 must reject if GitHub does not include it.
  actorId?: string;
  subject: string;
}

export interface GitHubInvokerPolicy {
  audience: string;
  repositoryId: string;
  repository: string;
  workflowRef: string;
  ref: string;
  eventName: "workflow_dispatch" | "schedule";
}

type Jwk = JsonWebKey & { kid?: string; alg?: string; use?: string };
type Claims = Record<string, unknown>;
const text = new TextDecoder();

function decodeBase64Url(input: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(input)) throw new Error("WORKOS_OIDC_INVALID_ENCODING");
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = atob(normalized + "=".repeat((4-normalized.length%4)%4));
  return Uint8Array.from(bytes, char => char.charCodeAt(0));
}

function jsonPart(segment: string): Record<string,unknown> {
  const obj: unknown = JSON.parse(text.decode(decodeBase64Url(segment)));
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error("WORKOS_OIDC_INVALID_OBJECT");
  }
  return obj as Record<string,unknown>;
}

function strictString(claims: Claims, key: string): string {
  const v = claims[key];
  if (typeof v !== "string" || !v || v.length > 1500) {
    throw new Error("WORKOS_OIDC_INVALID_CLAIM:" + key);
  }
  return v;
}

function numericClaim(claims:Claims,key:string):number {
  const v=claims[key];
  if (typeof v!=="number" || !Number.isSafeInteger(v)) {
    throw new Error("WORKOS_OIDC_INVALID_TIME:"+key);
  }
  return v;
}

export async function verifyGitHubWorkOsInvoker(
  bearer: string | null,
  policy: GitHubInvokerPolicy,
  fetchImpl: typeof fetch = fetch,
  currentEpochSeconds = Math.floor(Date.now()/1000),
): Promise<GitHubInvokerIdentity> {
  if (!bearer || bearer.length > 10000 || !policy.audience ||
      !ID_PATTERN.test(policy.repositoryId)) {
    throw new Error("WORKOS_OIDC_UNCONFIGURED_OR_MISSING");
  }
  const jwt=bearer.replace(/^Bearer /,"");
  const parts=jwt.split(".");
  if(parts.length!==3 || parts.some(x=>!x))throw new Error("WORKOS_OIDC_FORMAT");
  const header=jsonPart(parts[0]);
  if(header.alg!=="RS256" || header.typ!=="JWT" ||
      typeof header.kid!=="string" || !header.kid) {
    throw new Error("WORKOS_OIDC_ALGORITHM_OR_KID");
  }
  const claims=jsonPart(parts[1]);
  if(strictString(claims,"iss")!==ISSUER ||
      strictString(claims,"aud")!==policy.audience ||
      strictString(claims,"repository_id")!==policy.repositoryId ||
      strictString(claims,"repository")!==policy.repository ||
      strictString(claims,"workflow_ref")!==policy.workflowRef ||
      strictString(claims,"ref")!==policy.ref ||
      strictString(claims,"event_name")!==policy.eventName) {
    throw new Error("WORKOS_OIDC_PRINCIPAL_OR_SCOPE_MISMATCH");
  }
  const runId=strictString(claims,"run_id");
  const runAttempt=strictString(claims,"run_attempt");
  if(!ID_PATTERN.test(runId)||!ID_PATTERN.test(runAttempt))throw new Error("WORKOS_OIDC_RUN_ID");
  const iat=numericClaim(claims,"iat");
  const nbf=numericClaim(claims,"nbf");
  const exp=numericClaim(claims,"exp");
  if(iat>currentEpochSeconds+60||nbf>currentEpochSeconds+60||
      exp<=currentEpochSeconds || exp>currentEpochSeconds+600 ||
      exp<=iat || currentEpochSeconds-iat>600) {
    throw new Error("WORKOS_OIDC_EXPIRED_OR_FUTURE");
  }
  const jwksResponse=await fetchImpl(JWKS_URL,{method:"GET"});
  if(!jwksResponse.ok)throw new Error("WORKOS_OIDC_JWKS_UNAVAILABLE");
  const jwks=await jwksResponse.json() as {keys?:Jwk[]};
  const candidates=(Array.isArray(jwks.keys)?jwks.keys:[]).filter(key=>
    key.kid===header.kid && key.kty==="RSA" &&
    (key.alg===undefined || key.alg==="RS256") &&
    (key.use===undefined || key.use==="sig"));
  if(candidates.length!==1)throw new Error("WORKOS_OIDC_JWK_NOT_UNIQUE");
  const publicKey=await crypto.subtle.importKey(
    "jwk",candidates[0],{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
  const message=new TextEncoder().encode(parts[0]+"."+parts[1]);
  const signature=decodeBase64Url(parts[2]);
  if(!(await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",publicKey,signature as BufferSource,message))) {
    throw new Error("WORKOS_OIDC_SIGNATURE_INVALID");
  }
  const actorId=claims["actor_id"];
  if(actorId!==undefined &&
     (typeof actorId!=="string" || !ID_PATTERN.test(actorId))) {
    throw new Error("WORKOS_OIDC_ACTOR_ID_INVALID");
  }
  const subject=strictString(claims,"sub");
  const expectedSubject="repo:"+policy.repository+":ref:"+policy.ref;
  if(subject!==expectedSubject)throw new Error("WORKOS_OIDC_SUBJECT_MISMATCH");
  return {
    issuer:ISSUER,audience:policy.audience,repositoryId:policy.repositoryId,
    repository:policy.repository,workflowRef:policy.workflowRef,
    ref:policy.ref,eventName:policy.eventName,runId,runAttempt,
    actorId:actorId as string|undefined,subject,
  };
}
