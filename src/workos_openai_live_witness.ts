import { pathToFileURL } from "node:url";
import {
  createResponsesClientFromWorkloadIdentity,
  type ResponsesClient,
} from "./workos_model_runtime.js";

export const OPENAI_LIVE_WITNESS_MODEL = "gpt-5.6";
export const OPENAI_LIVE_WITNESS_EXPECTED_STATUS = "OPENAI_LIVE_WITNESS_OK";

function responseText(r: any): string {
  if (typeof r?.output_text === "string") return r.output_text;
  for (const item of r?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (typeof content?.text === "string") return content.text;
    }
  }
  throw new Error("OPENAI_LIVE_WITNESS_OUTPUT_MISSING");
}

export function assertOpenAILiveWitnessEnvironment(env: Record<string, string | undefined>): void {
  if (env.GITHUB_EVENT_NAME !== "workflow_dispatch") {
    throw new Error("OPENAI_LIVE_WITNESS_REQUIRES_WORKFLOW_DISPATCH");
  }
  if (env.WORKOS_OPENAI_LIVE_WITNESS !== "true") {
    throw new Error("OPENAI_LIVE_WITNESS_MODE_NOT_ENABLED");
  }
  if (env.WORKOS_PRODUCTION_WRITES_ENABLED === "true") {
    throw new Error("OPENAI_LIVE_WITNESS_PRODUCTION_WRITES_FORBIDDEN");
  }
  for (const key of ["WORKOS_TASK_ID", "GOOGLE_OAUTH_ACCESS_TOKEN", "RUNTIME_SECRET"]) {
    if (env[key]) throw new Error(`OPENAI_LIVE_WITNESS_FORBIDDEN_ENV:${key}`);
  }
}

export async function runOpenAILiveWitness(client: ResponsesClient) {
  const response = await client.responses.create({
    model: OPENAI_LIVE_WITNESS_MODEL,
    input: "Non-production infrastructure witness only. Return the single JSON object required by the response schema.",
    max_output_tokens: 64,
    text: {
      format: {
        type: "json_schema",
        name: "openai_live_witness",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            status: { type: "string", enum: [OPENAI_LIVE_WITNESS_EXPECTED_STATUS] },
          },
          required: ["status"],
        },
      },
    },
  });

  const text = responseText(response);
  if (!text || text.length > 256) throw new Error("OPENAI_LIVE_WITNESS_OUTPUT_NOT_BOUNDED");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("OPENAI_LIVE_WITNESS_OUTPUT_INVALID");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.keys(parsed as Record<string, unknown>).length !== 1 ||
    (parsed as Record<string, unknown>).status !== OPENAI_LIVE_WITNESS_EXPECTED_STATUS
  ) {
    throw new Error("OPENAI_LIVE_WITNESS_ASSERTION_FAILED");
  }

  const responseId = String((response as any).id ?? "");
  if (!responseId) throw new Error("OPENAI_LIVE_WITNESS_RESPONSE_ID_MISSING");

  return {
    status: "SUCCESS" as const,
    witness: "OPENAI_WIF_RESPONSES_MINIMAL" as const,
    requested_model: OPENAI_LIVE_WITNESS_MODEL,
    response_id: responseId,
    output_assertion: "PASS" as const,
  };
}

export async function runOpenAILiveWitnessFromEnvironment(
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
) {
  assertOpenAILiveWitnessEnvironment(env);
  return runOpenAILiveWitness(createResponsesClientFromWorkloadIdentity(env, fetchImpl));
}

async function cli() {
  console.log(JSON.stringify(await runOpenAILiveWitnessFromEnvironment(process.env)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
