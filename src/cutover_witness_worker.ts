import {
  CutoverWitnessInvocationRequest,
  invokeCutoverWitness,
  probeCutoverWitnessProviderReadiness,
} from "./cutover_witness_invocation";
import {
  CUTOVER_WITNESS_CALLER_AUTH_BINDING,
  CUTOVER_WITNESS_CREDENTIAL_LIFECYCLE_ID,
  CUTOVER_WITNESS_EXPIRY_MARGIN_SECONDS,
  CUTOVER_WITNESS_FORMAL_ROUTE,
  CUTOVER_WITNESS_GOOGLE_AUTH_ACTION_SHA,
  CUTOVER_WITNESS_GOOGLE_CREDENTIAL_BINDING,
  CUTOVER_WITNESS_GOOGLE_SCOPE,
  CUTOVER_WITNESS_PROVIDER_AUTH_MODE,
  CUTOVER_WITNESS_READINESS_ROUTE,
  CUTOVER_WITNESS_REQUESTED_ACCESS_TOKEN_LIFETIME_SECONDS,
  CUTOVER_WITNESS_RUNTIME_SCOPE,
  CUTOVER_WITNESS_SERVICE_PRINCIPAL,
  CUTOVER_WITNESS_WIF_PROVIDER_FULL_NAME,
  CUTOVER_WITNESS_WORKER_SERVICE,
} from "./cutover_witness_runtime_config";

interface Env {
  RUNTIME_SECRET?: string;
  CUTOVER_WITNESS_GOOGLE_ACCESS_TOKEN?: string;
  CUTOVER_WITNESS_BUILD_COMMIT?: string;
  CUTOVER_WITNESS_PROVIDER_CONFIG_ID?: string;
  CUTOVER_WITNESS_ACCEPTANCE_BINDING_ID?: string;
  CUTOVER_WITNESS_CREDENTIAL_LIFECYCLE_ID?: string;
  CUTOVER_WITNESS_APPROVED_CANDIDATE_COMMIT?: string;
  CUTOVER_WITNESS_WORKFLOW_BLOB?: string;
  CUTOVER_WITNESS_GOOGLE_AUTH_ACTION_SHA?: string;
  CUTOVER_WITNESS_TOKEN_ISSUED_AT?: string;
  CUTOVER_WITNESS_TOKEN_EXPIRES_AT?: string;
  CUTOVER_WITNESS_GOOGLE_SCOPE?: string;
  CUTOVER_WITNESS_WIF_PROVIDER?: string;
  CUTOVER_WITNESS_SERVICE_PRINCIPAL?: string;
}

interface CredentialContext {
  token: string;
  issuedAt: string;
  expiresAt: string;
  approvedCandidateCommit: string;
  workflowBlob: string;
  acceptanceBindingId: string;
}

function jsonError(error: string, statusCode: number): Response {
  return Response.json({ status: "FAILED", error }, { status: statusCode });
}

function authenticate(request: Request, env: Env): Response | null {
  if (!env.RUNTIME_SECRET) {
    return jsonError("CUTOVER_WITNESS_CALLER_AUTH_NOT_CONFIGURED", 503);
  }
  if (request.headers.get("Authorization") !== `Bearer ${env.RUNTIME_SECRET}`) {
    return jsonError("UNAUTHORIZED", 401);
  }
  return null;
}

function requireCredentialContext(env: Env): CredentialContext | Response {
  if (!env.CUTOVER_WITNESS_GOOGLE_ACCESS_TOKEN) {
    return jsonError("CUTOVER_WITNESS_GOOGLE_PROVIDER_NOT_CONFIGURED", 503);
  }
  if (
    !env.CUTOVER_WITNESS_BUILD_COMMIT ||
    !env.CUTOVER_WITNESS_PROVIDER_CONFIG_ID ||
    !env.CUTOVER_WITNESS_ACCEPTANCE_BINDING_ID ||
    !env.CUTOVER_WITNESS_APPROVED_CANDIDATE_COMMIT ||
    !env.CUTOVER_WITNESS_WORKFLOW_BLOB ||
    !env.CUTOVER_WITNESS_TOKEN_ISSUED_AT ||
    !env.CUTOVER_WITNESS_TOKEN_EXPIRES_AT
  ) {
    return jsonError("CUTOVER_WITNESS_RUNTIME_IDENTITY_NOT_CONFIGURED", 503);
  }
  if (env.CUTOVER_WITNESS_CREDENTIAL_LIFECYCLE_ID !== CUTOVER_WITNESS_CREDENTIAL_LIFECYCLE_ID) {
    return jsonError("CUTOVER_WITNESS_CREDENTIAL_LIFECYCLE_MISMATCH", 503);
  }
  if (env.CUTOVER_WITNESS_GOOGLE_AUTH_ACTION_SHA !== CUTOVER_WITNESS_GOOGLE_AUTH_ACTION_SHA) {
    return jsonError("CUTOVER_WITNESS_AUTH_ACTION_IDENTITY_MISMATCH", 503);
  }
  if (env.CUTOVER_WITNESS_GOOGLE_SCOPE !== CUTOVER_WITNESS_GOOGLE_SCOPE) {
    return jsonError("CUTOVER_WITNESS_GOOGLE_SCOPE_MISMATCH", 503);
  }
  if (env.CUTOVER_WITNESS_WIF_PROVIDER !== CUTOVER_WITNESS_WIF_PROVIDER_FULL_NAME) {
    return jsonError("CUTOVER_WITNESS_WIF_PROVIDER_MISMATCH", 503);
  }
  if (env.CUTOVER_WITNESS_SERVICE_PRINCIPAL !== CUTOVER_WITNESS_SERVICE_PRINCIPAL) {
    return jsonError("CUTOVER_WITNESS_SERVICE_PRINCIPAL_MISMATCH", 503);
  }

  const issuedMs = Date.parse(env.CUTOVER_WITNESS_TOKEN_ISSUED_AT);
  const expiresMs = Date.parse(env.CUTOVER_WITNESS_TOKEN_EXPIRES_AT);
  if (!Number.isFinite(issuedMs) || !Number.isFinite(expiresMs) || expiresMs <= issuedMs) {
    return jsonError("CUTOVER_WITNESS_CREDENTIAL_TIME_INVALID", 503);
  }
  const lifetimeMs = expiresMs - issuedMs;
  if (lifetimeMs > CUTOVER_WITNESS_REQUESTED_ACCESS_TOKEN_LIFETIME_SECONDS * 1000) {
    return jsonError("CUTOVER_WITNESS_CREDENTIAL_LIFETIME_EXCEEDS_CONTRACT", 503);
  }
  const freshnessDeadlineMs =
    expiresMs - CUTOVER_WITNESS_EXPIRY_MARGIN_SECONDS * 1000;
  const nowMs = Date.now();
  if (nowMs < issuedMs || nowMs > freshnessDeadlineMs) {
    return jsonError("CUTOVER_WITNESS_CREDENTIAL_NOT_FRESH", 503);
  }

  return {
    token: env.CUTOVER_WITNESS_GOOGLE_ACCESS_TOKEN,
    issuedAt: env.CUTOVER_WITNESS_TOKEN_ISSUED_AT,
    expiresAt: env.CUTOVER_WITNESS_TOKEN_EXPIRES_AT,
    approvedCandidateCommit: env.CUTOVER_WITNESS_APPROVED_CANDIDATE_COMMIT,
    workflowBlob: env.CUTOVER_WITNESS_WORKFLOW_BLOB,
    acceptanceBindingId: env.CUTOVER_WITNESS_ACCEPTANCE_BINDING_ID,
  };
}

async function parseJson(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function handleReadiness(request: Request, env: Env): Promise<Response> {
  const authError = authenticate(request, env);
  if (authError) return authError;

  const credential = requireCredentialContext(env);
  if (credential instanceof Response) return credential;

  try {
    const readiness = await probeCutoverWitnessProviderReadiness(credential.token);
    return Response.json({
      status: "READY",
      service: CUTOVER_WITNESS_WORKER_SERVICE,
      build_commit: env.CUTOVER_WITNESS_BUILD_COMMIT,
      approved_candidate_commit: credential.approvedCandidateCommit,
      workflow_blob: credential.workflowBlob,
      provider_config_id: env.CUTOVER_WITNESS_PROVIDER_CONFIG_ID,
      acceptance_binding_id: credential.acceptanceBindingId,
      credential_lifecycle_id: CUTOVER_WITNESS_CREDENTIAL_LIFECYCLE_ID,
      google_auth_action_sha: CUTOVER_WITNESS_GOOGLE_AUTH_ACTION_SHA,
      wif_provider: CUTOVER_WITNESS_WIF_PROVIDER_FULL_NAME,
      service_principal: CUTOVER_WITNESS_SERVICE_PRINCIPAL,
      google_scope: CUTOVER_WITNESS_GOOGLE_SCOPE,
      token_issued_at: credential.issuedAt,
      token_expires_at: credential.expiresAt,
      credential_freshness: "PASS",
      formal_route: CUTOVER_WITNESS_FORMAL_ROUTE,
      caller_auth_binding: CUTOVER_WITNESS_CALLER_AUTH_BINDING,
      provider_auth_mode: CUTOVER_WITNESS_PROVIDER_AUTH_MODE,
      google_credential_binding: CUTOVER_WITNESS_GOOGLE_CREDENTIAL_BINDING,
      credential_value_disclosed: false,
      runtime_scope: CUTOVER_WITNESS_RUNTIME_SCOPE,
      provider_readiness: readiness,
    });
  } catch (error) {
    const code =
      error instanceof Error ? error.message : "CUTOVER_WITNESS_PROVIDER_READINESS_FAILED";
    return jsonError(code, 503);
  }
}

async function handleWitness(request: Request, env: Env): Promise<Response> {
  const authError = authenticate(request, env);
  if (authError) return authError;

  const credential = requireCredentialContext(env);
  if (credential instanceof Response) return credential;

  const body = await parseJson(request);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return jsonError("INVALID_WITNESS_INVOCATION", 400);
  }

  try {
    const result = await invokeCutoverWitness(
      body as CutoverWitnessInvocationRequest,
      credential.token,
    );
    return Response.json({ status: "SUCCESS", ...result });
  } catch (error) {
    const code =
      error instanceof Error ? error.message : "CUTOVER_WITNESS_INVOCATION_FAILED";
    const status =
      code === "GOOGLE_PROVIDER_CREDENTIAL_UNAVAILABLE" ? 503 : 400;
    return jsonError(code, status);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return Response.json({
        service: CUTOVER_WITNESS_WORKER_SERVICE,
        status: "alive",
        formal_route: CUTOVER_WITNESS_FORMAL_ROUTE,
        readiness_route: CUTOVER_WITNESS_READINESS_ROUTE,
        credential_lifecycle_id: CUTOVER_WITNESS_CREDENTIAL_LIFECYCLE_ID,
        credential_value_disclosed: false,
      });
    }

    if (request.method === "GET" && url.pathname === CUTOVER_WITNESS_READINESS_ROUTE) {
      return handleReadiness(request, env);
    }

    if (request.method === "POST" && url.pathname === CUTOVER_WITNESS_FORMAL_ROUTE) {
      return handleWitness(request, env);
    }

    return jsonError("NOT_FOUND", 404);
  },
};
