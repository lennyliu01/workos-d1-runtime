import type { ExactControlPlaneReader, SupportedTaskId } from "./workos_control_plane_loader.js";
import type { ManifestAccessRow } from "./workos_persistent_gate_projection.js";

const ACCEPTANCE_BINDING_COMPONENT = "D1_PROVIDER_INVOCATION_CONTRACT";
const REQUIRED_D1_ACCEPTANCE_CASES = new Set([
  "D1_APPEND_WRITE_SAFETY",
  "D1_CURRENT_STATE_CAS",
  "D1_BOUNDED_READ",
  "ACTIVATION_TIME_D1_CAPABILITY_RECONFIRMATION",
]);

interface LiveContextInput {
  taskId: SupportedTaskId;
  currentCutoverId: string;
  currentRegistryFileId: string;
  currentRegistrySnapshotId: string;
  currentRegistryFingerprint: string;
  currentAcceptanceBindingId: string;
  accesses: readonly ManifestAccessRow[];
}

export interface LiveGateContext {
  migrationFenceActive: boolean;
  pruneFenceIndexAvailable: true;
  pruneFencedKeys: ReadonlySet<string>;
  startedPruneKeys: ReadonlySet<string>;
  archivedIdentityKeys: ReadonlySet<string>;
  physicalContractFingerprints: ReadonlyMap<string, string>;
  businessAuthorityStates: ReadonlyMap<string, "ACTIVE" | "PENDING">;
  sourceEvidence: Readonly<Record<string, string>>;
}

type Row = Record<string, string>;

function rowsToObjects(values: string[][], required: readonly string[], label: string): Row[] {
  if (!values.length) throw new Error(`LIVE_GATE_CONTEXT_UNAVAILABLE:${label}:EMPTY`);
  const headers = values[0] ?? [];
  for (const column of required) {
    if (!headers.includes(column)) throw new Error(`LIVE_GATE_CONTEXT_INVALID:${label}:MISSING_COLUMN:${column}`);
  }
  return values.slice(1)
    .filter((row) => row.some((value) => value !== ""))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function one<T>(items: readonly T[], label: string): T {
  if (items.length !== 1) throw new Error(`LIVE_GATE_CONTEXT_AMBIGUOUS:${label}:${items.length}`);
  return items[0];
}

function key(datasetId: string, instanceId: string): string {
  return `${datasetId}\u0000${instanceId}`;
}

function logicalKey(datasetId: string, logicalK1: string): string {
  return `${datasetId}\u0000${logicalK1}`;
}

function exactResource(rows: readonly Row[], datasetId: string, expectedMember?: string): Row {
  const row = one(rows.filter((candidate) => candidate.Dataset_ID === datasetId), `RESOURCE:${datasetId}`);
  if (row.Instance_Projection_Mode !== "SINGLETON_RESOURCE") {
    throw new Error(`LIVE_GATE_CONTEXT_INVALID:RESOURCE_MODE:${datasetId}:${row.Instance_Projection_Mode}`);
  }
  if (!row.Exact_File_ID) throw new Error(`LIVE_GATE_CONTEXT_INVALID:RESOURCE_FILE_ID:${datasetId}`);
  if (expectedMember && row.Exact_Member_Name !== expectedMember) {
    throw new Error(`LIVE_GATE_CONTEXT_INVALID:RESOURCE_MEMBER:${datasetId}`);
  }
  return row;
}

function parseCanonicalKeySet(raw: string, label: string): string[] {
  if (!raw) throw new Error(`LIVE_GATE_CONTEXT_INVALID:${label}:EMPTY_KEY_SET`);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`LIVE_GATE_CONTEXT_INVALID:${label}:NON_JSON_KEY_SET`);
  }
  if (!Array.isArray(value)) throw new Error(`LIVE_GATE_CONTEXT_INVALID:${label}:KEY_SET_NOT_ARRAY`);
  const result: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.includes("\u0000")) {
      result.push(item);
      continue;
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const record = item as Record<string, unknown>;
      if (typeof record.dataset_id === "string" && typeof record.logical_k1 === "string" &&
          record.dataset_id && record.logical_k1) {
        result.push(logicalKey(record.dataset_id, record.logical_k1));
        continue;
      }
    }
    throw new Error(`LIVE_GATE_CONTEXT_INVALID:${label}:UNSUPPORTED_KEY_ENTRY`);
  }
  return result;
}

function driveEvidenceId(ref: string): string | null {
  const direct = ref.match(/^drive:([A-Za-z0-9_-]+)$/)?.[1];
  if (direct) return direct;
  return ref.match(/\/d\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
}

async function coverageEvidence(
  reader: ExactControlPlaneReader,
  coverageRows: readonly Row[],
  input: LiveContextInput,
): Promise<Record<string, unknown>[]> {
  const applicable = coverageRows.filter(
    (row) => row.Registry_Snapshot_ID === input.currentRegistrySnapshotId && row.Audit_Result === "PASS",
  );
  const evidence: Record<string, unknown>[] = [];
  for (const row of applicable) {
    const fileId = driveEvidenceId(row.Evidence_Ref);
    if (!fileId) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await reader.readDriveText(fileId));
    } catch {
      throw new Error(`LIVE_GATE_CONTEXT_INVALID:COVERAGE_EVIDENCE:${fileId}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`LIVE_GATE_CONTEXT_INVALID:COVERAGE_EVIDENCE_SHAPE:${fileId}`);
    }
    const record = parsed as Record<string, unknown>;
    if (record.registry_snapshot_id !== input.currentRegistrySnapshotId ||
        record.registry_fingerprint !== input.currentRegistryFingerprint) {
      throw new Error("LIVE_GATE_CONTEXT_STALE:COVERAGE_EVIDENCE_REGISTRY_BINDING");
    }
    evidence.push(record);
  }
  return evidence;
}

function authorityFromEvidence(
  evidence: readonly Record<string, unknown>[],
  instanceId: string,
  registryResource: Row,
): "ACTIVE" | "PENDING" {
  for (const item of evidence) {
    const instances = item.instances;
    if (!instances || typeof instances !== "object" || Array.isArray(instances)) continue;
    const instance = (instances as Record<string, unknown>)[instanceId];
    if (!instance || typeof instance !== "object" || Array.isArray(instance)) continue;
    const row = instance as Record<string, unknown>;
    if (row.file_id !== registryResource.Exact_File_ID) continue;
    const checks = row.checks;
    if (!checks || typeof checks !== "object" || Array.isArray(checks)) continue;
    const c = checks as Record<string, unknown>;
    if (c.parent_active !== true ||
        c.exact_member_set !== true ||
        c.history_headers_match_registry !== true ||
        c.current_state_identity_match !== true ||
        row.coverage_pass !== true) continue;
    return "ACTIVE";
  }
  return "PENDING";
}

export async function loadLiveGateContext(
  reader: ExactControlPlaneReader,
  input: LiveContextInput,
): Promise<LiveGateContext> {
  const [registryMetadataValues, resourceValues, contractValues] = await Promise.all([
    reader.readSheet(input.currentRegistryFileId, "Registry_Metadata", "A1:K5"),
    reader.readSheet(input.currentRegistryFileId, "Resource_Projection", "A1:J500"),
    reader.readSheet(input.currentRegistryFileId, "Contract_Fingerprints", "A1:E500"),
  ]);
  const registryMetadata = one(rowsToObjects(
    registryMetadataValues,
    ["Registry_State","Active_Registry_Snapshot_ID","Active_Registry_Fingerprint"],
    "REGISTRY_METADATA",
  ), "REGISTRY_METADATA");
  if (registryMetadata.Registry_State !== "ACTIVE" ||
      registryMetadata.Active_Registry_Snapshot_ID !== input.currentRegistrySnapshotId ||
      registryMetadata.Active_Registry_Fingerprint !== input.currentRegistryFingerprint) {
    throw new Error("LIVE_GATE_CONTEXT_STALE:REGISTRY_METADATA");
  }

  const resources = rowsToObjects(
    resourceValues,
    ["Dataset_ID","Instance_Projection_Mode","Source_Instance_ID_Expression","Exact_File_ID","Exact_Member_Name","Parent_Instance_Registry_ID"],
    "RESOURCE_PROJECTION",
  );
  const contracts = rowsToObjects(
    contractValues,
    ["Registry_Snapshot_ID","Dataset_ID","Registry_Contract_Fingerprint","Registry_Snapshot_Fingerprint"],
    "CONTRACT_FINGERPRINTS",
  );
  const contractByDataset = new Map<string,string>();
  for (const access of input.accesses) {
    const row = one(
      contracts.filter((candidate) =>
        candidate.Registry_Snapshot_ID === input.currentRegistrySnapshotId &&
        candidate.Registry_Snapshot_Fingerprint === input.currentRegistryFingerprint &&
        candidate.Dataset_ID === access.datasetId),
      `CONTRACT_FINGERPRINT:${access.datasetId}`,
    );
    if (!row.Registry_Contract_Fingerprint) throw new Error(`LIVE_GATE_CONTEXT_INVALID:CONTRACT_FINGERPRINT:${access.datasetId}`);
    contractByDataset.set(access.datasetId, row.Registry_Contract_Fingerprint);
  }

  // Bind Registry contract fingerprints to the currently accepted physical D1 provider lineage.
  const acceptanceResource = exactResource(resources, "SYS_ARCHIVE_ACCEPTANCE_RESULT", "Acceptance_Results");
  const runtimeProjectionResource = exactResource(resources, "SYS_RUNTIME_COMPONENT_PROJECTION", "Runtime_Component_Projection");
  if (acceptanceResource.Exact_File_ID !== runtimeProjectionResource.Exact_File_ID) {
    throw new Error("LIVE_GATE_CONTEXT_INVALID:ACCEPTANCE_CONTROL_SPLIT");
  }
  const [runtimeProjectionValues, acceptanceValues] = await Promise.all([
    reader.readSheet(runtimeProjectionResource.Exact_File_ID, "Runtime_Component_Projection", "A1:F300"),
    reader.readSheet(acceptanceResource.Exact_File_ID, "Acceptance_Results", "A1:M500"),
  ]);
  const runtimeProjectionRows = rowsToObjects(
    runtimeProjectionValues,
    ["Acceptance_Binding_ID","Component_ID","Locator_Type","Exact_Locator","Evidence_Ref","Projection_State"],
    "RUNTIME_COMPONENT_PROJECTION",
  );
  one(runtimeProjectionRows.filter((row) =>
    row.Acceptance_Binding_ID === input.currentAcceptanceBindingId &&
    row.Component_ID === ACCEPTANCE_BINDING_COMPONENT &&
    row.Projection_State === "ACTIVE"), "ACTIVE_D1_PROVIDER_INVOCATION_CONTRACT");

  const acceptanceRows = rowsToObjects(
    acceptanceValues,
    ["Acceptance_Binding_ID","Test_Case_ID","Registry_Snapshot_ID","Result"],
    "ACCEPTANCE_RESULTS",
  );
  const passing = new Set(
    acceptanceRows
      .filter((row) =>
        row.Acceptance_Binding_ID === input.currentAcceptanceBindingId &&
        row.Registry_Snapshot_ID === input.currentRegistrySnapshotId &&
        row.Result === "PASS")
      .map((row) => row.Test_Case_ID),
  );
  for (const testCase of REQUIRED_D1_ACCEPTANCE_CASES) {
    if (!passing.has(testCase)) throw new Error(`LIVE_GATE_CONTEXT_UNAVAILABLE:PHYSICAL_CONTRACT_ACCEPTANCE:${testCase}`);
  }

  const migrationResource = exactResource(resources, "SYS_MIGRATION_WRITE_FENCE", "MIGRATION_WRITE_FENCE");
  const migrationRows = rowsToObjects(
    await reader.readSheet(migrationResource.Exact_File_ID, "MIGRATION_WRITE_FENCE", "A1:K1000"),
    ["Fence_ID","Dataset_ID","Source_Instance_ID","Fence_State","Cutover_ID","Migration_Execution_Manifest_ID"],
    "MIGRATION_WRITE_FENCE",
  );
  const writeDatasets = [...new Set(input.accesses.filter((access) => access.writerScopes.length > 0).map((access) => access.datasetId))];
  let migrationFenceActive = false;
  for (const datasetId of writeDatasets) {
    const current = migrationRows.filter((row) => row.Cutover_ID === input.currentCutoverId && row.Dataset_ID === datasetId);
    const row = one(current, `MIGRATION_FENCE:${datasetId}:${input.currentCutoverId}`);
    if (row.Fence_State !== "RELEASED") migrationFenceActive = true;
  }

  const pruneResource = exactResource(resources, "SYS_ARCHIVE_PRUNE_FENCE_INDEX", "Archive_Prune_Fence_Index");
  const pruneRows = rowsToObjects(
    await reader.readSheet(pruneResource.Exact_File_ID, "Archive_Prune_Fence_Index", "A:L"),
    ["Archive_Unit_ID","Archive_Transaction_ID","Fence_State","Registry_Contract_Fingerprint","Exact_K1_Set","Blocked_Dependency_Write_Scope","Affected_Source_Instances"],
    "ARCHIVE_PRUNE_FENCE_INDEX",
  );
  const pruneFencedKeys = new Set<string>();
  const startedPruneKeys = new Set<string>();
  for (const row of pruneRows) {
    if (!["PREPARED","STARTED"].includes(row.Fence_State)) {
      throw new Error(`LIVE_GATE_CONTEXT_INVALID:PRUNE_FENCE_STATE:${row.Fence_State}`);
    }
    const keys = parseCanonicalKeySet(row.Exact_K1_Set, `PRUNE_FENCE:${row.Archive_Unit_ID}`);
    for (const value of keys) {
      pruneFencedKeys.add(value);
      if (row.Fence_State === "STARTED") startedPruneKeys.add(value);
    }
    if (row.Blocked_Dependency_Write_Scope) {
      for (const value of parseCanonicalKeySet(row.Blocked_Dependency_Write_Scope, `PRUNE_DEPENDENCY_SCOPE:${row.Archive_Unit_ID}`)) {
        pruneFencedKeys.add(value);
      }
    }
  }

  const routeResource = exactResource(resources, "SYS_ARCHIVE_INDEX_ROUTE_DIRECTORY");
  const [indexMetadataValues, routeValues] = await Promise.all([
    reader.readSheet(routeResource.Exact_File_ID, "Index_Metadata", "A1:I5"),
    reader.readSheet(routeResource.Exact_File_ID, "Shard_Routes", "A1:J100"),
  ]);
  const indexMetadata = one(rowsToObjects(
    indexMetadataValues,
    ["Index_ID","Index_State","Index_Version","Routing_Version","Active_Routing_Fingerprint"],
    "ARCHIVE_LOCATOR_INDEX_METADATA",
  ), "ARCHIVE_LOCATOR_INDEX_METADATA");
  if (indexMetadata.Index_ID !== "ARCHIVE_LOCATOR_INDEX" || indexMetadata.Index_State !== "ACTIVE" ||
      !indexMetadata.Index_Version || !indexMetadata.Routing_Version || !indexMetadata.Active_Routing_Fingerprint) {
    throw new Error("LIVE_GATE_CONTEXT_STALE:ARCHIVE_LOCATOR_INDEX");
  }
  const routeRows = rowsToObjects(
    routeValues,
    ["Route_ID","Logical_Table","Shard_ID","Shard_File_ID","Shard_Tab_Name","Route_State","Routing_Fingerprint"],
    "ARCHIVE_LOCATOR_SHARD_ROUTES",
  );
  const recordRoute = one(routeRows.filter((row) =>
    row.Logical_Table === "Record_Locators" && row.Route_State === "ACTIVE"),
    "RECORD_LOCATORS_ROUTE",
  );
  if (!recordRoute.Shard_File_ID || recordRoute.Shard_Tab_Name !== "Record_Locators" || !recordRoute.Routing_Fingerprint) {
    throw new Error("LIVE_GATE_CONTEXT_INVALID:RECORD_LOCATORS_ROUTE");
  }
  const locatorRows = rowsToObjects(
    await reader.readSheet(recordRoute.Shard_File_ID, recordRoute.Shard_Tab_Name, "A:Q"),
    ["Record_Locator_ID","Dataset_ID","Record_Key_Canonical","Source_Instance_ID","Registry_Contract_Fingerprint_At_Copy","Index_State","Active_Prune_Verified_At"],
    "RECORD_LOCATORS",
  );
  const archivedIdentityKeys = new Set<string>();
  for (const row of locatorRows) {
    if (!["COPY_VERIFIED","ARCHIVED"].includes(row.Index_State)) {
      throw new Error(`LIVE_GATE_CONTEXT_INVALID:RECORD_LOCATOR_STATE:${row.Index_State}`);
    }
    if (row.Index_State === "ARCHIVED") {
      if (!row.Dataset_ID || !row.Record_Key_Canonical || !row.Active_Prune_Verified_At) {
        throw new Error("LIVE_GATE_CONTEXT_INVALID:ARCHIVED_LOCATOR_INCOMPLETE");
      }
      const expectedContract = contractByDataset.get(row.Dataset_ID);
      if (expectedContract && row.Registry_Contract_Fingerprint_At_Copy !== expectedContract) {
        throw new Error(`LIVE_GATE_CONTEXT_STALE:ARCHIVED_LOCATOR_CONTRACT:${row.Dataset_ID}`);
      }
      archivedIdentityKeys.add(logicalKey(row.Dataset_ID, row.Record_Key_Canonical));
    }
  }

  const coverageResource = exactResource(resources, "SYS_REGISTRY_COVERAGE_STATE", "Registry_Coverage_State");
  const coverageRows = rowsToObjects(
    await reader.readSheet(coverageResource.Exact_File_ID, "Registry_Coverage_State", "A1:I500"),
    ["Audit_ID","Registry_Snapshot_ID","Scope_Fingerprint","Audit_Result","Verified_At","Evidence_Ref"],
    "REGISTRY_COVERAGE_STATE",
  );
  const evidence = await coverageEvidence(reader, coverageRows, input);
  const businessAuthorityStates = new Map<string, "ACTIVE" | "PENDING">();
  for (const access of input.accesses) {
    if (!access.dynamicInstance) {
      businessAuthorityStates.set(key(access.datasetId, access.instanceId), "ACTIVE");
      continue;
    }
    const registryResource = one(
      resources.filter((row) =>
        row.Dataset_ID === access.datasetId &&
        row.Instance_Projection_Mode === "D1_REGISTERED_PARENT"),
      `DYNAMIC_RESOURCE:${access.datasetId}`,
    );
    businessAuthorityStates.set(
      key(access.datasetId, access.instanceId),
      authorityFromEvidence(evidence, access.instanceId, registryResource),
    );
  }

  return {
    migrationFenceActive,
    pruneFenceIndexAvailable: true,
    pruneFencedKeys,
    startedPruneKeys,
    archivedIdentityKeys,
    physicalContractFingerprints: contractByDataset,
    businessAuthorityStates,
    sourceEvidence: {
      registry: `${input.currentRegistryFileId}:${input.currentRegistrySnapshotId}:${input.currentRegistryFingerprint}`,
      migration: `${migrationResource.Exact_File_ID}:MIGRATION_WRITE_FENCE:${input.currentCutoverId}`,
      prune: `${pruneResource.Exact_File_ID}:Archive_Prune_Fence_Index`,
      locator: `${routeResource.Exact_File_ID}:${indexMetadata.Routing_Version}:${recordRoute.Shard_File_ID}`,
      coverage: `${coverageResource.Exact_File_ID}:Registry_Coverage_State`,
      acceptance: `${acceptanceResource.Exact_File_ID}:${input.currentAcceptanceBindingId}`,
    },
  };
}
