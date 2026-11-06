import assert from "node:assert/strict";
import {
  ExecutorCore, GoogleSheetsControlPlaneProvider,
  type ExactRecord, type ExecutorInput, type NonproductionPublicationFence,
  type SheetsLocator, type TargetRoot,
} from "../src/cutover_executor";
import {
  MATERIALIZED_FIXTURE_LOCATORS,
  MATERIALIZED_FIXTURE_PRODUCTION_DENYLIST_ID,
  MATERIALIZED_FIXTURE_ROOT_ID,
  MATERIALIZED_FIXTURE_SPREADSHEET_ID,
} from "../src/cutover_witness_fixture";

const authority: SheetsLocator = {
  ...MATERIALIZED_FIXTURE_LOCATORS.authorityPublication,
  range: "Authority_Publication!A2:H2",
  logicalIdentity: "FIXTURE_FULL_GENERATION_NONPRODUCTION_ONLY",
  columns: [
    "Authority_Scope_Fingerprint", "Current_Committed_Cutover_ID",
    "Current_Activation_Epoch", "Registry_Snapshot_ID", "Manifest_Set_ID",
    "Gate_Config_Fingerprint", "Workflow_Set_Fingerprint", "Published_At",
  ],
};
const member: SheetsLocator = {
  provider: "GOOGLE_SHEETS_V4",
  spreadsheetId: MATERIALIZED_FIXTURE_SPREADSHEET_ID,
  sheetId: 1428950150,
  range: "Transition_Target!A2:B2",
  startRowIndex: 1,
  startColumnIndex: 0,
  logicalIdentity: "FIXTURE_COUPLED_MEMBER_NONPRODUCTION_ONLY",
  columns: ["Projection_ID", "Projection_State"],
};
const candidate = MATERIALIZED_FIXTURE_LOCATORS.candidateActivation as SheetsLocator;
const protection = MATERIALIZED_FIXTURE_LOCATORS.protection as SheetsLocator;
const epochs = MATERIALIZED_FIXTURE_LOCATORS.usedEpochs as SheetsLocator;
const session = MATERIALIZED_FIXTURE_LOCATORS.sessionCapability as SheetsLocator;
const root: TargetRoot = {
  rootId: MATERIALIZED_FIXTURE_ROOT_ID,
  fixtureAuthority: false,
  fixtureSpreadsheetId: MATERIALIZED_FIXTURE_SPREADSHEET_ID,
  productionDenylistId: MATERIALIZED_FIXTURE_PRODUCTION_DENYLIST_ID,
  locators: {
    authorityPublication: authority, candidateActivation: candidate,
    protection, usedEpochs: epochs, sessionCapability: session,
  },
  mutationAllowlist: [authority, member],
};
const frozen: ExactRecord = {
  Cutover_ID: "CUT_FIXTURE_TARGET", Authority_Scope_Fingerprint: "fixture-scope",
  Registry_Snapshot_ID: "RS_FIXTURE", Manifest_Set_ID: "MSET_FIXTURE",
  Gate_Config_Fingerprint: "gate-fixture", Workflow_Set_Fingerprint: "workflow-fixture",
  Target_Acceptance_Binding_ID: "AB_FIXTURE",
};
const predecessor: ExactRecord = {
  Authority_Scope_Fingerprint: "fixture-scope",
  Current_Committed_Cutover_ID: "CUT_FIXTURE_PREV",
  Current_Activation_Epoch: 10,
  Registry_Snapshot_ID: "RS_PREV", Manifest_Set_ID: "MSET_PREV",
  Gate_Config_Fingerprint: "gate-prev", Workflow_Set_Fingerprint: "workflow-prev",
  Published_At: "2026-09-28T00:00:00Z",
};
const successor: ExactRecord = {
  Authority_Scope_Fingerprint: "fixture-scope",
  Current_Committed_Cutover_ID: "CUT_FIXTURE_TARGET",
  Current_Activation_Epoch: 11,
  Registry_Snapshot_ID: "RS_FIXTURE", Manifest_Set_ID: "MSET_FIXTURE",
  Gate_Config_Fingerprint: "gate-fixture", Workflow_Set_Fingerprint: "workflow-fixture",
  Published_At: "2026-11-06T00:00:00Z",
};
const locators = [authority, candidate, protection, epochs, session, member];
const key = (locator: SheetsLocator): string => locator.range;

function makeInput(): ExecutorInput {
  return {
    mode: "WITNESS", sessionId: "FIXTURE_INVOCATION_SESSION_01", root,
    expectedPredecessorCutoverId: "CUT_FIXTURE_PREV",
    expectedPredecessorEpoch: 10, targetEpoch: 11,
    frozenActivation: { fields: frozen },
    transitionPlan: [
      { id: "AUTHORITY_PUBLICATION", target: authority, expectedBefore: predecessor, desiredAfter: successor },
      { id: "MEMBERSHIP_FLIP", target: member,
        expectedBefore: { Projection_ID: "fixture-1", Projection_State: "CANDIDATE" },
        desiredAfter: { Projection_ID: "fixture-1", Projection_State: "ACTIVE" } },
    ],
  };
}

type PostMode = "OK" | "HTTP_500_AFTER_COMMIT" | "HTTP_500_NO_COMMIT" | "THROW_NO_COMMIT" | "PARTIAL_READBACK";
class MockSheetsHttp {
  readonly values = new Map<string, ExactRecord>();
  readonly requests: any[] = [];
  postMode: PostMode = "OK";
  unreadableRange: string | null = null;
  constructor() {
    this.values.set(key(authority), predecessor);
    this.values.set(key(candidate), frozen);
    this.values.set(key(protection), {
      Cutover_State: "AUTHORITY_PREPARED", Migration_Write_Fence_State: "ACTIVE", Maintenance_State: "BLOCKED",
    });
    this.values.set(key(epochs), { Used_Epochs_JSON: "[1,2,3,4,5,6,7,8,9,10]" });
    this.values.set(key(session), { Session_ID: "FIXTURE_INVOCATION_SESSION_01", Capability_State: "OPEN" });
    this.values.set(key(member), { Projection_ID: "fixture-1", Projection_State: "CANDIDATE" });
  }
  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (!init?.method || init.method === "GET") {
      const path = url.split("/values/")[1];
      assert.ok(path, "mock must only receive Sheets values GET");
      const range = decodeURIComponent(path.split("?")[0]);
      if (range === this.unreadableRange) return Response.json({ error: "read fault" }, { status: 503 });
      const locator = locators.find((x) => x.range === range);
      const values = this.values.get(range);
      if (!locator || !values) return Response.json({ error: "unknown fixture" }, { status: 404 });
      return Response.json({ values: [locator.columns.map((column) => values[column])] });
    }
    assert.equal(init.method, "POST");
    assert.ok(url.endsWith(":batchUpdate"));
    const body = JSON.parse(String(init.body));
    this.requests.push(body);
    if (this.postMode === "THROW_NO_COMMIT") throw new Error("simulated transport timeout");
    if (this.postMode === "HTTP_500_NO_COMMIT") return Response.json({ error: "unknown finality" }, { status: 500 });
    const updates = this.postMode === "PARTIAL_READBACK" ? body.requests.slice(0, 1) : body.requests;
    for (const request of updates) {
      const range = request.updateCells.range;
      const locator = locators.find((x) =>
        x.sheetId === range.sheetId &&
        x.startRowIndex === range.startRowIndex &&
        x.startColumnIndex === range.startColumnIndex &&
        x.columns.length === range.endColumnIndex - range.startColumnIndex
      );
      assert.ok(locator, "unexpected target in a mock provider POST");
      const cells: Record<string, string | number | boolean | null> = {};
      request.updateCells.rows[0].values.forEach((entry: any, index: number) => {
        const raw = entry.userEnteredValue;
        cells[locator.columns[index]] = raw.stringValue ?? raw.numberValue ?? raw.boolValue ?? null;
      });
      this.values.set(key(locator), cells);
    }
    if (this.postMode === "HTTP_500_AFTER_COMMIT") return Response.json({ error: "ambiguous after apply" }, { status: 500 });
    return Response.json({ spreadsheetId: MATERIALIZED_FIXTURE_SPREADSHEET_ID, replies: [] });
  };
}
class MockFence implements NonproductionPublicationFence {
  readonly claims = new Set<string>();
  readonly completed = new Set<string>();
  oldTerminal = true;
  finality: "APPLIED" | "NOT_APPLIED" | "UNKNOWN" = "UNKNOWN";
  completionDurable = true;
  // Simulate a durable singleton writer slot plus non-expiring invocation dedup.
  private exclusiveOwner: string | null = null;
  async claimExclusive(id: string, idOfSheet: string): Promise<"ACQUIRED" | "DENIED"> {
    assert.equal(idOfSheet, MATERIALIZED_FIXTURE_SPREADSHEET_ID);
    if (this.claims.has(id) || this.exclusiveOwner !== null) return "DENIED";
    this.claims.add(id);
    this.exclusiveOwner = id;
    return "ACQUIRED";
  }
  async priorRequestsTerminal(id: string): Promise<boolean> {
    return this.claims.has(id) && this.exclusiveOwner === id && this.oldTerminal;
  }
  async ownRequestFinality(id: string): Promise<"APPLIED" | "NOT_APPLIED" | "UNKNOWN"> {
    return this.exclusiveOwner === id ? this.finality : "UNKNOWN";
  }
  async completeVerified(id: string): Promise<boolean> {
    if (this.exclusiveOwner !== id || !this.completionDurable) return false;
    this.completed.add(id);
    // Claim remains durable to reject duplicates, including across new ExecutorCore instances.
    return true;
  }
}

function setup() {
  const http = new MockSheetsHttp();
  const provider = new GoogleSheetsControlPlaneProvider({
    accessToken: "MOCK_OAUTH_TOKEN_NOT_WORKOS_AUTHORIZATION",
    fetchImpl: http.fetch as typeof fetch,
  });
  return { http, core: new ExecutorCore(provider), fence: new MockFence() };
}
async function run(): Promise<void> {
  let cases = 0;
  {
    const { http, core, fence } = setup();
    const result = await core.executeNonproductionAtomicPublication("inv-ok", makeInput(), fence);
    assert.equal(result.ok, true);
    assert.equal(http.requests.length, 1, "full generation and membership must use ONE POST");
    assert.equal(http.requests[0].requests.length, 2, "same workbook atomic batch");
    assert.equal(http.requests[0].requests[0].updateCells.range.endColumnIndex, 8);
    assert.deepEqual(http.values.get(key(authority)), successor);
    assert.equal(fence.completed.has("inv-ok"), true);
    cases++;
    const duplicate = await new ExecutorCore(new GoogleSheetsControlPlaneProvider({
      accessToken: "mock", fetchImpl: http.fetch as typeof fetch,
    })).executeNonproductionAtomicPublication("inv-ok", makeInput(), fence);
    assert.equal(duplicate.ok, false);
    if (!duplicate.ok) assert.equal(duplicate.stop, "PUBLISHER_INVOCATION_REPLAY");
    assert.equal(http.requests.length, 1);
    cases++;
  }
  {
    const { http, core } = setup();
    const noGrant = await core.executeNonproductionAtomicPublication("no-grant", makeInput());
    assert.equal(noGrant.ok, false);
    if (!noGrant.ok) assert.equal(noGrant.stop, "PUBLISHER_GRANT_NOT_CONFIGURED");
    assert.equal(http.requests.length, 0, "Google OAuth alone must not authorize publication");
    cases++;
  }
  {
    const { http, core, fence } = setup();
    const denied = await core.executeNonproductionAtomicPublication("production-denied", {
      ...makeInput(), mode: "PRODUCTION",
    }, fence);
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.stop, "PRODUCTION_TARGET_DENIED");
    assert.equal(http.requests.length, 0);
    cases++;
  }
  {
    const { http, core, fence } = setup();
    const forbidden = {
      ...authority, spreadsheetId: "1Ckqy598EPE9CO3gejn2b0sLC3IC1_FcwScRFPE2JumM",
    };
    const input = makeInput();
    const poisoned: ExecutorInput = {
      ...input,
      root: { ...root, locators: { ...root.locators, authorityPublication: forbidden } },
      transitionPlan: [{ ...input.transitionPlan[0], target: forbidden }, input.transitionPlan[1]],
    };
    const denied = await core.executeNonproductionAtomicPublication("wrong-book", poisoned, fence);
    assert.equal(denied.ok, false);
    assert.equal(http.requests.length, 0);
    cases++;
  }
  {
    const { http, core, fence } = setup();
    fence.oldTerminal = false; // old in-flight POST may arrive late: no fixed wait/fake expiry
    const stopped = await core.executeNonproductionAtomicPublication("old-pending", makeInput(), fence);
    assert.equal(stopped.ok, false);
    if (!stopped.ok) assert.equal(stopped.stop, "OLD_REQUEST_FINALITY_NOT_PROVEN");
    const second = await core.executeNonproductionAtomicPublication("old-pending", makeInput(), fence);
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.stop, "PUBLISHER_INVOCATION_REPLAY");
    assert.equal(http.requests.length, 0);
    cases++;
  }
  {
    const { http, core, fence } = setup();
    http.postMode = "HTTP_500_AFTER_COMMIT";
    fence.finality = "APPLIED";
    const recovered = await core.executeNonproductionAtomicPublication("ambiguous-applied", makeInput(), fence);
    assert.equal(recovered.ok, true, "same-invocation terminal proof + exact readback");
    assert.equal(http.requests.length, 1);
    if (recovered.ok) assert.deepEqual(recovered.reconciledAmbiguousSteps, ["AUTHORITY_PUBLICATION", "MEMBERSHIP_FLIP"]);
    cases++;
  }
  {
    const { http, core, fence } = setup();
    http.postMode = "HTTP_500_NO_COMMIT";
    const blocked = await core.executeNonproductionAtomicPublication("ambiguous-unresolved", makeInput(), fence);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.stop, "MUTATION_OUTCOME_AMBIGUOUS");
    assert.equal(http.requests.length, 1);
    const duplicate = await core.executeNonproductionAtomicPublication("ambiguous-unresolved", makeInput(), fence);
    assert.equal(duplicate.ok, false);
    assert.equal(http.requests.length, 1, "no blind provider retry after 5xx");
    cases++;
  }
  {
    const { http, core, fence } = setup();
    http.postMode = "THROW_NO_COMMIT";
    const blocked = await core.executeNonproductionAtomicPublication("timeout-unresolved", makeInput(), fence);
    assert.equal(blocked.ok, false);
    assert.equal(http.requests.length, 1, "transport timeout never triggers retry");
    cases++;
  }
  {
    const { http, core, fence } = setup();
    http.postMode = "PARTIAL_READBACK";
    const blocked = await core.executeNonproductionAtomicPublication("partial-target", makeInput(), fence);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.stop, "POSTCONDITION_MISMATCH");
    assert.equal(fence.completed.size, 0);
    cases++;
  }
  {
    const { http, core, fence } = setup();
    http.values.set(candidate.range, { ...frozen, Registry_Snapshot_ID: "DRIFT" });
    const blocked = await core.executeNonproductionAtomicPublication("candidate-drift", makeInput(), fence);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.stop, "ACTIVATION_OBJECT_DRIFT");
    assert.equal(http.requests.length, 0);
    cases++;
  }
  {
    const { http, core, fence } = setup();
    const notSealed = makeInput();
    notSealed.transitionPlan = [{ ...notSealed.transitionPlan[0], target: {
      ...authority, range: "Authority_Publication!A2:B2", columns: authority.columns.slice(0, 2),
    } }];
    const blocked = await core.executeNonproductionAtomicPublication("partial-a2", notSealed, fence);
    assert.equal(blocked.ok, false);
    assert.equal(http.requests.length, 0);
    cases++;
  }
  {
    const { http, core, fence } = setup();
    const wrong = makeInput();
    wrong.transitionPlan = [wrong.transitionPlan[0], {
      ...wrong.transitionPlan[1],
      target: { ...member, spreadsheetId: "UNREGISTERED_CROSS_BOOK" },
    }];
    const blocked = await core.executeNonproductionAtomicPublication("cross-book", wrong, fence);
    assert.equal(blocked.ok, false);
    assert.equal(http.requests.length, 0);
    cases++;
  }
  {
    const { http, core, fence } = setup();
    const [a,b] = await Promise.all([
      core.executeNonproductionAtomicPublication("concurrent-a", makeInput(), fence),
      core.executeNonproductionAtomicPublication("concurrent-b", makeInput(), fence),
    ]);
    assert.equal([a,b].filter((x) => x.ok).length, 1);
    assert.equal(http.requests.length, 1, "one mock exclusive writer wins");
    cases++;
  }
  {
    const { http, core, fence } = setup();
    fence.completionDurable = false;
    const blocked = await core.executeNonproductionAtomicPublication("terminal-fence-failed", makeInput(), fence);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.stop, "MUTATION_OUTCOME_AMBIGUOUS");
    assert.equal(http.requests.length, 1);
    cases++;
  }
  console.log(JSON.stringify({
    status: "PASS_NONPRODUCTION_MOCK_RUNTIME_ONLY",
    cases,
    provider: "GoogleSheetsControlPlaneProvider_WITH_MOCK_FETCH",
    real_google_sheets_provider_writes: 0,
    real_provider_finality_proof: false,
    real_publisher_grant_issuer: false,
    production_route: false,
    blind_retry: false,
    whole_A2_H2_atomic_post: true,
    same_invocation_exact_readback: true,
  }));
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
