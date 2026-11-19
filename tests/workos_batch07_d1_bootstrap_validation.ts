import assert from "node:assert/strict";
import { handleWorkOsCandidatePersistence } from "../src/workos_candidate.js";
import {
  PINNED_GATE_BLOB, PINNED_GATE_CONFIG_FINGERPRINT, PINNED_GATE_LOCATOR,
  type GateProjectionSnapshot,
} from "../src/workos_persistent_gate_projection.js";
import type { TrustedDynamicInstanceContext } from "../src/workos_d1_bootstrap_guard.js";

/**
 * Mock-only, independently isolated D1 statement fixture.
 * No network, Google, Cloudflare, real D1, production Gate or Publisher.
 */
const companies = [
  ["DSG", "DSG"], ["DOL", "DOL"], ["WSP", "WSP"], ["GIBA", "GIB.A"],
  ["NA", "NA"], ["ENB", "ENB"], ["ATD", "ATD"],
] as const;

function gate(instanceId: string): GateProjectionSnapshot {
  return {
    gateLocator: PINNED_GATE_LOCATOR, gateBlob: PINNED_GATE_BLOB,
    gateConfigFingerprint: PINNED_GATE_CONFIG_FINGERPRINT,
    authorityPublicationState: "EXACT_ONE",
    authorityPublication: {
      authorityScopeFingerprint: "mock-scope", currentCommittedCutoverId: "MOCK-CUT",
      currentActivationEpoch: "mock-epoch", registrySnapshotId: "RS-MOCK",
      manifestSetId: "MSET-MOCK", gateConfigFingerprint: PINNED_GATE_CONFIG_FINGERPRINT,
      workflowSetFingerprint: "WF-MOCK",
    },
    expectedAuthorityScopeFingerprint: "mock-scope", expectedCutoverId: "MOCK-CUT",
    expectedActivationEpoch: "mock-epoch", expectedManifestSetId: "MSET-MOCK",
    expectedGateConfigFingerprint: PINNED_GATE_CONFIG_FINGERPRINT,
    expectedWorkflowSetFingerprint: "WF-MOCK", referencedCutoverState: "COMPLETE",
    currentRegistrySnapshotId: "RS-MOCK", currentRegistryFingerprint: "RF-MOCK",
    manifestId: "MS-MOCK", taskId: "ROLLING_WEDGE_INVESTMENT",
    manifestState: "ACTIVE", manifestRegistrySnapshotId: "RS-MOCK",
    manifestRegistryFingerprint: "RF-MOCK", migrationFenceActive: false,
    pruneFenceIndexAvailable: true, pruneFencedKeys: new Set(),
    startedPruneKeys: new Set(), archivedIdentityKeys: new Set(),
    accesses: [{
      datasetId: "RW_CURRENT_STATE", instanceId,
      logicalMember: "D1_BOUND_DATASET:RW_CURRENT_STATE;Binding=DB",
      contractFingerprint: "mock-schema", physicalContractFingerprint: "mock-schema",
      readers: new Set(["Rolling_Wedge_Workflow"]),
      writerScopes: [{
        writerId: "Rolling_Wedge_Workflow",
        operations: new Set(["CONDITIONAL_CURRENT_STATE"]),
        fields: new Set([
          "Company_ID", "Company_Name", "Ticker", "Exchange", "Currency",
          "State_As_Of", "Base_Source_Materials", "Structured_State_Content",
        ]),
      }],
      writeMode: "CURRENT_STATE", dynamicInstance: true,
      businessAuthorityState: "ACTIVE",
    }],
  };
}

function context(instanceId: string, ticker: string, grant = true): TrustedDynamicInstanceContext {
  return {
    gate: gate(instanceId),
    registry: {
      companyId: instanceId, companyName: "Mock " + instanceId,
      ticker, exchange: "TSX", stateStatus: "DRAFT",
      monitorEnabled: false, archived: false,
    },
    authorizeInitialBaseline: async (scope) =>
      grant && scope.instanceId === instanceId &&
      scope.expectedVersion === 0 &&
      scope.datasetId === "RW_CURRENT_STATE" &&
      scope.callerIdentity === "Rolling_Wedge_Workflow" &&
      scope.manifestId === "MS-MOCK" &&
      scope.authorityFingerprint === "mock-scope" &&
      scope.idempotencyKey === "bootstrap-" + instanceId,
  };
}

function payload(instanceId: string, ticker: string) {
  return {
    Company_ID: instanceId, Company_Name: "Mock " + instanceId, Ticker: ticker,
    Exchange: "TSX", Currency: null, State_As_Of: null,
    Base_Source_Materials: "https://docs.google.com/document/d/mock-source/edit",
    Structured_State_Content: { source_only: true, accepted_belief: null },
  };
}

function write(instanceId: string, ticker: string) {
  return {
    task_id: "ROLLING_WEDGE_INVESTMENT", caller_identity: "Rolling_Wedge_Workflow",
    operation: "WRITE", dataset_id: "RW_CURRENT_STATE", instance_id: instanceId,
    bootstrap_mode: "INITIAL_BASELINE", expected_version: 0,
    idempotency_key: "bootstrap-" + instanceId, payload: payload(instanceId, ticker),
  };
}
function read(instanceId: string) {
  return {
    task_id: "ROLLING_WEDGE_INVESTMENT", caller_identity: "Rolling_Wedge_Workflow",
    operation: "READ", dataset_id: "RW_CURRENT_STATE", instance_id: instanceId,
    selector: { kind: "CURRENT" },
  };
}

function dbFixture() {
  let rows: any[] = [];
  let sqlWrites = 0;
  const DB = {
    prepare(sql: string) {
      return {
        bind(...args: any[]) {
          return {
            async first() {
              const row = sql.includes("WHERE idempotency_key=?") ? rows.find(x => x.idempotency_key === args[0]) :
                sql.includes("WHERE invocation_id=?") ? rows.find(x => x.invocation_id === args[0]) :
                rows.filter(x => x.dataset_id === args[0] && x.instance_id === args[1])
                  .sort((a,b) => b.version - a.version)[0];
              return row ? { ...row, db_read_at: "MOCK_READBACK" } : null;
            },
            async run() {
              if (!sql.startsWith("INSERT INTO workos_current_state_versions")) {
                throw new Error("UNEXPECTED_MOCK_SQL_WRITE");
              }
              sqlWrites += 1;
              const [dataset_id, instance_id, payload_json, invocation_id, idempotency_key] = args;
              const existing = rows.find(x => x.dataset_id === dataset_id && x.instance_id === instance_id);
              if (existing || rows.some(x => x.idempotency_key === idempotency_key)) {
                return { success: true, meta: { changes: 0 } };
              }
              rows.push({
                dataset_id, instance_id, version: 1, previous_version: 0,
                payload_json, invocation_id, idempotency_key, db_written_at: "MOCK_WRITE",
              });
              return { success: true, meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
  return { DB, get rows() { return rows; }, get sqlWrites() { return sqlWrites; } };
}

async function invoke(body: unknown, mock: ReturnType<typeof dbFixture>,
  resolver?: (arg: any) => Promise<TrustedDynamicInstanceContext>) {
  const request = new Request("https://test.invalid/candidate/workos-persistence", {
    method: "POST", headers: { "Authorization": "Bearer mock-secret" },
    body: JSON.stringify(body),
  });
  const response = await handleWorkOsCandidatePersistence(request, {
    DB: mock.DB as any, RUNTIME_SECRET: "mock-secret",
    ...(resolver ? { resolveDynamicD1Context: resolver } : {}),
  });
  return { status: response.status, body: await response.json() as any };
}

let cases = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn(); cases++; console.log("PASS", name);
}

for (const [id, ticker] of companies) {
  await check("DRAFT " + id + " scoped v0->v1 plus independent readback, replay and stale denial", async () => {
    const mock = dbFixture(), resolve = async () => context(id, ticker);
    const first = await invoke(write(id, ticker), mock, resolve);
    assert.equal(first.status, 200);
    assert.equal(first.body.version, 1);
    assert.equal(first.body.previous_version, 0);
    assert.equal(first.body.replayed, false);
    assert.equal(mock.sqlWrites, 1);
    const independent = await invoke(read(id), mock, resolve);
    assert.equal(independent.status, 200);
    assert.equal(independent.body.version, 1);
    assert.equal(independent.body.payload.Company_ID, id);
    assert.equal(independent.body.payload.Ticker, ticker);
    const replay = await invoke(write(id, ticker), mock, resolve);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(mock.sqlWrites, 1);
    // The old one-use scope must not authorize a new idempotency key.
    const unauthorizedStale = await invoke(
      { ...write(id, ticker), idempotency_key: "stale-" + id }, mock, resolve);
    assert.equal(unauthorizedStale.status, 403);
    assert.equal(mock.sqlWrites, 1);
    // Even with a distinct bounded test-only grant, v0 cannot overwrite v1.
    const staleContext = context(id, ticker);
    staleContext.authorizeInitialBaseline = async scope =>
      scope.instanceId === id && scope.expectedVersion === 0 &&
      scope.idempotencyKey === "stale-" + id;
    const stale = await invoke(
      { ...write(id, ticker), idempotency_key: "stale-" + id },
      mock, async () => staleContext);
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error, "STALE_STATE");
    assert.equal(mock.sqlWrites, 2);
  });
}

const id = "GIBA", ticker = "GIB.A";
const denied: Array<[string, (req: any, ctx: TrustedDynamicInstanceContext) => void]> = [
  ["wrong-issuer", (r) => { r.caller_identity = "MONITOR"; }],
  ["wrong-dataset", (r) => { r.dataset_id = "RW_RUN_LOG"; }],
  ["wrong-instance", (r) => { r.instance_id = "HACK"; }],
  ["wildcard-instance", (r) => { r.instance_id = "*"; }],
  ["wrong-expected-version", (r) => { r.expected_version = 1; }],
  ["not-initial-mode", (r) => { delete r.bootstrap_mode; }],
  ["other-bootstrap-mode", (r) => { r.bootstrap_mode = "ANY"; }],
  ["ticker-spoof", (r) => { r.payload.Ticker = "GIBA"; }],
  ["extra-field", (r) => { r.payload.Valuation_State_ID = "ACCEPTED"; }],
  ["currency-not-null", (r) => { r.payload.Currency = "CAD"; }],
  ["archive-registry", (_, c) => { c.registry.archived = true; }],
  ["draft-monitor-enabled", (_, c) => { c.registry.monitorEnabled = true; }],
  ["gate-business-draft", (_, c) => { c.gate.accesses = c.gate.accesses.map(a => ({...a,businessAuthorityState:"DRAFT"})); }],
  ["manifest-not-active", (_, c) => { c.gate.manifestState = "CANDIDATE"; }],
  ["gate-epoch-drift", (_, c) => { c.gate.expectedActivationEpoch = "different"; }],
  ["gate-fingerprint-drift", (_, c) => { c.gate.gateConfigFingerprint = "bad"; }],
  ["physical-contract-drift", (_, c) => { c.gate.accesses = c.gate.accesses.map(a=>({...a,physicalContractFingerprint:"bad"})); }],
  ["migration-write-fence", (_, c) => { c.gate.migrationFenceActive = true; }],
  ["duplicate-instance-projection", (_, c) => { c.gate.accesses = [...c.gate.accesses,c.gate.accesses[0]]; }],
  ["wrong-writer-operation", (_, c) => { c.gate.accesses = c.gate.accesses.map(a => ({...a,writerScopes:[]})); }],
];

for (const [name, modify] of denied) {
  await check("fail closed " + name + " before D1 mutation", async () => {
    const mock = dbFixture(), req: any = structuredClone(write(id, ticker));
    const ctx = context(id, ticker);
    modify(req,ctx);
    const result = await invoke(req, mock, async () => ctx);
    assert.ok(result.status === 400 || result.status === 403);
    assert.equal(mock.sqlWrites, 0);
  });
}

await check("missing resolver no D1 write", async () => {
  const mock=dbFixture();
  const result=await invoke(write(id,ticker),mock);
  assert.equal(result.status,403); assert.equal(mock.sqlWrites,0);
});
await check("no bootstrap grant no D1 write", async () => {
  const mock=dbFixture(), ctx=context(id,ticker);
  delete ctx.authorizeInitialBaseline;
  const result=await invoke(write(id,ticker),mock,async()=>ctx);
  assert.equal(result.status,403); assert.equal(mock.sqlWrites,0);
});
await check("rejected external grant no D1 write", async () => {
  const mock=dbFixture();
  const result=await invoke(write(id,ticker),mock,async()=>context(id,ticker,false));
  assert.equal(result.status,403); assert.equal(mock.sqlWrites,0);
});
await check("conflicting idempotency payload no overwrite", async () => {
  const mock=dbFixture(), resolve=async()=>context(id,ticker);
  assert.equal((await invoke(write(id,ticker),mock,resolve)).status,200);
  const changed:any=structuredClone(write(id,ticker));
  changed.payload.Structured_State_Content={source_only:true,accepted_belief:null,changed:true};
  const result=await invoke(changed,mock,resolve);
  assert.equal(result.status,409);
  assert.equal(result.body.error,"IDEMPOTENCY_CONFLICT");
  assert.equal(mock.rows.length,1);
});
await check("DRAFT read only current workflow and exact active manifest", async () => {
  const mock=dbFixture(), ctx=context(id,ticker);
  const q:any=read(id); q.selector={kind:"TAIL",limit:100};
  assert.equal((await invoke(q,mock,async()=>ctx)).status,403);
  assert.equal(mock.sqlWrites,0);
});
console.log("MOCK_ONLY_CASES_PASS", cases, "PRODUCTION_EXECUTION_NOT_AUTHORIZED");
