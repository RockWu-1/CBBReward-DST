# Brand + Tier Reward Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 按 `2026-05-22-brand-tier-reward-design.md` 落地品牌+等级奖励逻辑，替换旧的统一比例发放，并重构数据模型（移除 `OrderSnapshot`、新增 `CustomerQuarterSnapshot`、扩展 `RewardRecord`）。

**Architecture:** 保持单体 NestJS。计算分两层：  
1) 客户季度净销售聚合（品牌维度）-> 快照入库  
2) tier+品牌比例计算奖励 -> reward record 入库 -> 既有发放流程

**Tech Stack:** NestJS, Prisma/PostgreSQL, AdminJS, Jest

---

## File Structure Map

### New files
- `src/modules/reward/types/partner-tier.type.ts`
- `src/modules/reward/reward-calculator.service.ts`
- `test/unit/modules/reward/reward-calculator.service.spec.ts`
- `test/unit/modules/reward/reward-aggregation.spec.ts`

### Modified files
- `prisma/schema.prisma`
- `src/modules/order/order.service.ts`
- `src/modules/bigcommerce/types/bigcommerce-order.type.ts`
- `src/modules/reward/reward.service.ts`
- `src/modules/admin/admin.config.ts`
- `test/integration/reward/reward-engine.e2e-spec.ts`

### Removed files
- `OrderSnapshot` model（schema 中删除）

---

## Task 1: Prisma 模型迁移（快照表 + RewardRecord 扩展）

**Files:**
- Modify: `prisma/schema.prisma`
- Test: `test/integration/reward/reward-engine.e2e-spec.ts`

- [ ] Step 1: 写失败测试（schema metadata）
  - 断言存在 `CustomerQuarterSnapshot` model
  - 断言 `RewardRecord` 包含 `bobReward/csReward`
  - 断言无 `OrderSnapshot`

- [ ] Step 2: 跑测试确认失败
  - `npm run test:integration -- test/integration/reward/reward-engine.e2e-spec.ts -t "schema metadata"`

- [ ] Step 3: 实现最小 schema 变更
  - 删除 `OrderSnapshot`
  - 新增 `PartnerTier` enum
  - 新增 `CustomerQuarterSnapshot`
  - `RewardRecord` 新增 `bobReward/csReward`（默认 0）

- [ ] Step 4: 生成并验证
  - `npm run prisma:generate`
  - `npm run test:integration -- test/integration/reward/reward-engine.e2e-spec.ts`

---

## Task 2: 提取 tier/比例计算器（纯函数层）

**Files:**
- Create: `src/modules/reward/reward-calculator.service.ts`
- Create: `src/modules/reward/types/partner-tier.type.ts`
- Create: `test/unit/modules/reward/reward-calculator.service.spec.ts`

- [ ] Step 1: 写失败测试（先测边界）
  - tier 边界：1499/1500/2499/2500/4999/5000/9999/10000/18750
  - 仅 BOB existing + 截止日前 => 10%
  - CS 在 `COLLECTIVE` 为 0%

- [ ] Step 2: 跑单测确认失败
  - `npm run test:unit -- test/unit/modules/reward/reward-calculator.service.spec.ts`

- [ ] Step 3: 实现最小计算器
  - `resolveTier(totalAmount)`
  - `resolveRates({tier,isExistingCustomer,bobAmount,csAmount,allocationDate})`
  - `calculateRewards({bobAmount,csAmount,rates})`

- [ ] Step 4: 跑单测确认通过
  - `npm run test:unit -- test/unit/modules/reward/reward-calculator.service.spec.ts`

---

## Task 3: 订单聚合改造（品牌维度）

**Files:**
- Modify: `src/modules/order/order.service.ts`
- Modify: `src/modules/bigcommerce/types/bigcommerce-order.type.ts`
- Create: `test/unit/modules/reward/reward-aggregation.spec.ts`

- [ ] Step 1: 写失败测试
  - brand_id=39 累加到 bobAmount
  - brand_id=40 累加到 csAmount
  - tax/shipping 不计入
  - totalAmount = bob + cs

- [ ] Step 2: 跑测试确认失败
  - `npm run test:unit -- test/unit/modules/reward/reward-aggregation.spec.ts`

- [ ] Step 3: 实现聚合结构
  - 返回 customer 维度聚合对象：`customerId/customerName/customerEmail/totalAmount/bobAmount/csAmount`
  - 忽略非 39/40 品牌金额（可记日志）

- [ ] Step 4: 跑测试确认通过
  - `npm run test:unit -- test/unit/modules/reward/reward-aggregation.spec.ts`

---

## Task 4: RewardService 主流程改造（快照 + 记录）

**Files:**
- Modify: `src/modules/reward/reward.service.ts`
- Modify: `test/unit/modules/reward/reward.service.spec.ts`

- [ ] Step 1: 写失败测试
  - 每客户 upsert `CustomerQuarterSnapshot(customerId, season)`
  - 每客户 upsert `RewardRecord`，写 `bobReward/csReward/rewardAmount`
  - rewardAmount 必须等于 bobReward + csReward

- [ ] Step 2: 跑测试确认失败
  - `npm run test:unit -- test/unit/modules/reward/reward.service.spec.ts`

- [ ] Step 3: 实现逻辑重构
  - 恢复批量 `processPendingRecords`（避免当前只处理首条的临时逻辑）
  - 调用新聚合与计算器
  - 入库快照 + 记录
  - 保持发放幂等键策略不变

- [ ] Step 4: 跑测试确认通过
  - `npm run test:unit -- test/unit/modules/reward/reward.service.spec.ts`

---

## Task 5: Admin 管理页资源调整

**Files:**
- Modify: `src/modules/admin/admin.config.ts`
- Modify: `test/integration/admin/admin-wiring.e2e-spec.ts`

- [ ] Step 1: 写失败测试
  - Admin 资源移除 `OrderSnapshot`
  - 新增 `CustomerQuarterSnapshot`
  - `RewardRecord` 可显示 `bobReward/csReward/rewardAmount`

- [ ] Step 2: 跑测试确认失败
  - `npm run test:integration -- test/integration/admin/admin-wiring.e2e-spec.ts`

- [ ] Step 3: 最小实现
  - 更新 resources 列表
  - 配置列表字段展示（不改你现有权限与动作规则）

- [ ] Step 4: 跑测试确认通过
  - `npm run test:integration -- test/integration/admin/admin-wiring.e2e-spec.ts`

---

## Task 6: 全量回归与发布前检查

**Files:**
- Modify (if needed): `docs/superpowers/runbooks/reward-engine-operations.md`

- [ ] Step 1: 跑全量验证
  - `npm run test:unit`
  - `npm run test:integration`
  - `npm run build`

- [ ] Step 2: 数据迁移演练（本地）
  - `npm run prisma:migrate:dev`
  - `npm run prisma:seed`（保留 admin 账户）

- [ ] Step 3: 检查测试安全约束
  - 确认真实调用只影响 `rock.wu@silksoftware.com`
  - 确认默认 `MOCK_MODE=true`

---

## Risk & Guardrails

- 风险 1：BigCommerce 订单行字段不稳定（brand_id 路径差异）
  - 对策：在 adapter 层集中映射并单测覆盖
- 风险 2：旧逻辑残留（如仅处理第一条记录）
  - 对策：明确回归修复 + 单测断言处理多条
- 风险 3：AdminJS 缓存导致字段不刷新
  - 对策：重启服务并清理 `.adminjs` 缓存

---

## Spec Coverage Check

- `RewardRecord` 奖励维度拆分：Task 1 + Task 4
- `CustomerQuarterSnapshot` 季度快照：Task 1 + Task 4
- 新 tier+品牌比例引擎：Task 2 + Task 4
- 移除 `OrderSnapshot`：Task 1 + Task 5
- Admin 页面同步：Task 5

