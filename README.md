# D1 Runtime Prototype

Prototype-only Cloudflare Worker project for testing a shared runtime path before any WorkOS integration.

## Verified baseline

- GitHub is the source-code authority.
- Cloudflare Worker deployment is established.
- D1 database `d1-runtime-prototype-db` is bound as `DB`.
- `GET /` is the Worker health endpoint.
- `GET /d1-check` verifies Worker -> D1 connectivity.
- The GitHub Plugin + GitHub Actions transport has separately passed qualification for CHAT/WORK x HUMAN/SCHEDULE.

## Prototype 0 persistence core

The repository now contains the direct runtime implementation for:

```text
POST /prototype/time-roundtrip
```

The endpoint:

1. requires `Authorization: Bearer <RUNTIME_SECRET>`;
2. validates a bounded request envelope;
3. generates the authoritative `Invocation_ID`;
4. inserts exactly one D1 row with a D1-generated `DB_Written_At`;
5. reads the exact row back by `Invocation_ID` and obtains a D1-generated `DB_Read_At`;
6. verifies invocation identity fields; and
7. returns terminal `Status = SUCCESS` only after exact readback succeeds.

The stored row uses `status = RECORDED` to mean the single INSERT completed. Terminal `SUCCESS` is a runtime result and is deliberately not written back as a second D1 mutation.

## Remote setup required for direct acceptance

Apply the migration:

```bash
npx wrangler d1 migrations apply d1-runtime-prototype-db --remote
```

Set the Worker secret privately; do not commit or paste it into prompts:

```bash
npx wrangler secret put RUNTIME_SECRET
```

Then deploy the Worker through the existing deployment path.

## Example direct request

```bash
curl -sS https://d1-runtime-prototype.lennyliu01.workers.dev/prototype/time-roundtrip \
  -H "Authorization: Bearer $RUNTIME_SECRET" \
  -H "Content-Type: application/json" \
  --data '{
    "execution_surface": "CHAT",
    "trigger_mode": "HUMAN",
    "operation": "TIME_ROUNDTRIP",
    "source_run_key": "direct-acceptance"
  }'
```

## Authority boundary

- GitHub: source code and migration authority.
- Cloudflare Worker: runtime execution.
- D1: persistent data authority for Prototype 0.
- GitHub transport: invocation transport only; it must not implement D1 persistence logic.

Prototype 0 remains isolated from WorkOS production authority.

## Prototype 1 state compare-and-set core

Prototype 1 adds an authoritative append-only state transition path:

```text
POST /prototype/state-cas
```

The operation is `STATE_COMPARE_AND_SET`. Each accepted mutation appends exactly one new state version to `prototype_state_versions`; stale expectations append nothing.

Request invariants:

- `state_key` identifies an independent state stream.
- `expected_version = 0` requires `expected_state = null` and initializes a previously absent state stream at version 1.
- Existing-state transitions require both the exact `expected_version` and exact `expected_state`.
- A mismatch returns HTTP 409 / `STALE_STATE` and does not mutate state.
- `idempotency_key` is unique. Replaying the same accepted mutation returns the original accepted state version with `replayed = true` and does not append another version.
- Reusing an idempotency key for a different mutation returns HTTP 409 / `IDEMPOTENCY_CONFLICT`.
- There is no reset, update, delete, or arbitrary-SQL capability in the runtime API. Acceptance tests use fresh state keys instead of resetting authoritative state.

Prototype 0 `POST /prototype/time-roundtrip` remains available unchanged as the frozen baseline.
