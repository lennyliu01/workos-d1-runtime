export type CapabilityName =
  | "control_plane_read"
  | "workos_read"
  | "workos_write"
  | "web_search"
  | "market_quote"
  | "source_verify"
  | "dispatch_role"
  | "terminal_route";

export type ExecutionContextId =
  | "FX_WORKFLOW"
  | "FX_COLLECTOR"
  | "FX_READER"
  | "RW_WORKFLOW"
  | "RW_MONITOR"
  | "RW_REVISER"
  | "RW_VALUATOR"
  | "RW_DECISION";

const PROFILES: Readonly<Record<ExecutionContextId, ReadonlySet<CapabilityName>>> = {
  FX_WORKFLOW: new Set(["control_plane_read", "workos_read", "dispatch_role", "terminal_route"]),
  FX_COLLECTOR: new Set(["web_search", "workos_read", "workos_write"]),
  FX_READER: new Set(["workos_read", "workos_write"]),
  RW_WORKFLOW: new Set(["control_plane_read", "workos_read", "market_quote", "dispatch_role", "terminal_route"]),
  RW_MONITOR: new Set(["web_search", "workos_read", "workos_write"]),
  RW_REVISER: new Set(["workos_read", "workos_write", "source_verify"]),
  RW_VALUATOR: new Set(["workos_read", "workos_write", "market_quote", "web_search"]),
  RW_DECISION: new Set(["workos_read", "workos_write"]),
};

export function capabilitiesFor(context: ExecutionContextId): ReadonlySet<CapabilityName> {
  return PROFILES[context];
}

export function assertCapability(context: ExecutionContextId, capability: CapabilityName): void {
  if (!PROFILES[context].has(capability)) {
    throw new Error(`CAPABILITY_DENIED:${context}:${capability}`);
  }
}

export function contextForRole(taskId: string, role: string | null): ExecutionContextId {
  if (taskId === "US_JAPAN_FX_POLICY") {
    if (role === null || role === "WORKFLOW") return "FX_WORKFLOW";
    if (role === "COLLECTOR") return "FX_COLLECTOR";
    if (role === "READER") return "FX_READER";
  }
  if (taskId === "ROLLING_WEDGE_INVESTMENT") {
    if (role === null || role === "WORKFLOW") return "RW_WORKFLOW";
    if (role === "MONITOR") return "RW_MONITOR";
    if (role === "REVISER") return "RW_REVISER";
    if (role === "VALUATOR") return "RW_VALUATOR";
    if (role === "DECISION") return "RW_DECISION";
  }
  throw new Error(`UNREGISTERED_EXECUTION_CONTEXT:${taskId}:${role ?? "WORKFLOW"}`);
}
