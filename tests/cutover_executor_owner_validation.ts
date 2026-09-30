import {
  ControlPlaneProvider,
  ExactRecord,
  ExecutorCore,
  ExecutorInput,
  FaultInjectingProvider,
  GoogleSheetsControlPlaneProvider,
  MutationResult,
  SheetsLocator,
  TargetRoot,
  exactEqual,
} from "../src/cutover_executor";
import {
  MATERIALIZED_FIXTURE_LOCATORS,
  MATERIALIZED_FIXTURE_PRODUCTION_DENYLIST_ID,
  MATERIALIZED_FIXTURE_ROOT_ID,
  MATERIALIZED_FIXTURE_SPREADSHEET_ID,
} from "../src/cutover_witness_fixture";

class MemoryProvider implements ControlPlaneProvider {
  readonly state = new Map<string, ExactRecord>();
  readonly mutationCount = new Map<string, number>();

  key(x: SheetsLocator): string {
    return [x.spreadsheetId, x.range, x.columns.join(",")].join("|");
  }

  seed(locator: SheetsLocator, value: ExactRecord): void {
    this.state.set(this.key(locator), structuredClone(value));
  }

  async readExact(locator: SheetsLocator): Promise<ExactRecord> {
    const value = this.state.get(this.key(locator));
    if (!value) throw new Error("unreadable");
    return structuredClone(value);
  }

  async mutateExact(locator: SheetsLocator, value: ExactRecord): Promise<MutationResult> {
    const key = this.key(locator);
    this.state.set(key, structuredClone(value));
    this.mutationCount.set(key, (this.mutationCount.get(key) ?? 0) + 1);
    return { outcome: "CONFIRMED" };
  }
}

const cols = {
  authority: ["Current_Committed_Cutover_ID", "Current_Activation_Epoch"] as const,
  activation: [
    "Cutover_ID",
    "Authority_Scope_Fingerprint",
    "Registry_Snapshot_ID",
    "Manifest_Set_ID",
    "Gate_Config_Fingerprint",
    "Workflow_Set_Fingerprint",
    "Target_Acceptance_Binding_ID",
  ] as const,
  protection: ["Cutover_State", "Migration_Write_Fence_State", "Maintenance_State"] as const,
  epochs: ["Used_Epochs_JSON"] as const,
  session: ["Session_ID", "Capability_State"] as const,
};

const authority = MATERIALIZED_FIXTURE_LOCATORS.authorityPublication as SheetsLocator;
const activation = MATERIALIZED_FIXTURE_LOCATORS.candidateActivation as SheetsLocator;
const protection = MATERIALIZED_FIXTURE_LOCATORS.protection as SheetsLocator;
const epochs = MATERIALIZED_FIXTURE_LOCATORS.usedEpochs as SheetsLocator;
const session = MATERIALIZED_FIXTURE_LOCATORS.sessionCapability as SheetsLocator;
const realProviderTarget = MATERIALIZED_FIXTURE_LOCATORS.realProviderTarget as SheetsLocator;

const root: TargetRoot = {
  rootId: MATERIALIZED_FIXTURE_ROOT_ID,
  fixtureAuthority: false,
  fixtureSpreadsheetId: MATERIALIZED_FIXTURE_SPREADSHEET_ID,
  productionDenylistId: MATERIALIZED_FIXTURE_PRODUCTION_DENYLIST_ID,
  locators: {
    authorityPublication: authority,
    candidateActivation: activation,
    protection,
    usedEpochs: epochs,
    sessionCapability: session,
  },
  mutationAllowlist: [authority, protection, session, realProviderTarget],
};

const frozenActivation: ExactRecord = {
  Cutover_ID: "CUT_FIXTURE_TARGET",
  Authority_Scope_Fingerprint: "fixture-scope",
  Registry_Snapshot_ID: "RS_FIXTURE",
  Manifest_Set_ID: "MSET_FIXTURE",
  Gate_Config_Fingerprint: "gate-fixture",
  Workflow_Set_Fingerprint: "workflow-fixture",
  Target_Acceptance_Binding_ID: "AB_FIXTURE",
};

function seed(provider: MemoryProvider, sessionId = "SESSION_001"): void {
  provider.seed(authority, {
    Current_Committed_Cutover_ID: "CUT_FIXTURE_PREV",
    Current_Activation_Epoch: 10,
  });
  provider.seed(activation, frozenActivation);
  provider.seed(protection, {
    Cutover_State: "AUTHORITY_PREPARED",
    Migration_Write_Fence_State: "ACTIVE",
    Maintenance_State: "BLOCKED",
  });
  provider.seed(epochs, { Used_Epochs_JSON: "[1,2,3,4,5,6,7,8,9,10]" });
  provider.seed(session, { Session_ID: sessionId, Capability_State: "OPEN" });
}

function makeInput(sessionId = "SESSION_001"): ExecutorInput {
  return {
    mode: "WITNESS",
    sessionId,
    root,
    expectedPredecessorCutoverId: "CUT_FIXTURE_PREV",
    expectedPredecessorEpoch: 10,
    targetEpoch: 11,
    frozenActivation: { fields: frozenActivation },
    transitionPlan: [
      {
        id: "AUTHORITY_PUBLICATION",
        target: authority,
        expectedBefore: {
          Current_Committed_Cutover_ID: "CUT_FIXTURE_PREV",
          Current_Activation_Epoch: 10,
        },
        desiredAfter: {
          Current_Committed_Cutover_ID: "CUT_FIXTURE_TARGET",
          Current_Activation_Epoch: 11,
        },
      },
      {
        id: "CUTOVER_COMPLETE",
        target: protection,
        expectedBefore: {
          Cutover_State: "AUTHORITY_PREPARED",
          Migration_Write_Fence_State: "ACTIVE",
          Maintenance_State: "BLOCKED",
        },
        desiredAfter: {
          Cutover_State: "COMPLETE",
          Migration_Write_Fence_State: "RELEASED",
          Maintenance_State: "RELEASED",
        },
      },
    ],
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function case1(): Promise<void> {
  const p = new MemoryProvider(); seed(p);
  const result = await new ExecutorCore(p).execute(makeInput());
  assert(result.ok && result.status === "READY_FOR_RELAY", "CASE_1 exact match failed");
}

async function case2(): Promise<void> {
  const p = new MemoryProvider(); seed(p);
  p.seed(authority, { Current_Committed_Cutover_ID: "WRONG", Current_Activation_Epoch: 10 });
  const result = await new ExecutorCore(p).execute(makeInput());
  assert(!result.ok && result.stop === "PREDECESSOR_MISMATCH", "CASE_2 predecessor mismatch not stopped");
  assert((p.mutationCount.get(p.key(authority)) ?? 0) === 0, "CASE_2 mutated");
}

async function case3(): Promise<void> {
  const p = new MemoryProvider(); seed(p);
  const input = makeInput(); input.targetEpoch = 10;
  const result = await new ExecutorCore(p).execute(input);
  assert(!result.ok && result.stop === "NON_MONOTONIC_OR_REUSED_EPOCH", "CASE_3 non-monotonic not stopped");
}

async function case4(): Promise<void> {
  const p = new MemoryProvider(); seed(p);
  p.seed(activation, { ...frozenActivation, Workflow_Set_Fingerprint: "DRIFT" });
  const result = await new ExecutorCore(p).execute(makeInput());
  assert(!result.ok && result.stop === "ACTIVATION_OBJECT_DRIFT", "CASE_4 drift not stopped");
}

async function case5(): Promise<void> {
  const p = new MemoryProvider(); seed(p);
  const fault = new FaultInjectingProvider(p, "WITNESS", [authority, activation, protection, epochs, session], {
    control: "FAULT_SOURCE_UNREADABLE",
    designatedLocator: activation,
  });
  const result = await new ExecutorCore(fault).execute(makeInput());
  assert(!result.ok && result.stop === "SOURCE_UNREADABLE", "CASE_5 unreadable not stopped");
  assert([...p.mutationCount.values()].reduce((a, b) => a + b, 0) === 0, "CASE_5 mutated");
}

async function case6(): Promise<void> {
  const p = new MemoryProvider(); seed(p);
  const fault = new FaultInjectingProvider(p, "WITNESS", root.mutationAllowlist, {
    control: "FAULT_AMBIGUOUS_AFTER_COMMIT",
    designatedLocator: authority,
  });
  const result = await new ExecutorCore(fault).execute(makeInput());
  assert(result.ok, "CASE_6 committed ambiguity failed reconciliation");
  assert(result.reconciledAmbiguousSteps.includes("AUTHORITY_PUBLICATION"), "CASE_6 no ambiguity reconciliation evidence");
  assert((p.mutationCount.get(p.key(authority)) ?? 0) === 1, "CASE_6 blind retry occurred");

  const u = new MemoryProvider(); seed(u);
  const unresolved = new FaultInjectingProvider(u, "WITNESS", root.mutationAllowlist, {
    control: "FAULT_AMBIGUOUS_UNRESOLVED",
    designatedLocator: authority,
  });
  const stop = await new ExecutorCore(unresolved).execute(makeInput());
  assert(!stop.ok && stop.stop === "MUTATION_OUTCOME_AMBIGUOUS", "CASE_6 unresolved ambiguity did not stop");
  assert((u.mutationCount.get(u.key(authority)) ?? 0) === 1, "CASE_6 unresolved ambiguity duplicated mutation");
}

async function case7(): Promise<void> {
  const p = new MemoryProvider(); seed(p);
  p.seed(authority, {
    Current_Committed_Cutover_ID: "CUT_FIXTURE_PREV",
    Current_Activation_Epoch: 10,
  });
  const input = makeInput();
  const originalRead = p.readExact.bind(p);
  let firstTransitionRead = true;
  p.readExact = async (locator: SheetsLocator): Promise<ExactRecord> => {
    if (p.key(locator) === p.key(authority) && !firstTransitionRead) {
      return {
        Current_Committed_Cutover_ID: "CUT_FIXTURE_TARGET",
        Current_Activation_Epoch: 11,
      };
    }
    const result = await originalRead(locator);
    if (p.key(locator) === p.key(authority)) firstTransitionRead = false;
    return result;
  };
  const result = await new ExecutorCore(p).execute(input);
  assert(result.ok && result.recoveredSteps.includes("AUTHORITY_PUBLICATION"), "CASE_7 partial recovery not recognized");
  assert((p.mutationCount.get(p.key(authority)) ?? 0) === 0, "CASE_7 repeated completed prefix mutation");
}

async function case8(): Promise<void> {
  const p = new MemoryProvider(); seed(p);
  const core = new ExecutorCore(p);
  const run = await core.execute(makeInput());
  assert(run.ok, "CASE_8 initial execution failed");

  let relayStatus: "PREPARED" | "COMMITTED" = "PREPARED";
  const verifier = {
    async verify(status: "PREPARED" | "COMMITTED", sessionId: string): Promise<boolean> {
      return status === relayStatus && sessionId === "SESSION_001";
    },
  };

  const prepared = await core.acknowledgeRelayPrepared("WITNESS", "SESSION_001", root, verifier);
  assert(
    prepared.ok && prepared.status === "RELAY_PREPARED_VERIFIED",
    "CASE_8 PREPARED exact readback was not verified",
  );
  const afterPrepared = await p.readExact(session);
  assert(
    afterPrepared.Capability_State === "OPEN",
    "CASE_8 PREPARED incorrectly closed mutation capability before COMMITTED",
  );

  const prematureClose = await core.closeSessionAfterRelay("WITNESS", "SESSION_001", root, verifier);
  assert(
    !prematureClose.ok && prematureClose.stop === "RELAY_FINALITY_NOT_PROVEN",
    "CASE_8 closed without COMMITTED exact readback",
  );
  assert((await p.readExact(session)).Capability_State === "OPEN", "CASE_8 premature close changed session state");

  relayStatus = "COMMITTED";
  const close = await core.closeSessionAfterRelay("WITNESS", "SESSION_001", root, verifier);
  assert(close.ok && close.status === "COMPLETE", "CASE_8 session close failed after COMMITTED");

  const before = [...p.mutationCount.values()].reduce((a, b) => a + b, 0);
  const denied = await core.execute(makeInput());
  const after = [...p.mutationCount.values()].reduce((a, b) => a + b, 0);
  assert(!denied.ok && denied.stop === "SESSION_MUTATION_CAPABILITY_CLOSED", "CASE_8 closed session not denied");
  assert(before === after, "CASE_8 mutation occurred after terminal close");
}

async function extraGuards(): Promise<void> {
  const p = new MemoryProvider(); seed(p);
  let productionFaultRejected = false;
  try {
    new FaultInjectingProvider(p, "PRODUCTION", root.mutationAllowlist, {
      control: "FAULT_AMBIGUOUS_AFTER_COMMIT",
      designatedLocator: authority,
    });
  } catch (error) {
    productionFaultRejected = String(error).includes("WITNESS_FAULT_FORBIDDEN_IN_PRODUCTION");
  }
  assert(productionFaultRejected, "production mode enabled witness fault");

  const deniedRoot: TargetRoot = {
    ...root,
    locators: {
      ...root.locators,
      authorityPublication: {
        ...authority,
        spreadsheetId: "1Ckqy598EPE9CO3gejn2b0sLC3IC1_FcwScRFPE2JumM",
      },
    },
  };
  const result = await new ExecutorCore(p).execute({ ...makeInput(), root: deniedRoot });
  assert(
    !result.ok && (result.stop === "PRODUCTION_TARGET_DENIED" || result.stop === "FIXTURE_TARGET_NOT_ALLOWLISTED"),
    "production File_ID denylist not enforced",
  );

  const logicalDeniedRoot: TargetRoot = {
    ...root,
    locators: {
      ...root.locators,
      authorityPublication: {
        ...authority,
        logicalIdentity: "RW_CURRENT_STATE:ENPLAS",
      },
    },
  };
  const logicalDenied = await new ExecutorCore(p).execute({ ...makeInput(), root: logicalDeniedRoot });
  assert(!logicalDenied.ok && logicalDenied.stop === "PRODUCTION_TARGET_DENIED", "production Dataset/Instance denylist not enforced");

  const resetProvider = new MemoryProvider(); seed(resetProvider);
  const resetSnapshot = new Map<SheetsLocator, ExactRecord>([
    [authority, { Current_Committed_Cutover_ID: "RESET", Current_Activation_Epoch: 20 }],
    [session, { Session_ID: "SESSION_001", Capability_State: "OPEN" }],
  ]);
  const { deterministicFixtureReset } = await import("../src/cutover_executor");
  await deterministicFixtureReset(resetProvider, root, resetSnapshot);
  assert(
    exactEqual(await resetProvider.readExact(authority), { Current_Committed_Cutover_ID: "RESET", Current_Activation_Epoch: 20 }),
    "deterministic fixture reset failed",
  );

  const prodProvider = new MemoryProvider(); seed(prodProvider);
  const prodResult = await new ExecutorCore(prodProvider).execute({ ...makeInput(), mode: "PRODUCTION" });
  assert(prodResult.ok, "shared ExecutorCore production mode failed owner validation");

  let capturedUrl = "";
  let capturedMethod = "";
  let capturedBody = "";
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    capturedUrl = String(input);
    capturedMethod = init?.method ?? "GET";
    capturedBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ replies: [{}] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const google = new GoogleSheetsControlPlaneProvider({ accessToken: "owner-test", fetchImpl: fakeFetch as typeof fetch });
  const providerResult = await google.mutateExact(realProviderTarget, {
    Target_ID: "REAL_PROVIDER_TARGET",
    Version: 2,
    State: "AFTER_COMMIT",
    Last_Mutation_ID: "OWNER_TEST_001",
  });
  assert(providerResult.outcome === "CONFIRMED", "Google provider batchUpdate contract did not confirm");
  assert(capturedUrl.endsWith(":batchUpdate"), "Google provider did not use spreadsheets.batchUpdate");
  assert(capturedMethod === "POST", "Google provider batchUpdate did not use POST");
  const parsed = JSON.parse(capturedBody) as { requests?: Array<{ updateCells?: { range?: { sheetId?: number } } }> };
  assert(
    parsed.requests?.[0]?.updateCells?.range?.sheetId === realProviderTarget.sheetId,
    "Google provider did not bind exact fixture sheetId",
  );

  assert(MATERIALIZED_FIXTURE_ROOT_ID.startsWith("GFR1_"), "fixture root identity missing");
  assert(MATERIALIZED_FIXTURE_SPREADSHEET_ID === authority.spreadsheetId, "fixture locator set is not exact");
  assert(exactEqual({ b: 2, a: 1 }, { a: 1, b: 2 }), "exact equality canonical ordering failed");
}

async function main(): Promise<void> {
  await case1();
  await case2();
  await case3();
  await case4();
  await case5();
  await case6();
  await case7();
  await case8();
  await extraGuards();
  console.log(JSON.stringify({
    owner_validation: "PASS",
    official_migration_witness: "NOT_EXECUTED",
    same_core: "ExecutorCore",
    cases: {
      EXACT_MATCH_SUCCESS: "PASS",
      PREDECESSOR_MISMATCH: "PASS",
      NON_MONOTONIC_OR_REUSED_EPOCH: "PASS",
      ACTIVATION_OBJECT_DRIFT: "PASS",
      SOURCE_UNREADABLE: "PASS",
      AMBIGUOUS_MUTATION_RECONCILIATION: "PASS",
      SAME_TRANSITION_PARTIAL_RECOVERY: "PASS",
      POST_COMMITTED_SESSION_DENIAL: "PASS",
    },
    extra: {
      ambiguous_unresolved_stop: "PASS",
      production_fault_rejection: "PASS",
      production_denylist: "PASS",
      materialized_fixture_binding: "PASS",
      google_batch_update_contract: "PASS",
      prepared_does_not_close_session: "PASS",
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
