import {
  FROZEN_PRODUCTION_DENYLIST,
  MATERIALIZED_FIXTURE_PRODUCTION_DENYLIST_ID,
  MATERIALIZED_FIXTURE_ROOT_ID,
  MATERIALIZED_FIXTURE_SPREADSHEET_ID,
} from "./cutover_witness_fixture";
export { FROZEN_PRODUCTION_DENYLIST } from "./cutover_witness_fixture";

export type ExecutorMode = "PRODUCTION" | "WITNESS";
export type FaultControl =
  | "NONE"
  | "FAULT_SOURCE_UNREADABLE"
  | "FAULT_AMBIGUOUS_AFTER_COMMIT"
  | "FAULT_AMBIGUOUS_UNRESOLVED";

export type StopCode =
  | "SOURCE_UNREADABLE"
  | "PREDECESSOR_MISMATCH"
  | "NON_MONOTONIC_OR_REUSED_EPOCH"
  | "ACTIVATION_OBJECT_DRIFT"
  | "TRANSITION_PROTECTION_NOT_VALID"
  | "MUTATION_OUTCOME_AMBIGUOUS"
  | "POSTCONDITION_MISMATCH"
  | "PRODUCTION_TARGET_DENIED"
  | "FIXTURE_TARGET_NOT_ALLOWLISTED"
  | "INVALID_FIXTURE_AUTHORITY"
  | "WITNESS_FAULT_FORBIDDEN_IN_PRODUCTION"
  | "SESSION_MUTATION_CAPABILITY_CLOSED"
  | "SESSION_ID_MISMATCH"
  | "RELAY_FINALITY_NOT_PROVEN"
  | "PUBLISHER_GRANT_NOT_CONFIGURED"
  | "PUBLISHER_INVOCATION_REPLAY"
  | "OLD_REQUEST_FINALITY_NOT_PROVEN"
  | "ATOMIC_GENERATION_NOT_SEALED";

export type Scalar = string | number | boolean | null;
export type ExactRecord = Readonly<Record<string, Scalar>>;

export interface SheetsLocator {
  provider: "GOOGLE_SHEETS_V4";
  spreadsheetId: string;
  sheetId: number;
  range: string;
  startRowIndex: number;
  startColumnIndex: number;
  logicalIdentity: string;
  columns: readonly string[];
  headerRange?: string;
}

export interface RootLocators {
  authorityPublication: SheetsLocator;
  candidateActivation: SheetsLocator;
  protection: SheetsLocator;
  usedEpochs: SheetsLocator;
  sessionCapability: SheetsLocator;
}

export interface TargetRoot {
  rootId: string;
  fixtureAuthority: false | null;
  fixtureSpreadsheetId: string;
  productionDenylistId: string;
  locators: RootLocators;
  mutationAllowlist: readonly SheetsLocator[];
}

export interface FrozenActivationIdentity {
  readonly fields: ExactRecord;
}

export interface TransitionStep {
  id: string;
  target: SheetsLocator;
  expectedBefore: ExactRecord;
  desiredAfter: ExactRecord;
}

export interface ExecutorInput {
  mode: ExecutorMode;
  sessionId: string;
  root: TargetRoot;
  expectedPredecessorCutoverId: string;
  expectedPredecessorEpoch: number;
  targetEpoch: number;
  frozenActivation: FrozenActivationIdentity;
  transitionPlan: readonly TransitionStep[];
}

export type MutationOutcome = "CONFIRMED" | "AMBIGUOUS";

export interface MutationResult {
  outcome: MutationOutcome;
}

export class ProviderUnreadable extends Error {
  constructor(public readonly locator: SheetsLocator) {
    super("SOURCE_UNREADABLE");
  }
}

export interface ControlPlaneProvider {
  readExact(locator: SheetsLocator): Promise<ExactRecord>;
  mutateExact(locator: SheetsLocator, value: ExactRecord): Promise<MutationResult>;
}


/**
 * Nonproduction-only seam. A real production grant issuer/fence is deliberately
 * NOT implemented. An OAuth access token is never a WorkOS publication grant.
 * The fixture fence must atomically reserve the invocation, exclude all writers,
 * and attest that every older provider request has reached terminal finality.
 * It must retain the reservation after ambiguous/failed execution; no lease
 * expiry or fixed sleep is a substitute for terminal old-request proof.
 */
export interface NonproductionPublicationFence {
  claimExclusive(invocationId: string, spreadsheetId: string): Promise<"ACQUIRED" | "DENIED">;
  priorRequestsTerminal(invocationId: string): Promise<boolean>;
  ownRequestFinality(invocationId: string): Promise<"APPLIED" | "NOT_APPLIED" | "UNKNOWN">;
  completeVerified(invocationId: string): Promise<boolean>;
}

export interface AtomicGenerationProvider extends ControlPlaneProvider {
  mutateAuthorityGenerationBatch(
    authority: SheetsLocator,
    generation: ExactRecord,
    coupled: readonly { locator: SheetsLocator; value: ExactRecord }[],
  ): Promise<MutationResult>;
}

export interface ExecutorSuccess {
  ok: true;
  status: "READY_FOR_RELAY" | "RELAY_PREPARED_VERIFIED" | "COMPLETE";
  recoveredSteps: readonly string[];
  mutatedSteps: readonly string[];
  reconciledAmbiguousSteps: readonly string[];
}

export interface ExecutorStop {
  ok: false;
  stop: StopCode;
  detail?: string;
}

export type ExecutorResult = ExecutorSuccess | ExecutorStop;

export type RelayTerminalStatus = "PREPARED" | "COMMITTED";

export interface RelayFinalityVerifier {
  verify(status: RelayTerminalStatus, sessionId: string): Promise<boolean>;
}

export class ExactRelayRowVerifier implements RelayFinalityVerifier {
  constructor(
    private readonly provider: ControlPlaneProvider,
    private readonly rowLocator: SheetsLocator,
    private readonly expectedRunId: string,
    private readonly expectedAgentId: string,
  ) {}

  async verify(status: RelayTerminalStatus, sessionId: string): Promise<boolean> {
    let row: ExactRecord;
    try {
      row = await this.provider.readExact(this.rowLocator);
    } catch {
      return false;
    }
    return (
      row.run_id === this.expectedRunId &&
      row.agent_id === this.expectedAgentId &&
      row.session_id === sessionId &&
      row.status === status
    );
  }
}

const locatorKey = (x: SheetsLocator): string =>
  [
    x.provider,
    x.spreadsheetId,
    String(x.sheetId),
    x.range,
    String(x.startRowIndex),
    String(x.startColumnIndex),
    x.logicalIdentity,
    x.columns.join(","),
  ].join("|");

function stableObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableObject);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = stableObject((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function exactEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(stableObject(a)) === JSON.stringify(stableObject(b));
}

function parseInteger(value: Scalar): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) return Number(value);
  return null;
}

function asString(value: Scalar): string | null {
  return typeof value === "string" ? value : null;
}

function allRootLocators(root: TargetRoot): SheetsLocator[] {
  return [
    root.locators.authorityPublication,
    root.locators.candidateActivation,
    root.locators.protection,
    root.locators.usedEpochs,
    root.locators.sessionCapability,
    ...root.mutationAllowlist,
  ];
}

function productionIdentityDenied(value: string): boolean {
  const exactSets = [
    FROZEN_PRODUCTION_DENYLIST.fileIds,
    FROZEN_PRODUCTION_DENYLIST.datasetIds,
    FROZEN_PRODUCTION_DENYLIST.taskIds,
    FROZEN_PRODUCTION_DENYLIST.instanceIds,
    FROZEN_PRODUCTION_DENYLIST.authorityIds,
    FROZEN_PRODUCTION_DENYLIST.scheduleIds,
  ];
  if (exactSets.some((set) => set.has(value))) return true;
  const tokens = value.split(/[:/@|]/g).filter(Boolean);
  return tokens.some((token) => exactSets.some((set) => set.has(token)));
}

function locatorDenied(locator: SheetsLocator): boolean {
  return (
    FROZEN_PRODUCTION_DENYLIST.fileIds.has(locator.spreadsheetId) ||
    productionIdentityDenied(locator.logicalIdentity)
  );
}

function witnessBoundaryStop(root: TargetRoot): ExecutorStop | null {
  if (root.fixtureAuthority !== false) return { ok: false, stop: "INVALID_FIXTURE_AUTHORITY" };
  if (
    root.rootId !== MATERIALIZED_FIXTURE_ROOT_ID ||
    root.fixtureSpreadsheetId !== MATERIALIZED_FIXTURE_SPREADSHEET_ID ||
    root.productionDenylistId !== MATERIALIZED_FIXTURE_PRODUCTION_DENYLIST_ID
  ) {
    return { ok: false, stop: "FIXTURE_TARGET_NOT_ALLOWLISTED", detail: "fixture root identity mismatch" };
  }
  if (
    productionIdentityDenied(root.rootId) ||
    FROZEN_PRODUCTION_DENYLIST.fileIds.has(root.fixtureSpreadsheetId)
  ) {
    return { ok: false, stop: "PRODUCTION_TARGET_DENIED", detail: root.rootId };
  }

  const allowed = new Set(root.mutationAllowlist.map(locatorKey));
  for (const locator of allRootLocators(root)) {
    if (locatorDenied(locator)) {
      return { ok: false, stop: "PRODUCTION_TARGET_DENIED", detail: locator.logicalIdentity };
    }
    if (locator.spreadsheetId !== root.fixtureSpreadsheetId) {
      return { ok: false, stop: "FIXTURE_TARGET_NOT_ALLOWLISTED", detail: locatorKey(locator) };
    }
  }
  for (const locator of root.mutationAllowlist) {
    if (!allowed.has(locatorKey(locator))) {
      return { ok: false, stop: "FIXTURE_TARGET_NOT_ALLOWLISTED" };
    }
  }
  return null;
}

function targetAllowed(root: TargetRoot, target: SheetsLocator): boolean {
  return root.mutationAllowlist.some((x) => locatorKey(x) === locatorKey(target));
}

async function readOrStop(
  provider: ControlPlaneProvider,
  locator: SheetsLocator,
): Promise<ExactRecord | ExecutorStop> {
  try {
    return await provider.readExact(locator);
  } catch (error) {
    if (error instanceof ProviderUnreadable) {
      return { ok: false, stop: "SOURCE_UNREADABLE", detail: locatorKey(locator) };
    }
    return { ok: false, stop: "SOURCE_UNREADABLE", detail: locatorKey(locator) };
  }
}

function isExecutorStop(value: ExactRecord | ExecutorStop): value is ExecutorStop {
  return (value as { ok?: unknown }).ok === false;
}

export class ExecutorCore {
  constructor(private readonly provider: ControlPlaneProvider) {}

  async execute(input: ExecutorInput): Promise<ExecutorResult> {
    if (input.mode === "WITNESS") {
      const boundary = witnessBoundaryStop(input.root);
      if (boundary) return boundary;
    }

    const session = await readOrStop(this.provider, input.root.locators.sessionCapability);
    if (isExecutorStop(session)) return session;
    if (asString(session.Session_ID) !== input.sessionId) {
      return { ok: false, stop: "SESSION_ID_MISMATCH" };
    }
    if (session.Capability_State !== "OPEN") {
      return { ok: false, stop: "SESSION_MUTATION_CAPABILITY_CLOSED" };
    }

    const authority = await readOrStop(this.provider, input.root.locators.authorityPublication);
    if (isExecutorStop(authority)) return authority;
    const candidate = await readOrStop(this.provider, input.root.locators.candidateActivation);
    if (isExecutorStop(candidate)) return candidate;
    const protection = await readOrStop(this.provider, input.root.locators.protection);
    if (isExecutorStop(protection)) return protection;
    const usedEpochs = await readOrStop(this.provider, input.root.locators.usedEpochs);
    if (isExecutorStop(usedEpochs)) return usedEpochs;

    const currentCutover = asString(authority.Current_Committed_Cutover_ID);
    const currentEpoch = parseInteger(authority.Current_Activation_Epoch);
    const predecessorMatches =
      currentCutover === input.expectedPredecessorCutoverId &&
      currentEpoch === input.expectedPredecessorEpoch;

    let used: number[];
    try {
      const decoded = JSON.parse(asString(usedEpochs.Used_Epochs_JSON) ?? "[]") as unknown;
      used = Array.isArray(decoded)
        ? decoded.filter((x): x is number => Number.isInteger(x))
        : [];
    } catch {
      return { ok: false, stop: "ACTIVATION_OBJECT_DRIFT", detail: "invalid used-epoch evidence" };
    }
    if (
      input.targetEpoch <= input.expectedPredecessorEpoch ||
      used.includes(input.targetEpoch)
    ) {
      return { ok: false, stop: "NON_MONOTONIC_OR_REUSED_EPOCH" };
    }

    if (!exactEqual(candidate, input.frozenActivation.fields)) {
      return { ok: false, stop: "ACTIVATION_OBJECT_DRIFT" };
    }

    let sameTransitionPrefixLength = 0;
    if (!predecessorMatches) {
      const first = input.transitionPlan[0];
      const expectedPredecessorRecord: ExactRecord = {
        Current_Committed_Cutover_ID: input.expectedPredecessorCutoverId,
        Current_Activation_Epoch: input.expectedPredecessorEpoch,
      };
      const expectedTargetRecord: ExactRecord = {
        Current_Committed_Cutover_ID: asString(candidate.Cutover_ID),
        Current_Activation_Epoch: input.targetEpoch,
      };

      if (
        !first ||
        locatorKey(first.target) !== locatorKey(input.root.locators.authorityPublication) ||
        !exactEqual(first.expectedBefore, expectedPredecessorRecord) ||
        !exactEqual(first.desiredAfter, expectedTargetRecord) ||
        !exactEqual(authority, first.desiredAfter)
      ) {
        return { ok: false, stop: "PREDECESSOR_MISMATCH" };
      }

      let beforeStateSeen = false;
      for (const step of input.transitionPlan) {
        let observed: ExactRecord | ExecutorStop;
        if (locatorKey(step.target) === locatorKey(input.root.locators.authorityPublication)) {
          observed = authority;
        } else if (locatorKey(step.target) === locatorKey(input.root.locators.protection)) {
          observed = protection;
        } else {
          observed = await readOrStop(this.provider, step.target);
        }
        if (isExecutorStop(observed)) return observed;

        if (exactEqual(observed, step.desiredAfter)) {
          if (beforeStateSeen) {
            return { ok: false, stop: "PREDECESSOR_MISMATCH", detail: "non-contiguous same-transition prefix" };
          }
          sameTransitionPrefixLength += 1;
          continue;
        }
        if (exactEqual(observed, step.expectedBefore)) {
          beforeStateSeen = true;
          continue;
        }
        return { ok: false, stop: "PREDECESSOR_MISMATCH", detail: "foreign state is not same-transition prefix" };
      }

      if (sameTransitionPrefixLength < 1) {
        return { ok: false, stop: "PREDECESSOR_MISMATCH" };
      }
    }

    const protectionInitial =
      protection.Cutover_State === "AUTHORITY_PREPARED" &&
      protection.Migration_Write_Fence_State === "ACTIVE" &&
      protection.Maintenance_State === "BLOCKED";
    if (!protectionInitial) {
      const protectionStepIndex = input.transitionPlan.findIndex(
        (step) => locatorKey(step.target) === locatorKey(input.root.locators.protection),
      );
      const protectionRecovered =
        protectionStepIndex >= 0 &&
        sameTransitionPrefixLength > protectionStepIndex &&
        exactEqual(protection, input.transitionPlan[protectionStepIndex].desiredAfter);
      if (!protectionRecovered) {
        return { ok: false, stop: "TRANSITION_PROTECTION_NOT_VALID" };
      }
    }

    const recoveredSteps: string[] = [];
    const mutatedSteps: string[] = [];
    const reconciledAmbiguousSteps: string[] = [];

    for (const step of input.transitionPlan) {
      if (input.mode === "WITNESS" && !targetAllowed(input.root, step.target)) {
        return { ok: false, stop: "FIXTURE_TARGET_NOT_ALLOWLISTED", detail: step.id };
      }
      if (input.mode === "WITNESS" && locatorDenied(step.target)) {
        return { ok: false, stop: "PRODUCTION_TARGET_DENIED", detail: step.id };
      }

      const before = await readOrStop(this.provider, step.target);
      if (isExecutorStop(before)) return before;
      if (exactEqual(before, step.desiredAfter)) {
        recoveredSteps.push(step.id);
        continue;
      }
      if (!exactEqual(before, step.expectedBefore)) {
        return { ok: false, stop: "ACTIVATION_OBJECT_DRIFT", detail: step.id };
      }

      let mutation: MutationResult;
      try {
        mutation = await this.provider.mutateExact(step.target, step.desiredAfter);
      } catch {
        mutation = { outcome: "AMBIGUOUS" };
      }

      if (mutation.outcome === "AMBIGUOUS") {
        let reconciled: ExactRecord;
        try {
          reconciled = await this.provider.readExact(step.target);
        } catch {
          return { ok: false, stop: "MUTATION_OUTCOME_AMBIGUOUS", detail: step.id };
        }
        if (!exactEqual(reconciled, step.desiredAfter)) {
          return { ok: false, stop: "MUTATION_OUTCOME_AMBIGUOUS", detail: step.id };
        }
        reconciledAmbiguousSteps.push(step.id);
      } else {
        const after = await readOrStop(this.provider, step.target);
        if (isExecutorStop(after)) return after;
        if (!exactEqual(after, step.desiredAfter)) {
          return { ok: false, stop: "POSTCONDITION_MISMATCH", detail: step.id };
        }
      }
      mutatedSteps.push(step.id);
    }

    return {
      ok: true,
      status: "READY_FOR_RELAY",
      recoveredSteps,
      mutatedSteps,
      reconciledAmbiguousSteps,
    };
  }


  /**
   * Isolated CUTOVER_EXECUTOR test invocation. It never accepts PRODUCTION,
   * cannot route through src/index.ts or the existing witness Worker, and does
   * not infer publication authority from Google OAuth/ACL. It consumes the same
   * frozen transitionPlan and the PR #1233 whole-generation batch primitive.
   *
   * A production implementation would additionally require an accepted,
   * durable external WorkOS grant issuer + exclusive terminal-request fence.
   * There is intentionally no production fallback in this method.
   */
  async executeNonproductionAtomicPublication(
    invocationId: string,
    input: ExecutorInput,
    fence?: NonproductionPublicationFence,
  ): Promise<ExecutorResult> {
    if (input.mode !== "WITNESS") {
      return { ok: false, stop: "PRODUCTION_TARGET_DENIED" };
    }
    const boundary = witnessBoundaryStop(input.root);
    if (boundary) return boundary;
    if (!fence) return { ok: false, stop: "PUBLISHER_GRANT_NOT_CONFIGURED" };
    if (typeof invocationId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(invocationId)) {
      return { ok: false, stop: "ATOMIC_GENERATION_NOT_SEALED", detail: "invalid invocation identity" };
    }

    const steps = input.transitionPlan;
    const authority = input.root.locators.authorityPublication;
    const fullColumns = [
      "Authority_Scope_Fingerprint",
      "Current_Committed_Cutover_ID",
      "Current_Activation_Epoch",
      "Registry_Snapshot_ID",
      "Manifest_Set_ID",
      "Gate_Config_Fingerprint",
      "Workflow_Set_Fingerprint",
      "Published_At",
    ];
    if (
      steps.length === 0 ||
      steps[0].id !== "AUTHORITY_PUBLICATION" ||
      locatorKey(steps[0].target) !== locatorKey(authority) ||
      authority.range !== "Authority_Publication!A2:H2" ||
      authority.startRowIndex !== 1 ||
      authority.startColumnIndex !== 0 ||
      authority.columns.join("|") !== fullColumns.join("|")
    ) {
      return { ok: false, stop: "ATOMIC_GENERATION_NOT_SEALED" };
    }
    const sourceKeys = new Set(Object.values(input.root.locators).slice(1).map(locatorKey));
    const seen = new Set<string>();
    for (const step of steps) {
      const key = locatorKey(step.target);
      if (
        seen.has(key) ||
        !targetAllowed(input.root, step.target) ||
        locatorDenied(step.target) ||
        step.target.spreadsheetId !== authority.spreadsheetId ||
        Object.keys(step.expectedBefore).length !== step.target.columns.length ||
        Object.keys(step.desiredAfter).length !== step.target.columns.length ||
        !step.target.columns.every((column) =>
          Object.prototype.hasOwnProperty.call(step.expectedBefore, column) &&
          Object.prototype.hasOwnProperty.call(step.desiredAfter, column)) ||
        (step !== steps[0] && sourceKeys.has(key))
      ) {
        return { ok: false, stop: "ATOMIC_GENERATION_NOT_SEALED", detail: step.id };
      }
      seen.add(key);
    }
    const intended = steps[0].desiredAfter;
    if (
      !Number.isInteger(input.expectedPredecessorEpoch) ||
      !Number.isInteger(input.targetEpoch) ||
      input.targetEpoch <= input.expectedPredecessorEpoch ||
      asString(steps[0].expectedBefore.Current_Committed_Cutover_ID) !== input.expectedPredecessorCutoverId ||
      parseInteger(steps[0].expectedBefore.Current_Activation_Epoch) !== input.expectedPredecessorEpoch ||
      parseInteger(intended.Current_Activation_Epoch) !== input.targetEpoch ||
      asString(intended.Current_Committed_Cutover_ID) !== asString(input.frozenActivation.fields.Cutover_ID) ||
      !asString(intended.Published_At) ||
      !["Authority_Scope_Fingerprint", "Registry_Snapshot_ID", "Manifest_Set_ID",
        "Gate_Config_Fingerprint", "Workflow_Set_Fingerprint"].every(
          (field) => exactEqual(intended[field], input.frozenActivation.fields[field])
        )
    ) {
      return { ok: false, stop: "ACTIVATION_OBJECT_DRIFT" };
    }

    // This must be a persistent, atomic exclusive claim in any real adapter.
    // Mock claims are adequate ONLY for this nonproduction test entry.
    let claimed: "ACQUIRED" | "DENIED";
    try {
      claimed = await fence.claimExclusive(invocationId, authority.spreadsheetId);
    } catch {
      return { ok: false, stop: "OLD_REQUEST_FINALITY_NOT_PROVEN" };
    }
    if (claimed !== "ACQUIRED") return { ok: false, stop: "PUBLISHER_INVOCATION_REPLAY" };

    let oldTerminal = false;
    try {
      oldTerminal = await fence.priorRequestsTerminal(invocationId);
    } catch {
      oldTerminal = false;
    }
    if (!oldTerminal) {
      return { ok: false, stop: "OLD_REQUEST_FINALITY_NOT_PROVEN" };
    }

    const read = async (locator: SheetsLocator): Promise<ExactRecord | null> => {
      try { return await this.provider.readExact(locator); } catch { return null; }
    };
    const session = await read(input.root.locators.sessionCapability);
    const candidate = await read(input.root.locators.candidateActivation);
    const protection = await read(input.root.locators.protection);
    const usedEpochs = await read(input.root.locators.usedEpochs);
    const before = await read(authority);
    if (!session || !candidate || !protection || !usedEpochs || !before) {
      return { ok: false, stop: "SOURCE_UNREADABLE" };
    }
    if (session.Session_ID !== input.sessionId || session.Capability_State !== "OPEN") {
      return { ok: false, stop: "SESSION_MUTATION_CAPABILITY_CLOSED" };
    }
    if (!exactEqual(candidate, input.frozenActivation.fields)) {
      return { ok: false, stop: "ACTIVATION_OBJECT_DRIFT" };
    }
    if (
      protection.Cutover_State !== "AUTHORITY_PREPARED" ||
      protection.Migration_Write_Fence_State !== "ACTIVE" ||
      protection.Maintenance_State !== "BLOCKED"
    ) {
      return { ok: false, stop: "TRANSITION_PROTECTION_NOT_VALID" };
    }
    let epochs: unknown;
    try { epochs = JSON.parse(asString(usedEpochs.Used_Epochs_JSON) ?? ""); } catch { epochs = null; }
    if (!Array.isArray(epochs) || !epochs.every((e) => Number.isSafeInteger(e))) {
      return { ok: false, stop: "ACTIVATION_OBJECT_DRIFT", detail: "used epochs unreadable" };
    }
    if (epochs.includes(input.targetEpoch)) {
      return { ok: false, stop: "NON_MONOTONIC_OR_REUSED_EPOCH" };
    }
    if (!exactEqual(before, steps[0].expectedBefore)) {
      return { ok: false, stop: "PREDECESSOR_MISMATCH" };
    }
    for (const step of steps.slice(1)) {
      const observed = await read(step.target);
      if (!observed) return { ok: false, stop: "SOURCE_UNREADABLE", detail: step.id };
      if (!exactEqual(observed, step.expectedBefore)) {
        return { ok: false, stop: "ACTIVATION_OBJECT_DRIFT", detail: step.id };
      }
    }
    const provider = this.provider as ControlPlaneProvider & Partial<AtomicGenerationProvider>;
    if (typeof provider.mutateAuthorityGenerationBatch !== "function") {
      return { ok: false, stop: "ATOMIC_GENERATION_NOT_SEALED", detail: "atomic provider capability missing" };
    }

    let mutation: MutationResult;
    try {
      mutation = await provider.mutateAuthorityGenerationBatch(
        authority, intended,
        steps.slice(1).map((step) => ({ locator: step.target, value: step.desiredAfter })),
      );
    } catch {
      mutation = { outcome: "AMBIGUOUS" };
    }

    if (mutation.outcome !== "CONFIRMED") {
      // An observed target row is insufficient: a timed-out older POST may
      // still complete later. Demand same-invocation terminal attestation.
      let finality: "APPLIED" | "NOT_APPLIED" | "UNKNOWN" = "UNKNOWN";
      try { finality = await fence.ownRequestFinality(invocationId); } catch { /* fail closed */ }
      if (finality !== "APPLIED") {
        return { ok: false, stop: "MUTATION_OUTCOME_AMBIGUOUS" };
      }
    }
    for (const step of steps) {
      const after = await read(step.target);
      if (!after || !exactEqual(after, step.desiredAfter)) {
        return {
          ok: false,
          stop: mutation.outcome === "CONFIRMED" ? "POSTCONDITION_MISMATCH" : "MUTATION_OUTCOME_AMBIGUOUS",
          detail: step.id,
        };
      }
    }

    let completed = false;
    try { completed = await fence.completeVerified(invocationId); } catch { /* fail closed */ }
    if (!completed) return { ok: false, stop: "MUTATION_OUTCOME_AMBIGUOUS", detail: "fence completion not durable" };
    return {
      ok: true,
      status: "READY_FOR_RELAY",
      recoveredSteps: [],
      mutatedSteps: steps.map((step) => step.id),
      reconciledAmbiguousSteps: mutation.outcome === "AMBIGUOUS" ? steps.map((step) => step.id) : [],
    };
  }

  async acknowledgeRelayPrepared(
    mode: ExecutorMode,
    sessionId: string,
    root: TargetRoot,
    verifier: RelayFinalityVerifier,
  ): Promise<ExecutorResult> {
    if (mode === "WITNESS") {
      const boundary = witnessBoundaryStop(root);
      if (boundary) return boundary;
    }

    let verified = false;
    try {
      verified = await verifier.verify("PREPARED", sessionId);
    } catch {
      verified = false;
    }
    if (!verified) return { ok: false, stop: "RELAY_FINALITY_NOT_PROVEN" };

    const session = await readOrStop(this.provider, root.locators.sessionCapability);
    if (isExecutorStop(session)) return session;
    if (asString(session.Session_ID) !== sessionId) {
      return { ok: false, stop: "SESSION_ID_MISMATCH" };
    }
    if (session.Capability_State !== "OPEN") {
      return { ok: false, stop: "SESSION_MUTATION_CAPABILITY_CLOSED" };
    }

    return {
      ok: true,
      status: "RELAY_PREPARED_VERIFIED",
      recoveredSteps: [],
      mutatedSteps: [],
      reconciledAmbiguousSteps: [],
    };
  }

  async closeSessionAfterRelay(
    mode: ExecutorMode,
    sessionId: string,
    root: TargetRoot,
    verifier: RelayFinalityVerifier,
  ): Promise<ExecutorResult> {
    if (mode === "WITNESS") {
      const boundary = witnessBoundaryStop(root);
      if (boundary) return boundary;
    }

    let verified = false;
    try {
      verified = await verifier.verify("COMMITTED", sessionId);
    } catch {
      verified = false;
    }
    if (!verified) return { ok: false, stop: "RELAY_FINALITY_NOT_PROVEN" };

    const before = await readOrStop(this.provider, root.locators.sessionCapability);
    if (isExecutorStop(before)) return before;
    if (asString(before.Session_ID) !== sessionId) {
      return { ok: false, stop: "SESSION_ID_MISMATCH" };
    }
    if (before.Capability_State !== "OPEN") {
      return { ok: false, stop: "SESSION_MUTATION_CAPABILITY_CLOSED" };
    }

    const desired: ExactRecord = { Session_ID: sessionId, Capability_State: "CLOSED" };
    let result: MutationResult;
    try {
      result = await this.provider.mutateExact(root.locators.sessionCapability, desired);
    } catch {
      result = { outcome: "AMBIGUOUS" };
    }

    let after: ExactRecord;
    try {
      after = await this.provider.readExact(root.locators.sessionCapability);
    } catch {
      return {
        ok: false,
        stop: result.outcome === "AMBIGUOUS" ? "MUTATION_OUTCOME_AMBIGUOUS" : "SOURCE_UNREADABLE",
      };
    }
    if (!exactEqual(after, desired)) {
      return {
        ok: false,
        stop: result.outcome === "AMBIGUOUS" ? "MUTATION_OUTCOME_AMBIGUOUS" : "POSTCONDITION_MISMATCH",
      };
    }

    return {
      ok: true,
      status: "COMPLETE",
      recoveredSteps: [],
      mutatedSteps: ["SESSION_CAPABILITY_CLOSE"],
      reconciledAmbiguousSteps: result.outcome === "AMBIGUOUS" ? ["SESSION_CAPABILITY_CLOSE"] : [],
    };
  }

}

export interface GoogleSheetsProviderOptions {
  accessToken: string;
  fetchImpl?: typeof fetch;
}

export class GoogleSheetsControlPlaneProvider implements ControlPlaneProvider {
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly options: GoogleSheetsProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private headers(): HeadersInit {
    return {
      Authorization: "Bearer " + this.options.accessToken,
      "Content-Type": "application/json",
    };
  }

  async readExact(locator: SheetsLocator): Promise<ExactRecord> {
    const url =
      "https://sheets.googleapis.com/v4/spreadsheets/" +
      encodeURIComponent(locator.spreadsheetId) +
      "/values/" +
      encodeURIComponent(locator.range) +
      "?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE";
    const response = await this.fetchImpl(url, { headers: this.headers() });
    if (!response.ok) throw new ProviderUnreadable(locator);
    const body = (await response.json()) as { values?: unknown[][] };
    const row = body.values?.[0];
    if (!row) throw new ProviderUnreadable(locator);
    const record: Record<string, Scalar> = {};
    locator.columns.forEach((column, index) => {
      const value = row[index];
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        record[column] = value ?? null;
      } else {
        record[column] = JSON.stringify(value);
      }
    });
    return record;
  }

  private cellData(value: Scalar): { userEnteredValue: Record<string, unknown> } {
    if (typeof value === "number") return { userEnteredValue: { numberValue: value } };
    if (typeof value === "boolean") return { userEnteredValue: { boolValue: value } };
    return { userEnteredValue: { stringValue: value === null ? "" : String(value) } };
  }

  /**
   * Non-production candidate primitive for one Sheets-level atomic Generation update.
   * This is deliberately NOT a publisher invocation, exclusive-writer fence,
   * expected-predecessor CAS, formal WorkOS grant, or a successful readback.
   * The approved executor must establish those separately before this can be used.
   */
  async mutateAuthorityGenerationBatch(
    authority: SheetsLocator,
    generation: ExactRecord,
    coupled: readonly { locator: SheetsLocator; value: ExactRecord }[] = [],
  ): Promise<MutationResult> {
    const authorityColumns = [
      "Authority_Scope_Fingerprint",
      "Current_Committed_Cutover_ID",
      "Current_Activation_Epoch",
      "Registry_Snapshot_ID",
      "Manifest_Set_ID",
      "Gate_Config_Fingerprint",
      "Workflow_Set_Fingerprint",
      "Published_At",
    ];
    if (
      authority.provider !== "GOOGLE_SHEETS_V4" ||
      authority.range !== "Authority_Publication!A2:H2" ||
      authority.startRowIndex !== 1 ||
      authority.startColumnIndex !== 0 ||
      authority.columns.join("|") !== authorityColumns.join("|")
    ) {
      throw new Error("AUTHORITY_PUBLICATION_COMPLETE_A2_H2_REQUIRED");
    }

    const updates = [{ locator: authority, value: generation }, ...coupled];
    const occupied = new Set<string>();
    const requests = updates.map(({ locator, value }) => {
      if (
        locator.provider !== "GOOGLE_SHEETS_V4" ||
        locator.spreadsheetId !== authority.spreadsheetId ||
        !Number.isInteger(locator.sheetId) ||
        !Number.isInteger(locator.startRowIndex) ||
        !Number.isInteger(locator.startColumnIndex) ||
        locator.startRowIndex < 0 ||
        locator.startColumnIndex < 0 ||
        locator.columns.length === 0 ||
        new Set(locator.columns).size !== locator.columns.length ||
        Object.keys(value).length !== locator.columns.length ||
        !locator.columns.every((column) => Object.prototype.hasOwnProperty.call(value, column))
      ) {
        throw new Error("ATOMIC_PUBLICATION_UNSEALED_OR_CROSS_WORKBOOK_UPDATE");
      }
      for (let c = locator.startColumnIndex; c < locator.startColumnIndex + locator.columns.length; c++) {
        const cell = `${locator.sheetId}:${locator.startRowIndex}:${c}`;
        if (occupied.has(cell)) throw new Error("ATOMIC_PUBLICATION_OVERLAPPING_UPDATE");
        occupied.add(cell);
      }
      return {
        updateCells: {
          range: {
            sheetId: locator.sheetId,
            startRowIndex: locator.startRowIndex,
            endRowIndex: locator.startRowIndex + 1,
            startColumnIndex: locator.startColumnIndex,
            endColumnIndex: locator.startColumnIndex + locator.columns.length,
          },
          rows: [{ values: locator.columns.map((column) => this.cellData(value[column])) }],
          fields: "userEnteredValue",
        },
      };
    });

    const url =
      "https://sheets.googleapis.com/v4/spreadsheets/" +
      encodeURIComponent(authority.spreadsheetId) +
      ":batchUpdate";
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ requests }),
      });
      return { outcome: response.ok ? "CONFIRMED" : "AMBIGUOUS" };
    } catch {
      return { outcome: "AMBIGUOUS" };
    }
  }

  async mutateExact(locator: SheetsLocator, value: ExactRecord): Promise<MutationResult> {
    const cells = locator.columns.map((column) => this.cellData(value[column] ?? null));
    const url =
      "https://sheets.googleapis.com/v4/spreadsheets/" +
      encodeURIComponent(locator.spreadsheetId) +
      ":batchUpdate";
    const body = {
      requests: [
        {
          updateCells: {
            range: {
              sheetId: locator.sheetId,
              startRowIndex: locator.startRowIndex,
              endRowIndex: locator.startRowIndex + 1,
              startColumnIndex: locator.startColumnIndex,
              endColumnIndex: locator.startColumnIndex + locator.columns.length,
            },
            rows: [{ values: cells }],
            fields: "userEnteredValue",
          },
        },
      ],
    };

    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      });
      if (!response.ok) return { outcome: "AMBIGUOUS" };
      return { outcome: "CONFIRMED" };
    } catch {
      return { outcome: "AMBIGUOUS" };
    }
  }
}

export interface FaultInjectionSpec {
  control: FaultControl;
  designatedLocator: SheetsLocator;
}

export class FaultInjectingProvider implements ControlPlaneProvider {
  private unresolvedReadbackKey: string | null = null;

  constructor(
    private readonly inner: ControlPlaneProvider,
    private readonly mode: ExecutorMode,
    private readonly fixtureAllowlist: readonly SheetsLocator[],
    private readonly spec: FaultInjectionSpec,
  ) {
    if (mode === "PRODUCTION" && spec.control !== "NONE") {
      throw new Error("WITNESS_FAULT_FORBIDDEN_IN_PRODUCTION");
    }
    if (
      spec.control !== "NONE" &&
      locatorDenied(spec.designatedLocator)
    ) {
      throw new Error("PRODUCTION_TARGET_DENIED");
    }
    if (
      mode === "WITNESS" &&
      spec.control !== "NONE" &&
      !fixtureAllowlist.some((x) => locatorKey(x) === locatorKey(spec.designatedLocator))
    ) {
      throw new Error("FIXTURE_TARGET_NOT_ALLOWLISTED");
    }
  }

  async readExact(locator: SheetsLocator): Promise<ExactRecord> {
    const key = locatorKey(locator);
    if (
      this.spec.control === "FAULT_SOURCE_UNREADABLE" &&
      key === locatorKey(this.spec.designatedLocator)
    ) {
      throw new ProviderUnreadable(locator);
    }
    if (this.unresolvedReadbackKey === key) {
      throw new ProviderUnreadable(locator);
    }
    return this.inner.readExact(locator);
  }

  async mutateExact(locator: SheetsLocator, value: ExactRecord): Promise<MutationResult> {
    const key = locatorKey(locator);
    const designated = key === locatorKey(this.spec.designatedLocator);
    if (!designated || this.spec.control === "NONE" || this.spec.control === "FAULT_SOURCE_UNREADABLE") {
      return this.inner.mutateExact(locator, value);
    }

    const real = await this.inner.mutateExact(locator, value);
    if (this.spec.control === "FAULT_AMBIGUOUS_AFTER_COMMIT") {
      return { outcome: "AMBIGUOUS" };
    }
    if (this.spec.control === "FAULT_AMBIGUOUS_UNRESOLVED") {
      this.unresolvedReadbackKey = key;
      return { outcome: "AMBIGUOUS" };
    }
    return real;
  }
}

export async function deterministicFixtureInitialize(
  provider: ControlPlaneProvider,
  root: TargetRoot,
  snapshot: ReadonlyMap<SheetsLocator, ExactRecord>,
): Promise<void> {
  await deterministicFixtureReset(provider, root, snapshot);
}

export async function deterministicFixtureReset(
  provider: ControlPlaneProvider,
  root: TargetRoot,
  snapshot: ReadonlyMap<SheetsLocator, ExactRecord>,
): Promise<void> {
  const boundary = witnessBoundaryStop(root);
  if (boundary) throw new Error(boundary.stop);
  for (const [locator, value] of snapshot.entries()) {
    if (!targetAllowed(root, locator)) throw new Error("FIXTURE_TARGET_NOT_ALLOWLISTED");
    const result = await provider.mutateExact(locator, value);
    if (result.outcome !== "CONFIRMED") throw new Error("FIXTURE_RESET_AMBIGUOUS");
    const readback = await provider.readExact(locator);
    if (!exactEqual(readback, value)) throw new Error("FIXTURE_RESET_READBACK_MISMATCH");
  }
}

export async function deterministicFixtureCleanup(
  provider: ControlPlaneProvider,
  root: TargetRoot,
  tombstone: ReadonlyMap<SheetsLocator, ExactRecord>,
): Promise<void> {
  await deterministicFixtureReset(provider, root, tombstone);
}
