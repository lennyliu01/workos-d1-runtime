import worker from "../src/cutover_witness_worker";
import {
  CUTOVER_WITNESS_FORMAL_ROUTE,
  CUTOVER_WITNESS_GOOGLE_CREDENTIAL_BINDING,
  CUTOVER_WITNESS_PROVIDER_AUTH_MODE,
  CUTOVER_WITNESS_READINESS_ROUTE,
  CUTOVER_WITNESS_WORKER_SERVICE,
  CUTOVER_WITNESS_WORKER_URL,
} from "../src/cutover_witness_runtime_config";
import {
  CUTOVER_WITNESS_INVOCATION_VERSION,
} from "../src/cutover_witness_invocation";
import {
  MATERIALIZED_FIXTURE_ROOT_ID,
  MATERIALIZED_FIXTURE_SPREADSHEET_ID,
} from "../src/cutover_witness_fixture";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

class FakeGoogleApi {
  readonly calls: string[] = [];
  readonly productionCalls: string[] = [];

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    this.calls.push((init?.method ?? "GET") + " " + url.toString());
    const parts = url.pathname.split("/");
    const spreadsheetId = decodeURIComponent(parts[3] ?? "");
    if (spreadsheetId && spreadsheetId !== MATERIALIZED_FIXTURE_SPREADSHEET_ID) {
      this.productionCalls.push(url.toString());
    }

    if (
      (init?.method ?? "GET") === "GET" &&
      spreadsheetId === MATERIALIZED_FIXTURE_SPREADSHEET_ID &&
      url.pathname.includes("/values/Candidate_Activation!A2%3AG2")
    ) {
      return Response.json({
        values: [[
          "CUT_FIXTURE_TARGET",
          "fixture-scope",
          "RS_FIXTURE",
          "MSET_FIXTURE",
          "gate-fixture",
          "workflow-fixture",
          "AB_FIXTURE",
        ]],
      });
    }

    return Response.json({ error: "unexpected fake Google request" }, { status: 404 });
  };
}

const configuredEnv = {
  RUNTIME_SECRET: "owner-runtime-secret",
  CUTOVER_WITNESS_GOOGLE_ACCESS_TOKEN: "owner-ephemeral-google-token",
  CUTOVER_WITNESS_BUILD_COMMIT: "OWNER_CANDIDATE_BUILD",
  CUTOVER_WITNESS_PROVIDER_CONFIG_ID: "GSPC_OWNER_CANDIDATE",
};

async function withFakeGoogle<T>(fn: (api: FakeGoogleApi) => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  const api = new FakeGoogleApi();
  globalThis.fetch = api.fetch as typeof fetch;
  try {
    return await fn(api);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function main(): Promise<void> {
  assert(CUTOVER_WITNESS_WORKER_SERVICE === "workos-cutover-witness", "worker identity drift");
  assert(CUTOVER_WITNESS_WORKER_URL.endsWith(".workers.dev"), "worker target missing");
  assert(CUTOVER_WITNESS_FORMAL_ROUTE === "/cutover/witness", "formal route drift");
  assert(CUTOVER_WITNESS_READINESS_ROUTE === "/cutover/witness/readiness", "readiness route drift");
  assert(
    CUTOVER_WITNESS_PROVIDER_AUTH_MODE === "GOOGLE_OAUTH_BEARER_ACCESS_TOKEN_EPHEMERAL",
    "provider auth mode drift",
  );
  assert(
    CUTOVER_WITNESS_GOOGLE_CREDENTIAL_BINDING === "CUTOVER_WITNESS_GOOGLE_ACCESS_TOKEN",
    "credential binding drift",
  );

  const unauth = await worker.fetch(
    new Request(CUTOVER_WITNESS_WORKER_URL + CUTOVER_WITNESS_FORMAL_ROUTE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
    configuredEnv,
  );
  assert(unauth.status === 401, "formal route did not enforce caller authentication");

  const missingGoogle = await worker.fetch(
    new Request(CUTOVER_WITNESS_WORKER_URL + CUTOVER_WITNESS_READINESS_ROUTE, {
      headers: { Authorization: "Bearer owner-runtime-secret" },
    }),
    {
      ...configuredEnv,
      CUTOVER_WITNESS_GOOGLE_ACCESS_TOKEN: undefined,
    },
  );
  assert(missingGoogle.status === 503, "missing Google binding did not fail closed");
  const missingGoogleBody = await missingGoogle.json() as { error?: string };
  assert(
    missingGoogleBody.error === "CUTOVER_WITNESS_GOOGLE_PROVIDER_NOT_CONFIGURED",
    "missing Google binding returned wrong error",
  );

  await withFakeGoogle(async (api) => {
    const readiness = await worker.fetch(
      new Request(CUTOVER_WITNESS_WORKER_URL + CUTOVER_WITNESS_READINESS_ROUTE, {
        headers: { Authorization: "Bearer owner-runtime-secret" },
      }),
      configuredEnv,
    );
    assert(readiness.status === 200, "configured provider readiness failed");
    const body = await readiness.json() as Record<string, any>;
    assert(body.status === "READY", "readiness status mismatch");
    assert(body.build_commit === "OWNER_CANDIDATE_BUILD", "build readback mismatch");
    assert(body.provider_config_id === "GSPC_OWNER_CANDIDATE", "provider config readback mismatch");
    assert(body.provider_readiness.exact_readback === true, "real provider exact readback absent");
    assert(body.provider_readiness.fixture_root_id === MATERIALIZED_FIXTURE_ROOT_ID, "fixture root mismatch");
    assert(body.credential_value_disclosed === false, "secret disclosure flag violated");
    assert(
      JSON.stringify(body).includes("owner-ephemeral-google-token") === false,
      "Google credential leaked into readiness response",
    );
    assert(api.calls.length === 1, "readiness used unexpected provider call count");
    assert(api.productionCalls.length === 0, "readiness addressed production Google resource");
  });

  await withFakeGoogle(async (api) => {
    const negative = await worker.fetch(
      new Request(CUTOVER_WITNESS_WORKER_URL + CUTOVER_WITNESS_FORMAL_ROUTE, {
        method: "POST",
        headers: {
          Authorization: "Bearer owner-runtime-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          operation: "CUTOVER_EXECUTOR_WITNESS",
          invocation_version: CUTOVER_WITNESS_INVOCATION_VERSION,
          case_id: "NEGATIVE_PRODUCTION_DENYLIST",
          run_id: "OWNER_DEPLOYMENT_NEGATIVE_001",
          session_id: "OWNER_DEPLOYMENT_NEGATIVE_SESSION_001",
          fixture_root_id: MATERIALIZED_FIXTURE_ROOT_ID,
          fixture_spreadsheet_id: MATERIALIZED_FIXTURE_SPREADSHEET_ID,
        }),
      }),
      configuredEnv,
    );
    assert(negative.status === 200, "negative addressing formal invocation transport failed");
    const body = await negative.json() as Record<string, any>;
    assert(body.result.ok === false, "negative addressing unexpectedly succeeded");
    assert(body.result.stop === "PRODUCTION_TARGET_DENIED", "negative addressing stop mismatch");
    assert(Object.keys(body.provider_reads ?? {}).length === 0, "negative denial occurred after provider read");
    assert(Object.keys(body.provider_mutations ?? {}).length === 0, "negative denial occurred after provider mutation");
    assert(api.calls.length === 0, "negative denial reached Google provider");
    assert(api.productionCalls.length === 0, "negative denial addressed production provider");
  });

  const invalid = await worker.fetch(
    new Request(CUTOVER_WITNESS_WORKER_URL + CUTOVER_WITNESS_FORMAL_ROUTE, {
      method: "POST",
      headers: {
        Authorization: "Bearer owner-runtime-secret",
        "Content-Type": "application/json",
      },
      body: "{}",
    }),
    configuredEnv,
  );
  assert(invalid.status === 400, "authenticated invalid invocation did not stop before execution");

  console.log(JSON.stringify({
    deployment_config_repair_owner_validation: "PASS",
    worker_service: CUTOVER_WITNESS_WORKER_SERVICE,
    formal_route: CUTOVER_WITNESS_FORMAL_ROUTE,
    readiness_route: CUTOVER_WITNESS_READINESS_ROUTE,
    provider_auth_mode: CUTOVER_WITNESS_PROVIDER_AUTH_MODE,
    credential_binding: CUTOVER_WITNESS_GOOGLE_CREDENTIAL_BINDING,
    credential_secret_disclosed: false,
    real_provider_readiness_fixture_only: "PASS",
    missing_credential_fail_closed: "PASS",
    production_denylist_pre_provider: "PASS",
    governed_witness_executed: false,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
