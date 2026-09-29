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
  range: string;
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
  status: "READY_FOR_RELAY" | "COMPLETE";
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

export interface RelayFinalityReceipt {
  preparedReadbackExact: boolean;
  committedReadbackExact: boolean;
}

const locatorKey = (x: SheetsLocator): string =>
  [x.provider, x.spreadsheetId, x.range, x.columns.join(",")].join("|");

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

export const FROZEN_PRODUCTION_DENYLIST = Object.freeze({
  spreadsheetIds: new Set([
    "1Ckqy598EPE9CO3gejn2b0sLC3IC1_FcwScRFPE2JumM",
    "12bKGkui-DrcFjW4k2stW2vp8o8uqILaBNl57qztqFKM",
    "10aqM2xEzuCOCxvqzivNQJVCjl-trvrC12S5lXvzE9fY",
    "1R3K-tcZLT-AXEClTWNt3djlVijSZNog-EYl_PS5Rkw8",
    "1ROEy5RyJ7pWNyZYm8hmzssV3cbwnvPNGCG3qxMSTDco",
    "1sO97-59J4m0FlO8AZOyVIq3qdKvkJQQaoSElksyyEXQ",
    "1ba86fQs0YH5a07OHcVDmsAKpYA0z95P9vIBc1fUxGuw",
    "1Ny77wFr1LvJMc3LhLixFUwbqGYC_GdHTnQj1F3jq8h4",
    "1bfcfUsNtrfvGscstI3l9jIdYdAVg5nODpsLTTPQ3h5I",
  ]),
  fileIds: new Set([
    "1vLsNv3YZK-dAJh7jln7KbGLfWzp2k3ec",
    "1n1YPmM6V8j4VCeVHZo1e2AvKjoVz4KFjXlpqBPqRnx8",
  ]),
  logicalIdentities: new Set([
    "CUT1_ARCHIVE_REPOSITORY_20260928_01",
    "RS1_84f170ffef50fecc331de87458db2bee9aeebf1bdf7c4e079260c338d477d7e1",
    "MSET1_2f76282f0cc13c1df38b414d0221bebcc7f739fcb749ac6d7012e438f42f1cbc",
    "AB1_033cc2303356f400eb36344e87dec0a2a430749521a759afe167e2e2fce12367",
    "US_JAPAN_FX_POLICY",
    "ROLLING_WEDGE_INVESTMENT",
    "6aaaa975a4e8819189c56bce4f1fbcaa",
    "6aabae742b4c819197c722b6cc8d643b",
    "6aa64baf51648191845f153791c2ec73",
  ]),
});

function witnessBoundaryStop(root: TargetRoot): ExecutorStop | null {
  if (root.fixtureAuthority !== false) return { ok: false, stop: "INVALID_FIXTURE_AUTHORITY" };
  const allowed = new Set(root.mutationAllowlist.map(locatorKey));
  for (const locator of allRootLocators(root)) {
    if (FROZEN_PRODUCTION_DENYLIST.spreadsheetIds.has(locator.spreadsheetId)) {
      return { ok: false, stop: "PRODUCTION_TARGET_DENIED", detail: locator.spreadsheetId };
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
    if (session.Capability_State === "CLOSED") {
      return { ok: false, stop: "SESSION_MUTATION_CAPABILITY_CLOSED" };
    }
    if (session.Capability_State !== "OPEN") {
      return { ok: false, stop: "ACTIVATION_OBJECT_DRIFT", detail: "session state must be OPEN" };
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
      if (
        input.mode === "WITNESS" &&
        FROZEN_PRODUCTION_DENYLIST.spreadsheetIds.has(step.target.spreadsheetId)
      ) {
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

  async closeSessionAfterRelay(
    mode: ExecutorMode,
    sessionId: string,
    root: TargetRoot,
    receipt: RelayFinalityReceipt,
  ): Promise<ExecutorResult> {
    if (mode === "WITNESS") {
      const boundary = witnessBoundaryStop(root);
      if (boundary) return boundary;
    }
    if (!receipt.preparedReadbackExact || !receipt.committedReadbackExact) {
      return { ok: false, stop: "RELAY_FINALITY_NOT_PROVEN" };
    }
    const before = await readOrStop(this.provider, root.locators.sessionCapability);
    if (isExecutorStop(before)) return before;
    if (asString(before.Session_ID) !== sessionId) {
      return { ok: false, stop: "SESSION_ID_MISMATCH" };
    }
    if (before.Capability_State === "CLOSED") {
      return { ok: false, stop: "SESSION_MUTATION_CAPABILITY_CLOSED" };
    }
    if (before.Capability_State !== "OPEN") {
      return { ok: false, stop: "ACTIVATION_OBJECT_DRIFT" };
    }

    const desired: ExactRecord = { Session_ID: sessionId, Capability_State: "CLOSED" };
    const result = await this.provider.mutateExact(root.locators.sessionCapability, desired);
    if (result.outcome === "AMBIGUOUS") {
      let afterAmbiguous: ExactRecord;
      try {
        afterAmbiguous = await this.provider.readExact(root.locators.sessionCapability);
      } catch {
        return { ok: false, stop: "MUTATION_OUTCOME_AMBIGUOUS" };
      }
      if (!exactEqual(afterAmbiguous, desired)) {
        return { ok: false, stop: "MUTATION_OUTCOME_AMBIGUOUS" };
      }
    } else {
      const after = await readOrStop(this.provider, root.locators.sessionCapability);
      if (isExecutorStop(after)) return after;
      if (!exactEqual(after, desired)) {
        return { ok: false, stop: "POSTCONDITION_MISMATCH" };
      }
    }
    return {
      ok: true,
      status: "COMPLETE",
      recoveredSteps: [],
      mutatedSteps: ["SESSION_CAPABILITY_CLOSE"],
      reconciledAmbiguousSteps: [],
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

  async mutateExact(locator: SheetsLocator, value: ExactRecord): Promise<MutationResult> {
    const values = locator.columns.map((column) => value[column] ?? "");
    const url =
      "https://sheets.googleapis.com/v4/spreadsheets/" +
      encodeURIComponent(locator.spreadsheetId) +
      "/values/" +
      encodeURIComponent(locator.range) +
      "?valueInputOption=RAW";
    try {
      const response = await this.fetchImpl(url, {
        method: "PUT",
        headers: this.headers(),
        body: JSON.stringify({ majorDimension: "ROWS", values: [values] }),
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
      FROZEN_PRODUCTION_DENYLIST.spreadsheetIds.has(spec.designatedLocator.spreadsheetId)
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
