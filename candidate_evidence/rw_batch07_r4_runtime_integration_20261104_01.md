# RW Batch07 R4 Runtime Integration — NON-PRODUCTION Evidence

Run ID: RW_BATCH07_R4_RUNTIME_INTEGRATION_20261104_01
Predecessor: RW_BATCH07_R4_GRANT_REPAIR_20261104_01
Repository: https://github.com/lennyliu01/workos-d1-runtime
Frozen PR #389 head: d6b90092ae9832c1c2823e1b843b380dc01fa691 (UNMODIFIED, open/draft, unmerged)
Independent successor branch: candidate/rw-batch07-r4-runtime-integration-20261104-01
Precisely tested candidate commit: b9555162a91b5d6454728ce97b231d655d2d2fcb
CI run: https://github.com/lennyliu01/workos-d1-runtime/actions/runs/41760520619
Job: 126346877322
No merge / deploy / production D1 write / production Authority update / real Grant issue.

## Governance entry: fact-by-fact classification

1. Existing ACTIVE WorkOS persistent Gate / Runtime enforcement semantics (grant lifetime, one-use behavior, version/readback and revocation policy) proposed for a future production switch: CHANGE, primary domain Shared Runtime Infrastructure, exact runtime implementation owner plus affected persistent Dataset/Execution Authority owner decisions as separately owned directional facts. Govern through Repository_Management -> Governance_Core -> Migration CHANGE_SPEC_V1 -> independent PCV -> applicable Human Gate -> atomic publication + operational witness, not via this candidate.
2. Publisher/Control Plane signer validation, exact Grant issuance and singleton Epoch CAS mechanism: governed CHANGE if existing owner continuity holds; issuer authority/owner acceptance and native provider CAS are NOT VERIFIED. Until authoritative owner resolution and legal semantic acceptance, affected facts remain UNKNOWN/BLOCKED. No synthetic signer or SQLite CAS can make the published authority READY.
3. Independent GitHub successor branch, isolated test fixtures, this evidence file and CI harness: NON_GOVERNED_CHANGE, non-authoritative preparation only; no new registered Dataset, writer, service, registry, authority locator or long-lived carrier.
4. Existing three ACTIVE company workflows and existing FX workload remain unchanged: no governed change requested or approved for them; compatibility verified by tests.

## Implemented on successor branch

- src/workos_persistent_gate_projection.ts — blob SHA 7d1565cb05974a40d29e05ad4c2f63c943581e1c. Tight trusted issued/expiry windows at Worker gate for DRAFT INITIAL_BASELINE WRITE only, verified publisher requirement, revoke/disable deny; bounded expired recovery readback is a candidate policy, not owner-accepted semantics.
- src/workos_control_plane_loader.ts — blob SHA f79ed2658f866a1416d7c83394aba94f86184bfd. Exact published-grant projection read A1:P200 and 16-column schema; strict UTC times and explicit publisher proof ref; optional `verifyBootstrapPublisher` interface MUST return true. The live reader has NO verifier adapter, thus real Grant loading fails closed until owner-controlled issuer proof integration.
- src/workos_candidate.ts — blob SHA c87044a81f3dab911970bface52ad61874884aea. INITIAL_BASELINE second WRITE with same idempotency now returns consumed denial instead of replay SUCCESS. Ambiguous DB outcome may be reconciled only by same invocation's persisted receipt. D1 single-statement v0->v1 CAS and unique keys reused. Readback includes idempotency key for exact receipt matching.
- src/workos_initial_baseline_candidate.ts — blob SHA 3912dbc7fd2e9d59b2c8d7742883fe588bea9055. Confirm payload canonical equivalence plus idempotency, instance, version and invocation; expose read-only `recoverBaselineReadbackOnly` without second WRITE.
- tests/rw_batch07_runtime_bootstrap_validation.ts — blob SHA bcd675d3417141e390cbb72bf14aaa9b1262d2dd. Legacy mock suite revised for consumed denial, expiry/revoke and recovery.
- tests/rw_batch07_r4_miniflare_d1_validation.ts — blob SHA 7c33139832786cbd1d0fba787e8d288927904836. Original migration + Miniflare D1 binding + actual Worker handler; synthetic trusted control-plane source only. No remote D1 or live issuer.
- package.json — blob SHA 462a67a89295dbbefcce723b1571cf96478119b0; .github/workflows/rw-batch07-candidate-runtime.yml — blob SHA 9c70b07ed175992b5d2aeb19bbfa7aef74199b48; safe push-only CI on independent branch.
- ORIGINAL migrations/0003_create_workos_candidate_persistence.sql reused unchanged — blob SHA 6e6583a6ee1f9e21d6a77373ebc94f7a0fdbc42b.

## Reproducible CI evidence

CI run 41760520619, job 126346877322 at tested SHA b9555162a91b5d6454728ce97b231d655d2d2fcb:
- `npm install --no-audit --no-fund` PASS
- `npm run typecheck` PASS
- `npx tsx tests/rw_batch07_runtime_bootstrap_validation.ts` PASS; checks=163
- `npm run test:rw-r4-d1` PASS; suite R4_MINIFLARE_ORIGINAL_D1_SCHEMA; checks=56; failed=0
- `npm run test:workos-business-executor` PASS all: workos_control_plane_loader_validation, workos_runtime_client_equivalence_validation, workos_business_executor_validation

D1 suite verifies expiry/revoked/forged publisher denial, stale Epoch/manifest denial, D1 v0->v1 concurrent single-winner CAS, denial to losing invocation and replay, exact v1 payload and invocation/idempotency readback, read-only crash recovery, seven company DRAFT fixture lifecycle, unchanged ENPLAS/SERVICENOW/FIGMA v1->v2 behavior, and unchanged FX append/replay.

Initial CI runs 41760260575 and 41760365166 and 41760438676 failed on local Miniflare compatibility-date and D1 migration exec harness initialization; repair commits 529f1f, 9f1e0fc and b955516 are test-harness changes. Final run above succeeded. Those earlier failures are not called production test failures.

## Residual gaps / stop conditions

- NO accepted R4 Grant expiry/revoke/consume policy or verified issuer/Publisher signer path; live adapter intentionally absent, hence all unproven grants fail closed.
- NO real provider-native singleton Authority Publication Epoch CAS, lost-writer proof or provider-side atomic invocation ownership; a D1 version CAS is NOT an Authority Epoch CAS.
- No real published active Manifest grant test, no production-equivalent Worker deployed isolation, no production D1 testing, no real Grant creation.
- No signed/sealed compound Change Spec, R1/R2/R3/R5 readiness, independent publication-closure PCV, Human Model B approval, activation witness or seven-company live grant issuance.
- This is NOT PROD_READY, NOT a grant-issuing Runtime, and NOT a production-cutover witness.

END: prepare owner review and independent closer only; no merge, deploy, issuer configuration, seven grants or production Authority mutation.
