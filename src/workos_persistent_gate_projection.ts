export const PINNED_GATE_LOCATOR =
  "https://github.com/lennyliu01/data-archive-runtime/blob/3b3158b78eaf6e93bf915f6d49fb0964390c90bb/src/data_archive_runtime/gate.py";
export const PINNED_GATE_CONFIG_FINGERPRINT =
  "ba3bb9599a034a764c9bdfd10a3dca79436fbae80960ace6a64e2786035909f8";

export type PersistenceOperation = "READ" | "WRITE";

export interface ManifestAccessRow {
  datasetId: string;
  instanceId: string;
  readers: ReadonlySet<string>;
  writers: ReadonlySet<string>;
  writeMode: "APPEND_ONLY" | "CURRENT_STATE" | "GOVERNED_CURRENT";
}

export interface GateProjectionSnapshot {
  gateLocator: string;
  gateConfigFingerprint: string;
  taskId: string;
  registrySnapshotId: string;
  manifestSetId: string;
  manifestState: "ACTIVE" | string;
  accesses: readonly ManifestAccessRow[];
}

export interface PersistenceAuthorizationRequest {
  taskId: string;
  callerIdentity: string;
  datasetId: string;
  instanceId: string;
  operation: PersistenceOperation;
}

export function assertGateProjectionPin(snapshot: GateProjectionSnapshot): void {
  if (snapshot.gateLocator !== PINNED_GATE_LOCATOR) throw new Error("GATE_LOCATOR_DRIFT");
  if (snapshot.gateConfigFingerprint !== PINNED_GATE_CONFIG_FINGERPRINT) {
    throw new Error("GATE_CONFIG_FINGERPRINT_DRIFT");
  }
  if (snapshot.manifestState !== "ACTIVE") throw new Error("MANIFEST_NOT_ACTIVE");
}

export function authorizePersistence(
  snapshot: GateProjectionSnapshot,
  request: PersistenceAuthorizationRequest,
): ManifestAccessRow {
  assertGateProjectionPin(snapshot);
  if (snapshot.taskId !== request.taskId) throw new Error("TASK_AUTHORITY_MISMATCH");
  const match = snapshot.accesses.find(
    (row) => row.datasetId === request.datasetId && row.instanceId === request.instanceId,
  );
  if (!match) throw new Error("DATASET_INSTANCE_NOT_REGISTERED");
  const allowed = request.operation === "READ"
    ? match.readers.has(request.callerIdentity)
    : match.writers.has(request.callerIdentity);
  if (!allowed) throw new Error(`${request.operation}_NOT_AUTHORIZED`);
  return match;
}
