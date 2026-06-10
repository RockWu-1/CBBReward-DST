# Quarterly Reward Rerun Endpoint Design

## 1. Goal

Add a manual fallback endpoint for quarterly reward execution.

This endpoint is used when the scheduled quarterly reward job should have run, but did not run because of external issues. An operator can call the endpoint with a target `period` to trigger the missed quarterly reward run manually.

## 2. Endpoint

- Method: `POST`
- Path: `/reward/periods/rerun`

Request body:

- `period: string`
- `authToken: string`

Example:

```json
{
  "period": "2026-Q2",
  "authToken": "silk12345"
}
```

## 3. Authentication Rule

The endpoint uses a simple fixed token check:

- expected token: `silk12345`

If `authToken` does not match exactly, the request must be rejected immediately.

## 4. Period Rule

The endpoint requires an explicit `period` from the caller.

Supported format:

- `YYYY-Q1`
- `YYYY-Q2`
- `YYYY-Q3`
- `YYYY-Q4`

Examples:

- valid: `2026-Q2`
- invalid: `2026Q2`
- invalid: `2026-q2`
- invalid: `26-Q2`

The service must convert the incoming `period` into the quarter `startDate` and `endDate` before calling the existing quarterly reward run flow.

## 5. Reuse of Existing Reward Flow

The new endpoint should not introduce a second quarterly reward execution path.

Instead, it should reuse the existing `RewardService.runQuarterlyReward(...)` flow after validation passes.

This keeps the manual rerun behavior aligned with scheduled execution.

## 6. Batch Status Gate

Before triggering the rerun, the service must query `rewardBatch` by the requested `period`.

### 6.1 Reject Rerun

If the target `period` already exists and its status is one of:

- `PENDING`
- `PROCESSING`
- `COMPLETED`
- `PARTIAL_FAILED`

the rerun must be rejected.

Returned failure meaning:

- create period failed
- the quarter has already run

Preferred user-facing message:

- `创建period失败，季度已经跑过`

### 6.2 Allow Rerun

The rerun is allowed when:

- no `rewardBatch` exists for the target `period`
- or the existing batch status is `PROCESSING`
- or the existing batch status is `FAILED`

Allowed reruns continue through the existing quarterly reward execution flow.

## 7. Service Design

### 7.1 Controller Responsibility

`RewardController` should:

- expose the new endpoint
- accept the request body through a DTO
- forward validated input to `RewardService`

The controller should stay thin and should not contain the rerun business rules.

### 7.2 Service Responsibility

`RewardService` should add a dedicated manual rerun entrypoint, for example:

- `rerunQuarterlyReward(period: string, authToken: string)`

This method should:

1. verify `authToken`
2. validate `period` format
3. compute quarter `startDate` and `endDate`
4. query existing `rewardBatch` for the target `period`
5. reject rerun for `COMPLETED` or `PARTIAL_FAILED`
6. reject rerun for `PENDING`
7. call `runQuarterlyReward(...)` when allowed

## 8. Error Handling

The new endpoint should return explicit failures for the following cases:

- invalid `authToken`
- invalid `period` format
- existing `period` with status `COMPLETED`
- existing `period` with status `PARTIAL_FAILED`
- existing `period` with status `PENDING`
- existing `period` with status `PROCESSING`

Recommended semantics:

- invalid token: unauthorized-style error
- invalid period: bad request-style error
- already-ran quarter: conflict-style or bad request-style error with the exact message `创建period失败，季度已经跑过`

The final implementation can choose the exact Nest exception class, but the user-facing meaning must stay consistent.

## 9. Testing Scope

### 9.1 Controller / Route Tests

Cover:

- `POST /reward/periods/rerun` reaches the controller
- valid request calls the new service method
- invalid body is rejected by DTO validation

### 9.2 Service Unit Tests

Cover:

- rejects wrong `authToken`
- rejects invalid `period`
- rejects rerun when existing batch status is `COMPLETED`
- rejects rerun when existing batch status is `PARTIAL_FAILED`
- rejects rerun when existing batch status is `PENDING`
- rejects rerun when existing batch status is `PROCESSING`
- allows rerun when existing batch does not exist
- allows rerun when existing batch status is `FAILED`
- computes the correct quarter dates for the requested `period`
- delegates allowed execution to `runQuarterlyReward(...)`

## 10. Out of Scope

- replacing the scheduler
- adding a general-purpose auth framework
- changing existing batch retry endpoints
- changing quarterly reward calculation logic
- changing the scheduled cron behavior itself
