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
      businessAuthorityState: "DRAFT",
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

function dbFixture(options:{failLedger?:boolean}={}) {
  let rows: any[] = [];
  let ledger: any[] = [];
  let sqlWrites = 0;
  const DB = {
    prepare(sql: string) {
      return {
        bind(...args: any[]) {
          return {
            sql,args,
            async first() {
              if(sql.includes("FROM workos_initial_baseline_consumptions")) {
                const row=ledger.find(x=>x.invocation_id===args[0]);
                return row?{...row}:null;
              }
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
    async batch(statements:any[]) {
      if(statements.length!==2 ||
         !statements[0].sql.startsWith("INSERT INTO workos_current_state_versions") ||
         !statements[1].sql.startsWith("INSERT INTO workos_initial_baseline_consumptions")) {
        throw new Error("UNEXPECTED_MOCK_TRANSACTION");
      }
      sqlWrites++;
      const [dataset_id,instance_id,payload_json,invocation_id,idempotency_key]=statements[0].args;
      const [authority_scope_fingerprint,activation_epoch,manifest_id,ldataset,linstance,
        lidempotency,payload_sha256,lookupDataset,lookupInstance,lookupInvocation,
        lookupIdempotency,lookupPayload]=statements[1].args;
      // Isolated model of the real SQLite single-batch transaction: validate
      // BOTH operations and unique scopes BEFORE committing either one.
      if(options.failLedger || rows.some(r=>r.dataset_id===dataset_id&&r.instance_id===instance_id) ||
         ledger.some(l=>l.authority_scope_fingerprint===authority_scope_fingerprint&&
           l.activation_epoch===activation_epoch&&l.manifest_id===manifest_id&&
           l.dataset_id===dataset_id&&l.instance_id===instance_id) ||
         dataset_id!=="RW_CURRENT_STATE" || ldataset!==dataset_id ||
         linstance!==instance_id || lidempotency!==idempotency_key ||
         lookupDataset!==dataset_id || lookupInstance!==instance_id ||
         lookupInvocation!==invocation_id || lookupIdempotency!==idempotency_key ||
         lookupPayload!==payload_json)
        throw new Error("MOCK_D1_TRANSACTION_ROLLED_BACK");
      rows.push({dataset_id,instance_id,version:1,previous_version:0,
        payload_json,invocation_id,idempotency_key,db_written_at:"MOCK_WRITE"});
      ledger.push({authority_scope_fingerprint,activation_epoch,manifest_id,
        dataset_id,instance_id,idempotency_key,payload_sha256,
        invocation_id,db_consumed_at:"MOCK_CONSUME"});
      return [{success:true,meta:{changes:1}},{success:true,meta:{changes:1}}];
    },
  };
  return { DB, get rows() {return rows;},get ledger(){return ledger;},
    get sqlWrites() { return sqlWrites; } };
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
  ["gate-business-active-in-draft", (_, c) => { c.gate.accesses = c.gate.accesses.map(a => ({...a,businessAuthorityState:"ACTIVE"})); }],
  ["gate-business-disabled", (_, c) => { c.gate.accesses = c.gate.accesses.map(a => ({...a,businessAuthorityState:"DISABLED"})); }],
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

await check("ledger insertion failure cannot leave version one without consumption",async()=>{
  const mock=dbFixture({failLedger:true});
  const result=await invoke(write("DSG","DSG"),mock,async()=>context("DSG","DSG"));
  assert.notEqual(result.status,200);
  assert.equal(mock.rows.length,0);
  assert.equal(mock.ledger.length,0);
  assert.equal(mock.sqlWrites,1);
});
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
// Cross-check PR #1715's exact-instance negative matrix without installing a
// second resolver: every Batch07 instance is rejected absent trusted current
// ACTIVE Manifest/Gate context, across all five existing RW Dataset families.
await check("seven-by-five missing trusted ACTIVE Manifest context denied", async () => {
  const datasets = [
    "RW_CURRENT_STATE", "RW_EVIDENCE_HISTORY", "RW_REVISION_HISTORY",
    "RW_VALUATION_HISTORY", "RW_RUN_LOG",
  ];
  for (const [instance] of companies) {
    for (const dataset of datasets) {
      const mock = dbFixture();
      const request: any = { ...read(instance), dataset_id: dataset };
      if (dataset !== "RW_CURRENT_STATE") request.selector = {kind:"TAIL", limit:1};
      const rejected = await invoke(request, mock);
      assert.equal(rejected.status, 403, instance + ":" + dataset);
      assert.equal(mock.sqlWrites, 0);
    }
  }
});
await check("all seven missing exact instance in ACTIVE Manifest denied", async () => {
  for (const [instance, listedTicker] of companies) {
    const mock = dbFixture();
    const ctx = context(instance, listedTicker);
    ctx.gate.accesses = [];
    const rejected = await invoke(write(instance, listedTicker), mock, async () => ctx);
    assert.equal(rejected.status, 403, instance);
    assert.equal(mock.sqlWrites, 0);
  }
});

console.log("MOCK_ONLY_CASES_PASS", cases, "PRODUCTION_EXECUTION_NOT_AUTHORIZED");
