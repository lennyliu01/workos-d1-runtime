/**
 * Batch07 explicitly-authorized REAL Sheets API primitive witness.
 *
 * This does NOT test ExecutorCore's publication grant, old-request fence or
 * complete CUTOVER lifecycle.  It only tests the concrete PR #1718
 * GoogleSheetsControlPlaneProvider implementation against a PINNED,
 * non-authoritative copied fixture.  No dynamic spreadsheet target.
 *
 * Never call this from a general PR workflow.  Run only inside an
 * independently scoped nonproduction execution environment holding a
 * short-lived Google access token for the isolated test service account.
 */
import assert from "node:assert/strict";
import {
  GoogleSheetsControlPlaneProvider,
  type ExactRecord,
  type SheetsLocator,
} from "../src/cutover_executor";

const FIXTURE_ID = "1tmh0OEqnVfwJAfx7jj7O8F11wUtmkpdvuqhqLry9rF4";
const PRODUCTION_ID = "1Ckqy598EPE9CO3gejn2b0sLC3IC1_FcwScRFPE2JumM";
const ORIGINAL_FIXTURE_ID = "11DKed3wVcnryEQrgHzfR276znYJLRAwM14ZOEwCkS1Y";
const BOUND_PR_SHA = "dc2b3c04826cdf834441349bbe91437ce43cfa9c";
const EPOCH_0 = 10;
const EPOCH_1 = 11;

function locator(sheetId: number, range: string, columns: string[], row = 1, col = 0): SheetsLocator {
  return {
    provider: "GOOGLE_SHEETS_V4",
    spreadsheetId: FIXTURE_ID,
    sheetId,
    range,
    startRowIndex: row,
    startColumnIndex: col,
    logicalIdentity: "NONAUTHORITATIVE_BATCH07_ISOLATED_WITNESS",
    columns,
  };
}

const authority = locator(
  1649175050, "Authority_Publication!A2:H2",
  ["Authority_Scope_Fingerprint", "Current_Committed_Cutover_ID", "Current_Activation_Epoch",
   "Registry_Snapshot_ID", "Manifest_Set_ID", "Gate_Config_Fingerprint",
   "Workflow_Set_Fingerprint", "Published_At"],
);
const member = locator(
  1428950150, "Transition_Target!A2:B2", ["Projection_ID", "Projection_State"],
);

const predecessor: ExactRecord = {
  Authority_Scope_Fingerprint: "fixture-scope",
  Current_Committed_Cutover_ID: "CUT_FIXTURE_PREV",
  Current_Activation_Epoch: EPOCH_0,
  Registry_Snapshot_ID: "RS_PREV",
  Manifest_Set_ID: "MSET_PREV",
  Gate_Config_Fingerprint: "gate-prev",
  Workflow_Set_Fingerprint: "workflow-prev",
  Published_At: "2026-09-28T00:00:00Z",
};
const successor: ExactRecord = {
  Authority_Scope_Fingerprint: "fixture-scope",
  Current_Committed_Cutover_ID: "CUT_FIXTURE_TARGET",
  Current_Activation_Epoch: EPOCH_1,
  Registry_Snapshot_ID: "RS_FIXTURE",
  Manifest_Set_ID: "MSET_FIXTURE",
  Gate_Config_Fingerprint: "gate-fixture",
  Workflow_Set_Fingerprint: "workflow-fixture",
  Published_At: "2026-11-06T00:00:00Z",
};
const memberBefore: ExactRecord = {
  Projection_ID: "fixture-1", Projection_State: "CANDIDATE",
};
const memberAfter: ExactRecord = {
  Projection_ID: "fixture-1", Projection_State: "ACTIVE",
};

async function main(): Promise<void> {
  assert.notEqual(FIXTURE_ID, PRODUCTION_ID);
  assert.notEqual(FIXTURE_ID, ORIGINAL_FIXTURE_ID);
  assert.equal(
    process.env.BATCH07_NONPROD_WITNESS_APPROVED,
    "PR1718_ISOLATED_FIXTURE_ONLY",
    "Explicit, fixture-only invocation acknowledgement required",
  );
  const token = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  assert.ok(token, "Isolated, short-lived Google OAuth access token required");

  const provider = new GoogleSheetsControlPlaneProvider({ accessToken: token });
  const metadata = (row: number, name: string) =>
    locator(624586367, `Fixture_Metadata!B${row}:B${row}`, [name], row - 1, 1);
  const [isAuthority, sheetIdentity, selectable] = await Promise.all([
    provider.readExact(metadata(3, "fixture_authority")),
    provider.readExact(metadata(4, "Spreadsheet_ID")),
    provider.readExact(metadata(8, "Authority_Publication_Selectable")),
  ]);
  assert.equal(String(isAuthority.fixture_authority).toUpperCase(), "FALSE");
  assert.equal(sheetIdentity.Spreadsheet_ID, FIXTURE_ID);
  assert.equal(String(selectable.Authority_Publication_Selectable).toUpperCase(), "FALSE");

  const before = await provider.readExact(authority);
  const memberSnapshot = await provider.readExact(member);
  assert.deepEqual(before, predecessor, "Unexpected fixture predecessor, no mutation permitted");
  assert.deepEqual(memberSnapshot, memberBefore, "Unexpected member predecessor, no mutation permitted");

  // One actual Google Sheets spreadsheets.batchUpdate POST with two updateCells.
  const forward = await provider.mutateAuthorityGenerationBatch(authority, successor, [
    { locator: member, value: memberAfter },
  ]);
  assert.equal(forward.outcome, "CONFIRMED", "Ambiguous write: STOP; reconcile before any reset/retry");
  assert.deepEqual(await provider.readExact(authority), successor, "Forward authority readback mismatch");
  assert.deepEqual(await provider.readExact(member), memberAfter, "Forward member readback mismatch");

  // Reset ONLY after exact positive readback, using the same provider method.
  const reset = await provider.mutateAuthorityGenerationBatch(authority, predecessor, [
    { locator: member, value: memberBefore },
  ]);
  assert.equal(reset.outcome, "CONFIRMED", "Ambiguous reset: STOP and reconcile, never blind retry");
  assert.deepEqual(await provider.readExact(authority), predecessor, "Reset authority readback mismatch");
  assert.deepEqual(await provider.readExact(member), memberBefore, "Reset member readback mismatch");

  console.log(JSON.stringify({
    status: "REAL_SHEETS_PROVIDER_ATOMIC_PRIMITIVE_PASS",
    boundary: "NOT_EXECUTORCORE_NOT_PUBLISHER_GRANT_NOT_PRODUCTION",
    fixture_id: FIXTURE_ID,
    source_pr_head: BOUND_PR_SHA,
    verified_real_api_batches: 2,
    coupled_records_per_batch: 2,
    independently_readback: true,
    reset_verified: true,
  }));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({
    status: "REAL_PROVIDER_WITNESS_FAILED_OR_AMBIGUOUS",
    boundary: "STOP_NO_BLIND_RETRY",
    error: error instanceof Error ? error.message : String(error),
    fixture_id: FIXTURE_ID,
  }));
  process.exitCode = 1;
});
