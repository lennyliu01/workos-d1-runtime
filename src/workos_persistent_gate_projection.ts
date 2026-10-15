/** WorkOS-owned candidate Gate. Publication of this implementation requires governed CHANGE.
 * This fingerprint identifies the current singleton-authorized configuration,
 * not a Python code pin or an assertion of production approval. */
export const WORKOS_D1_GATE_IMPLEMENTATION_ID = "WORKOS_D1_PERSISTENT_GATE";
export const WORKOS_D1_GATE_IMPLEMENTATION_VERSION = "1.0.0-candidate";
export const ACCEPTED_GATE_CONFIG_FINGERPRINT =
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

export interface BootstrapGrantProjection {
  taskId: string;
  manifestId: string;
  manifestFingerprint: string;
  authorityEpoch: string;
  datasetId: string;
  instanceId: string;
  logicalMember: string;
  writerId: string;
  readerId: string;
  fields: ReadonlySet<string>;
  idempotencyKey: string;
  state: "ACTIVE" | "DISABLED";
}

export interface GateProjectionSnapshot {
  gateImplementationId: string;
  gateImplementationVersion: string;
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
  manifestFingerprint?: string;
  /** Only populated from a verified, publisher-owned authority control projection. */
  bootstrapGrants?: ReadonlyMap<string, BootstrapGrantProjection>;
  manifestRegistrySnapshotId: string;
  manifestRegistryFingerprint: string;

  migrationFenceActive: boolean;
  /** Trusted loader marks only ACTIVE Registry-verified ACTIVE_ONLY datasets. */
  nonArchiveDatasetIds?: ReadonlySet<string>;
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
  expectedVersion?: number;
  idempotencyKey?: string;
  readPurpose?: string;
}

function logicalKey(datasetId: string, logicalK1: string): string {
  return `${datasetId}\u0000${logicalK1}`;
}

export function assertWorkOsGateImplementation(snapshot: GateProjectionSnapshot): void {
  if (snapshot.gateImplementationId !== WORKOS_D1_GATE_IMPLEMENTATION_ID) {
    throw new Error("GATE_IMPLEMENTATION_ID_DRIFT");
  }
  if (snapshot.gateImplementationVersion !== WORKOS_D1_GATE_IMPLEMENTATION_VERSION) {
    throw new Error("GATE_IMPLEMENTATION_VERSION_DRIFT");
  }
  if (!snapshot.expectedGateConfigFingerprint ||
      snapshot.gateConfigFingerprint !== snapshot.expectedGateConfigFingerprint ||
      snapshot.gateConfigFingerprint !== ACCEPTED_GATE_CONFIG_FINGERPRINT) {
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


function draftGrant(snapshot: GateProjectionSnapshot, entry: ManifestAccessRow): BootstrapGrantProjection | null {
  if (!entry.dynamicInstance || entry.businessAuthorityState !== "DRAFT" ||
      snapshot.taskId !== "ROLLING_WEDGE_INVESTMENT" || entry.datasetId !== "RW_CURRENT_STATE" ||
      !snapshot.manifestFingerprint) return null;
  const grant = snapshot.bootstrapGrants?.get(`${entry.datasetId}\u0000${entry.instanceId}`);
  if (!grant || grant.state !== "ACTIVE" ||
      grant.taskId !== snapshot.taskId || grant.manifestId !== snapshot.manifestId ||
      grant.manifestFingerprint !== snapshot.manifestFingerprint ||
      grant.authorityEpoch !== snapshot.expectedActivationEpoch ||
      grant.datasetId !== entry.datasetId || grant.instanceId !== entry.instanceId ||
      grant.logicalMember !== entry.logicalMember ||
      grant.writerId !== "Rolling_Wedge_Workflow" || grant.readerId !== "Rolling_Wedge_Workflow" ||
      !grant.idempotencyKey || grant.fields.size === 0) return null;
  return grant;
}
function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every(value => b.has(value));
}
function allowDraft(snapshot: GateProjectionSnapshot, entry: ManifestAccessRow, request: PersistenceAuthorizationRequest): boolean {
  const grant = draftGrant(snapshot, entry);
  if (!grant || request.callerIdentity !== "Rolling_Wedge_Workflow" ||
      entry.writeMode !== "CURRENT_STATE" || request.logicalK1) return false;
  if (request.operation === "READ") {
    return request.readPurpose === "INITIAL_BASELINE_READBACK" &&
      request.expectedVersion === 1 && request.idempotencyKey === grant.idempotencyKey;
  }
  return request.writeOperation === "INITIAL_BASELINE" && request.expectedVersion === 0 &&
    request.idempotencyKey === grant.idempotencyKey &&
    sameSet(request.fields ?? new Set(), grant.fields) &&
    entry.writerScopes.some(scope => scope.writerId === grant.writerId &&
      scope.operations.has("CONDITIONAL_CURRENT_STATE") &&
      (scope.fields === null || [...grant.fields].every(field => scope.fields!.has(field))));
}

export function authorizePersistence(
  snapshot: GateProjectionSnapshot,
  request: PersistenceAuthorizationRequest,
): ManifestAccessRow {
  assertWorkOsGateImplementation(snapshot);
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
  if (request.operation === "READ" && !snapshot.pruneFenceIndexAvailable &&
      !snapshot.nonArchiveDatasetIds?.has(request.datasetId)) {
    throw new Error("PRUNE_FENCE_UNAVAILABLE");
  }

  const entry = findAccess(snapshot, request);
  if (entry.dynamicInstance && entry.businessAuthorityState !== "ACTIVE" &&
      !allowDraft(snapshot, entry, request)) {
    throw new Error(`BUSINESS_AUTHORITY_NOT_READY:${entry.businessAuthorityState}`);
  }

  if (entry.physicalContractFingerprint === null) {
    throw new Error("UNRESOLVED:physical contract unreadable");
  }
  if (entry.physicalContractFingerprint !== entry.contractFingerprint) {
    throw new Error("ARCHIVE_CONTRACT_DRIFT");
  }

  if (request.operation === "READ") {
    if (!entry.readers.has(request.callerIdentity)) {
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
  const isBootstrap = entry.dynamicInstance && entry.businessAuthorityState === "DRAFT" && allowDraft(snapshot, entry, request);
  if (!scope || (!isBootstrap && !scope.operations.has(operation))) throw new Error("WRITE_SCOPE_VIOLATION");
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
