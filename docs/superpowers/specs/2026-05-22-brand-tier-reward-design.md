# Brand + Tier Reward Logic Design (CBBReward-DST)

## 1. Goal

在现有季度奖励系统中引入“品牌维度 + 伙伴等级维度”的计算逻辑，并按你确认的方式重构数据模型：

- `CustomerQuarterSnapshot` 存订单净额维度：`totalAmount / bobAmount / csAmount / level / season`
- `RewardRecord` 存奖励维度：`bobReward / csReward / rewardAmount`

同时移除 `OrderSnapshot` 表。

---

## 2. Confirmed Business Rules

### 2.1 不变规则

- 伙伴等级按季度重置（Q1/Q2/Q3/Q4）
- 下一季度第 1 天发放上一季度奖励
- tier 判定基于季度内所有适用品牌净销售总额
- 税费、运费不计入净销售额

### 2.2 品牌映射

- BigCommerce `brand_id=39` -> `BOB`
- BigCommerce `brand_id=40` -> `CS`

### 2.3 奖励计算规则

- 特例：existing customer 且仅购买 BOB，直到 `2027-06-30` 固定 10%（忽略 tier）
- 其他情况：按季度总额先判 tier，再按该 tier 的品牌比例计算：
  - `bobReward = bobAmount * bobRate`
  - `csReward = csAmount * csRate`
  - `rewardAmount = bobReward + csReward`

---

## 3. Data Model Changes

## 3.1 Remove

- `OrderSnapshot` model 删除

## 3.2 Add Model: `CustomerQuarterSnapshot`

字段：

- `id Int @id @default(autoincrement())`
- `customerId Int`
- `customerName String?`
- `customerEmail String?`
- `season String`（如 `2026-Q1`）
- `totalAmount Decimal(18,2)`
- `bobAmount Decimal(18,2)`
- `csAmount Decimal(18,2)`
- `level PartnerTier`
- `isExistingCustomer Boolean`
- `createdAt DateTime @default(now())`
- `updatedAt DateTime @updatedAt`

约束：

- `@@unique([customerId, season])`
- `@@index([season, level])`

## 3.3 Update Model: `RewardRecord`

新增字段：

- `bobReward Decimal(18,2) @default(0)`
- `csReward Decimal(18,2) @default(0)`

保留：

- `rewardAmount` 作为总奖励（`bobReward + csReward`）

## 3.4 New Enum

`PartnerTier`：

- `NONE`
- `COLLECTIVE`
- `TOP_SHELF`
- `CRAFT`
- `STUDIO`
- `ICON`

---

## 4. Quarterly Data Flow

1. 定时任务触发季度批次（已有）
2. 拉取季度订单与行项目（已有入口，计算逻辑重写）
3. 过滤税费/运费后按 customer 聚合：
   - `bobAmount`
   - `csAmount`
   - `totalAmount = bobAmount + csAmount`
4. 根据 `totalAmount` 判定 `PartnerTier`
5. 计算 `bobReward/csReward/rewardAmount`
6. upsert `CustomerQuarterSnapshot(customerId, season)`
7. upsert `RewardRecord(batchId, customerId)` 写入奖励字段
8. 发放阶段沿用现有 `processOneRecord` 与 ledger 幂等

---

## 5. Tier Mapping

按季度总额 `totalAmount`：

- `>= 18750` -> `ICON`（BOB 10%，CS 4%）
- `10000 ~ 18749.99` -> `STUDIO`（BOB 9%，CS 3%）
- `5000 ~ 9999.99` -> `CRAFT`（BOB 8%，CS 2%）
- `2500 ~ 4999.99` -> `TOP_SHELF`（BOB 6%，CS 1%）
- `1500 ~ 2499.99` -> `COLLECTIVE`（BOB 5%，CS N/A=0%）
- `< 1500` -> `NONE`（0%）

---

## 6. Idempotency and Retry

- 快照幂等：`CustomerQuarterSnapshot` 使用 `(customerId, season)` upsert
- 记录幂等：`RewardRecord` 使用 `(batchId, customerId)` upsert
- 发放幂等：保持 `reward_${record.id}`
- 回滚幂等：沿用现有 rollback key 策略（后续按当前代码一致性微调）

---

## 7. Admin Management Page Impact

- 资源替换：
  - 移除 `OrderSnapshot`
  - 增加 `CustomerQuarterSnapshot`
- `RewardRecord` 列表增加展示字段：
  - `bobReward`
  - `csReward`
  - `rewardAmount`
- `CustomerQuarterSnapshot` 列表展示：
  - `customerId / season / totalAmount / bobAmount / csAmount / level`

---

## 8. Migration Strategy

1. Prisma schema 更新（drop `OrderSnapshot` + add `CustomerQuarterSnapshot` + alter `RewardRecord`）
2. 生成 migration
3. `prisma generate`
4. 调整 service 计算逻辑
5. 调整 AdminJS 资源配置
6. 回归测试

---

## 9. Testing Scope

单测：

- tier 判定边界值测试
- 品牌金额聚合测试（39/40）
- 仅 BOB existing customer 10% 特例测试（截止 `2027-06-30`）
- upsert 幂等测试

集成：

- 季度批次一次完整跑通（计算 -> 入库 -> 发放）
- 重跑同季度不重复发放
- Admin 资源可读可检索

---

## 10. Out of Scope

- Beans 客户端 UI 改造不在本轮实现
- 多币种处理不在本轮实现
- 非 39/40 品牌处理暂按 0 金额忽略（后续可加告警）

---

## 11. LOE (for this change set)

- 后端模型 + 逻辑改造：3~5 个工作日
- Admin 管理页字段/资源调整：1~2 个工作日
- 联调与回归：1~2 个工作日

总体：约 5~9 个工作日（取决于 BC 订单字段稳定性与测试数据准备）
