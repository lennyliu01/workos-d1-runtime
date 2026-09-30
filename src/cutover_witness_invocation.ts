import {
  ControlPlaneProvider,
  ExactRecord,
  ExactRelayRowVerifier,
  ExecutorCore,
  ExecutorInput,
  ExecutorResult,
  FaultControl,
  FaultInjectingProvider,
  GoogleSheetsControlPlaneProvider,
  MutationResult,
  SheetsLocator,
  TargetRoot,
  deterministicFixtureReset,
  exactEqual,
} from "./cutover_executor";
import {
  MATERIALIZED_CASE8_FINALITY_SURFACE_ID,
  MATERIALIZED_FIXTURE_INITIAL_STATE,
  MATERIALIZED_FIXTURE_LOCATORS,
  MATERIALIZED_FIXTURE_PRODUCTION_DENYLIST_ID,
  MATERIALIZED_FIXTURE_ROOT_ID,
  MATERIALIZED_FIXTURE_SPREADSHEET_ID,
} from "./cutover_witness_fixture";

export const CUTOVER_WITNESS_INVOCATION_VERSION = "CUTOVER_WITNESS_INVOCATION_V1";
export const CUTOVER_WITNESS_AGENT_ID = "CUTOVER_EXECUTOR";

export type FormalWitnessCaseId =
  | "CASE_1_EXACT_MATCH"
  | "CASE_2_PREDECESSOR_MISMATCH"
  | "CASE_3_NON_MONOTONIC"
  | "CASE_4_ACTIVATION_DRIFT"
  | "CASE_5_SOURCE_UNREADABLE"
  | "CASE_6A_AMBIGUOUS_AFTER_COMMIT"
  | "CASE_6B_AMBIGUOUS_UNRESOLVED"
  | "CASE_7_PARTIAL_RECOVERY"
  | "CASE_7_FOREIGN_SUCCESSOR_GUARD"
  | "CASE_8_POST_COMMITTED_DENIAL"
  | "NEGATIVE_PRODUCTION_DENYLIST";

export interface CutoverWitnessInvocationRequest {
  operation: "CUTOVER_EXECUTOR_WITNESS";
  invocation_version: typeof CUTOVER_WITNESS_INVOCATION_VERSION;
  case_id: FormalWitnessCaseId;
  run_id: string;
  session_id: string;
  fixture_root_id: typeof MATERIALIZED_FIXTURE_ROOT_ID;
  fixture_spreadsheet_id: typeof MATERIALIZED_FIXTURE_SPREADSHEET_ID;
  case8_finality_surface_id?: typeof MATERIALIZED_CASE8_FINALITY_SURFACE_ID;
}

export interface CutoverWitnessInvocationResult {
  invocation_version: typeof CUTOVER_WITNESS_INVOCATION_VERSION;
  case_id: FormalWitnessCaseId;
  executor_core: "ExecutorCore";
  provider: "GoogleSheetsControlPlaneProvider";
  fixture_root_id: typeof MATERIALIZED_FIXTURE_ROOT_ID;
  result: ExecutorResult;
  provider_mutations: Readonly<Record<string, number>>;
  provider_reads: Readonly<Record<string, number>>;
  case8?: {
    prepared_verified: boolean;
    committed_verified: boolean;
    session_closed: boolean;
    post_close_transition_mutation_delta: number;
    finality_surface_id: typeof MATERIALIZED_CASE8_FINALITY_SURFACE_ID;
  };
}

const authority = MATERIALIZED_FIXTURE_LOCATORS.authorityPublication as SheetsLocator;
const activation = MATERIALIZED_FIXTURE_LOCATORS.candidateActivation as SheetsLocator;
const protection = MATERIALIZED_FIXTURE_LOCATORS.protection as SheetsLocator;
const epochs = MATERIALIZED_FIXTURE_LOCATORS.usedEpochs as SheetsLocator;
const session = MATERIALIZED_FIXTURE_LOCATORS.sessionCapability as SheetsLocator;
const realProviderTarget = MATERIALIZED_FIXTURE_LOCATORS.realProviderTarget as SheetsLocator;
const relayFinality = MATERIALIZED_FIXTURE_LOCATORS.relayFinality as SheetsLocator;

const allFixtureLocators = [
  authority,
  activation,
  protection,
  epochs,
  session,
  realProviderTarget,
  relayFinality,
] as const;

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
  mutationAllowlist: allFixtureLocators,
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

function locatorKey(locator: SheetsLocator): string {
  return [
    locator.logicalIdentity,
    locator.spreadsheetId,
    String(locator.sheetId),
    locator.range,
  ].join("|");
}

class CountingProvider implements ControlPlaneProvider {
  readonly mutationCount = new Map<string, number>();
  readonly readCount = new Map<string, number>();

  constructor(private readonly inner: ControlPlaneProvider) {}

  async readExact(locator: SheetsLocator): Promise<ExactRecord> {
    const key = locatorKey(locator);
    this.readCount.set(key, (this.readCount.get(key) ?? 0) + 1);
    return this.inner.readExact(locator);
  }

  async mutateExact(locator: SheetsLocator, value: ExactRecord): Promise<MutationResult> {
    const key = locatorKey(locator);
    this.mutationCount.set(key, (this.mutationCount.get(key) ?? 0) + 1);
    return this.inner.mutateExact(locator, value);
  }

  mutationCountFor(locator: SheetsLocator): number {
    return this.mutationCount.get(locatorKey(locator)) ?? 0;
  }

  mutationSnapshot(): Record<string, number> {
    return Object.fromEntries(this.mutationCount.entries());
  }

  readSnapshot(): Record<string, number> {
    return Object.fromEntries(this.readCount.entries());
  }
}

function makeInput(sessionId: string): ExecutorInput {
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

function snapshotFor(sessionId: string, runId: string): ReadonlyMap<SheetsLocator, ExactRecord> {
  return new Map<SheetsLocator, ExactRecord>([
    [authority, { ...MATERIALIZED_FIXTURE_INITIAL_STATE.authorityPublication }],
    [activation, { ...MATERIALIZED_FIXTURE_INITIAL_STATE.candidateActivation }],
    [protection, { ...MATERIALIZED_FIXTURE_INITIAL_STATE.protection }],
    [epochs, { ...MATERIALIZED_FIXTURE_INITIAL_STATE.usedEpochs }],
    [session, { Session_ID: sessionId, Capability_State: "OPEN" }],
    [realProviderTarget, { ...MATERIALIZED_FIXTURE_INITIAL_STATE.realProviderTarget }],
    [
      relayFinality,
      {
        run_id: runId,
        agent_id: CUTOVER_WITNESS_AGENT_ID,
        session_id: sessionId,
        status: "RESET",
      },
    ],
  ]);
}

async function exactFixtureReset(
  provider: ControlPlaneProvider,
  sessionId: string,
  runId: string,
): Promise<void> {
  await deterministicFixtureReset(provider, root, snapshotFor(sessionId, runId));
}

async function exactSetupMutation(
  provider: ControlPlaneProvider,
  locator: SheetsLocator,
  value: ExactRecord,
): Promise<void> {
  const result = await provider.mutateExact(locator, value);
  if (result.outcome !== "CONFIRMED") throw new Error("FIXTURE_SETUP_AMBIGUOUS");
  const readback = await provider.readExact(locator);
  if (!exactEqual(readback, value)) throw new Error("FIXTURE_SETUP_READBACK_MISMATCH");
}

function faultForCase(caseId: FormalWitnessCaseId): { control: FaultControl; locator: SheetsLocator } {
  if (caseId === "CASE_5_SOURCE_UNREADABLE") {
    return { control: "FAULT_SOURCE_UNREADABLE", locator: activation };
  }
  if (caseId === "CASE_6A_AMBIGUOUS_AFTER_COMMIT") {
    return { control: "FAULT_AMBIGUOUS_AFTER_COMMIT", locator: authority };
  }
  if (caseId === "CASE_6B_AMBIGUOUS_UNRESOLVED") {
    return { control: "FAULT_AMBIGUOUS_UNRESOLVED", locator: authority };
  }
  return { control: "NONE", locator: authority };
}

function validateRequest(request: CutoverWitnessInvocationRequest): void {
  if (
    request.operation !== "CUTOVER_EXECUTOR_WITNESS" ||
    request.invocation_version !== CUTOVER_WITNESS_INVOCATION_VERSION ||
    request.fixture_root_id !== MATERIALIZED_FIXTURE_ROOT_ID ||
    request.fixture_spreadsheet_id !== MATERIALIZED_FIXTURE_SPREADSHEET_ID
  ) {
    throw new Error("INVALID_WITNESS_INVOCATION");
  }
  if (
    request.case_id === "CASE_8_POST_COMMITTED_DENIAL" &&
    request.case8_finality_surface_id !== MATERIALIZED_CASE8_FINALITY_SURFACE_ID
  ) {
    throw new Error("INVALID_CASE8_FINALITY_SURFACE");
  }
  if (!request.run_id || !request.session_id) {
    throw new Error("INVALID_WITNESS_IDENTITY");
  }
}

async function runNegativeProductionDenylist(
  accessToken: string,
  fetchImpl: typeof fetch | undefined,
  request: CutoverWitnessInvocationRequest,
): Promise<CutoverWitnessInvocationResult> {
  const google = new GoogleSheetsControlPlaneProvider({ accessToken, fetchImpl });
  const counted = new CountingProvider(google);
  const deniedRoot: TargetRoot = {
    ...root,
    locators: {
      ...root.locators,
      authorityPublication: {
        ...authority,
        spreadsheetId: "1Ckqy598EPE9CO3gejn2b0sLC3IC1_FcwScRFPE2JumM",
        logicalIdentity: "SYS_REPOSITORY_CUTOVER_CONTROL",
      },
    },
  };
  const result = await new ExecutorCore(counted).execute({
    ...makeInput(request.session_id),
    root: deniedRoot,
  });
  return {
    invocation_version: CUTOVER_WITNESS_INVOCATION_VERSION,
    case_id: request.case_id,
    executor_core: "ExecutorCore",
    provider: "GoogleSheetsControlPlaneProvider",
    fixture_root_id: MATERIALIZED_FIXTURE_ROOT_ID,
    result,
    provider_mutations: counted.mutationSnapshot(),
    provider_reads: counted.readSnapshot(),
  };
}

export async function invokeCutoverWitness(
  request: CutoverWitnessInvocationRequest,
  accessToken: string,
  fetchImpl?: typeof fetch,
): Promise<CutoverWitnessInvocationResult> {
  validateRequest(request);
  if (!accessToken) throw new Error("GOOGLE_PROVIDER_CREDENTIAL_UNAVAILABLE");

  if (request.case_id === "NEGATIVE_PRODUCTION_DENYLIST") {
    return runNegativeProductionDenylist(accessToken, fetchImpl, request);
  }

  const setupProvider = new GoogleSheetsControlPlaneProvider({ accessToken, fetchImpl });
  await exactFixtureReset(setupProvider, request.session_id, request.run_id);

  let input = makeInput(request.session_id);

  if (request.case_id === "CASE_2_PREDECESSOR_MISMATCH") {
    await exactSetupMutation(setupProvider, authority, {
      Current_Committed_Cutover_ID: "FOREIGN_CUTOVER",
      Current_Activation_Epoch: 10,
    });
  } else if (request.case_id === "CASE_3_NON_MONOTONIC") {
    input = { ...input, targetEpoch: 10 };
  } else if (request.case_id === "CASE_4_ACTIVATION_DRIFT") {
    await exactSetupMutation(setupProvider, activation, {
      ...frozenActivation,
      Workflow_Set_Fingerprint: "DRIFT",
    });
  } else if (request.case_id === "CASE_7_PARTIAL_RECOVERY") {
    await exactSetupMutation(setupProvider, authority, {
      Current_Committed_Cutover_ID: "CUT_FIXTURE_TARGET",
      Current_Activation_Epoch: 11,
    });
  } else if (request.case_id === "CASE_7_FOREIGN_SUCCESSOR_GUARD") {
    await exactSetupMutation(setupProvider, authority, {
      Current_Committed_Cutover_ID: "FOREIGN_SUCCESSOR",
      Current_Activation_Epoch: 11,
    });
  }

  const counted = new CountingProvider(setupProvider);
  const fault = faultForCase(request.case_id);
  const executionProvider: ControlPlaneProvider =
    fault.control === "NONE"
      ? counted
      : new FaultInjectingProvider(counted, "WITNESS", allFixtureLocators, {
          control: fault.control,
          designatedLocator: fault.locator,
        });
  const core = new ExecutorCore(executionProvider);

  if (request.case_id !== "CASE_8_POST_COMMITTED_DENIAL") {
    const result = await core.execute(input);
    return {
      invocation_version: CUTOVER_WITNESS_INVOCATION_VERSION,
      case_id: request.case_id,
      executor_core: "ExecutorCore",
      provider: "GoogleSheetsControlPlaneProvider",
      fixture_root_id: MATERIALIZED_FIXTURE_ROOT_ID,
      result,
      provider_mutations: counted.mutationSnapshot(),
      provider_reads: counted.readSnapshot(),
    };
  }

  const initial = await core.execute(input);
  if (!initial.ok) {
    return {
      invocation_version: CUTOVER_WITNESS_INVOCATION_VERSION,
      case_id: request.case_id,
      executor_core: "ExecutorCore",
      provider: "GoogleSheetsControlPlaneProvider",
      fixture_root_id: MATERIALIZED_FIXTURE_ROOT_ID,
      result: initial,
      provider_mutations: counted.mutationSnapshot(),
      provider_reads: counted.readSnapshot(),
    };
  }

  await exactSetupMutation(counted, relayFinality, {
    run_id: request.run_id,
    agent_id: CUTOVER_WITNESS_AGENT_ID,
    session_id: request.session_id,
    status: "PREPARED",
  });
  const verifier = new ExactRelayRowVerifier(
    counted,
    relayFinality,
    request.run_id,
    CUTOVER_WITNESS_AGENT_ID,
  );
  const prepared = await core.acknowledgeRelayPrepared(
    "WITNESS",
    request.session_id,
    root,
    verifier,
  );
  const preparedVerified = prepared.ok && prepared.status === "RELAY_PREPARED_VERIFIED";
  if (!preparedVerified) {
    return {
      invocation_version: CUTOVER_WITNESS_INVOCATION_VERSION,
      case_id: request.case_id,
      executor_core: "ExecutorCore",
      provider: "GoogleSheetsControlPlaneProvider",
      fixture_root_id: MATERIALIZED_FIXTURE_ROOT_ID,
      result: prepared,
      provider_mutations: counted.mutationSnapshot(),
      provider_reads: counted.readSnapshot(),
      case8: {
        prepared_verified: false,
        committed_verified: false,
        session_closed: false,
        post_close_transition_mutation_delta: 0,
        finality_surface_id: MATERIALIZED_CASE8_FINALITY_SURFACE_ID,
      },
    };
  }

  await exactSetupMutation(counted, relayFinality, {
    run_id: request.run_id,
    agent_id: CUTOVER_WITNESS_AGENT_ID,
    session_id: request.session_id,
    status: "COMMITTED",
  });
  const close = await core.closeSessionAfterRelay(
    "WITNESS",
    request.session_id,
    root,
    verifier,
  );
  const sessionClosed = close.ok && close.status === "COMPLETE";

  const transitionMutationsBefore =
    counted.mutationCountFor(authority) + counted.mutationCountFor(protection);
  const denied = await core.execute(input);
  const transitionMutationsAfter =
    counted.mutationCountFor(authority) + counted.mutationCountFor(protection);

  return {
    invocation_version: CUTOVER_WITNESS_INVOCATION_VERSION,
    case_id: request.case_id,
    executor_core: "ExecutorCore",
    provider: "GoogleSheetsControlPlaneProvider",
    fixture_root_id: MATERIALIZED_FIXTURE_ROOT_ID,
    result: denied,
    provider_mutations: counted.mutationSnapshot(),
    provider_reads: counted.readSnapshot(),
    case8: {
      prepared_verified: preparedVerified,
      committed_verified: sessionClosed,
      session_closed: sessionClosed,
      post_close_transition_mutation_delta:
        transitionMutationsAfter - transitionMutationsBefore,
      finality_surface_id: MATERIALIZED_CASE8_FINALITY_SURFACE_ID,
    },
  };
}
