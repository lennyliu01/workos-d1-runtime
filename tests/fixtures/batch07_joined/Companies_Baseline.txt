# Companies_Baseline.md

## Purpose

This file is the company registry and router for:

`TASK_ID: ROLLING_WEDGE_INVESTMENT`

Its job is only to answer:

1. which companies are registered;
2. which companies should be monitored;
3. which `Company_ID` / runtime instance identity is used for ACTIVE Manifest resolution;
4. which activation state and baseline decision defaults apply.

This file does **not** contain the analytical law for MONITOR / REVISER / VALUATOR / DECISION.

Those laws belong only in their authoritative Role Specs.

Each company has exactly one registered `Company_ID`. Production persistent state is not owned or located by this registry; it is resolved through the current singleton-authority-selected ACTIVE Manifest / `Persistent_Data_Gate` binding to the registered `Instance_ID` and logical Rolling Wedge datasets. This registry must not select or provide a direct production storage carrier locator.

Activation governance is separate from analytical state. `Companies_Baseline.md` is the sole authority for `Monitor_Enabled`, `State_Status`, and `Archived`. Persistent company state must not store or override those activation fields. Changing activation is a human / explicitly delegated governance action outside the normal MONITOR → REVISER → VALUATOR → DECISION analytical chain.

---

# Runtime Rule

A company is eligible for scheduled monitoring only when the registry entry in this file has:

- `Monitor_Enabled = TRUE`;
- `State_Status = ACTIVE`;
- `Archived = FALSE`;
- the current ACTIVE Manifest resolves that `Company_ID` to the required registered `Instance_ID` / Rolling Wedge datasets;
- `RW_CURRENT_STATE` is readable and contains a non-draft Research Objective, Wedge, Falsifier, Scenario definitions, and Next Reality Watch block;
- when a prior MONITOR run exists, the latest MONITOR checkpoint in `RW_RUN_LOG` is readable.

If any required element is missing:

**Fail closed for that company.**

Do not reconstruct missing company state from chat history or model memory.

---

# Default Decision Constraints

Unless a company has an explicit company-specific override, use:

- `Holding_Period = 3Y`
- `Max_Permanent_Loss = -50%`
- `Minimum_Expected_Return = 0%`

Current valuation-horizon support is intentionally narrower than the override field:

- `Supported_Holding_Period = 3Y` only.
- A company may retain an explicit `Decision_Override_Holding_Period` field, but the only currently valid runtime value is `3Y`.
- Any resolved value other than `3Y` must fail closed in Workflow with `UNSUPPORTED_HOLDING_PERIOD`; never coerce, ignore, or fall back to 3Y.

Resolution rule:

> **Company Override > Baseline Default**

This file is the unique authority for baseline default values. A company-specific override must be explicit in that company's `RW_CURRENT_STATE`. Missing company-specific values do not block execution when the Baseline Default is available.

At runtime, `Rolling_Wedge_Workflow.md` is the sole resolver of effective constraints and the sole creator of `Constraint_State_ID`. DECISION consumes the resolved packet and must not independently resolve defaults / overrides.

Do not copy the default values into every company merely to repeat them. Store only genuine company-specific overrides at company level.

---

# Registered Companies

## ENPLAS

- Company_ID: `ENPLAS`
- Company: Enplas
- Ticker: `6961`
- Exchange: TSE
- Monitor_Enabled: `TRUE`
- Archived: `FALSE`
- State_Status: `ACTIVE`
- Primary Observation Focus: 光通信新产品放量是否形成可持续分部利润，而不仅是收入增长。
- Runtime Instance_ID: `ENPLAS` (resolved only through the current ACTIVE Manifest)
- Legacy / Historical State Sheet:
  https://docs.google.com/spreadsheets/d/1y1aBXpbq7IjSs0GAl9OWCr-Y8WR4uU9WqlP6Fmo45L4/edit
  Status: historical/read-only only — not production READ, not production WRITE, not fallback, and not authority.
- Monitor Startup:
  bounded `RW_CURRENT_STATE` + latest MONITOR checkpoint in `RW_RUN_LOG` when one exists

---

## SERVICENOW

- Company_ID: `SERVICENOW`
- Company: ServiceNow
- Ticker: `NOW`
- Exchange: NYSE
- Monitor_Enabled: `TRUE`
- Archived: `FALSE`
- State_Status: `ACTIVE`
- Primary Observation Focus: AI是否形成真正新增收费、续约/扩张和更长 Revenue Duration，并在成本/SBC后改善每股经济。
- Runtime Instance_ID: `SERVICENOW` (resolved only through the current ACTIVE Manifest)
- Legacy / Historical State Sheet:
  https://docs.google.com/spreadsheets/d/1kPxJc6Q7vDa7jq57iJO7i_8N5qrRqpxOoAFAUBHlwXY/edit
  Status: historical/read-only only — not production READ, not production WRITE, not fallback, and not authority.
- Monitor Startup:
  bounded `RW_CURRENT_STATE` + latest MONITOR checkpoint in `RW_RUN_LOG` when one exists

---

## FIGMA

- Company_ID: `FIGMA`
- Company: Figma
- Ticker: `FIG`
- Exchange: NYSE
- Monitor_Enabled: `TRUE`
- Archived: `FALSE`
- State_Status: `ACTIVE`
- Primary Observation Focus: AI/Make付费转化与企业扩张能否持续，并改善 Revenue Duration 与 Unit Economics。
- Runtime Instance_ID: `FIGMA` (resolved only through the current ACTIVE Manifest)
- Legacy / Historical State Sheet:
  https://docs.google.com/spreadsheets/d/1nGIH2qsaToj7Uh0P0nLgPfBWgAMHErk_lCjb_3gts84/edit
  Status: historical/read-only only — not production READ, not production WRITE, not fallback, and not authority.
- Monitor Startup:
  bounded `RW_CURRENT_STATE` + latest MONITOR checkpoint in `RW_RUN_LOG` when one exists

---

## DSG

- Company_ID: `DSG`
- Company: The Descartes Systems Group Inc.
- Ticker: `DSG`
- Exchange: TSX
- Monitor_Enabled: `FALSE`
- Archived: `FALSE`
- State_Status: `DRAFT`
- Runtime Instance_ID: `DSG` (CANDIDATE only; not resolved by production ACTIVE Manifest)
- Base_Source_Materials: https://docs.google.com/document/d/1x7_WCTEVL6MHCi6Q0u1SMaroXLx3biTXyduakm62GM4/edit
- Source status: `SOURCE_STATUS: ACCEPTED` (research source only)
- Frozen baseline: `FROZEN_CANDIDATE`; no accepted Belief/Valuation/Decision/REVISER Watch implied
- Monitor Startup: `BLOCKED_PENDING_AUTHORITATIVE_ADMISSION_AND_INITIAL_BASELINE`

---

## DOL

- Company_ID: `DOL`
- Company: Dollarama Inc.
- Ticker: `DOL`
- Exchange: TSX
- Monitor_Enabled: `FALSE`
- Archived: `FALSE`
- State_Status: `DRAFT`
- Runtime Instance_ID: `DOL` (CANDIDATE only; not resolved by production ACTIVE Manifest)
- Base_Source_Materials: https://docs.google.com/document/d/170xNvoohTXeCT7rcIVboigFIhiKcLmxn2KmLqYGAc24/edit
- Source status: `SOURCE_STATUS: ACCEPTED` (research source only)
- Frozen baseline: `FROZEN_CANDIDATE`; no accepted Belief/Valuation/Decision/REVISER Watch implied
- Monitor Startup: `BLOCKED_PENDING_AUTHORITATIVE_ADMISSION_AND_INITIAL_BASELINE`

---

## WSP

- Company_ID: `WSP`
- Company: WSP Global Inc.
- Ticker: `WSP`
- Exchange: TSX
- Monitor_Enabled: `FALSE`
- Archived: `FALSE`
- State_Status: `DRAFT`
- Runtime Instance_ID: `WSP` (CANDIDATE only; not resolved by production ACTIVE Manifest)
- Base_Source_Materials: https://docs.google.com/document/d/1mtEIcqOE9efW_4dc-zP_mG8feXrw1YAFZYtpwAyH49I/edit
- Source status: `SOURCE_STATUS: ACCEPTED` (research source only)
- Frozen baseline: `FROZEN_CANDIDATE`; no accepted Belief/Valuation/Decision/REVISER Watch implied
- Monitor Startup: `BLOCKED_PENDING_AUTHORITATIVE_ADMISSION_AND_INITIAL_BASELINE`

---

## GIBA

- Company_ID: `GIBA`
- Company: CGI Inc.
- Ticker: `GIB.A`
- Exchange: TSX
- Monitor_Enabled: `FALSE`
- Archived: `FALSE`
- State_Status: `DRAFT`
- Runtime Instance_ID: `GIBA` (CANDIDATE only; not resolved by production ACTIVE Manifest)
- Base_Source_Materials: https://docs.google.com/document/d/12P9yYGNtlSp9XPnLjXc1Id4wuaWwJvzSuZ8k4BpS1Wc/edit
- Source status: `SOURCE_STATUS: ACCEPTED` (research source only)
- Frozen baseline: `FROZEN_CANDIDATE`; no accepted Belief/Valuation/Decision/REVISER Watch implied
- Monitor Startup: `BLOCKED_PENDING_AUTHORITATIVE_ADMISSION_AND_INITIAL_BASELINE`

---

## NA

- Company_ID: `NA`
- Company: National Bank of Canada
- Ticker: `NA`
- Exchange: TSX
- Monitor_Enabled: `FALSE`
- Archived: `FALSE`
- State_Status: `DRAFT`
- Runtime Instance_ID: `NA` (CANDIDATE only; not resolved by production ACTIVE Manifest)
- Base_Source_Materials: https://docs.google.com/document/d/1lh6NqyS55lnrSMcvH34COSHlcP4MouqPcfto_2uXXLI/edit
- Source status: `SOURCE_STATUS: ACCEPTED` (research source only)
- Frozen baseline: `FROZEN_CANDIDATE`; no accepted Belief/Valuation/Decision/REVISER Watch implied
- Monitor Startup: `BLOCKED_PENDING_AUTHORITATIVE_ADMISSION_AND_INITIAL_BASELINE`

---

## ENB

- Company_ID: `ENB`
- Company: Enbridge Inc.
- Ticker: `ENB`
- Exchange: TSX
- Monitor_Enabled: `FALSE`
- Archived: `FALSE`
- State_Status: `DRAFT`
- Runtime Instance_ID: `ENB` (CANDIDATE only; not resolved by production ACTIVE Manifest)
- Base_Source_Materials: https://docs.google.com/document/d/1bo71pO4I9DBfPHJv-gZNah4pF3_uz4cFFgV9sD2-K_k/edit
- Source status: `SOURCE_STATUS: ACCEPTED` (research source only)
- Frozen baseline: `FROZEN_CANDIDATE`; no accepted Belief/Valuation/Decision/REVISER Watch implied
- Monitor Startup: `BLOCKED_PENDING_AUTHORITATIVE_ADMISSION_AND_INITIAL_BASELINE`

---

## ATD

- Company_ID: `ATD`
- Company: Alimentation Couche-Tard Inc.
- Ticker: `ATD`
- Exchange: TSX
- Monitor_Enabled: `FALSE`
- Archived: `FALSE`
- State_Status: `DRAFT`
- Runtime Instance_ID: `ATD` (CANDIDATE only; not resolved by production ACTIVE Manifest)
- Base_Source_Materials: https://docs.google.com/document/d/1XP53wSoPYhm5UBgFGx2Vz5Fb-f2JFyR0eAa2rpFFA1c/edit
- Source status: `SOURCE_STATUS: ACCEPTED` (research source only)
- Frozen baseline: `FROZEN_CANDIDATE`; no accepted Belief/Valuation/Decision/REVISER Watch implied
- Monitor Startup: `BLOCKED_PENDING_AUTHORITATIVE_ADMISSION_AND_INITIAL_BASELINE`

---

# Legacy / Historical Company State Template

The former Sheet template is retained only as historical design reference:

`COMPANY_STATE_TEMPLATE`

https://docs.google.com/spreadsheets/d/1MA4l8DNU6PFza7Upzyay1dF2q0gguiLTqXp6qi7cH_U/edit

Status: historical/read-only only. It is not a production state carrier, not a production onboarding mechanism, not a fallback, and not authority.

`Monitor_Enabled`, `State_Status`, and `Archived` live only in this registry. A new company must not be activated until its baseline is complete and its required persistent instance is registered through the current governed Manifest path.

---

# Standard Company Interface

Every active company resolves through the current ACTIVE Manifest to the same logical dataset interface:

1. `RW_CURRENT_STATE`
2. `RW_EVIDENCE_HISTORY`
3. `RW_REVISION_HISTORY`
4. `RW_VALUATION_HISTORY`
5. `RW_RUN_LOG`

Do not create a separate `Decision_History` dataset in the initial implementation.

## RW_CURRENT_STATE ownership

### Human / Design-owned by default

- Identity & Overrides
- optional company-specific Decision Overrides only;
- `Base_Source_Materials` authoritative Drive locator for REVISER / INITIAL_BASELINE;
- Research Objective
- Wedge Definition
- Key Causal Mechanism
- What Must Be Proven
- Falsifiers
- Frozen Scenario Definitions

Ordinary scheduled execution must not silently rewrite these.

Baseline Decision defaults stay in this registry; `RW_CURRENT_STATE` stores only genuine company-specific overrides.

Persistent Rolling Wedge datasets must not store `Monitor_Enabled`, `State_Status`, or `Archived`; those fields are registry-only governance state.

For bootstrap, `Base_Source_Materials` must point to bounded authoritative Drive research. REVISER may initialize Belief only when the resolved source is readable and declares `SOURCE_STATUS: ACCEPTED`. Missing / unreadable / non-accepted source fails closed with `BOOTSTRAP_BLOCKED — BASE_SOURCE_GAP`; chat history or model memory is never a substitute.

### REVISER-owned

- Current Belief State;
- `Belief_State_ID` and Belief status / checkpoint;
- `Next Reality Watch`;
- optional REVISER-owned `Material Capital Commitment State`.

#### Material Capital Commitment State

When a company has a material commitment to track, `RW_CURRENT_STATE` contains a REVISER-owned compact table with columns:

- `Commitment_ID`;
- `Scope_Segment`;
- `Stage`;
- `Committed_Capital`;
- `Reversibility`;
- `Evidence_Maturity`;
- `Last_Evidence_ID`;
- `Next_Transition_Watch`.

Allowed lifecycle stages are `EXPERIMENT / VALIDATION / COMMITMENT / EXPANSION / STOP / OUTCOME / UNKNOWN`.

`NONE` means accepted evidence supports that no material commitment currently requires tracking. `UNKNOWN` means the lifecycle state is unresolved, including a schema migration that intentionally did not backfill historical evidence. `UNKNOWN` must never be treated as zero capital risk.

The commitment table is part of REVISER-owned Belief state. It is not a new Role, Dataset, cache object, or parallel state system. A material accepted change to the capital path requires a new `Belief_State_ID` through ordinary REVISER `UPDATE`.

### VALUATOR-owned

- Current Valuation State;
- `Valuation_State_ID`;
- `Input_Belief_State_ID`;
- Valuation Anchor Price;
- deterministic / effective Price Validity Envelope metadata;
- Value / Payoff / Edge outputs.

### DECISION-owned

- Current Decision State;
- `Decision_State_ID`;
- `Input_Valuation_State_ID`;
- the Workflow-resolved `Constraint_State_ID`;
- a copy of the Workflow-resolved effective constraints for auditability;
- `BUY / WAIT / PASS`, concise rationale, and Decision Boundary.

DECISION stores the resolved constraint snapshot but does not own constraint resolution.

### MONITOR-read startup block

- frozen thesis / falsifiers;
- Frozen Scenario Definitions;
- REVISER-owned `Next Reality Watch`;
- REVISER-owned Material Capital Commitment State / `Next_Transition_Watch` when present;
- latest MONITOR checkpoint in `RW_RUN_LOG`.

MONITOR does not need Valuation or Decision state for Reality trigger detection.

### Workflow cache interface

Workflow routes using explicit state IDs and stored cache metadata only. It does not infer state change from prose.

Minimum dependency links are:

- Valuation records `Input_Belief_State_ID`;
- Workflow resolves effective constraints and creates `Constraint_State_ID`;
- Decision records `Input_Valuation_State_ID`;
- Decision stores the Workflow-resolved `Constraint_State_ID`;
- Valuation stores Anchor / effective Price Validity Envelope metadata.
- Material Capital Commitment State is carried inside the accepted Belief dependency; Workflow does not create a separate commitment cache key.

---

# Add Company Protocol

To add a company:

1. Prepare the company baseline package and bounded `Base_Source_Materials`; do not copy the legacy Sheet template as a production carrier.
2. Fill the required Identity, Research Objective, Wedge, causal mechanism, evidence requirements, falsifiers, Scenario definitions, Next Reality Watch, Decision overrides when genuinely needed, and an explicit Material Capital Commitment baseline classification (`Commitment_ID` or `NONE`; use `RESOLVED_UNATTRIBUTED_GROUP_CAPITAL` when material group investment exists but cannot be attributed to the tracked Wedge). The baseline source may remain blocked while incomplete, but the company must not be activated for normal bootstrap until an accepted source is available.
3. Through the current governed persistent-data / Manifest path, provision and register the company `Instance_ID` for the required Rolling Wedge logical datasets. Then add one registry entry to this file and initialize only here:
   - `State_Status = DRAFT`;
   - `Monitor_Enabled = FALSE`;
   - `Archived = FALSE`.
4. After baseline review, require the registered instance and `RW_CURRENT_STATE` baseline to be readable and complete, then activate only by editing this registry entry:
   - `State_Status = ACTIVE`;
   - `Monitor_Enabled = TRUE`;
   - keep `Archived = FALSE`.

No Harness change should be required merely to add a normal company.

If adding a company requires editing MONITOR / REVISER / VALUATOR / DECISION rules, first determine whether the company exposes a genuine framework defect or only needs company-specific fields in `RW_CURRENT_STATE`.

Prefer company state / registry changes over Harness changes.

---

# Archive Protocol

To stop monitoring without deleting history, change only this registry entry:

- set `Archived = TRUE`;
- set `Monitor_Enabled = FALSE`;
- set `State_Status = ARCHIVED`;
- preserve registered persistent state and histories unchanged; any retained legacy company Sheet remains historical/read-only.

Archived companies must not run in scheduled monitoring.

They may be reactivated by setting `Archived = FALSE`, `State_Status = ACTIVE`, and `Monitor_Enabled = TRUE` in this registry after human review, provided the required ACTIVE Manifest instance remains valid and readable. No persistent carrier or legacy Sheet activation edit is required.

---

# Framework Evolution Rule

Historical company state and run history exist partly to improve the Harnesses.

When repeated execution reveals:

- the same false positive;
- the same false negative;
- recurring ambiguity;
- missing ownership;
- unnecessary context loading;
- a decision inconsistency;

do not silently patch behavior during a run.

Record the failure, then perform a separate Harness design review.

The goal is:

`fast execution + bounded context + human readability + easy company addition + auditable history + controlled framework evolution`.

---

# Deprecated State

`Rolling_Wedge_Investment_State`

is a superseded design artifact from the earlier global-wide-table approach.

Do not use it as authoritative runtime state.

Do not delete it automatically; retain it only for design history until the human chooses to remove it.
