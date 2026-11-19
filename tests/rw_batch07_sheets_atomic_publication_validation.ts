import assert from "node:assert/strict";
import {
  GoogleSheetsControlPlaneProvider,
  type ExactRecord,
  type SheetsLocator,
} from "../src/cutover_executor";

const authority: SheetsLocator = {
  provider: "GOOGLE_SHEETS_V4",
  spreadsheetId: "NONPRODUCTION_ATOMIC_FIXTURE_ONLY",
  sheetId: 1002,
  range: "Authority_Publication!A2:H2",
  startRowIndex: 1,
  startColumnIndex: 0,
  logicalIdentity: "NONPRODUCTION_FULL_AUTHORITY_GENERATION",
  columns: [
    "Authority_Scope_Fingerprint",
    "Current_Committed_Cutover_ID",
    "Current_Activation_Epoch",
    "Registry_Snapshot_ID",
    "Manifest_Set_ID",
    "Gate_Config_Fingerprint",
    "Workflow_Set_Fingerprint",
    "Published_At",
  ],
};

const target: ExactRecord = {
  Authority_Scope_Fingerprint: "FIXTURE_SCOPE",
  Current_Committed_Cutover_ID: "FIXTURE_CUTOVER_11",
  Current_Activation_Epoch: "11",
  Registry_Snapshot_ID: "FIXTURE_REGISTRY_11",
  Manifest_Set_ID: "FIXTURE_MANIFEST_11",
  Gate_Config_Fingerprint: "FIXTURE_GATE_11",
  Workflow_Set_Fingerprint: "FIXTURE_WORKFLOW_11",
  Published_At: "2026-11-05T00:00:00Z",
};

const member: SheetsLocator = {
  provider: "GOOGLE_SHEETS_V4",
  spreadsheetId: authority.spreadsheetId,
  sheetId: 358499032,
  range: "Manifest_Set_Members!E7:E7",
  startRowIndex: 6,
  startColumnIndex: 4,
  logicalIdentity: "FIXTURE_COUPLED_MEMBER",
  columns: ["Projection_State"],
};

type Captured = { url: string; method: string; body: any };
const calls: Captured[] = [];
let mode: "OK" | "HTTP_500" | "THROW" = "OK";
const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  calls.push({
    url: String(input),
    method: String(init?.method),
    body: JSON.parse(String(init?.body)),
  });
  if (mode === "THROW") throw new Error("simulated_timeout_no_provider_finality");
  if (mode === "HTTP_500") return Response.json({ error: "transient" }, { status: 500 });
  return Response.json({ spreadsheetId: authority.spreadsheetId, replies: [] });
};

const p = new GoogleSheetsControlPlaneProvider({
  accessToken: "NONPRODUCTION_TEST_ONLY",
  fetchImpl: fakeFetch as typeof fetch,
});

async function main(): Promise<void> {
  const single = await p.mutateAuthorityGenerationBatch(authority, target);
  assert.equal(single.outcome, "CONFIRMED");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.ok(calls[0].url.endsWith(":batchUpdate"));
  assert.equal(calls[0].body.requests.length, 1);
  const full = calls[0].body.requests[0].updateCells;
  assert.deepEqual(full.range, {
    sheetId: 1002,
    startRowIndex: 1,
    endRowIndex: 2,
    startColumnIndex: 0,
    endColumnIndex: 8,
  });
  assert.deepEqual(
    full.rows[0].values.map((x: any) => x.userEnteredValue.stringValue),
    authority.columns.map((key) => target[key]),
  );

  calls.length = 0;
  const coupledResult = await p.mutateAuthorityGenerationBatch(authority, target, [
    { locator: member, value: { Projection_State: "ACTIVE" } },
  ]);
  assert.equal(coupledResult.outcome, "CONFIRMED");
  assert.equal(calls.length, 1, "coupled requests must share one provider batch");
  assert.equal(calls[0].body.requests.length, 2);
  assert.equal(
    calls[0].body.requests[1].updateCells.rows[0].values[0].userEnteredValue.stringValue,
    "ACTIVE",
  );

  calls.length = 0;
  await assert.rejects(
    p.mutateAuthorityGenerationBatch(
      { ...authority, range: "Authority_Publication!A2:B2", columns: authority.columns.slice(0, 2) },
      target,
    ),
    /AUTHORITY_PUBLICATION_COMPLETE_A2_H2_REQUIRED/,
  );
  await assert.rejects(
    p.mutateAuthorityGenerationBatch(authority, { ...target, Extra_Field: "DRIFT" }),
    /ATOMIC_PUBLICATION_UNSEALED_OR_CROSS_WORKBOOK_UPDATE/,
  );
  await assert.rejects(
    p.mutateAuthorityGenerationBatch(authority, target, [
      { locator: { ...member, spreadsheetId: "OTHER_WORKBOOK" }, value: { Projection_State: "ACTIVE" } },
    ]),
    /ATOMIC_PUBLICATION_UNSEALED_OR_CROSS_WORKBOOK_UPDATE/,
  );
  await assert.rejects(
    p.mutateAuthorityGenerationBatch(authority, target, [
      { locator: authority, value: target },
    ]),
    /ATOMIC_PUBLICATION_OVERLAPPING_UPDATE/,
  );
  assert.equal(calls.length, 0, "invalid inputs reached the provider");

  mode = "HTTP_500";
  assert.equal((await p.mutateAuthorityGenerationBatch(authority, target)).outcome, "AMBIGUOUS");
  mode = "THROW";
  assert.equal((await p.mutateAuthorityGenerationBatch(authority, target)).outcome, "AMBIGUOUS");

  assert.equal(calls.length, 2, "ambiguous attempts must not automatically retry");
  console.log(JSON.stringify({
    status: "PASS_ISOLATED_REQUEST_SHAPE_ONLY",
    cases: 8,
    complete_authority_columns: 8,
    coupled_workbook_batch_count: 1,
    duplicate_provider_retry: false,
    real_provider_write: false,
    expected_epoch_cas: false,
    formal_publisher_grant: false,
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
