import { GoogleExactControlPlaneReader, loadControlPlane, type LoadedControlPlane } from "./workos_control_plane_loader.js";
import { authorizePersistence } from "./workos_persistent_gate_projection.js";
import { invokePersistence, type PersistenceReadRequest, type PersistenceWriteRequest } from "./runtime_invocation_client.js";
import { projectRWInitialBaselineWire, validateRWInitialBaselineWire } from "./rw_current_state_wire.js";
export { projectRWInitialBaselineWire } from "./rw_current_state_wire.js";


/**
 * A narrowly scoped INITIAL_BASELINE candidate. Not a workflow-dispatch or
 * production-publication entry. Accepted grants must originate in the live,
 * published control plane; absent grants fail closed before any D1 invocation.
 */
export async function initializeBaselineWithReadback(
  cp: LoadedControlPlane, instanceId: string, payload: Record<string, unknown>,
  runtimeSecret: string, fetchImpl: typeof fetch = fetch,
): Promise<{ write: Record<string,unknown>; readback: Record<string,unknown> }> {
  if (cp.task.taskId !== "ROLLING_WEDGE_INVESTMENT" ||
      cp.projectionDrift || !runtimeSecret) throw new Error("BOOTSTRAP_AUTHORITY_UNAVAILABLE");
  if (!validateRWInitialBaselineWire(payload, instanceId))
    throw new Error("BOOTSTRAP_EIGHT_FIELD_WIRE_INVALID");
  const snapshot = cp.gate;
  const entries = snapshot.accesses.filter(a =>
    a.datasetId === "RW_CURRENT_STATE" && a.instanceId === instanceId);
  if (entries.length !== 1) throw new Error("BOOTSTRAP_INSTANCE_NOT_REGISTERED");
  const entry = entries[0];
  const grant = snapshot.bootstrapGrants?.get(`RW_CURRENT_STATE\u0000${instanceId}`);
  if (!grant || grant.state !== "ACTIVE" || !snapshot.manifestFingerprint ||
      snapshot.manifestFingerprint !== grant.manifestFingerprint ||
      payload.Company_ID !== instanceId ||
      Object.keys(payload).length !== grant.fields.size ||
      !Object.keys(payload).every(x => grant.fields.has(x)))
    throw new Error("BOOTSTRAP_GRANT_OR_FIELDS_MISMATCH");
  const fields = new Set(Object.keys(payload));
  const common = {
    taskId: snapshot.taskId, callerIdentity: "Rolling_Wedge_Workflow",
    manifestId: snapshot.manifestId, datasetId: "RW_CURRENT_STATE",
    instanceId, logicalMember: entry.logicalMember,
    idempotencyKey: grant.idempotencyKey,
  };
  authorizePersistence(snapshot,{
    ...common, operation: "WRITE", writeOperation: "INITIAL_BASELINE",
    expectedVersion: 0, fields,
  });
  const w: PersistenceWriteRequest = {
    execution_surface: "WORK", trigger_mode: "HUMAN",
    task_id: snapshot.taskId, caller_identity: "Rolling_Wedge_Workflow", operation: "WRITE",
    dataset_id: "RW_CURRENT_STATE", instance_id: instanceId,
    expected_version: 0, idempotency_key: grant.idempotencyKey,
    authority_epoch: snapshot.expectedActivationEpoch,
    manifest_fingerprint: snapshot.manifestFingerprint,
    write_operation: "INITIAL_BASELINE", fields: [...fields], payload,
  };
  const wr = (await invokePersistence(w, runtimeSecret, fetchImpl)).response;
  if (wr.status !== "SUCCESS" || wr.version !== 1 || wr.previous_version !== 0 ||
      wr.idempotency_key !== grant.idempotencyKey)
    throw new Error("BOOTSTRAP_WRITE_NOT_CONFIRMED");
  authorizePersistence(snapshot,{
    ...common, operation: "READ", readPurpose: "INITIAL_BASELINE_READBACK",
    expectedVersion: 1,
  });
  const r: PersistenceReadRequest = {
    execution_surface: "WORK", trigger_mode: "HUMAN",
    task_id: snapshot.taskId, caller_identity: "Rolling_Wedge_Workflow",
    operation: "READ", dataset_id: "RW_CURRENT_STATE", instance_id: instanceId,
    selector: {kind:"CURRENT"}, expected_version: 1,
    bootstrap_idempotency_key: grant.idempotencyKey,
    read_purpose: "INITIAL_BASELINE_READBACK",
    authority_epoch: snapshot.expectedActivationEpoch,
    manifest_fingerprint: snapshot.manifestFingerprint,
  };
  const rb = (await invokePersistence(r, runtimeSecret, fetchImpl)).response;
  const stable = (v: unknown): string => JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a],[b]) => a.localeCompare(b))) : val);
  if (rb.status !== "SUCCESS" || rb.version !== 1 ||
      rb.previous_version !== 0 || stable(rb.payload) !== stable(payload) ||
      rb.instance_id !== instanceId)
    throw new Error("BOOTSTRAP_READBACK_NOT_CONFIRMED");
  return {write: wr, readback: rb};
}

/** Manual owner path, intentionally not reachable by schedule or READ_ONLY dispatch. */
export async function runRegisteredInitialBaseline(
  oauthToken: string, runtimeSecret: string, instanceId: string,
  payload: Record<string, unknown>, fetchImpl: typeof fetch = fetch,
) {
  const cp = await loadControlPlane(
    new GoogleExactControlPlaneReader(oauthToken, fetchImpl),
    "ROLLING_WEDGE_INVESTMENT",
  );
  return initializeBaselineWithReadback(cp, instanceId, projectRWInitialBaselineWire(payload), runtimeSecret, fetchImpl);
}
