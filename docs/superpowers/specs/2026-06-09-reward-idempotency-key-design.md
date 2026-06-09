# Reward Idempotency Key Design

## 1. Goal

Update reward issuance idempotency key generation so it no longer depends on `rewardRecord.id`.

The new default format is:

- `reward_` + 12-character random `base62` string

This change applies only to reward issuance keys. Rollback behavior continues to reuse the persisted reward ledger key.

## 2. Confirmed Behavior

### 2.1 Default Key Format

- Prefix is always `reward_`
- Suffix is always 12 characters
- Allowed characters are `0-9`, `A-Z`, and `a-z`
- Example shape only: `reward_A1b2C3d4E5f6`

### 2.2 Normal Processing

For normal reward processing, generate one random key and use it directly.

This applies to:

- scheduled or ordinary reward processing
- any non-retry reward issuance path
- `POST /rewards/batches/:id/retry`

Normal processing does not need to check the ledger first to find an unused key.

### 2.3 Single Record Retry

For `POST /rewards/records/:id/retry` only:

- generate a random key using the same `reward_` + 12-char `base62` format
- check whether that key already exists in the ledger
- if it exists, generate another key and check again
- continue until an unused key is found

This collision-avoidance loop is required only for the single-record retry endpoint.

### 2.4 Batch Retry

`POST /rewards/batches/:id/retry` keeps the default behavior:

- generate one random key
- do not loop on ledger lookups to find an unused key

### 2.5 Rollback

Rollback behavior stays unchanged:

- read the existing persisted reward ledger row
- reuse that stored `idempotencyKey`

## 3. Scope

In scope:

- reward issuance key generation in `RewardService`
- distinguishing single-record retry from other execution paths
- unit tests for key format and retry-specific collision handling

Out of scope:

- changing rollback key rules
- changing ledger schema or unique constraints
- adding batch-retry collision avoidance
- modifying unrelated reward calculation logic

## 4. Design

### 4.1 Service Behavior

`RewardService` should generate reward issuance keys through a dedicated helper instead of interpolating `rewardRecord.id`.

The service should have two behaviors:

- default generation path: create one random `base62(12)` key with the `reward_` prefix
- single-record retry path: create a key, query ledger usage, and retry generation until the key is unused

### 4.2 Retry Detection

The special collision-avoidance behavior must be used only when execution originates from:

- `POST /rewards/records/:id/retry`

Batch retry should not be treated as equivalent to single-record retry even though both eventually process failed records.

Implementation may carry this distinction explicitly through method parameters or another localized control path, but the resulting behavior must remain endpoint-specific.

### 4.3 Data Flow Expectations

For reward issuance:

1. Determine whether this execution came from single-record retry.
2. Generate an idempotency key using the correct strategy for that path.
3. Call beans grant with that key.
4. Persist the same key into the reward ledger on success.

## 5. Testing Requirements

Unit tests should cover:

- generated key matches `^reward_[0-9A-Za-z]{12}$`
- normal processing does not depend on `record.id` for key content
- single-record retry loops when the first generated key already exists
- single-record retry eventually uses the first unused generated key
- batch retry does not add the extra collision-avoidance lookup loop
- rollback continues using the stored ledger key

Tests should avoid asserting specific random values unless randomness is stubbed in the test.

## 6. Risks and Constraints

- Random generation introduces theoretical collisions, but 12-character `base62` keeps collision probability very low.
- Single-record retry explicitly reduces operational collision risk by checking ledger uniqueness before use.
- Batch retry intentionally accepts the default one-shot generation behavior per confirmed requirement.
