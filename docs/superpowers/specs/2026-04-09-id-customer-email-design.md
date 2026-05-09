# ID and Customer Email Refactor Design

- Date: 2026-04-09
- Scope: Refactor IDs to auto-increment integers, switch reward identity from userId to customerId, and use customer email for Beans account
- Status: Brainstormed and approved

## 1. Goal

Apply a full schema and service refactor to make IDs human-readable integers, align reward identity to BigCommerce customer semantics, and ensure Beans grant/rollback uses customer email as account.

## 2. Confirmed Decisions

1. ID strategy:
- All core table IDs must be auto-increment integers.

2. Reward identity:
- `RewardRecord.userId` is removed.
- `RewardRecord.customerId` is added as `Int`.

3. Customer profile persistence:
- `RewardRecord` must store `customerName` and `customerEmail`.

4. Beans account mapping:
- `grantBeans` and `rollbackBeans` account field must use customer email.

5. Missing email policy:
- If customer email is missing, record is marked `FAILED` with explicit error message.

6. Delivery approach:
- Use one-step clean refactor (no dual-field transition).

## 3. Database Schema Changes

## 3.1 RewardBatch
- `id: Int @id @default(autoincrement())`

## 3.2 RewardRecord
- `id: Int @id @default(autoincrement())`
- `batchId: Int`
- remove `userId`
- add `customerId: Int`
- add `customerName: String?`
- add `customerEmail: String?`
- unique constraint changes from `@@unique([batchId, userId])` to `@@unique([batchId, customerId])`

## 3.3 BeansLedger
- `id: Int @id @default(autoincrement())`
- `customerId: Int` (replace `userId`)
- `rewardRecordId: Int?`

## 3.4 OrderSnapshot
- `id: Int @id @default(autoincrement())`
- `customerId: Int` (replace string type)

## 3.5 Relation updates
- All FK relations that referenced UUID strings are converted to Int.

## 4. Data Access and Service Refactor

## 4.1 BigCommerce module
- Add `getCustomer(customerId: number)` in `BigcommerceService`.
- Endpoint (fixed): `GET https://api.bigcommerce.com/stores/{storeHash}/v2/customers/{customerId}`.
- Return normalized customer payload containing:
  - `customerName`
  - `customerEmail`

## 4.2 Order aggregation path
- Aggregation output identity changes from `userId` to `customerId` (Int).

## 4.3 Reward record creation/update
- During upsert, fetch customer profile from BigCommerce and persist:
  - `customerId`
  - `customerName`
  - `customerEmail`
  - existing amount fields

## 4.4 Grant path
- `processOneRecord` calls `beansService.grantBeans` with `customerEmail`.
- If `customerEmail` is null/empty:
  - set `RewardRecord.status=FAILED`
  - set `lastError='Missing customer email for customerId=<id>'`
  - do not call external Beans API

## 4.5 Rollback path
- `rollbackRecord` calls `beansService.rollbackBeans` with `customerEmail`.
- If missing email, fail explicitly with clear message.

## 4.6 Ledger path
- `BeansLedger` entries persist `customerId` instead of `userId`.
- Existing reward/rollback sign rules remain unchanged.

## 5. Migration Strategy

- Since current runtime DB has been reset recently, use direct migration to new schema.
- Generate and apply a new Prisma migration after schema changes.
- No historical UUID-to-int remapping process is included in this scope.

## 6. Error Handling

- BigCommerce customer fetch errors are surfaced with explicit message and status context.
- Missing customer email is treated as business failure and recorded on the reward record.
- No automatic retry added in BigCommerce client as per prior decision.

## 7. Test Plan

## 7.1 Schema tests
- Assert all core IDs are Int auto-increment.
- Assert `RewardRecord` includes customer fields and new unique constraint.
- Assert `BeansLedger.customerId` exists and `userId` removed.

## 7.2 BigCommerce client tests
- `getCustomer(customerId)` path and headers.
- Customer mapping correctness (`name/email`).
- Error normalization for customer endpoint failures.

## 7.3 Reward service tests
- Upsert uses `customerId` and customer profile fields.
- Missing email causes `FAILED` and blocks Beans grant.
- Rollback path also requires email.

## 7.4 Beans service tests
- Account in grant/rollback payload equals customer email.

## 7.5 Integration tests
- App wiring remains valid after type migration.
- Reward and rollback routes still operate on new schema semantics.

## 7.6 Regression
- `npm run build`
- `npm run test:unit`
- `npm run test:integration`

## 8. Non-Goals

- No partial compatibility layer with old UUID model.
- No historical data conversion tooling.
- No BigCommerce retry/backoff enhancement in this iteration.

## 9. Spec Self-Review

- Placeholder scan: no TODO/TBD placeholders remain.
- Consistency: schema changes, service changes, and test plan are aligned.
- Scope: single refactor project, implementation-ready.
- Ambiguity: missing-email behavior and identity strategy are explicit.
