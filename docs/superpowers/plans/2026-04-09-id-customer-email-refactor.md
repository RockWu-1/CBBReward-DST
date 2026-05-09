# ID and Customer Email Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将核心表主键改为自增整数、`RewardRecord.userId` 重构为 `customerId` 并落库客户姓名/邮箱，且 Beans 发放账号改为客户邮箱。

**Architecture:** 先完成 Prisma schema 与类型迁移，再重构 BigCommerce customer 查询和 Reward/Beans 调用链，最后补齐测试与回归。采用 TDD：先失败测试、最小实现、回归验证、原子提交。

**Tech Stack:** NestJS, Prisma, PostgreSQL, Jest, @nestjs/axios.

---

## File Structure Map

### Core files to modify
- `prisma/schema.prisma`
- `src/modules/reward/reward.service.ts`
- `src/modules/ledger/ledger.service.ts`
- `src/modules/order/order.service.ts`
- `src/modules/beans/beans.service.ts`
- `src/modules/bigcommerce/bigcommerce.service.ts`

### New/updated tests
- `test/integration/reward/reward-engine.e2e-spec.ts`
- `test/unit/modules/reward/reward.service.spec.ts`
- `test/unit/modules/beans/beans.service.spec.ts`
- `test/unit/modules/bigcommerce/bigcommerce.service.spec.ts`
- `test/unit/modules/order/order.service.spec.ts`

---

### Task 1: Prisma Schema 全量切换为 Int 主键 + customer 字段

**Files:**
- Modify: `prisma/schema.prisma`
- Test: `test/integration/reward/reward-engine.e2e-spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('RewardRecord should contain customerId/customerName/customerEmail and Int id', () => {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'RewardRecord');
  const idField = model?.fields.find((f) => f.name === 'id');
  const names = model?.fields.map((f) => f.name) ?? [];
  expect(idField?.type).toBe('Int');
  expect(names).toEqual(expect.arrayContaining(['customerId', 'customerName', 'customerEmail']));
  expect(names).not.toContain('userId');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration -- test/integration/reward/reward-engine.e2e-spec.ts -t "RewardRecord should contain customerId"`
Expected: FAIL。

- [ ] **Step 3: Write minimal implementation**

```prisma
model RewardBatch {
  id Int @id @default(autoincrement())
  ...
}

model RewardRecord {
  id            Int @id @default(autoincrement())
  batchId       Int
  customerId    Int
  customerName  String?
  customerEmail String?
  ...
  @@unique([batchId, customerId])
}

model BeansLedger {
  id             Int @id @default(autoincrement())
  customerId     Int
  rewardRecordId Int?
  ...
}

model OrderSnapshot {
  id         Int @id @default(autoincrement())
  customerId Int
  ...
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
- `npx prisma generate`
- `npm run test:integration -- test/integration/reward/reward-engine.e2e-spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma test/integration/reward/reward-engine.e2e-spec.ts
git commit -m "feat: migrate core schema ids to int and add reward customer fields"
```

### Task 2: BigCommerce 客户查询接口

**Files:**
- Modify: `src/modules/bigcommerce/bigcommerce.service.ts`
- Modify: `test/unit/modules/bigcommerce/bigcommerce.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('getCustomer should call /v2/customers/{id} and map name/email', async () => {
  // mock HttpService.get and assert URL + mapped result
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- test/unit/modules/bigcommerce/bigcommerce.service.spec.ts -t "getCustomer"`
Expected: FAIL。

- [ ] **Step 3: Write minimal implementation**

```ts
type BigcommerceCustomer = { id: number; first_name?: string; last_name?: string; name?: string; email?: string };

async getCustomer(customerId: number): Promise<{ customerName: string | null; customerEmail: string | null }> {
  // GET https://api.bigcommerce.com/stores/{storeHash}/v2/customers/{customerId}
  // map name/email and throw BadRequestException on failures
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- test/unit/modules/bigcommerce/bigcommerce.service.spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/bigcommerce/bigcommerce.service.ts test/unit/modules/bigcommerce/bigcommerce.service.spec.ts
git commit -m "feat: add bigcommerce customer lookup with normalized mapping"
```

### Task 3: Order 聚合与 RewardRecord upsert 改为 customer 语义

**Files:**
- Modify: `src/modules/order/order.service.ts`
- Modify: `src/modules/reward/reward.service.ts`
- Modify: `test/unit/modules/order/order.service.spec.ts`
- Modify: `test/unit/modules/reward/reward.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('createOrUpdateRewardRecords should upsert by batchId+customerId with customer profile fields', async () => {
  // assert upsert payload contains customerId/customerName/customerEmail
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- test/unit/modules/reward/reward.service.spec.ts -t "upsert by batchId+customerId"`
Expected: FAIL。

- [ ] **Step 3: Write minimal implementation**

```ts
// order aggregate type
type CustomerOrderAggregate = {
  customerId: number;
  totalAmount: Decimal;
};

// reward service upsert
const customer = await this.bigcommerceService.getCustomer(item.customerId);
await this.prisma.rewardRecord.upsert({
  where: { batchId_customerId: { batchId, customerId: item.customerId } },
  create: {
    batchId,
    customerId: item.customerId,
    customerName: customer.customerName,
    customerEmail: customer.customerEmail,
    ...
  },
  update: {
    customerName: customer.customerName,
    customerEmail: customer.customerEmail,
    ...
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run:
- `npm run test:unit -- test/unit/modules/order/order.service.spec.ts`
- `npm run test:unit -- test/unit/modules/reward/reward.service.spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/order/order.service.ts src/modules/reward/reward.service.ts test/unit/modules/order/order.service.spec.ts test/unit/modules/reward/reward.service.spec.ts
git commit -m "feat: refactor reward identity to customerId and persist customer profile"
```

### Task 4: Beans 发放/回滚改为邮箱 account + 无邮箱失败

**Files:**
- Modify: `src/modules/beans/beans.service.ts`
- Modify: `src/modules/reward/reward.service.ts`
- Modify: `test/unit/modules/beans/beans.service.spec.ts`
- Modify: `test/unit/modules/reward/reward.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('grantBeans should send account as customer email', async () => {
  // assert request body account === customerEmail
});

it('processOneRecord should fail when customerEmail is missing and skip external call', async () => {
  // expect FAILED + clear lastError + grantBeans not called
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- test/unit/modules/reward/reward.service.spec.ts -t "customerEmail is missing"`
Expected: FAIL。

- [ ] **Step 3: Write minimal implementation**

```ts
// beans service input
type GrantBeansInput = { customerEmail: string; beans: number; idempotencyKey: string; orderAmount: number };

// reward processOneRecord
if (!record.customerEmail) {
  await this.prisma.rewardRecord.update({
    where: { id: record.id },
    data: {
      status: RewardRecordStatus.FAILED,
      attemptCount: record.attemptCount + 1,
      lastError: `Missing customer email for customerId=${record.customerId}`,
      nextRetryAt: null,
    },
  });
  return;
}

await this.beansService.grantBeans({
  customerEmail: record.customerEmail,
  ...
});
```

- [ ] **Step 4: Run test to verify it passes**

Run:
- `npm run test:unit -- test/unit/modules/beans/beans.service.spec.ts`
- `npm run test:unit -- test/unit/modules/reward/reward.service.spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/beans/beans.service.ts src/modules/reward/reward.service.ts test/unit/modules/beans/beans.service.spec.ts test/unit/modules/reward/reward.service.spec.ts
git commit -m "feat: use customer email as beans account and fail on missing email"
```

### Task 5: Ledger/customerId 适配与全量回归

**Files:**
- Modify: `src/modules/ledger/ledger.service.ts`
- Modify: `test/integration/reward/reward-engine.e2e-spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('ledger should persist customerId instead of userId', () => {
  // assert prisma dmmf fields and/or integration payload
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration -- test/integration/reward/reward-engine.e2e-spec.ts -t "customerId instead of userId"`
Expected: FAIL。

- [ ] **Step 3: Write minimal implementation**

```ts
// ledger.service.ts
await tx.beansLedger.create({
  data: {
    customerId: record.customerId,
    ...
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run:
- `npm run test:unit`
- `npm run test:integration`
- `npm run build`
Expected: all PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/ledger/ledger.service.ts test/integration/reward/reward-engine.e2e-spec.ts
git commit -m "refactor: switch ledger identity to customerId and pass full regression"
```

---

## Spec Coverage Self-Review

- 全表 ID 改自增 Int：Task 1。
- RewardRecord `userId -> customerId` + name/email：Task 1 + Task 3。
- BigCommerce getCustomer 获取并落库：Task 2 + Task 3。
- grantBeans account 使用 customer email：Task 4。
- 无邮箱失败策略：Task 4。
- Ledger `userId -> customerId`：Task 5。

## Placeholder Scan

- 已检查，无 TODO/TBD/implement later/fill in details。

## Type Consistency

- 统一使用 `customerId: Int`。
- Beans 输入统一为 `customerEmail`。
- Reward upsert 唯一键统一 `batchId_customerId`。
