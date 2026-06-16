# Reward Rerun Simplification Design

Date: 2026-06-11

## Summary

This design removes the incomplete adjustment batch flow and makes rerun the only supported manual recovery path for quarterly rewards.

The reward engine will no longer store or pass `rewardRate` through `RewardBatch` or related flows. Reward amounts must always be derived at runtime from customer tier and new-vs-existing customer logic.

## Goals

- Remove the unused adjustment batch workflow.
- Remove `rewardRate` from `RewardBatch` and all related request or service flows.
- Remove `parentPeriod` and the `ADJUSTMENT` batch type.
- Distinguish scheduled runs from manual reruns using batch source metadata.
- Keep `RewardBatchStatus` focused on processing lifecycle only.
- Make rerun safe by blocking it when reward issuance has already happened.

## Non-Goals

- No support for a separate manual adjustment or backfill batch flow.
- No change to the underlying reward calculation rules beyond removing stored `rewardRate`.
- No attempt to preserve the incomplete adjustment API surface.

## Current Problems

- `RewardBatch.rewardRate` is persisted even though reward calculation is now dynamic.
- `RewardBatch.parentPeriod` and `RewardBatchType.ADJUSTMENT` only support an incomplete adjustment concept.
- The current adjustment flow creates a batch shell but does not generate records or issue rewards.
- Rerun currently reuses the normal run path, but the reuse behavior is not explicit enough about existing records and issued rewards.

## Approved Approach

### Data Model

Replace the current batch type model with a batch source model.

- Remove `RewardBatch.rewardRate`
- Remove `RewardBatch.parentPeriod`
- Remove `RewardBatchType`
- Add `RewardBatchSource`
- Add `RewardBatch.source` with default `SCHEDULED`

Recommended enum:

```prisma
enum RewardBatchSource {
  SCHEDULED
  RERUN
}
```

`RewardBatchStatus` remains unchanged and continues to represent lifecycle only:

- `PENDING`
- `PROCESSING`
- `COMPLETED`
- `PARTIAL_FAILED`
- `FAILED`

The meaning split is:

- `status`: what stage the batch is in
- `source`: how the batch was triggered

### Batch Creation Rules

- Scheduled quarterly processing creates a batch with `source = SCHEDULED`.
- Manual rerun creates a batch with `source = RERUN` if the period has no batch yet.
- Manual rerun reuses an existing batch only when its status is `FAILED`.
- For rerun reuse, the reused batch must be updated to `source = RERUN`.
- `RewardBatch.period` remains unique. Rerun must not create a second batch for the same period.

### Reward Calculation Rules

- `runQuarterlyReward()` must no longer read `REWARD_RATE`.
- No service, DTO, schema field, or batch creation flow should accept or store `rewardRate`.
- Reward values must always be computed dynamically from:
  - customer tier
  - new or existing customer status
  - runtime order composition inputs already used by `RewardCalculatorService`

### Rerun Workflow

`POST /reward/periods/rerun` remains the only supported manual recovery path.

Validation order:

1. Validate exact `authToken`.
2. Validate `period` format as `YYYY-Q[1-4]`.
3. Reject rerun if the quarter has not ended in the configured scheduler timezone.
4. Load the existing batch by `period`, if any.

Batch gating rules:

- No batch exists: create a new batch with `source = RERUN`.
- Batch exists with `PENDING`, `PROCESSING`, `COMPLETED`, or `PARTIAL_FAILED`: reject rerun.
- Batch exists with `FAILED`: rerun may proceed only if the batch has no already-issued reward ledger records.

### Rerun Safety Rule

Rerun is forbidden when reward issuance has already happened for the failed batch.

Before resetting or reusing a failed batch, the system must check whether any associated `BeansLedger` represents a successful reward issuance for records in that batch. If such a ledger exists, rerun must be rejected without changing batch state or records.

This prevents rerun from:

- resetting records that were already paid out
- recreating records that conflict with existing issuance history
- producing ambiguous or duplicated reward outcomes

### Failed Batch Reuse Flow

When rerun is allowed for an existing `FAILED` batch, the system should treat the batch row as reusable metadata, not as reusable record state.

Recommended sequence:

1. Confirm no successful reward issuance exists for the batch.
2. In a transaction:
   - set `source = RERUN`
   - set `status = PENDING`
   - clear `startedAt`
   - clear `finishedAt`
   - delete existing non-successful `RewardRecord` rows for the batch
3. Re-enter the normal quarterly processing flow.
4. Regenerate `CustomerQuarterSnapshot` values from current source data.
5. Recreate `RewardRecord` rows from current aggregated orders and dynamic reward rules.
6. Process pending reward records through the normal reward issuance path.
7. Update final batch status to `COMPLETED` or `PARTIAL_FAILED`.

The cleanup step is required because rerun may change which customers qualify for rewards. Reusing stale records in place would leave invalid rows behind, especially when a recalculated reward becomes zero.

## API Behavior

### Success Response

The rerun endpoint continues to return a synchronous acceptance response and does not wait for the full batch to finish.

Recommended success response:

```json
{
  "success": true
}
```

An optional message such as `Rerun accepted for period 2026-Q2.` is acceptable, but not required.

### Failure Responses

Use explicit messages that describe why rerun was blocked.

- `401 Unauthorized`
  - `Invalid auth token`
- `400 Bad Request`
  - `Invalid period format. Expected YYYY-Q[1-4].`
- `400 Bad Request`
  - `Cannot rerun period 2026-Q2 before quarter end in timezone America/New_York.`
- `400 Bad Request`
  - `Cannot rerun period 2026-Q2 because batch status is COMPLETED.`
- `409 Conflict`
  - `Cannot rerun period 2026-Q2 because reward beans have already been issued for this batch.`

## Code Changes

### Remove

- `CreateAdjustmentRequestDto`
- `RewardService.createAdjustmentBatch()`
- adjustment-related admin action wiring
- adjustment-related controller entrypoints, including commented-out dead code
- tests that assert `ADJUSTMENT`, `parentPeriod`, or `rewardRate` on `RewardBatch`

### Update

- Prisma schema and migration for new `RewardBatchSource`
- `runQuarterlyReward()` to remove `rewardRate` handling
- `getOrCreateBatch()` to set `source`
- `rerunQuarterlyReward()` to:
  - differentiate allowed and blocked statuses
  - block rerun on already-issued reward ledger data
  - mark reused or newly created rerun batches with `source = RERUN`
  - reset reusable failed batches safely before regeneration

## Migration Strategy

- Drop `rewardRate`
- Drop `parentPeriod`
- Drop `RewardBatchType`
- Add `RewardBatchSource`
- Add `RewardBatch.source` with default `SCHEDULED`
- Backfill existing rows to `source = SCHEDULED`

If any historical `ADJUSTMENT` rows exist, they should be treated as obsolete data created by an incomplete flow. They do not need feature-level compatibility after migration. If the environment contains such rows, verify whether they should be deleted before or during rollout.

## Testing Strategy

### Schema and Integration Tests

- Remove assertions for `rewardRate`
- Remove assertions for `parentPeriod`
- Remove assertions for `ADJUSTMENT`
- Add assertions for `RewardBatchSource`

### Service Tests

Add or update tests for:

- scheduled batch creation defaults `source` to `SCHEDULED`
- rerun-created batch uses `source = RERUN`
- rerun rejects non-`FAILED` batch statuses with status-specific messages
- rerun rejects a `FAILED` batch when any successful reward issuance ledger exists
- rerun allows a `FAILED` batch with no successful issuance ledger
- rerun resets reusable failed batch metadata before reprocessing
- rerun removes stale failed records before regeneration
- rerun does not leave behind old reward records when recalculated reward becomes zero

### Removal Tests

- Delete adjustment controller tests
- Delete adjustment admin action tests
- Delete adjustment service tests

## Risks and Mitigations

- Risk: rerun could overwrite records that already have successful issuance history.
  - Mitigation: block rerun immediately when any successful reward ledger exists for the batch.

- Risk: stale failed records remain after rerun and no longer match recalculated rewards.
  - Mitigation: clear reusable failed batch records before rebuilding records.

- Risk: lifecycle status becomes overloaded with trigger-source meaning.
  - Mitigation: store trigger origin in `source`, not `status`.

## Decision

Adopt rerun as the single manual recovery workflow. Remove adjustment-specific schema and code, stop persisting `rewardRate`, and introduce `RewardBatch.source` to distinguish scheduled execution from rerun execution.
