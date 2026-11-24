from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import FrozenSet, Mapping, Optional


class GateCode(str, Enum):
    ALLOW = "ALLOW"
    MANIFEST_NOT_ACTIVE = "MANIFEST_NOT_ACTIVE"
    MANIFEST_REGISTRY_CONFLICT = "MANIFEST_REGISTRY_CONFLICT"
    AUTHORITY_PUBLICATION_UNAVAILABLE = "AUTHORITY_PUBLICATION_UNAVAILABLE"
    AUTHORITY_PUBLICATION_CONFLICT = "AUTHORITY_PUBLICATION_CONFLICT"
    AUTHORITY_BINDING_MISMATCH = "AUTHORITY_BINDING_MISMATCH"
    AUTHORITY_CUTOVER_NOT_COMMITTED = "AUTHORITY_CUTOVER_NOT_COMMITTED"
    DATASET_NOT_REGISTERED = "DATASET_NOT_REGISTERED"
    INSTANCE_NOT_PROJECTED = "INSTANCE_NOT_PROJECTED"
    BUSINESS_AUTHORITY_NOT_READY = "BUSINESS_AUTHORITY_NOT_READY"
    DRAFT_BOOTSTRAP_SCOPE_DENIED = "DRAFT_BOOTSTRAP_SCOPE_DENIED"
    WRITE_SCOPE_VIOLATION = "WRITE_SCOPE_VIOLATION"
    CONTRACT_DRIFT = "ARCHIVE_CONTRACT_DRIFT"
    MIGRATION_FENCE_ACTIVE = "MIGRATION_WRITE_FENCE_ACTIVE"
    PRUNE_FENCE_CONFLICT = "PRUNE_FENCE_CONFLICT"
    READ_ARCHIVE_PRUNE_IN_PROGRESS = "READ_ARCHIVE_PRUNE_IN_PROGRESS"
    PRUNE_FENCE_UNAVAILABLE = "PRUNE_FENCE_UNAVAILABLE"
    ARCHIVED_IDENTITY_CONFLICT = "ARCHIVED_IDENTITY_CONFLICT"
    UNRESOLVED = "UNRESOLVED"


@dataclass(frozen=True)
class WriterScope:
    writer_id: str
    operations: FrozenSet[str]
    fields: Optional[FrozenSet[str]] = None


@dataclass(frozen=True)
class ManifestEntry:
    dataset_id: str
    task_id: str
    instance_id: str
    exact_file_id: str
    logical_member: str
    write_mode: str
    contract_fingerprint: str
    projection_fingerprint: str
    dynamic_instance: bool = False
    business_authority_state: str = "ACTIVE"
    coverage_evidence_fingerprint: str = ""
    writer_scopes: tuple[WriterScope, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class TaskManifest:
    manifest_id: str
    task_id: str
    state: str
    registry_snapshot_id: str
    registry_fingerprint: str
    entries: tuple[ManifestEntry, ...]


@dataclass(frozen=True)
class GateRequest:
    task_id: str
    writer_id: str
    manifest_id: str
    dataset_id: str
    instance_id: str
    logical_member: str
    operation: str
    fields: FrozenSet[str] = frozenset()
    logical_k1: Optional[str] = None
    # Trusted internal adapter only. This does NOT issue or verify a one-use grant.
    draft_initial_access: Optional[str] = None


@dataclass(frozen=True)
class ReadGateRequest:
    task_id: str
    manifest_id: str
    dataset_id: str
    instance_id: str
    logical_member: str
    logical_k1: Optional[str] = None
    # Trusted adapter binds exact identity and independently verifies readback grant.
    reader_id: Optional[str] = None
    draft_initial_access: Optional[str] = None


@dataclass(frozen=True)
class AuthorityPublication:
    authority_scope_fingerprint: str
    current_committed_cutover_id: str
    current_activation_epoch: str
    registry_snapshot_id: str
    manifest_set_id: str
    gate_config_fingerprint: str
    workflow_set_fingerprint: str


@dataclass(frozen=True)
class GateContext:
    current_registry_snapshot_id: str
    current_registry_fingerprint: str
    physical_contract_fingerprints: Mapping[tuple[str, str, str], str]
    migration_fence_active: bool = False
    prune_fenced_keys: FrozenSet[tuple[str, str]] = frozenset()
    started_prune_keys: FrozenSet[tuple[str, str]] = frozenset()
    prune_fence_index_available: bool = True
    archived_identity_keys: FrozenSet[tuple[str, str]] = frozenset()
    authority_publication_state: str = "UNAVAILABLE"
    authority_publication: Optional[AuthorityPublication] = None
    expected_authority_scope_fingerprint: str = ""
    expected_cutover_id: str = ""
    expected_activation_epoch: str = ""
    expected_manifest_set_id: str = ""
    expected_gate_config_fingerprint: str = ""
    expected_workflow_set_fingerprint: str = ""
    referenced_cutover_state: str = ""


@dataclass(frozen=True)
class GateDecision:
    allowed: bool
    code: GateCode
    detail: str = ""
