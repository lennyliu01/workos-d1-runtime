import {
  CutoverWitnessInvocationRequest,
  invokeCutoverWitness,
  probeCutoverWitnessProviderReadiness,
} from "./cutover_witness_invocation";
import {
  CUTOVER_WITNESS_CALLER_AUTH_BINDING,
  CUTOVER_WITNESS_FORMAL_ROUTE,
  CUTOVER_WITNESS_GOOGLE_CREDENTIAL_BINDING,
  CUTOVER_WITNESS_PROVIDER_AUTH_MODE,
  CUTOVER_WITNESS_READINESS_ROUTE,
  CUTOVER_WITNESS_RUNTIME_SCOPE,
  CUTOVER_WITNESS_WORKER_SERVICE,
} from "./cutover_witness_runtime_config";

interface Env {
  RUNTIME_SECRET?: string;
  CUTOVER_WITNESS_GOOGLE_ACCESS_TOKEN?: string;
  CUTOVER_WITNESS_BUILD_COMMIT?: string;
  CUTOVER_WITNESS_PROVIDER_CONFIG_ID?: string;
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

function requireGoogleCredential(env: Env): string | Response {
  if (!env.CUTOVER_WITNESS_GOOGLE_ACCESS_TOKEN) {
    return jsonError("CUTOVER_WITNESS_GOOGLE_PROVIDER_NOT_CONFIGURED", 503);
  }
  return env.CUTOVER_WITNESS_GOOGLE_ACCESS_TOKEN;
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

  const credential = requireGoogleCredential(env);
  if (credential instanceof Response) return credential;

  if (!env.CUTOVER_WITNESS_BUILD_COMMIT || !env.CUTOVER_WITNESS_PROVIDER_CONFIG_ID) {
    return jsonError("CUTOVER_WITNESS_RUNTIME_IDENTITY_NOT_CONFIGURED", 503);
  }

  try {
    const readiness = await probeCutoverWitnessProviderReadiness(credential);
    return Response.json({
      status: "READY",
      service: CUTOVER_WITNESS_WORKER_SERVICE,
      build_commit: env.CUTOVER_WITNESS_BUILD_COMMIT,
      provider_config_id: env.CUTOVER_WITNESS_PROVIDER_CONFIG_ID,
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

  const credential = requireGoogleCredential(env);
  if (credential instanceof Response) return credential;

  const body = await parseJson(request);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return jsonError("INVALID_WITNESS_INVOCATION", 400);
  }

  try {
    const result = await invokeCutoverWitness(
      body as CutoverWitnessInvocationRequest,
      credential,
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
