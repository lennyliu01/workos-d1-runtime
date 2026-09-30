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
  | "RELAY_FINALITY_NOT_PROVEN";

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
    if (locator.spreadsheetId !== root.fixtureSpreadsheetId) {
      return { ok: false, stop: "FIXTURE_TARGET_NOT_ALLOWLISTED", detail: locatorKey(locator) };
    }
    if (locatorDenied(locator)) {
      return { ok: false, stop: "PRODUCTION_TARGET_DENIED", detail: locator.logicalIdentity };
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
    if (
      currentCutover !== input.expectedPredecessorCutoverId ||
      currentEpoch !== input.expectedPredecessorEpoch
    ) {
      return { ok: false, stop: "PREDECESSOR_MISMATCH" };
    }

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

    if (
      protection.Cutover_State !== "AUTHORITY_PREPARED" ||
      protection.Migration_Write_Fence_State !== "ACTIVE" ||
      protection.Maintenance_State !== "BLOCKED"
    ) {
      return { ok: false, stop: "TRANSITION_PROTECTION_NOT_VALID" };
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
