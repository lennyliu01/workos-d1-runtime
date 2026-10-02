import {
  invokeCutoverWitness,
  CUTOVER_WITNESS_INVOCATION_VERSION,
  CutoverWitnessInvocationRequest,
  FormalWitnessCaseId,
} from "../src/cutover_witness_invocation";
import {
  MATERIALIZED_CASE8_FINALITY_SURFACE_ID,
  MATERIALIZED_FIXTURE_LOCATORS,
  MATERIALIZED_FIXTURE_ROOT_ID,
  MATERIALIZED_FIXTURE_SPREADSHEET_ID,
} from "../src/cutover_witness_fixture";

type CellScalar = string | number | boolean | null;

const locatorList = Object.values(MATERIALIZED_FIXTURE_LOCATORS);
const byGrid = new Map<string, (typeof locatorList)[number]>();
for (const locator of locatorList) {
  byGrid.set(
    [locator.spreadsheetId, locator.sheetId, locator.startRowIndex, locator.startColumnIndex, locator.columns.length].join("|"),
    locator,
  );
}

function rangeKey(spreadsheetId: string, range: string): string {
  return spreadsheetId + "|" + range;
}

class FakeGoogleSheetsApi {
  readonly state = new Map<string, CellScalar[]>();
  readonly productionProviderCalls: string[] = [];

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const path = url.pathname;
    const method = init?.method ?? "GET";

    const valuesMatch = path.match(/^\/v4\/spreadsheets\/([^/]+)\/values\/(.+)$/);
    if (method === "GET" && valuesMatch) {
      const spreadsheetId = decodeURIComponent(valuesMatch[1]);
      const range = decodeURIComponent(valuesMatch[2]);
      if (spreadsheetId !== MATERIALIZED_FIXTURE_SPREADSHEET_ID) {
        this.productionProviderCalls.push(method + " " + spreadsheetId + " " + range);
      }
      const row = this.state.get(rangeKey(spreadsheetId, range));
      if (!row) return new Response(JSON.stringify({}), { status: 404 });
      return new Response(JSON.stringify({ values: [row] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const batchMatch = path.match(/^\/v4\/spreadsheets\/([^:]+):batchUpdate$/);
    if (method === "POST" && batchMatch) {
      const spreadsheetId = decodeURIComponent(batchMatch[1]);
      if (spreadsheetId !== MATERIALIZED_FIXTURE_SPREADSHEET_ID) {
        this.productionProviderCalls.push(method + " " + spreadsheetId);
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        requests?: Array<{
          updateCells?: {
            range?: {
              sheetId?: number;
              startRowIndex?: number;
              startColumnIndex?: number;
              endColumnIndex?: number;
            };
            rows?: Array<{ values?: Array<{ userEnteredValue?: Record<string, unknown> }> }>;
          };
        }>;
      };
      const update = body.requests?.[0]?.updateCells;
      const grid = update?.range;
      const values = update?.rows?.[0]?.values;
      if (
        !grid ||
        typeof grid.sheetId !== "number" ||
        typeof grid.startRowIndex !== "number" ||
        typeof grid.startColumnIndex !== "number" ||
        typeof grid.endColumnIndex !== "number" ||
        !values
      ) {
        return new Response(JSON.stringify({ error: "invalid updateCells" }), { status: 400 });
      }
      const locator = byGrid.get(
        [
          spreadsheetId,
          grid.sheetId,
          grid.startRowIndex,
          grid.startColumnIndex,
          grid.endColumnIndex - grid.startColumnIndex,
        ].join("|"),
      );
      if (!locator) return new Response(JSON.stringify({ error: "unknown locator" }), { status: 400 });
      const row = values.map((cell) => {
        const v = cell.userEnteredValue ?? {};
        if ("numberValue" in v) return v.numberValue as number;
        if ("boolValue" in v) return v.boolValue as boolean;
        if ("stringValue" in v) return v.stringValue as string;
        return null;
      });
      this.state.set(rangeKey(spreadsheetId, locator.range), row);
      return new Response(JSON.stringify({ replies: [{}] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "unhandled" }), { status: 404 });
  };
}

function request(caseId: FormalWitnessCaseId, n: number): CutoverWitnessInvocationRequest {
  return {
    operation: "CUTOVER_EXECUTOR_WITNESS",
    invocation_version: CUTOVER_WITNESS_INVOCATION_VERSION,
    case_id: caseId,
    run_id: "OWNER_POSTPUB_" + String(n).padStart(2, "0"),
    session_id: "OWNER_POSTPUB_SESSION_" + String(n).padStart(2, "0"),
    fixture_root_id: MATERIALIZED_FIXTURE_ROOT_ID,
    fixture_spreadsheet_id: MATERIALIZED_FIXTURE_SPREADSHEET_ID,
    ...(caseId === "CASE_8_POST_COMMITTED_DENIAL"
      ? { case8_finality_surface_id: MATERIALIZED_CASE8_FINALITY_SURFACE_ID }
      : {}),
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function mutationCount(result: Awaited<ReturnType<typeof invokeCutoverWitness>>, identity: string): number {
  return Object.entries(result.provider_mutations)
    .filter(([key]) => key.startsWith(identity + "|"))
    .reduce((sum, [, count]) => sum + count, 0);
}

async function main(): Promise<void> {
  const expectations: Array<{
    caseId: FormalWitnessCaseId;
    check: (result: Awaited<ReturnType<typeof invokeCutoverWitness>>) => void;
  }> = [
    {
      caseId: "CASE_1_EXACT_MATCH",
      check: (r) => assert(r.result.ok && r.result.status === "READY_FOR_RELAY", "CASE_1 failed"),
    },
    {
      caseId: "CASE_2_PREDECESSOR_MISMATCH",
      check: (r) => {
        assert(!r.result.ok && r.result.stop === "PREDECESSOR_MISMATCH", "CASE_2 did not stop");
        assert(mutationCount(r, "FIXTURE_AUTHORITY_PUBLICATION") === 0, "CASE_2 mutated authority");
      },
    },
    {
      caseId: "CASE_3_NON_MONOTONIC",
      check: (r) => assert(!r.result.ok && r.result.stop === "NON_MONOTONIC_OR_REUSED_EPOCH", "CASE_3 did not stop"),
    },
    {
      caseId: "CASE_4_ACTIVATION_DRIFT",
      check: (r) => assert(!r.result.ok && r.result.stop === "ACTIVATION_OBJECT_DRIFT", "CASE_4 did not stop"),
    },
    {
      caseId: "CASE_5_SOURCE_UNREADABLE",
      check: (r) => {
        assert(!r.result.ok && r.result.stop === "SOURCE_UNREADABLE", "CASE_5 did not stop");
        assert(Object.keys(r.provider_mutations).length === 0, "CASE_5 performed execution mutation");
      },
    },
    {
      caseId: "CASE_6A_AMBIGUOUS_AFTER_COMMIT",
      check: (r) => {
        assert(r.result.ok, "CASE_6A did not reconcile");
        assert(mutationCount(r, "FIXTURE_AUTHORITY_PUBLICATION") === 1, "CASE_6A blind retry detected");
        assert(r.result.reconciledAmbiguousSteps.includes("AUTHORITY_PUBLICATION"), "CASE_6A missing reconciliation");
      },
    },
    {
      caseId: "CASE_6B_AMBIGUOUS_UNRESOLVED",
      check: (r) => {
        assert(!r.result.ok && r.result.stop === "MUTATION_OUTCOME_AMBIGUOUS", "CASE_6B did not stop");
        assert(mutationCount(r, "FIXTURE_AUTHORITY_PUBLICATION") === 1, "CASE_6B duplicate mutation detected");
      },
    },
    {
      caseId: "CASE_7_PARTIAL_RECOVERY",
      check: (r) => {
        assert(r.result.ok && r.result.recoveredSteps.includes("AUTHORITY_PUBLICATION"), "CASE_7 prefix not recovered");
        assert(mutationCount(r, "FIXTURE_AUTHORITY_PUBLICATION") === 0, "CASE_7 repeated completed prefix");
        assert(mutationCount(r, "FIXTURE_TRANSITION_PROTECTION") === 1, "CASE_7 remaining step count");
      },
    },
    {
      caseId: "CASE_7_FOREIGN_SUCCESSOR_GUARD",
      check: (r) => {
        assert(!r.result.ok && r.result.stop === "PREDECESSOR_MISMATCH", "foreign successor treated as recovery");
        assert(mutationCount(r, "FIXTURE_AUTHORITY_PUBLICATION") === 0, "foreign successor mutated authority");
        assert(mutationCount(r, "FIXTURE_TRANSITION_PROTECTION") === 0, "foreign successor mutated protection");
      },
    },
    {
      caseId: "CASE_8_POST_COMMITTED_DENIAL",
      check: (r) => {
        assert(!r.result.ok && r.result.stop === "SESSION_MUTATION_CAPABILITY_CLOSED", "CASE_8 denial failed");
        assert(r.case8?.prepared_verified === true, "CASE_8 PREPARED not verified");
        assert(r.case8?.committed_verified === true, "CASE_8 COMMITTED not verified");
        assert(r.case8?.session_closed === true, "CASE_8 session not closed");
        assert(r.case8?.post_close_transition_mutation_delta === 0, "CASE_8 post-close mutation");
      },
    },
    {
      caseId: "NEGATIVE_PRODUCTION_DENYLIST",
      check: (r) => {
        assert(!r.result.ok && r.result.stop === "PRODUCTION_TARGET_DENIED", "production target not denied");
        assert(Object.keys(r.provider_reads).length === 0, "production denial after provider read");
        assert(Object.keys(r.provider_mutations).length === 0, "production denial after provider mutation");
      },
    },
  ];

  let n = 0;
  for (const item of expectations) {
    n += 1;
    const api = new FakeGoogleSheetsApi();
    const result = await invokeCutoverWitness(request(item.caseId, n), "owner-test-token", api.fetch as typeof fetch);
    item.check(result);
    assert(api.productionProviderCalls.length === 0, item.caseId + " addressed production provider");
  }

  console.log(JSON.stringify({
    post_publication_repair_owner_validation: "PASS",
    formal_invocation_entry: "POST /cutover/witness -> invokeCutoverWitness -> ExecutorCore",
    executor_core: "ExecutorCore",
    provider: "GoogleSheetsControlPlaneProvider",
    memory_provider_used_by_formal_path: false,
    case8_finality_surface: MATERIALIZED_CASE8_FINALITY_SURFACE_ID,
    governed_witness_executed: false,
    semantic_delta: "NONE",
    cases: expectations.map((x) => x.caseId),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
