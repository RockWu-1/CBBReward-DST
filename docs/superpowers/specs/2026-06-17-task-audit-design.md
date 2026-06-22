# Task Audit Table Design

## Goal

Add a single `Task` audit table to record operational actions performed by the reward system, including scheduled period runs, manual reruns, retry operations, and rollback operations.

The first version is audit-focused rather than workflow-focused. Its job is to answer:

- what operation was triggered
- who or what triggered it
- which reward batch or reward record it targeted
- when it started and finished
- whether it succeeded, failed, or partially failed
- a structured summary of the result

## Scope

This design covers the following operation types:

- scheduled quarterly reward execution
- manual quarterly rerun
- retry failed records for a reward batch
- retry a single reward record
- retry multiple selected reward records
- rollback a single reward record

This design does not introduce:

- a general-purpose async job queue
- step-by-step task event logging
- child task hierarchies
- task retries or task scheduling metadata

## Recommended Model

Use a single `Task` table.

One user-triggered or system-triggered operation creates one `Task` row.

Examples:

- one scheduler execution for `2026-Q1` creates one `Task`
- one AdminJS click on `Retry Record` creates one `Task`
- one AdminJS click on `Retry All` for 30 selected records creates one `Task`
- one AdminJS click on `Rollback` creates one `Task`

Do not create one task row per internal step.
Do not create one task row per record inside a bulk operation.

This keeps the audit trail compact and makes it easy to answer operational questions from one table.

## Why Single-Table Audit Is The Right Fit

The current requirement is operational auditing, not background orchestration.

The system needs a unified history of actions across scheduler, API, and admin-triggered flows. A single table gives:

- one place to query recent failures
- one place to inspect all actions for a given period
- one place to inspect all actions for a given reward record
- a clean backend list page if task browsing is added later

A heavier `Task + TaskEvent` model would better fit process-level logging, but it is unnecessary for the current scope and would add complexity without immediate value.

## Table Semantics

Each task row represents one operation request at the level visible to an operator or system owner.

That means:

- `PERIOD_RUN` represents one period execution
- `PERIOD_RERUN` represents one rerun request
- `BATCH_RETRY` represents one retry operation for one batch
- `RECORD_RETRY` represents one retry operation for one record
- `RECORD_RETRY_BULK` represents one bulk retry request
- `RECORD_ROLLBACK` represents one rollback operation for one record

## Prisma Schema

Add three enums:

```prisma
enum TaskType {
  PERIOD_RUN
  PERIOD_RERUN
  BATCH_RETRY
  RECORD_RETRY
  RECORD_RETRY_BULK
  RECORD_ROLLBACK
}

enum TaskTriggerSource {
  SCHEDULER
  ADMIN
  API
  SYSTEM
}

enum TaskStatus {
  PENDING
  RUNNING
  SUCCESS
  FAILED
  PARTIAL_FAILED
}
```

Add a new model:

```prisma
model Task {
  id             Int               @id @default(autoincrement())
  taskType       TaskType
  triggerSource  TaskTriggerSource
  status         TaskStatus        @default(PENDING)

  title          String
  period         String?
  rewardBatchId  Int?
  rewardRecordId Int?

  targetIds      Json?
  triggeredBy    String?
  requestPayload Json?
  resultPayload  Json?
  errorMessage   String?

  startedAt      DateTime?
  finishedAt     DateTime?
  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt

  rewardBatch    RewardBatch?      @relation(fields: [rewardBatchId], references: [id], onDelete: SetNull)
  rewardRecord   RewardRecord?     @relation(fields: [rewardRecordId], references: [id], onDelete: SetNull)

  @@index([taskType, createdAt])
  @@index([status, createdAt])
  @@index([triggerSource, createdAt])
  @@index([period])
  @@index([rewardBatchId])
  @@index([rewardRecordId])
}
```

Extend existing models:

```prisma
model RewardBatch {
  ...
  tasks Task[]
}

model RewardRecord {
  ...
  tasks Task[]
}
```

## Field Definitions

### `taskType`

Describes the kind of operation.

Use it to group task history by action type.

### `triggerSource`

Describes where the operation came from:

- `SCHEDULER`
- `ADMIN`
- `API`
- `SYSTEM`

### `status`

Tracks lifecycle and overall outcome:

- `PENDING`
- `RUNNING`
- `SUCCESS`
- `FAILED`
- `PARTIAL_FAILED`

`PARTIAL_FAILED` should only be used for multi-target operations such as:

- period runs
- batch retry
- bulk retry

### `title`

Short human-readable description for list views and audit review.

Examples:

- `Scheduled period run for 2026-Q1`
- `Rerun period 2026-Q1`
- `Retry batch 12 failed records`
- `Retry reward record 4615`
- `Bulk retry for 30 reward records`
- `Rollback reward record 4615`

### `period`

Optional period identifier such as `2026-Q1`.

Store it redundantly for period-based queries, even when `rewardBatchId` is also known.

### `rewardBatchId`

Optional foreign key to `RewardBatch`.

Used by:

- `PERIOD_RUN`
- `PERIOD_RERUN`
- `BATCH_RETRY`

Can also be redundantly populated for record-level operations when available.

### `rewardRecordId`

Optional foreign key to `RewardRecord`.

Used by:

- `RECORD_RETRY`
- `RECORD_ROLLBACK`

### `targetIds`

Optional JSON array used for bulk operations.

Example:

```json
[4615, 4616, 4617]
```

Only use this for multi-record operations. Do not use it for single-record actions.

### `triggeredBy`

Optional actor identifier.

Examples:

- `admin@test.com`
- `scheduler`
- `system`

This field standardizes operator identification across all action types.

### `requestPayload`

Optional JSON object storing the most relevant input data, not the full raw request.

Examples:

```json
{ "source": "SCHEDULED" }
```

```json
{ "period": "2026-Q1", "source": "RERUN" }
```

```json
{ "recordIds": [4615, 4616, 4617] }
```

```json
{ "reason": "manual rollback" }
```

### `resultPayload`

Optional JSON object storing structured outcome data.

This is the primary place for aggregated counts and operation-specific result details.

Examples:

```json
{
  "batchId": 12,
  "recordCount": 320,
  "successCount": 300,
  "failedCount": 20
}
```

```json
{
  "requestedCount": 3,
  "successCount": 2,
  "failedCount": 1,
  "failedRecordIds": [4617]
}
```

```json
{
  "finalStatus": "ROLLED_BACK",
  "ledgerUpdated": true
}
```

Do not store very large per-record diagnostic data here in the first version.

### `errorMessage`

Optional human-readable one-line error for quick review in list screens or logs.

Examples:

- `Cannot rerun period 2026-Q2 before quarter end in timezone America/New_York.`
- `Missing customerEmail for reward record 4617`
- `Reward beans have already been issued for this batch.`

### `startedAt` and `finishedAt`

Execution timestamps.

These allow duration to be derived later without storing a separate `durationMs` field in the first version.

## Status Rules

### `PENDING`

Created but not yet executing business work.

### `RUNNING`

Business work has started.

### `SUCCESS`

The operation completed successfully with no failed targets.

### `FAILED`

The operation failed as a whole, or could not be executed meaningfully.

Examples:

- auth token invalid for rerun
- referenced record not found
- rollback external call fails and operation does not complete

### `PARTIAL_FAILED`

Some targets succeeded and some failed.

Use only for multi-target operations.

## Per-Operation Recording Rules

### `PERIOD_RUN`

Trigger:

- scheduler automatic run
- optionally future internal catch-up run

Suggested values:

- `taskType`: `PERIOD_RUN`
- `triggerSource`: `SCHEDULER` or `SYSTEM`
- `period`: target period
- `rewardBatchId`: batch id after batch lookup or create
- `triggeredBy`: `scheduler`
- `requestPayload`: `{ "source": "SCHEDULED" }`

Suggested result payload:

```json
{
  "batchId": 12,
  "recordCount": 320,
  "successCount": 300,
  "failedCount": 20,
  "finalBatchStatus": "PARTIAL_FAILED"
}
```

### `PERIOD_RERUN`

Trigger:

- admin or API rerun request

Suggested values:

- `taskType`: `PERIOD_RERUN`
- `triggerSource`: `ADMIN` or `API`
- `period`: target period
- `rewardBatchId`: existing failed batch or resulting batch
- `triggeredBy`: admin email when applicable
- `requestPayload`: `{ "period": "2026-Q1", "source": "RERUN" }`

Suggested result payload:

```json
{
  "batchId": 12,
  "batchReset": true,
  "deletedNonSuccessRecords": 25,
  "finalBatchStatus": "PENDING"
}
```

### `BATCH_RETRY`

Trigger:

- retry failed records for a specific reward batch

Suggested values:

- `taskType`: `BATCH_RETRY`
- `triggerSource`: `ADMIN` or `SYSTEM`
- `rewardBatchId`: required
- `period`: recommended when available
- `requestPayload`: `{ "batchId": 12 }`

Suggested result payload:

```json
{
  "candidateCount": 18,
  "processedCount": 18,
  "successCount": 10,
  "failedCount": 8
}
```

### `RECORD_RETRY`

Trigger:

- retry one record

Suggested values:

- `taskType`: `RECORD_RETRY`
- `triggerSource`: `ADMIN`, `API`, or `SYSTEM`
- `rewardRecordId`: required
- `rewardBatchId`: recommended when available
- `period`: recommended when available
- `triggeredBy`: actor identifier
- `requestPayload`: `{ "recordId": 4615 }`

Suggested result payload:

```json
{
  "finalStatus": "SUCCESS",
  "attemptCount": 3,
  "idempotencyKey": "reward_xxx"
}
```

### `RECORD_RETRY_BULK`

Trigger:

- admin bulk retry for selected reward records

Suggested values:

- `taskType`: `RECORD_RETRY_BULK`
- `triggerSource`: `ADMIN`
- `targetIds`: selected ids
- `triggeredBy`: admin email
- `requestPayload`: `{ "recordIds": [4615, 4616, 4617] }`

Suggested result payload:

```json
{
  "requestedCount": 3,
  "deduplicatedCount": 3,
  "successCount": 2,
  "failedCount": 1,
  "failedRecordIds": [4617]
}
```

### `RECORD_ROLLBACK`

Trigger:

- rollback one reward record

Suggested values:

- `taskType`: `RECORD_ROLLBACK`
- `triggerSource`: `ADMIN`
- `rewardRecordId`: required
- `rewardBatchId`: recommended when available
- `period`: recommended when available
- `triggeredBy`: admin email
- `requestPayload`: `{ "reason": "manual rollback" }`

Suggested result payload:

```json
{
  "finalStatus": "ROLLED_BACK",
  "ledgerUpdated": true,
  "externalTxnId": "txn-123"
}
```

## Implementation Placement

Add a dedicated `TaskService`.

Do not spread direct `Task` persistence logic across multiple domain services.

Suggested responsibilities:

- create task rows
- mark task as running
- mark task success
- mark task failed
- mark task partial-failed

Suggested methods:

- `createTask(...)`
- `markRunning(taskId)`
- `markSuccess(taskId, resultPayload?)`
- `markFailed(taskId, errorMessage, resultPayload?)`
- `markPartialFailed(taskId, resultPayload?)`

### Creation Points

Create task rows at operation entry points:

- `src/modules/scheduler/quarterly-reward.scheduler.ts`
- `src/modules/reward/reward.controller.ts`
- `src/modules/admin/admin.actions.ts`

These layers know who or what initiated the operation.

### Update Points

Update task status and results in `src/modules/reward/reward.service.ts`.

This layer knows actual execution outcome.

## First Version Coverage

The first version should cover exactly these operations:

- scheduler period run
- manual rerun period
- retry failed records for a batch
- retry a single reward record
- retry multiple selected reward records
- rollback a single reward record

No additional task browsing UI is required for the first version.

## Explicit Non-Goals For Version 1

Do not add in the first version:

- `TaskEvent`
- `TaskItem`
- `parentTaskId`
- task retry scheduling fields
- deduplication keys
- operator IP or user agent tracking
- detailed per-step logs

## Future Evolution Path

This single-table design is intentionally easy to extend later.

If richer auditing is needed, add `TaskEvent` without changing `Task`.

If bulk item-level visibility is needed, add `TaskItem` without changing `Task` semantics.

If task orchestration is needed in the future, add workflow-oriented fields then, instead of prematurely adding them now.

## Final Recommendation

Implement a single `Task` audit table now.

Treat it as an operation-level audit log, not a workflow engine.

Keep the first version focused on:

- clear task type
- clear source
- clear actor
- clear target
- clear status
- clear timestamps
- compact structured result summary

This is sufficient for auditing scheduled runs, reruns, retries, and rollbacks while keeping the schema simple and maintainable.
