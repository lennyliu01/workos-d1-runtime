/**
 * ISOLATED proof only. Exercises the existing Worker guard and D1 call shape
 * after adding seven new companies to the static list. No Google Sheet, real D1, credentials,
 * publisher, or production Worker is touched.
 */
import assert from "node:assert/strict";
import { handleWorkOsCandidatePersistence } from "../src/workos_candidate.js";

interface CurrentRow {
  dataset_id: string;
  instance_id: string;
  version: number;
  previous_version: number;
  payload_json: string;
  invocation_id: string;
  idempotency_key: string;
  db_written_at: string;
  db_read_at: string;
}

class IsolatedD1 {
  readonly states = new Map<string, CurrentRow>();
  queries = 0;

  prepare(query: string) {
    this.queries++;
    return {
      bind: (...values: unknown[]) => ({
        first: async <T>(): Promise<T | null> => {
          if (query.includes("FROM workos_current_state_versions")) {
            let row: CurrentRow | undefined;
            if (query.includes("WHERE idempotency_key=?")) {
              row = [...this.states.values()].find(r => r.idempotency_key === values[0]);
            } else if (query.includes("WHERE invocation_id=?")) {
              row = [...this.states.values()].find(r => r.invocation_id === values[0]);
            } else if (query.includes("WHERE dataset_id=? AND instance_id=?")) {
              row = this.states.get(String(values[0]) + ":" + String(values[1]));
            }
            return (row ?? null) as T | null;
          }
          throw new Error("Unexpected isolated D1 SELECT");
        },
        all: async <T>(): Promise<{ success: boolean; results: T[] }> => {
          if (!query.includes("FROM workos_append_records")) {
            throw new Error("Unexpected isolated D1 query");
          }
          return { success: true, results: [] };
        },
        run: async (): Promise<{ success: boolean; meta: { changes: number } }> => {
          if (!query.startsWith("INSERT INTO workos_current_state_versions")) {
            throw new Error("Unexpected isolated D1 mutation");
          }
          const [dataset, instance, payload, invocation, idem] = values;
          const key = String(dataset) + ":" + String(instance);
          if (this.states.has(key)) return { success: true, meta: { changes: 0 } };
          this.states.set(key, {
            dataset_id: String(dataset), instance_id: String(instance),
            version: 1, previous_version: 0, payload_json: String(payload),
            invocation_id: String(invocation), idempotency_key: String(idem),
            db_written_at: "ISOLATED_TIME", db_read_at: "ISOLATED_TIME",
          });
          return { success: true, meta: { changes: 1 } };
        },
      }),
    };
  }
}

const db = new IsolatedD1();
const env = { DB: db as any, RUNTIME_SECRET: "ISOLATED_ONLY" };
async function post(body: object, token = "ISOLATED_ONLY") {
  const request = new Request("https://isolated.invalid/candidate/workos-persistence", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await handleWorkOsCandidatePersistence(request, env);
  return { status: response.status, body: await response.json() as Record<string, any> };
}

const read = (instance: string) => ({
  task_id: "ROLLING_WEDGE_INVESTMENT",
  caller_identity: "Rolling_Wedge_Workflow",
  operation: "READ", dataset_id: "RW_CURRENT_STATE",
  instance_id: instance, selector: { kind: "CURRENT" },
});
const write = (instance: string, caller = "Rolling_Wedge_Workflow", idem = `STATIC-${instance}-INIT-1`) => ({
  task_id: "ROLLING_WEDGE_INVESTMENT",
  caller_identity: caller, operation: "WRITE", dataset_id: "RW_CURRENT_STATE",
  instance_id: instance, expected_version: 0, idempotency_key: idem,
  payload: {
    Company_ID: instance, Company_Name: `ISOLATED ${instance} FIXTURE`,
    Ticker: instance === "GIBA" ? "GIB.A" : instance, Exchange: "ISOLATED", Currency: null, State_As_Of: null,
    Base_Source_Materials: "ISOLATED_TEST_FIXTURE", Structured_State_Content: "{}",
  },
});

// All ten instances (three incumbents, seven additions) pass the legacy guard.
const incumbents = ["ENPLAS", "SERVICENOW", "FIGMA"];
const additions = ["DSG", "DOL", "WSP", "GIBA", "NA", "ENB", "ATD"];
const accepted = [...incumbents, ...additions];
assert.equal(new Set(accepted).size, 10);
for (const id of accepted) {
  const response = await post(read(id));
  assert.equal(response.status, 404, id + " must reach empty isolated D1");
  assert.equal(response.body.error, "NOT_FOUND");
}

// Unknown, misspelled, or unlisted companies must be denied before touching D1.
for (const id of ["DGS", "UNKNOWN", "PLTR", ""]) {
  const before = db.queries;
  const response = await post(read(id));
  assert.equal(response.status, 403, id + " must be denied by static guard");
  assert.equal(response.body.error, "CONTROL_DENIED");
  assert.equal(db.queries, before);
}

// Keep identity and authentication restrictions unchanged for all seven.
for (const id of additions) {
  const before = db.queries;
  const denied = await post(write(id, "MONITOR"));
  assert.equal(denied.status, 403, id + " wrong Writer");
  assert.equal(denied.body.error, "WRITE_NOT_AUTHORIZED");
  assert.equal(db.queries, before);
}

const wrongToken = await post(read("DSG"), "WRONG");
assert.equal(wrongToken.status, 401);
assert.equal(wrongToken.body.error, "UNAUTHORIZED");

// Each of seven new instances can write v0→v1 into its OWN isolated state,
// read it back, replay identically, and rejects a second v0 bootstrap.
for (let index = 0; index < additions.length; index++) {
  const id = additions[index];
  const first = await post(write(id));
  assert.equal(first.status, 200, id + " initial write");
  assert.equal(first.body.status, "SUCCESS");
  assert.equal(first.body.version, 1);
  assert.equal(first.body.previous_version, 0);
  assert.equal(first.body.replayed, false);
  assert.equal(db.states.size, index + 1);

  const after = await post(read(id));
  assert.equal(after.status, 200);
  assert.equal(after.body.version, 1);
  assert.equal(after.body.payload.Company_ID, id);

  const replay = await post(write(id));
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(db.states.size, index + 1);

  const stale = await post(write(id, "Rolling_Wedge_Workflow", `STATIC-${id}-INIT-2`));
  assert.equal(stale.status, 409, id + " must reject new conflicting v0");
  assert.equal(stale.body.error, "STALE_STATE");

  const historyRead = await post({
    task_id: "ROLLING_WEDGE_INVESTMENT", caller_identity: "Rolling_Wedge_Workflow",
    operation: "READ", dataset_id: "RW_EVIDENCE_HISTORY",
    instance_id: id, selector: { kind: "TAIL", limit: 1 },
  });
  assert.equal(historyRead.status, 200);
  assert.deepEqual(historyRead.body.records, []);
}

for (const id of incumbents) {
  const response = await post(read(id));
  assert.equal(response.status, 404, id + " read behavior must not regress");
  assert.equal(response.body.error, "NOT_FOUND");
}
assert.equal(db.states.size, 7);
assert.deepEqual([...db.states.keys()].sort(), additions.map(id => "RW_CURRENT_STATE:" + id).sort());

console.log("PASS: all 7 static RW additions + 3 incumbents pass guard, 7 isolated v0→v1 write/readback/replay and stale denial, unknown instances & wrong Writers denied; NO real D1/Manifest/Publisher tested.");
