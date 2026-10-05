export const PINNED_GATE_LOCATOR =
  "https://github.com/lennyliu01/data-archive-runtime/blob/3b3158b78eaf6e93bf915f6d49fb0964390c90bb/src/data_archive_runtime/gate.py";
export const PINNED_GATE_BLOB = "ad08749e52427f81f66dab89788779eb29bb09c2";
export const PINNED_GATE_CONFIG_FINGERPRINT =
  "ba3bb9599a034a764c9bdfd10a3dca79436fbae80960ace6a64e2786035909f8";

export type PersistenceOperation = "READ" | "WRITE";

export interface AuthorityPublicationProjection {
  authorityScopeFingerprint: string;
  currentCommittedCutoverId: string;
  currentActivationEpoch: string;
  registrySnapshotId: string;
  manifestSetId: string;
  gateConfigFingerprint: string;
  workflowSetFingerprint: string;
}

export interface WriterScopeProjection {
  writerId: string;
  operations: ReadonlySet<string>;
  fields: ReadonlySet<string> | null;
}

export interface ManifestAccessRow {
  datasetId: string;
  instanceId: string;
  logicalMember: string;
  contractFingerprint: string;
  physicalContractFingerprint: string | null;
  readers: ReadonlySet<string>;
  writerScopes: readonly WriterScopeProjection[];
  writeMode: "APPEND_ONLY" | "CURRENT_STATE" | "GOVERNED_CURRENT";
  dynamicInstance: boolean;
  businessAuthorityState: string;
}

export interface GateProjectionSnapshot {
  gateLocator: string;
  gateBlob: string;
  gateConfigFingerprint: string;

  authorityPublicationState: "EXACT_ONE" | "UNAVAILABLE" | "MISSING" | "CONFLICT";
  authorityPublication: AuthorityPublicationProjection | null;
  expectedAuthorityScopeFingerprint: string;
  expectedCutoverId: string;
  expectedActivationEpoch: string;
  expectedManifestSetId: string;
  expectedGateConfigFingerprint: string;
  expectedWorkflowSetFingerprint: string;
  referencedCutoverState: string;

  currentRegistrySnapshotId: string;
  currentRegistryFingerprint: string;

  manifestId: string;
  taskId: string;
  manifestState: string;
  manifestRegistrySnapshotId: string;
  manifestRegistryFingerprint: string;

  migrationFenceActive: boolean;
  pruneFenceIndexAvailable: boolean;
  pruneFencedKeys: ReadonlySet<string>;
  startedPruneKeys: ReadonlySet<string>;
  archivedIdentityKeys: ReadonlySet<string>;

  accesses: readonly ManifestAccessRow[];
}

export interface PersistenceAuthorizationRequest {
  taskId: string;
  callerIdentity: string;
  manifestId: string;
  datasetId: string;
  instanceId: string;
  logicalMember: string;
  operation: PersistenceOperation;
  writeOperation?: string;
  fields?: ReadonlySet<string>;
  logicalK1?: string | null;
}

function logicalKey(datasetId: string, logicalK1: string): string {
  return `${datasetId}\u0000${logicalK1}`;
}

export function assertGateProjectionPin(snapshot: GateProjectionSnapshot): void {
  if (snapshot.gateLocator !== PINNED_GATE_LOCATOR) throw new Error("GATE_LOCATOR_DRIFT");
  if (snapshot.gateBlob !== PINNED_GATE_BLOB) throw new Error("GATE_BLOB_DRIFT");
  if (snapshot.gateConfigFingerprint !== PINNED_GATE_CONFIG_FINGERPRINT) {
    throw new Error("GATE_CONFIG_FINGERPRINT_DRIFT");
  }
}

function assertAuthority(snapshot: GateProjectionSnapshot): void {
  if (snapshot.authorityPublicationState === "UNAVAILABLE" || snapshot.authorityPublicationState === "MISSING") {
    throw new Error("AUTHORITY_PUBLICATION_UNAVAILABLE");
  }
  if (snapshot.authorityPublicationState !== "EXACT_ONE") {
    throw new Error(`AUTHORITY_PUBLICATION_CONFLICT:${snapshot.authorityPublicationState}`);
  }
  const publication = snapshot.authorityPublication;
  if (!publication) throw new Error("AUTHORITY_PUBLICATION_CONFLICT:publication payload missing");

  const required = [
    snapshot.expectedAuthorityScopeFingerprint,
    snapshot.expectedCutoverId,
    snapshot.expectedActivationEpoch,
    snapshot.expectedManifestSetId,
    snapshot.expectedGateConfigFingerprint,
    snapshot.expectedWorkflowSetFingerprint,
  ];
  if (required.some((v) => !v)) throw new Error("AUTHORITY_BINDING_MISMATCH:expected authority binding incomplete");

  if (
    publication.authorityScopeFingerprint !== snapshot.expectedAuthorityScopeFingerprint ||
    publication.currentCommittedCutoverId !== snapshot.expectedCutoverId ||
    publication.currentActivationEpoch !== snapshot.expectedActivationEpoch ||
    publication.registrySnapshotId !== snapshot.currentRegistrySnapshotId ||
    publication.manifestSetId !== snapshot.expectedManifestSetId ||
    publication.gateConfigFingerprint !== snapshot.expectedGateConfigFingerprint ||
    publication.workflowSetFingerprint !== snapshot.expectedWorkflowSetFingerprint
  ) {
    throw new Error("AUTHORITY_BINDING_MISMATCH");
  }

  if (!new Set(["AUTHORITY_COMMITTED", "ROUTING_RELEASED", "COMPLETE"]).has(snapshot.referencedCutoverState)) {
    throw new Error(`AUTHORITY_CUTOVER_NOT_COMMITTED:${snapshot.referencedCutoverState}`);
  }
}

function findAccess(snapshot: GateProjectionSnapshot, request: PersistenceAuthorizationRequest): ManifestAccessRow {
  const matches = snapshot.accesses.filter(
    (row) =>
      row.datasetId === request.datasetId &&
      row.instanceId === request.instanceId &&
      row.logicalMember === request.logicalMember,
  );
  if (matches.length !== 1) throw new Error("DATASET_NOT_REGISTERED");
  return matches[0];
}

export function authorizePersistence(
  snapshot: GateProjectionSnapshot,
  request: PersistenceAuthorizationRequest,
): ManifestAccessRow {
  assertGateProjectionPin(snapshot);
  assertAuthority(snapshot);

  if (snapshot.manifestState !== "ACTIVE") throw new Error(`MANIFEST_NOT_ACTIVE:${snapshot.manifestState}`);
  if (snapshot.manifestId !== request.manifestId || snapshot.taskId !== request.taskId) {
    throw new Error("MANIFEST_REGISTRY_CONFLICT:manifest/task mismatch");
  }
  if (
    snapshot.manifestRegistrySnapshotId !== snapshot.currentRegistrySnapshotId ||
    snapshot.manifestRegistryFingerprint !== snapshot.currentRegistryFingerprint
  ) {
    throw new Error("MANIFEST_REGISTRY_CONFLICT:registry binding mismatch");
  }

  if (request.operation === "WRITE" && snapshot.migrationFenceActive) {
    throw new Error("MIGRATION_WRITE_FENCE_ACTIVE");
  }
  if (request.operation === "READ" && !snapshot.pruneFenceIndexAvailable) {
    throw new Error("PRUNE_FENCE_UNAVAILABLE");
  }

  const entry = findAccess(snapshot, request);
  if (entry.dynamicInstance && entry.businessAuthorityState !== "ACTIVE") {
    throw new Error(`BUSINESS_AUTHORITY_NOT_READY:${entry.businessAuthorityState}`);
  }

  if (entry.physicalContractFingerprint === null) {
    throw new Error("UNRESOLVED:physical contract unreadable");
  }
  if (entry.physicalContractFingerprint !== entry.contractFingerprint) {
    throw new Error("ARCHIVE_CONTRACT_DRIFT");
  }

  if (request.operation === "READ") {
    if (entry.readers.size > 0 && !entry.readers.has(request.callerIdentity)) {
      throw new Error("READ_NOT_AUTHORIZED");
    }
    if (request.logicalK1 && snapshot.startedPruneKeys.has(logicalKey(request.datasetId, request.logicalK1))) {
      throw new Error("READ_ARCHIVE_PRUNE_IN_PROGRESS");
    }
    return entry;
  }

  const operation = request.writeOperation;
  if (!operation) throw new Error("WRITE_SCOPE_VIOLATION:operation missing");
  const scope = entry.writerScopes.find((candidate) => candidate.writerId === request.callerIdentity);
  if (!scope || !scope.operations.has(operation)) throw new Error("WRITE_SCOPE_VIOLATION");
  const fields = request.fields ?? new Set<string>();
  if (scope.fields !== null && [...fields].some((field) => !scope.fields!.has(field))) {
    throw new Error("WRITE_SCOPE_VIOLATION:field scope");
  }

  if (request.logicalK1) {
    const key = logicalKey(request.datasetId, request.logicalK1);
    if (snapshot.pruneFencedKeys.has(key)) throw new Error("PRUNE_FENCE_CONFLICT");
    if (operation.startsWith("CREATE") && snapshot.archivedIdentityKeys.has(key)) {
      throw new Error("ARCHIVED_IDENTITY_CONFLICT");
    }
  }

  return entry;
}
