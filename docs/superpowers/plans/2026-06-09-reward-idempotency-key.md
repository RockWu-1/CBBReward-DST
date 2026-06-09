# Reward Idempotency Key Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `reward_${record.id}` with `reward_` + random 12-character base62 strings, while only adding collision-avoidance lookup loops for the single-record retry endpoint.

**Architecture:** Keep key generation inside `RewardService`, but split it into explicit helpers so the call site can choose between one-shot random generation and retry-only collision-avoidance generation. Preserve the existing "already granted" protection by checking ledger rows by `rewardRecordId`, since deterministic idempotency keys are going away.

**Tech Stack:** NestJS, TypeScript, Jest, Prisma

---

## File Structure

- Modify: `src/modules/reward/reward.service.ts`
  - Add random base62 key generation helpers
  - Add endpoint-specific retry mode plumbing
  - Replace the old deterministic idempotency-key lookup shortcut with a reward-ledger lookup by `rewardRecordId`
- Modify: `test/unit/modules/reward/reward.service.spec.ts`
  - Replace the fixed-key expectations
  - Add tests for single-record retry collision handling
  - Add tests that batch retry still uses one-shot generation
- Reference: `src/modules/reward/reward.controller.ts`
  - Confirms which service entrypoint corresponds to single-record retry vs batch retry

### Task 1: Write the Failing Unit Tests

**Files:**
- Modify: `test/unit/modules/reward/reward.service.spec.ts`
- Reference: `src/modules/reward/reward.service.ts`

- [ ] **Step 1: Replace the old fixed-key success-path test with a reward-ledger based success-path test**

```ts
it('marks record SUCCESS and skips grantBeans when a reward ledger already exists for the record', async () => {
  const findUniqueOrThrow = jest.fn().mockResolvedValue({
    id: 1,
    customerId: 1001,
    customerEmail: 'c1001@example.com',
    rewardAmount: new Decimal('12.34'),
    totalOrderAmount: new Decimal('123.4'),
    attemptCount: 0,
    batchId: 10,
  });
  const update = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    rewardRecord: { findUniqueOrThrow, update },
    $transaction: jest.fn(),
  };
  const grantBeans = jest.fn();
  const ledgerService = {
    findByRewardRecordId: jest.fn().mockResolvedValue({
      id: 'ledger-1',
      externalTxnId: 'txn-1',
      createdAt: new Date('2026-01-02T03:04:05.000Z'),
    }),
    findByIdempotencyKey: jest.fn(),
    appendRewardLedger: jest.fn(),
  };

  const service = new RewardService(
    prisma as unknown as PrismaService,
    {} as OrderService,
    { grantBeans } as unknown as BeansService,
    ledgerService as unknown as LedgerService,
    {} as BigcommerceService,
  );

  await (service as any).processOneRecord(1);

  expect(ledgerService.findByRewardRecordId).toHaveBeenCalledWith(1);
  expect(update).toHaveBeenCalledWith({
    where: { id: 1 },
    data: {
      status: RewardRecordStatus.SUCCESS,
      processedAt: new Date('2026-01-02T03:04:05.000Z'),
      lastError: null,
      nextRetryAt: null,
    },
  });
  expect(grantBeans).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Add a one-shot generation test for normal processing**

```ts
it('uses a random reward key format for normal processing without pre-checking key uniqueness', async () => {
  const findUniqueOrThrow = jest.fn().mockResolvedValue({
    id: 2,
    customerId: 1002,
    customerEmail: 'c1002@example.com',
    rewardAmount: new Decimal('8.88'),
    totalOrderAmount: new Decimal('88.8'),
    attemptCount: 0,
    batchId: 20,
  });
  const txUpdate = jest.fn().mockResolvedValue(undefined);
  const transaction = jest.fn().mockImplementation(async (callback: any) =>
    callback({
      rewardRecord: { update: txUpdate },
      beansLedger: {},
    }),
  );
  const prisma = {
    rewardRecord: { findUniqueOrThrow },
    $transaction: transaction,
  };
  const grantBeans = jest.fn().mockResolvedValue({ transactionId: 'txn-2' });
  const appendRewardLedger = jest.fn().mockResolvedValue(undefined);
  const ledgerService = {
    findByRewardRecordId: jest.fn().mockResolvedValue(null),
    findByIdempotencyKey: jest.fn(),
    appendRewardLedger,
  };

  const service = new RewardService(
    prisma as unknown as PrismaService,
    {} as OrderService,
    { grantBeans } as unknown as BeansService,
    ledgerService as unknown as LedgerService,
    {} as BigcommerceService,
  );

  await (service as any).processOneRecord(2);

  const key = grantBeans.mock.calls[0][0].idempotencyKey;
  expect(key).toMatch(/^reward_[0-9A-Za-z]{12}$/);
  expect(ledgerService.findByIdempotencyKey).not.toHaveBeenCalled();
  expect(appendRewardLedger).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ id: 2 }),
    expect.anything(),
    key,
    'txn-2',
  );
});
```

- [ ] **Step 3: Add a single-record retry collision test**

```ts
it('retries idempotency key generation for retryRecord until an unused key is found', async () => {
  const findUniqueOrThrow = jest.fn().mockResolvedValue({
    id: 3,
    customerId: 1003,
    customerEmail: 'c1003@example.com',
    rewardAmount: new Decimal('9.99'),
    totalOrderAmount: new Decimal('99.9'),
    attemptCount: 1,
    batchId: 30,
  });
  const prisma = {
    rewardRecord: { findUniqueOrThrow },
    $transaction: jest.fn().mockImplementation(async (callback: any) =>
      callback({ rewardRecord: { update: jest.fn() } }),
    ),
  };
  const grantBeans = jest.fn().mockResolvedValue({ transactionId: 'txn-3' });
  const appendRewardLedger = jest.fn().mockResolvedValue(undefined);
  const ledgerService = {
    findByRewardRecordId: jest.fn().mockResolvedValue(null),
    findByIdempotencyKey: jest
      .fn()
      .mockResolvedValueOnce({ id: 'existing-key' })
      .mockResolvedValueOnce(null),
    appendRewardLedger,
  };

  const service = new RewardService(
    prisma as unknown as PrismaService,
    {} as OrderService,
    { grantBeans } as unknown as BeansService,
    ledgerService as unknown as LedgerService,
    {} as BigcommerceService,
  );

  const first = jest.spyOn(service as any, 'generateRandomRewardIdempotencyKey')
    .mockReturnValueOnce('reward_AAAAAAAAAAAA')
    .mockReturnValueOnce('reward_BBBBBBBBBBBB');

  await service.retryRecord(3);

  expect(first).toHaveBeenCalledTimes(2);
  expect(ledgerService.findByIdempotencyKey).toHaveBeenNthCalledWith(1, 'reward_AAAAAAAAAAAA');
  expect(ledgerService.findByIdempotencyKey).toHaveBeenNthCalledWith(2, 'reward_BBBBBBBBBBBB');
  expect(grantBeans).toHaveBeenCalledWith(
    expect.objectContaining({ idempotencyKey: 'reward_BBBBBBBBBBBB' }),
  );
});
```

- [ ] **Step 4: Add a batch retry test proving there is no collision-avoidance lookup loop**

```ts
it('does not pre-check idempotency key uniqueness during batch retry processing', async () => {
  const findMany = jest.fn().mockResolvedValue([{ id: 4 }]);
  const processSpy = jest
    .spyOn(RewardService.prototype as any, 'processOneRecord')
    .mockResolvedValue(undefined);

  const service = new RewardService(
    {
      rewardRecord: { findMany },
    } as unknown as PrismaService,
    {} as OrderService,
    {} as BeansService,
    {} as LedgerService,
    {} as BigcommerceService,
  );

  await service.retryFailedRecords(99);

  expect(findMany).toHaveBeenCalled();
  expect(processSpy).toHaveBeenCalledWith(4, false);

  processSpy.mockRestore();
});
```

- [ ] **Step 5: Run the focused unit test file and verify the new cases fail for the expected reasons**

Run: `npm run test:unit -- test/unit/modules/reward/reward.service.spec.ts`

Expected:
- FAIL because `processOneRecord` still expects only one argument
- FAIL because the service still generates `reward_${record.id}`
- FAIL because normal processing still performs the old key-based lookup logic

- [ ] **Step 6: Commit the failing test changes**

```bash
git add test/unit/modules/reward/reward.service.spec.ts
git commit -m "test: cover reward idempotency key generation"
```

### Task 2: Implement Endpoint-Specific Key Generation in RewardService

**Files:**
- Modify: `src/modules/reward/reward.service.ts`
- Reference: `src/modules/reward/reward.controller.ts`
- Test: `test/unit/modules/reward/reward.service.spec.ts`

- [ ] **Step 1: Update `retryFailedRecords` and `retryRecord` to pass explicit retry mode into `processOneRecord`**

```ts
async retryFailedRecords(batchId: number): Promise<void> {
  const retryCandidates = await this.prisma.rewardRecord.findMany({
    where: {
      batchId,
      status: RewardRecordStatus.FAILED,
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
    },
    orderBy: { updatedAt: 'asc' },
    take: 500,
  });

  for (const record of retryCandidates) {
    await this.processOneRecord(record.id, false);
  }
}

async retryRecord(recordId: number): Promise<void> {
  await this.processOneRecord(recordId, true);
}
```

- [ ] **Step 2: Add focused helpers for random key generation**

```ts
import { randomInt } from 'node:crypto';

private generateRandomRewardIdempotencyKey(): string {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let suffix = '';

  for (let index = 0; index < 12; index += 1) {
    const next = randomInt(alphabet.length);
    suffix += alphabet[next];
  }

  return `reward_${suffix}`;
}

private async generateRetryRecordIdempotencyKey(): Promise<string> {
  while (true) {
    const candidate = this.generateRandomRewardIdempotencyKey();
    const existing = await this.ledgerService.findByIdempotencyKey(candidate);
    if (!existing) return candidate;
  }
}
```

- [ ] **Step 3: Change `processOneRecord` to use reward-ledger existence for duplicate protection and the new key strategy**

```ts
private async processOneRecord(recordId: number, ensureUnusedKey = false): Promise<void> {
  const record = await this.prisma.rewardRecord.findUniqueOrThrow({ where: { id: recordId } });

  const existingReward = await this.ledgerService.findByRewardRecordId(record.id);
  if (existingReward && existingReward.externalTxnId) {
    await this.prisma.rewardRecord.update({
      where: { id: record.id },
      data: {
        status: RewardRecordStatus.SUCCESS,
        processedAt: existingReward.createdAt,
        lastError: null,
        nextRetryAt: null,
      },
    });
    return;
  }

  const idempotencyKey = ensureUnusedKey
    ? await this.generateRetryRecordIdempotencyKey()
    : this.generateRandomRewardIdempotencyKey();

  if (!record.customerEmail) {
    await this.prisma.rewardRecord.update({
      where: { id: record.id },
      data: {
        status: RewardRecordStatus.FAILED,
        attemptCount: record.attemptCount + 1,
        lastError: `Missing customerEmail for reward record ${record.id}`,
        nextRetryAt: null,
      },
    });
    return;
  }
```

- [ ] **Step 4: Keep grant and ledger persistence aligned on the same generated key**

```ts
const external = await this.beansService.grantBeans({
  customerEmail: 'rock.wu@silksoftware.com',
  beans: Number(record.rewardAmount),
  orderAmount: Number(record.totalOrderAmount),
  idempotencyKey,
});

await this.prisma.$transaction(async (tx) => {
  await this.ledgerService.appendRewardLedger(
    tx,
    record,
    new Decimal(record.rewardAmount.toString()),
    idempotencyKey,
    external.transactionId,
  );

  await tx.rewardRecord.update({
    where: { id: record.id },
    data: {
      status: RewardRecordStatus.SUCCESS,
      processedAt: new Date(),
      lastError: null,
      nextRetryAt: null,
    },
  });
});
```

- [ ] **Step 5: Run the focused unit test file and verify it passes**

Run: `npm run test:unit -- test/unit/modules/reward/reward.service.spec.ts`

Expected:
- PASS for the new format and retry-path tests
- PASS for the existing retry scheduling and rollback tests

- [ ] **Step 6: Commit the service implementation**

```bash
git add src/modules/reward/reward.service.ts test/unit/modules/reward/reward.service.spec.ts
git commit -m "feat: randomize reward idempotency keys"
```

### Task 3: Verify the Change End-to-End at the Unit Level

**Files:**
- Modify: `src/modules/reward/reward.service.ts` if follow-up fixes are needed
- Modify: `test/unit/modules/reward/reward.service.spec.ts` if follow-up fixes are needed

- [ ] **Step 1: Run only the reward unit suite once more for a clean confirmation**

Run: `npm run test:unit -- test/unit/modules/reward/reward.service.spec.ts`

Expected:
- PASS with no snapshot updates
- PASS with the new retry-specific assertions intact

- [ ] **Step 2: Run the full unit test suite to check for regressions**

Run: `npm run test:unit`

Expected:
- PASS across the repository's unit tests
- No failures caused by the new `processOneRecord(recordId, ensureUnusedKey)` signature

- [ ] **Step 3: Commit any final verification-driven cleanup**

```bash
git add src/modules/reward/reward.service.ts test/unit/modules/reward/reward.service.spec.ts
git commit -m "test: verify reward retry key behavior"
```
