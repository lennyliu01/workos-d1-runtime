import {
  PINNED_GATE_BLOB,
  PINNED_GATE_CONFIG_FINGERPRINT,
  PINNED_GATE_LOCATOR,
  type AuthorityPublicationProjection,
  type GateProjectionSnapshot,
  type ManifestAccessRow,
  type WriterScopeProjection,
} from "./workos_persistent_gate_projection.js";

export const AGENTS_FILE_ID = "1vLsNv3YZK-dAJh7jln7KbGLfWzp2k3ec";
export const REPOSITORY_CUTOVER_CONTROL_ID = "1Ckqy598EPE9CO3gejn2b0sLC3IC1_FcwScRFPE2JumM";

export type SupportedTaskId = "US_JAPAN_FX_POLICY" | "ROLLING_WEDGE_INVESTMENT";

export interface ExactControlPlaneReader {
  readDriveText(fileId: string): Promise<string>;
  readSheet(spreadsheetId: string, sheetName: string, range: string): Promise<string[][]>;
}

export interface TaskRegistration {
  taskId: SupportedTaskId;
  workflowName: string;
  workflowFileId: string;
  runtimeProfileFileId: string;
  roleFileIds: Readonly<Record<string, string>>;
  companiesBaselineFileId?: string;
  agentsManifestProjectionFileId?: string;
}

export interface AuthoritySnapshot {
  authorityScopeFingerprint: string;
  currentCutoverId: string;
  activationEpoch: string;
  registrySnapshotId: string;
  registryFingerprint: string;
  manifestSetId: string;
  gateConfigFingerprint: string;
  workflowSetFingerprint: string;
  referencedCutoverState: string;
  migrationWriteFenceState: string;
}

export interface LoadedControlPlane {
  task: TaskRegistration;
  authority: AuthoritySnapshot;
  manifestFileId: string;
  manifestFingerprint: string;
  manifestMetadata: Readonly<Record<string, string>>;
  gate: GateProjectionSnapshot;
  workflowText: string;
  runtimeProfileText: string;
  roleTexts: Readonly<Record<string, string>>;
  companiesBaselineText?: string;
  projectionDrift?: { agentsManifestFileId: string; authoritativeManifestFileId: string };
}

function extractGoogleId(url: string): string {
  const m = url.match(/\/d\/([A-Za-z0-9_-]+)/) ?? url.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
  if (!m) throw new Error(`UNRESOLVABLE_REGISTERED_LOCATOR:${url}`);
  return m[1];
}

function taskSection(agents: string, taskId: SupportedTaskId): string {
  const marker = `## TASK_ID: ${taskId}`;
  const start = agents.indexOf(marker);
  if (start < 0) throw new Error(`TASK_NOT_REGISTERED:${taskId}`);
  const next = agents.indexOf("\n## TASK_ID:", start + marker.length);
  return next < 0 ? agents.slice(start) : agents.slice(start, next);
}

function fieldUrl(section: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("\\*\\*" + escaped + ":\\*\\*\\s*(?:`[^`]+`\\s*[—-]\\s*)?`?([^\\s`]+)", "m");
  const m = section.match(re);
  if (!m) throw new Error(`REGISTERED_FIELD_MISSING:${label}`);
  return m[1];
}

function parseRegistration(agents: string, taskId: SupportedTaskId): TaskRegistration {
  const section = taskSection(agents, taskId);
  const workflowName = section.match(/\*\*Name:\*\*\s*`([^`]+)`/)?.[1];
  if (!workflowName) throw new Error("WORKFLOW_NAME_MISSING");
  const workflowFileId = extractGoogleId(fieldUrl(section, "Cloud Location"));
  const manifestMatch = section.match(/\*\*Persistent Manifest:\*\*\s*`?([^\s`]+)/);
  const runtimeMatch = section.match(/\*\*Runtime Profile:\*\*[^\n]*?(https:\/\/docs\.google\.com\/document\/d\/[A-Za-z0-9_-]+)/);
  if (!runtimeMatch) throw new Error("RUNTIME_PROFILE_LOCATOR_MISSING");
  const roleFileIds: Record<string, string> = {};
  const roleRe = /### ROLE: ([A-Z_]+)[\s\S]*?\*\*Spec:\*\*[^\n]*?(https:\/\/(?:drive|docs)\.google\.com\/[^\s`]+)/g;
  for (const m of section.matchAll(roleRe)) roleFileIds[m[1]] = extractGoogleId(m[2]);
  const companies = taskId === "ROLLING_WEDGE_INVESTMENT"
    ? section.match(/\*\*Cloud Location:\*\*\s*`?(https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]+)/g)?.at(-1)
    : undefined;
  return {
    taskId,
    workflowName,
    workflowFileId,
    runtimeProfileFileId: extractGoogleId(runtimeMatch[1]),
    roleFileIds,
    ...(companies ? { companiesBaselineFileId: extractGoogleId(companies.replace(/^\*\*Cloud Location:\*\*\s*`?/, "")) } : {}),
    ...(manifestMatch ? { agentsManifestProjectionFileId: extractGoogleId(manifestMatch[1]) } : {}),
  };
}

function rowsToObjects(values: string[][]): Record<string, string>[] {
  if (values.length < 2) return [];
  const [headers, ...rows] = values;
  return rows
    .filter((row) => row.some((v) => v !== ""))
    .map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ""])));
}

function singleRow(values: string[][], label: string): Record<string, string> {
  const rows = rowsToObjects(values);
  if (rows.length !== 1) throw new Error(`${label}_NOT_SINGLETON`);
  return rows[0];
}

function singleMatch(rows: Record<string, string>[], predicate: (row: Record<string, string>) => boolean, label: string): Record<string, string> {
  const matches = rows.filter(predicate);
  if (matches.length !== 1) throw new Error(`${label}_NOT_SINGLETON`);
  return matches[0];
}

function instanceId(rule: string): string {
  const singleton = rule.match(/SINGLETON_RESOURCE:([A-Za-z0-9._:-]+)/)?.[1];
  if (singleton) return singleton;
  const registered = rule.match(/REGISTERED_INSTANCE_BINDING:([A-Za-z0-9._:-]+)/)?.[1];
  if (registered) return registered;
  const exact = rule.match(/Instance_ID=([A-Za-z0-9._:-]+)/)?.[1];
  if (exact) return exact;
  throw new Error(`INSTANCE_RULE_UNSUPPORTED:${rule}`);
}

const READERS_BY_DATASET: Readonly<Record<string, readonly string[]>> = {
  FX_POLICY_ANALYSIS_STATE: ["READER", "US_Japan_FX_Policy_Workflow"],
  FX_POLICY_EVIDENCE_LOG: ["COLLECTOR", "READER"],
  FX_POLICY_MARKET_STATE: ["COLLECTOR", "READER"],
  FX_POLICY_RUN_LOG: ["COLLECTOR", "READER", "US_Japan_FX_Policy_Workflow"],
  RW_COMPANY_REGISTRY: ["Rolling_Wedge_Workflow", "MONITOR", "REVISER", "VALUATOR", "DECISION"],
  RW_CURRENT_STATE: ["Rolling_Wedge_Workflow", "MONITOR", "REVISER", "VALUATOR", "DECISION"],
  RW_EVIDENCE_HISTORY: ["Rolling_Wedge_Workflow", "MONITOR", "REVISER"],
  RW_REVISION_HISTORY: ["Rolling_Wedge_Workflow", "REVISER"],
  RW_VALUATION_HISTORY: ["Rolling_Wedge_Workflow", "VALUATOR"],
  RW_RUN_LOG: ["Rolling_Wedge_Workflow", "MONITOR", "REVISER", "VALUATOR", "DECISION"],
};

function writeMode(mode: string): ManifestAccessRow["writeMode"] {
  if (mode === "CONDITIONAL_CURRENT_STATE") return "CURRENT_STATE";
  if (mode === "GOVERNED_CURRENT") return "GOVERNED_CURRENT";
  return "APPEND_ONLY";
}

function fieldScope(requirements: string): ReadonlySet<string> | null {
  const marker = requirements.split(";").find((part) => part.startsWith("FIELD_SCOPE="));
  if (!marker || marker === "FIELD_SCOPE=ALL_REGISTERED_FIELDS") return null;
  const raw = marker.slice("FIELD_SCOPE=".length);
  if (!raw) throw new Error("FIELD_SCOPE_UNRESOLVED");
  return new Set(raw.split(",").map((x) => x.trim()).filter(Boolean));
}

function releasedMigrationFence(state: string): boolean {
  return state === "RELEASED" || state.startsWith("NOT_APPLICABLE_");
}

function normalizeAccess(
  writeRows: Record<string, string>[],
  readRows: Record<string, string>[],
  instanceRows: Record<string, string>[],
): ManifestAccessRow[] {
  const accesses = new Map<string, {
    datasetId: string;
    instanceId: string;
    logicalMember: string;
    contractFingerprint: string;
    physicalContractFingerprint: string | null;
    readers: Set<string>;
    writerScopes: WriterScopeProjection[];
    writeMode: ManifestAccessRow["writeMode"];
    dynamicInstance: boolean;
    businessAuthorityState: string;
  }>();

  for (const row of instanceRows) {
    const iid = instanceId(row.Exact_Resource_Resolution_Rule || row.Instance_Rule || "");
    const read = singleMatch(
      readRows,
      (r) => r.Dataset_ID === row.Dataset_ID && instanceId(r.Instance_Rule) === iid,
      `READ_PROJECTION:${row.Dataset_ID}:${iid}`,
    );
    const dynamic = row.Projection_Mode.includes("REGISTERED_PARENT");
    const businessState = dynamic
      ? (row.Presence_Rule.includes("State_Status=ACTIVE") && row.Presence_Rule.includes("Archived=FALSE") ? "ACTIVE" : "UNRESOLVED")
      : "ACTIVE";
    const key = `${row.Dataset_ID}\u0000${iid}`;
    accesses.set(key, {
      datasetId: row.Dataset_ID,
      instanceId: iid,
      logicalMember: read.Exact_Member_Or_Resource_Class,
      contractFingerprint: read.Schema_Contract_Fingerprint,
      physicalContractFingerprint: read.Schema_Contract_Fingerprint || null,
      readers: new Set(READERS_BY_DATASET[row.Dataset_ID] ?? []),
      writerScopes: [],
      writeMode: "APPEND_ONLY",
      dynamicInstance: dynamic,
      businessAuthorityState: businessState,
    });
  }

  for (const row of writeRows) {
    const iid = instanceId(row.Instance_Rule);
    const key = `${row.Dataset_ID}\u0000${iid}`;
    const access = accesses.get(key);
    if (!access) throw new Error(`WRITE_INSTANCE_NOT_IN_INSTANCE_PROJECTION:${row.Dataset_ID}:${iid}`);
    if (access.logicalMember !== row.Exact_Member_Or_Resource_Class) {
      throw new Error(`LOGICAL_MEMBER_PROJECTION_DRIFT:${row.Dataset_ID}:${iid}`);
    }
    if (access.contractFingerprint !== row.Schema_Contract_Fingerprint) {
      throw new Error(`PHYSICAL_CONTRACT_PROJECTION_DRIFT:${row.Dataset_ID}:${iid}`);
    }
    access.writerScopes.push({
      writerId: row.Writer_Identity,
      operations: new Set([row.Operation_Mode]),
      fields: fieldScope(row.Gate_Requirements),
    });
    access.writeMode = writeMode(row.Operation_Mode);
  }

  return [...accesses.values()];
}

export async function loadControlPlane(reader: ExactControlPlaneReader, taskId: SupportedTaskId): Promise<LoadedControlPlane> {
  const agents = await reader.readDriveText(AGENTS_FILE_ID);
  const task = parseRegistration(agents, taskId);

  const authorityRow = singleRow(
    await reader.readSheet(REPOSITORY_CUTOVER_CONTROL_ID, "Authority_Publication", "A1:H5"),
    "AUTHORITY_PUBLICATION",
  );

  const cutovers = rowsToObjects(
    await reader.readSheet(REPOSITORY_CUTOVER_CONTROL_ID, "Cutovers", "A1:AC200"),
  );
  const cutover = singleMatch(
    cutovers,
    (row) => row.Cutover_ID === authorityRow.Current_Committed_Cutover_ID,
    "REFERENCED_CUTOVER",
  );

  const snapshot: AuthoritySnapshot = {
    authorityScopeFingerprint: authorityRow.Authority_Scope_Fingerprint,
    currentCutoverId: authorityRow.Current_Committed_Cutover_ID,
    activationEpoch: authorityRow.Current_Activation_Epoch,
    registrySnapshotId: authorityRow.Registry_Snapshot_ID,
    registryFingerprint: cutover.Target_Registry_Fingerprint,
    manifestSetId: authorityRow.Manifest_Set_ID,
    gateConfigFingerprint: authorityRow.Gate_Config_Fingerprint,
    workflowSetFingerprint: authorityRow.Workflow_Set_Fingerprint,
    referencedCutoverState: cutover.Cutover_State,
    migrationWriteFenceState: cutover.MIGRATION_WRITE_FENCE_State,
  };

  if (snapshot.gateConfigFingerprint !== PINNED_GATE_CONFIG_FINGERPRINT) {
    throw new Error("GATE_CONFIG_FINGERPRINT_DRIFT");
  }

  const members = rowsToObjects(
    await reader.readSheet(REPOSITORY_CUTOVER_CONTROL_ID, "Manifest_Set_Members", "A1:E200"),
  );
  const manifestMembers = members.filter(
    (r) => r.Manifest_Set_ID === snapshot.manifestSetId && r.Task_ID === taskId && r.Projection_State === "ACTIVE",
  );
  if (manifestMembers.length !== 1) throw new Error("CURRENT_MANIFEST_MEMBER_NOT_UNIQUE");
  const member = manifestMembers[0];
  const manifestFileId = member.Manifest_File_ID;

  const metadata = singleRow(
    await reader.readSheet(manifestFileId, "Manifest_Metadata", "A1:I5"),
    "MANIFEST_METADATA",
  );
  if (metadata.Task_ID !== taskId || metadata.Manifest_State !== "ACTIVE") {
    throw new Error("MANIFEST_IDENTITY_OR_STATE_MISMATCH");
  }
  if (metadata.Registry_Snapshot_ID !== snapshot.registrySnapshotId || metadata.Manifest_Set_ID !== snapshot.manifestSetId) {
    throw new Error("MANIFEST_AUTHORITY_MISMATCH");
  }
  if (metadata.Registry_Fingerprint !== snapshot.registryFingerprint) {
    throw new Error("MANIFEST_REGISTRY_FINGERPRINT_MISMATCH");
  }
  if (metadata.Manifest_Fingerprint !== member.Manifest_Fingerprint) {
    throw new Error("MANIFEST_FINGERPRINT_MISMATCH");
  }

  const [writeRows, readRows, instanceRows] = await Promise.all([
    reader.readSheet(manifestFileId, "Write_Projection", "A1:G200").then(rowsToObjects),
    reader.readSheet(manifestFileId, "Read_Projection", "A1:E200").then(rowsToObjects),
    reader.readSheet(manifestFileId, "Instance_Projection", "A1:E200").then(rowsToObjects),
  ]);
  const accesses = normalizeAccess(writeRows, readRows, instanceRows);

  const [workflowText, runtimeProfileText] = await Promise.all([
    reader.readDriveText(task.workflowFileId),
    reader.readDriveText(task.runtimeProfileFileId),
  ]);
  const roleTexts: Record<string, string> = {};
  for (const [role, fileId] of Object.entries(task.roleFileIds)) {
    roleTexts[role] = await reader.readDriveText(fileId);
  }
  const companiesBaselineText = task.companiesBaselineFileId
    ? await reader.readDriveText(task.companiesBaselineFileId)
    : undefined;

  const authorityPublication: AuthorityPublicationProjection = {
    authorityScopeFingerprint: authorityRow.Authority_Scope_Fingerprint,
    currentCommittedCutoverId: authorityRow.Current_Committed_Cutover_ID,
    currentActivationEpoch: authorityRow.Current_Activation_Epoch,
    registrySnapshotId: authorityRow.Registry_Snapshot_ID,
    manifestSetId: authorityRow.Manifest_Set_ID,
    gateConfigFingerprint: authorityRow.Gate_Config_Fingerprint,
    workflowSetFingerprint: authorityRow.Workflow_Set_Fingerprint,
  };

  const projectionDrift =
    task.agentsManifestProjectionFileId && task.agentsManifestProjectionFileId !== manifestFileId
      ? { agentsManifestFileId: task.agentsManifestProjectionFileId, authoritativeManifestFileId: manifestFileId }
      : undefined;

  return {
    task,
    authority: snapshot,
    manifestFileId,
    manifestFingerprint: metadata.Manifest_Fingerprint,
    manifestMetadata: metadata,
    gate: {
      gateLocator: PINNED_GATE_LOCATOR,
      gateBlob: PINNED_GATE_BLOB,
      gateConfigFingerprint: snapshot.gateConfigFingerprint,

      authorityPublicationState: "EXACT_ONE",
      authorityPublication,
      expectedAuthorityScopeFingerprint: cutover.Authority_Scope_Fingerprint,
      expectedCutoverId: cutover.Cutover_ID,
      expectedActivationEpoch: cutover.Activation_Epoch,
      expectedManifestSetId: cutover.Target_Manifest_Set_ID,
      expectedGateConfigFingerprint: cutover.Persistent_Data_Gate_Config_Fingerprint,
      expectedWorkflowSetFingerprint: cutover.Target_Workflow_Set_Fingerprint,
      referencedCutoverState: cutover.Cutover_State,

      currentRegistrySnapshotId: cutover.Target_Registry_Snapshot_ID,
      currentRegistryFingerprint: cutover.Target_Registry_Fingerprint,

      manifestId: metadata.Manifest_ID,
      taskId,
      manifestState: metadata.Manifest_State,
      manifestRegistrySnapshotId: metadata.Registry_Snapshot_ID,
      manifestRegistryFingerprint: metadata.Registry_Fingerprint,

      migrationFenceActive: !releasedMigrationFence(cutover.MIGRATION_WRITE_FENCE_State),
      pruneFenceIndexAvailable: true,
      pruneFencedKeys: new Set(),
      startedPruneKeys: new Set(),
      archivedIdentityKeys: new Set(),

      accesses,
    },
    workflowText,
    runtimeProfileText,
    roleTexts,
    ...(companiesBaselineText ? { companiesBaselineText } : {}),
    ...(projectionDrift ? { projectionDrift } : {}),
  };
}

export class GoogleExactControlPlaneReader implements ExactControlPlaneReader {
  constructor(private readonly accessToken: string, private readonly fetchImpl: typeof fetch = fetch) {
    if (!accessToken) throw new Error("GOOGLE_ACCESS_TOKEN_MISSING");
  }

  private auth(): Record<string, string> {
    return { Authorization: `Bearer ${this.accessToken}` };
  }

  async readDriveText(fileId: string): Promise<string> {
    const meta = await this.fetchImpl(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,mimeType,name`,
      { headers: this.auth() },
    );
    if (!meta.ok) throw new Error(`DRIVE_METADATA_READ_FAILED:${fileId}:${meta.status}`);
    const m = await meta.json() as { mimeType?: string };
    const url = m.mimeType === "application/vnd.google-apps.document"
      ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text%2Fplain`
      : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
    const r = await this.fetchImpl(url, { headers: this.auth() });
    if (!r.ok) throw new Error(`DRIVE_TEXT_READ_FAILED:${fileId}:${r.status}`);
    return await r.text();
  }

  async readSheet(spreadsheetId: string, sheetName: string, range: string): Promise<string[][]> {
    const a1 = `${sheetName}!${range}`;
    const url =
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(a1)}?majorDimension=ROWS`;
    const r = await this.fetchImpl(url, { headers: this.auth() });
    if (!r.ok) throw new Error(`SHEET_READ_FAILED:${spreadsheetId}:${sheetName}:${r.status}`);
    const body = await r.json() as { values?: string[][] };
    return body.values ?? [];
  }
}
