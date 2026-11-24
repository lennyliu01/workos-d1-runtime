"""Nonproduction R3 pinned-Gate parity. This does NOT issue one-use WorkOS Grants."""
from dataclasses import replace

from data_archive_runtime.contracts import (
    AuthorityPublication, GateCode, GateContext, GateRequest, ReadGateRequest,
    ManifestEntry, TaskManifest, WriterScope,
)
from data_archive_runtime.gate import authorize_write, authorize_read

FIELDS = frozenset({
    "Company_ID", "Company_Name", "Ticker", "Exchange", "Currency",
    "State_As_Of", "Base_Source_Materials", "Structured_State_Content",
})

def manifest(authority="DRAFT", task="ROLLING_WEDGE_INVESTMENT", dataset="RW_CURRENT_STATE"):
    return TaskManifest(
        "M-BATCH07", task, "ACTIVE", "RS-TEST", "RF-TEST",
        (ManifestEntry(
            dataset_id=dataset, task_id=task, instance_id="DSG",
            exact_file_id="D1", logical_member="D1_BOUND_DATASET:RW_CURRENT_STATE;Binding=DB",
            write_mode="CURRENT_STATE", contract_fingerprint="SCHEMA-TEST",
            projection_fingerprint="PROJECTION-TEST", dynamic_instance=True,
            business_authority_state=authority, coverage_evidence_fingerprint="COVERAGE-TEST",
            writer_scopes=(WriterScope("Rolling_Wedge_Workflow",
                frozenset({"CONDITIONAL_CURRENT_STATE"}), FIELDS),),
        ),),
    )

def context(**overrides):
    values = dict(
        current_registry_snapshot_id="RS-TEST",
        current_registry_fingerprint="RF-TEST",
        physical_contract_fingerprints={
            ("RW_CURRENT_STATE","DSG","D1_BOUND_DATASET:RW_CURRENT_STATE;Binding=DB"):"SCHEMA-TEST",
        },
        authority_publication_state="EXACT_ONE",
        authority_publication=AuthorityPublication(
            authority_scope_fingerprint="SCOPE-TEST",
            current_committed_cutover_id="CUT-TEST",
            current_activation_epoch="11",
            registry_snapshot_id="RS-TEST",
            manifest_set_id="MSET-TEST",
            gate_config_fingerprint="GATE-TEST",
            workflow_set_fingerprint="WORKFLOW-TEST",
        ),
        expected_authority_scope_fingerprint="SCOPE-TEST",
        expected_cutover_id="CUT-TEST",
        expected_activation_epoch="11",
        expected_manifest_set_id="MSET-TEST",
        expected_gate_config_fingerprint="GATE-TEST",
        expected_workflow_set_fingerprint="WORKFLOW-TEST",
        referenced_cutover_state="AUTHORITY_COMMITTED",
    )
    values.update(overrides)
    return GateContext(**values)

def write(**overrides):
    values = dict(
        task_id="ROLLING_WEDGE_INVESTMENT", writer_id="Rolling_Wedge_Workflow",
        manifest_id="M-BATCH07", dataset_id="RW_CURRENT_STATE", instance_id="DSG",
        logical_member="D1_BOUND_DATASET:RW_CURRENT_STATE;Binding=DB",
        operation="CONDITIONAL_CURRENT_STATE", fields=FIELDS,
        draft_initial_access="INITIAL_BASELINE_WRITE",
    )
    values.update(overrides)
    return GateRequest(**values)

def read(**overrides):
    values = dict(
        task_id="ROLLING_WEDGE_INVESTMENT", reader_id="Rolling_Wedge_Workflow",
        manifest_id="M-BATCH07", dataset_id="RW_CURRENT_STATE", instance_id="DSG",
        logical_member="D1_BOUND_DATASET:RW_CURRENT_STATE;Binding=DB",
        draft_initial_access="INITIAL_BASELINE_READBACK",
    )
    values.update(overrides)
    return ReadGateRequest(**values)

def test_draft_exact_initial_write_gate_only():
    result = authorize_write(manifest(), write(), context())
    assert result.allowed and result.code == GateCode.ALLOW

def test_draft_exact_current_readback_gate_only():
    result = authorize_read(manifest(), read(), context())
    assert result.allowed and result.code == GateCode.ALLOW

def test_draft_without_internal_scope_keeps_existing_deny():
    result = authorize_write(manifest(), write(draft_initial_access=None), context())
    assert not result.allowed and result.code == GateCode.BUSINESS_AUTHORITY_NOT_READY
    result = authorize_read(manifest(), read(draft_initial_access=None), context())
    assert not result.allowed and result.code == GateCode.BUSINESS_AUTHORITY_NOT_READY

def test_draft_wrong_scope_denied():
    cases = [
        write(instance_id="DOL"), write(writer_id="MONITOR"),
        write(operation="APPEND_ONLY"), write(fields=FIELDS-{"Company_ID"}),
        write(fields=FIELDS|{"Unauthorized"}), write(draft_initial_access="INITIAL_BASELINE_READBACK"),
    ]
    for request in cases:
        result = authorize_write(manifest(), request, context())
        assert not result.allowed, request

def test_draft_wrong_reader_denied():
    for request in [read(reader_id="MONITOR"), read(reader_id=None),
                    read(draft_initial_access="INITIAL_BASELINE_WRITE"),
                    read(instance_id="DOL")]:
        result = authorize_read(manifest(), request, context())
        assert not result.allowed, request

def test_no_draft_scope_on_active_or_archived():
    for state in ["ACTIVE", "ARCHIVED", "DISABLED"]:
        for operation in ["READ", "WRITE"]:
            result = (authorize_read(manifest(state), read(), context())
                      if operation == "READ" else
                      authorize_write(manifest(state), write(), context()))
            assert not result.allowed
            assert result.code == GateCode.DRAFT_BOOTSTRAP_SCOPE_DENIED

def test_existing_active_normal_authorization_unchanged():
    result = authorize_write(manifest("ACTIVE"), write(draft_initial_access=None), context())
    assert result.allowed and result.code == GateCode.ALLOW
    result = authorize_read(manifest("ACTIVE"), read(draft_initial_access=None), context())
    assert result.allowed and result.code == GateCode.ALLOW

def test_stale_authority_denied_even_with_internal_scope():
    stale = context(expected_activation_epoch="12")
    for result in [authorize_write(manifest(), write(), stale),
                   authorize_read(manifest(), read(), stale)]:
        assert not result.allowed and result.code == GateCode.AUTHORITY_BINDING_MISMATCH

def test_production_fence_and_unresolved_physical_deny():
    assert authorize_write(manifest(), write(), context(migration_fence_active=True)).code == GateCode.MIGRATION_FENCE_ACTIVE
    assert authorize_write(manifest(), write(), context(physical_contract_fingerprints={})).code == GateCode.UNRESOLVED
    assert authorize_read(manifest(), read(), context(prune_fence_index_available=False)).code == GateCode.PRUNE_FENCE_UNAVAILABLE

def test_candidate_manifest_never_admitted():
    m = replace(manifest(), state="CANDIDATE")
    for result in [authorize_write(m,write(),context()),authorize_read(m,read(),context())]:
        assert not result.allowed and result.code == GateCode.MANIFEST_NOT_ACTIVE

def test_other_task_not_draft_eligible():
    m=manifest(task="OTHER_TASK")
    result=authorize_write(m,write(task_id="OTHER_TASK"),context())
    assert not result.allowed and result.code == GateCode.DRAFT_BOOTSTRAP_SCOPE_DENIED
