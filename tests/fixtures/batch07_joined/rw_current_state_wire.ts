/** Candidate wire contract: existing eight RW_CURRENT_STATE Dataset_Fields only.
 * This module is non-authoritative until the Dataset Contract Owner accepts it.
 */
export const RW_CURRENT_STATE_FIELDS = [
  "Company_ID", "Company_Name", "Ticker", "Exchange", "Currency",
  "State_As_Of", "Base_Source_Materials", "Structured_State_Content",
] as const;

export const FROZEN_RESEARCH_FIELDS = [
  "FREEZE_IDENTITY_AND_RESEARCH_CUTOFF", "RESEARCH_OBJECTIVE",
  "WEDGE_DEFINITION", "KEY_CAUSAL_MECHANISMS", "WHAT_MUST_BE_PROVEN",
  "FALSIFIERS", "BEAR_BASE_WEDGE_WORKS_FROZEN_SCENARIO_DEFINITIONS",
] as const;

export const FROZEN_SOURCE_FIELDS = [
  "Base_Source_Source_Status", "Frozen_Baseline_Candidate",
  "Frozen_Baseline_Status", "Predecessor_Run_ID",
  "Model2_Research_Version", "Company_Specific_Decision_Overrides",
] as const;

export const RESEARCH_INPUT_FIELDS = [
  "Company_ID", "Instance_ID", "Security_Ticker", "Exchange", "Identity",
  "Base_Source_Materials", ...FROZEN_SOURCE_FIELDS,
  "Belief_State_ID", "Scenario_Probabilities", "Confidence",
  "Valuation_State_ID", "Decision_State_ID",
  "Next_Reality_Watch_Accepted", "Material_Capital_Commitment_Accepted",
  "Production_D1_Initialized", ...FROZEN_RESEARCH_FIELDS,
  "MATERIAL_CAPITAL_COMMITMENT_CANDIDATE__REVISER_OWNED",
  "NEXT_REALITY_WATCH_CANDIDATE__REVISER_OWNED",
] as const;

const schema = "RW_INITIAL_FROZEN_RESEARCH_V1";
const sameKeys = (value: Record<string,unknown>, allowed: readonly string[]): boolean =>
  Object.keys(value).length === allowed.length &&
  Object.keys(value).every(k => allowed.includes(k));
const plain = (v: unknown): v is Record<string,unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const nonblank = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;
const nullable = (v: unknown): boolean => v === null || typeof v === "string";

/** Same lexicographic canonical object-key ordering on every projection. */
export function canonicalRWJson(v: unknown): string {
  const norm = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(norm);
    if (plain(x)) return Object.fromEntries(
      Object.keys(x).sort().map(k => [k, norm(x[k])]),
    );
    return x;
  };
  return JSON.stringify(norm(v));
}

/** Do not accept schema-shaped content unless frozen research has full fidelity. */
export function validateRWInitialBaselineWire(
  input: unknown, instanceId: string,
): input is Record<string,unknown> {
  if (!plain(input) || !sameKeys(input, RW_CURRENT_STATE_FIELDS) ||
      !nonblank(input.Company_ID) || input.Company_ID !== instanceId ||
      !nonblank(input.Company_Name) || !nonblank(input.Ticker) ||
      !nonblank(input.Exchange) || !nonblank(input.Base_Source_Materials) ||
      !nullable(input.Currency) || !nullable(input.State_As_Of) ||
      !nonblank(input.Structured_State_Content)) return false;
  // No dates/currency invented. A non-null value requires a later Owner decision.
  if (input.Currency !== null || input.State_As_Of !== null) return false;
  let data: unknown;
  try {
    data = JSON.parse(input.Structured_State_Content as string);
  } catch { return false; }
  if (!plain(data) || !sameKeys(data, ["schema","source","research"]) ||
      data.schema !== schema || !plain(data.source) || !plain(data.research) ||
      !sameKeys(data.source, FROZEN_SOURCE_FIELDS) ||
      !sameKeys(data.research, FROZEN_RESEARCH_FIELDS) ||
      !FROZEN_SOURCE_FIELDS.every(k => nonblank((data.source as Record<string,unknown>)[k])) ||
      !FROZEN_RESEARCH_FIELDS.every(k => nonblank((data.research as Record<string,unknown>)[k]))) return false;
  if (!(data.source.Base_Source_Source_Status as string).startsWith("SOURCE_STATUS: ACCEPTED") ||
      !(data.source.Frozen_Baseline_Status as string).startsWith("FROZEN_CANDIDATE") ||
      canonicalRWJson(data) !== input.Structured_State_Content) return false;
  return true;
}

export function projectRWInitialBaselineWire(
  research: Record<string,unknown>,
): Record<string,unknown> {
  if (!plain(research) || !sameKeys(research, RESEARCH_INPUT_FIELDS))
    throw new Error("RESEARCH_PAYLOAD_SCHEMA_MISMATCH");
  if (!nonblank(research.Company_ID) || research.Company_ID !== research.Instance_ID ||
      !nonblank(research.Identity) || !nonblank(research.Security_Ticker) ||
      !nonblank(research.Exchange) || !nonblank(research.Base_Source_Materials) ||
      research.Belief_State_ID !== null ||
      research.Scenario_Probabilities !== null ||
      research.Confidence !== null ||
      research.Valuation_State_ID !== null ||
      research.Decision_State_ID !== null ||
      research.Next_Reality_Watch_Accepted !== false ||
      research.Material_Capital_Commitment_Accepted !== false ||
      research.Production_D1_Initialized !== false ||
      !FROZEN_SOURCE_FIELDS.every(k => nonblank(research[k])) ||
      !FROZEN_RESEARCH_FIELDS.every(k => nonblank(research[k])) ||
      !nonblank(research.MATERIAL_CAPITAL_COMMITMENT_CANDIDATE__REVISER_OWNED) ||
      !nonblank(research.NEXT_REALITY_WATCH_CANDIDATE__REVISER_OWNED))
    throw new Error("RESEARCH_PAYLOAD_OWNERSHIP_NOT_ACCEPTED");

  // REVISER-owned texts remain in the frozen source document, never in D1
  // (including inside JSON); unaccepted state IDs/flags also remain out of v1.
  const content = {
    schema,
    source: Object.fromEntries(FROZEN_SOURCE_FIELDS.map(k => [k, research[k]])),
    research: Object.fromEntries(FROZEN_RESEARCH_FIELDS.map(k => [k, research[k]])),
  };
  const wire: Record<string,unknown> = {
    Company_ID: research.Company_ID,
    Company_Name: research.Identity,
    Ticker: research.Security_Ticker,
    Exchange: research.Exchange,
    Currency: null,
    State_As_Of: null,
    Base_Source_Materials: research.Base_Source_Materials,
    Structured_State_Content: canonicalRWJson(content),
  };
  if (!validateRWInitialBaselineWire(wire, research.Company_ID as string))
    throw new Error("EIGHT_FIELD_WIRE_INVALID");
  return wire;
}
