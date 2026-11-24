from __future__ import annotations

from .contracts import GateCode, GateContext, GateDecision, GateRequest, ReadGateRequest, TaskManifest


_COMMITTED_CUTOVER_STATES = {"AUTHORITY_COMMITTED", "ROUTING_RELEASED", "COMPLETE"}

# Only the owner-approved DRAFT version-0 initialization/readback path.
# The Gate is NOT a WorkOS one-use capability issuer. Its caller must be a
# trusted server-side adapter that independently validates/consumes the grant.
_DRAFT_INITIAL_FIELDS = frozenset({
    "Company_ID", "Company_Name", "Ticker", "Exchange", "Currency",
    "State_As_Of", "Base_Source_Materials", "Structured_State_Content",
})


def _draft_write_eligible(manifest: TaskManifest, request: GateRequest, entry: object) -> bool:
    return (
        request.draft_initial_access == "INITIAL_BASELINE_WRITE"
        and getattr(entry, "dynamic_instance", False)
        and getattr(entry, "business_authority_state", None) == "DRAFT"
        and manifest.task_id == "ROLLING_WEDGE_INVESTMENT"
        and request.task_id == "ROLLING_WEDGE_INVESTMENT"
        and request.dataset_id == "RW_CURRENT_STATE"
        and request.writer_id == "Rolling_Wedge_Workflow"
        and request.operation == "CONDITIONAL_CURRENT_STATE"
        and request.fields == _DRAFT_INITIAL_FIELDS
    )


def _draft_read_eligible(manifest: TaskManifest, request: ReadGateRequest, entry: object) -> bool:
    return (
        request.draft_initial_access == "INITIAL_BASELINE_READBACK"
        and getattr(entry, "dynamic_instance", False)
        and getattr(entry, "business_authority_state", None) == "DRAFT"
        and manifest.task_id == "ROLLING_WEDGE_INVESTMENT"
        and request.task_id == "ROLLING_WEDGE_INVESTMENT"
        and request.dataset_id == "RW_CURRENT_STATE"
        and request.reader_id == "Rolling_Wedge_Workflow"
    )


def _validate_authority(context: GateContext) -> GateDecision | None:
    if context.authority_publication_state in {"UNAVAILABLE", "MISSING"}:
        return GateDecision(False, GateCode.AUTHORITY_PUBLICATION_UNAVAILABLE)
    if context.authority_publication_state != "EXACT_ONE":
        return GateDecision(False, GateCode.AUTHORITY_PUBLICATION_CONFLICT, context.authority_publication_state)
    publication = context.authority_publication
    if publication is None:
        return GateDecision(False, GateCode.AUTHORITY_PUBLICATION_CONFLICT, "publication payload missing")

    required = (
        context.expected_authority_scope_fingerprint,
        context.expected_cutover_id,
        context.expected_activation_epoch,
        context.expected_manifest_set_id,
        context.expected_gate_config_fingerprint,
        context.expected_workflow_set_fingerprint,
    )
    if not all(required):
        return GateDecision(False, GateCode.AUTHORITY_BINDING_MISMATCH, "expected authority binding incomplete")

    if (
        publication.authority_scope_fingerprint != context.expected_authority_scope_fingerprint
        or publication.current_committed_cutover_id != context.expected_cutover_id
        or publication.current_activation_epoch != context.expected_activation_epoch
        or publication.registry_snapshot_id != context.current_registry_snapshot_id
        or publication.manifest_set_id != context.expected_manifest_set_id
        or publication.gate_config_fingerprint != context.expected_gate_config_fingerprint
        or publication.workflow_set_fingerprint != context.expected_workflow_set_fingerprint
    ):
        return GateDecision(False, GateCode.AUTHORITY_BINDING_MISMATCH)

    if context.referenced_cutover_state not in _COMMITTED_CUTOVER_STATES:
        return GateDecision(False, GateCode.AUTHORITY_CUTOVER_NOT_COMMITTED, context.referenced_cutover_state)
    return None


def authorize_write(manifest: TaskManifest, request: GateRequest, context: GateContext) -> GateDecision:
    authority = _validate_authority(context)
    if authority is not None:
        return authority
    if manifest.state != "ACTIVE":
        return GateDecision(False, GateCode.MANIFEST_NOT_ACTIVE, manifest.state)
    if manifest.manifest_id != request.manifest_id or manifest.task_id != request.task_id:
        return GateDecision(False, GateCode.MANIFEST_REGISTRY_CONFLICT, "manifest/task mismatch")
    if (
        manifest.registry_snapshot_id != context.current_registry_snapshot_id
        or manifest.registry_fingerprint != context.current_registry_fingerprint
    ):
        return GateDecision(False, GateCode.MANIFEST_REGISTRY_CONFLICT, "registry binding mismatch")
    if context.migration_fence_active:
        return GateDecision(False, GateCode.MIGRATION_FENCE_ACTIVE)

    entry = next(
        (
            e for e in manifest.entries
            if e.dataset_id == request.dataset_id
            and e.instance_id == request.instance_id
            and e.logical_member == request.logical_member
        ),
        None,
    )
    if entry is None:
        return GateDecision(False, GateCode.DATASET_NOT_REGISTERED)

    draft_scope_allowed = _draft_write_eligible(manifest, request, entry)
    if request.draft_initial_access is not None and not draft_scope_allowed:
        return GateDecision(False, GateCode.DRAFT_BOOTSTRAP_SCOPE_DENIED)
    if entry.dynamic_instance and entry.business_authority_state != "ACTIVE" and not draft_scope_allowed:
        return GateDecision(False, GateCode.BUSINESS_AUTHORITY_NOT_READY, entry.business_authority_state)

    scope = next((s for s in entry.writer_scopes if s.writer_id == request.writer_id), None)
    if scope is None or request.operation not in scope.operations:
        return GateDecision(False, GateCode.WRITE_SCOPE_VIOLATION)
    if scope.fields is not None and not request.fields.issubset(scope.fields):
        return GateDecision(False, GateCode.WRITE_SCOPE_VIOLATION, "field scope")

    physical_key = (entry.dataset_id, entry.instance_id, entry.logical_member)
    physical_fp = context.physical_contract_fingerprints.get(physical_key)
    if physical_fp is None:
        return GateDecision(False, GateCode.UNRESOLVED, "physical contract unreadable")
    if physical_fp != entry.contract_fingerprint:
        return GateDecision(False, GateCode.CONTRACT_DRIFT)

    if request.logical_k1 is not None:
        k = (request.dataset_id, request.logical_k1)
        if k in context.prune_fenced_keys:
            return GateDecision(False, GateCode.PRUNE_FENCE_CONFLICT)
        if request.operation.startswith("CREATE") and k in context.archived_identity_keys:
            return GateDecision(False, GateCode.ARCHIVED_IDENTITY_CONFLICT)

    return GateDecision(True, GateCode.ALLOW)


def authorize_read(manifest: TaskManifest, request: ReadGateRequest, context: GateContext) -> GateDecision:
    authority = _validate_authority(context)
    if authority is not None:
        return authority
    if manifest.state != "ACTIVE":
        return GateDecision(False, GateCode.MANIFEST_NOT_ACTIVE, manifest.state)
    if manifest.manifest_id != request.manifest_id or manifest.task_id != request.task_id:
        return GateDecision(False, GateCode.MANIFEST_REGISTRY_CONFLICT, "manifest/task mismatch")
    if (
        manifest.registry_snapshot_id != context.current_registry_snapshot_id
        or manifest.registry_fingerprint != context.current_registry_fingerprint
    ):
        return GateDecision(False, GateCode.MANIFEST_REGISTRY_CONFLICT, "registry binding mismatch")
    if not context.prune_fence_index_available:
        return GateDecision(False, GateCode.PRUNE_FENCE_UNAVAILABLE)

    entry = next(
        (
            e for e in manifest.entries
            if e.dataset_id == request.dataset_id
            and e.instance_id == request.instance_id
            and e.logical_member == request.logical_member
        ),
        None,
    )
    if entry is None:
        return GateDecision(False, GateCode.DATASET_NOT_REGISTERED)
    draft_scope_allowed = _draft_read_eligible(manifest, request, entry)
    if request.draft_initial_access is not None and not draft_scope_allowed:
        return GateDecision(False, GateCode.DRAFT_BOOTSTRAP_SCOPE_DENIED)
    if entry.dynamic_instance and entry.business_authority_state != "ACTIVE" and not draft_scope_allowed:
        return GateDecision(False, GateCode.BUSINESS_AUTHORITY_NOT_READY, entry.business_authority_state)

    physical_key = (entry.dataset_id, entry.instance_id, entry.logical_member)
    physical_fp = context.physical_contract_fingerprints.get(physical_key)
    if physical_fp is None:
        return GateDecision(False, GateCode.UNRESOLVED, "physical contract unreadable")
    if physical_fp != entry.contract_fingerprint:
        return GateDecision(False, GateCode.CONTRACT_DRIFT)

    if request.logical_k1 is not None:
        key = (request.dataset_id, request.logical_k1)
        if key in context.started_prune_keys:
            return GateDecision(False, GateCode.READ_ARCHIVE_PRUNE_IN_PROGRESS)

    return GateDecision(True, GateCode.ALLOW)
