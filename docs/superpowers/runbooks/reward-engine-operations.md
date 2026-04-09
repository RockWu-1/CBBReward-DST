# Reward Engine Operations Runbook

## 1. 日常检查（Daily Checks）

- 检查应用日志是否存在 `ExternalApiError`、`FAILED`、`rollback` 关键字。
- 检查当日调度是否执行：确认季度批次（`rewardBatch`）和记录（`rewardRecord`）有新增或状态更新。
- 检查失败重试队列：关注 `rewardRecord.status=FAILED` 且 `nextRetryAt` 已到期的数据量。
- 检查 Beans 真实调用开关：`BEANS_REAL_CALL_ENABLED` 在非生产或演练环境应保持 `false`。

## 2. 重试操作（Retry Operations）

适用场景：外部接口短暂故障（例如 5xx 或超时）导致记录失败，且记录允许重试。

- 先确认失败原因是可重试类型（`retryable=true`）。
- 先处理外部依赖（Beans 服务恢复、网络恢复）后再触发重试。
- 按批次或记录粒度触发重试任务，避免一次性全量重试造成流量尖峰。
- 重试后核对：
  - 记录状态是否从 `FAILED` 变为 `SUCCESS`；
  - `attemptCount` 是否合理递增；
  - 是否写入对应 ledger/idempotency 结果。

## 3. 回滚操作（Rollback Operations）

适用场景：发放错误、账号归属错误、业务确认需要撤销奖励。

- 明确回滚对象（`recordId`/用户/批次）与回滚原因（`rollbackReason`）。
- 先检查是否已回滚（幂等键如 `rollback:<recordId>`）避免重复扣回。
- 执行回滚后核对：
  - `rewardRecord.status` 变为 `ROLLED_BACK`；
  - `rollbackReason`、`rollbackBy`、`rollbackAt` 已落库；
  - 外部 Beans 回滚交易号可追踪。
- 若外部回滚失败且不可重试，记录工单并进入人工补偿流程。

## 4. 补偿批次操作（Compensation / Adjustment Batch）

适用场景：漏发、修正历史数据、人工调整奖励。

- 创建补偿批次时必须使用独立 period（如 `2026-Q2-ADJ-001`），并填写 `parentPeriod`、`triggeredBy`。
- 补偿批次仅包含需要修正的用户记录，避免重复覆盖已成功记录。
- 执行前确认幂等策略：补偿记录需要独立 idempotency key。
- 执行后核对：
  - 批次类型为 `ADJUSTMENT`；
  - 记录状态与 ledger 一致；
  - 抽样比对用户 Beans 余额与预期一致。

## 5. 安全与变更注意事项

- 默认禁止真实外部调用：`BEANS_REAL_CALL_ENABLED=false`。
- 仅允许安全账户演练：`BEANS_SAFE_ACCOUNT` 必须为白名单测试账户。
- 涉及回滚和补偿的操作需保留变更记录（操作者、时间、原因、影响范围）。
- 大批量操作建议分批执行并逐批复核结果。
