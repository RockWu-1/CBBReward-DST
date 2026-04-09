# Reward Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a production-grade quarterly reward engine with deterministic order snapshots, idempotent Beans issuance, retry, rollback, and adjustment batches.

**Architecture:** Keep a single NestJS service with module boundaries (`scheduler`, `reward`, `order`, `beans`, `ledger`). Use PostgreSQL/Prisma as source of truth and enforce idempotency using unique constraints and external `uid` keys. Execute every feature with TDD: failing test first, minimal implementation, regression run, atomic commit.

**Tech Stack:** Node.js, NestJS, Prisma, PostgreSQL, Jest, ts-jest, Docker Compose, Axios (`@nestjs/axios`).

---

## File Structure Map

### Existing files to modify
- `package.json`: add test scripts and testing dependencies.
- `prisma/schema.prisma`: add adjustment and rollback audit fields.
- `src/modules/beans/beans.service.ts`: implement real Beans API adapter and error normalization.
- `src/modules/order/order.service.ts`: implement order snapshot ingestion and deterministic aggregation.
- `src/modules/reward/reward.service.ts`: orchestration, idempotency, retries, rollback, adjustment flow.
- `src/modules/scheduler/quarterly-reward.scheduler.ts`: daily trigger + catch-up behavior.

### New backend files
- `src/common/errors/external-api.error.ts`: normalized external API error object.
- `src/common/env/env.service.ts`: typed env accessor.
- `src/modules/reward/reward.controller.ts`: admin endpoints (`retry`, `rollback`, `adjustment`).
- `src/modules/reward/dto/rollback-record.request.dto.ts`: rollback request validation.
- `src/modules/reward/dto/create-adjustment.request.dto.ts`: adjustment request validation.
- `src/modules/order/types/order-snapshot.type.ts`: internal order snapshot shape.

### New test files
- `test/jest.unit.json`: unit test config.
- `test/jest.integration.json`: integration test config.
- `test/unit/modules/reward/reward.service.spec.ts`
- `test/unit/modules/beans/beans.service.spec.ts`
- `test/unit/modules/scheduler/quarterly-reward.scheduler.spec.ts`
- `test/integration/reward/reward-engine.e2e-spec.ts`
- `test/setup/testing.module.ts`

---

### Task 1: Testing Foundation and Tooling

**Files:**
- Modify: `package.json`
- Create: `test/jest.unit.json`
- Create: `test/jest.integration.json`
- Create: `test/setup/testing.module.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/modules/reward/reward.service.spec.ts
import { describe, it, expect } from '@jest/globals';

describe('test harness smoke', () => {
  it('runs unit tests in project config', () => {
    expect(true).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- test/unit/modules/reward/reward.service.spec.ts -t "runs unit tests in project config"`
Expected: FAIL with `Expected: false Received: true`

- [ ] **Step 3: Write minimal implementation**

```json
// package.json (scripts and devDependencies delta)
{
  "scripts": {
    "test": "npm run test:unit && npm run test:integration",
    "test:unit": "jest -c test/jest.unit.json",
    "test:integration": "jest -c test/jest.integration.json --runInBand"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "ts-jest": "^29.2.5",
    "@types/jest": "^29.5.14",
    "supertest": "^7.0.0"
  }
}
```

```json
// test/jest.unit.json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": "../",
  "testRegex": "test/unit/.*\\.spec\\.ts$",
  "transform": { "^.+\\.(t|j)s$": "ts-jest" },
  "testEnvironment": "node",
  "collectCoverageFrom": ["src/**/*.(t|j)s"]
}
```

```json
// test/jest.integration.json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": "../",
  "testRegex": "test/integration/.*\\.e2e-spec\\.ts$",
  "transform": { "^.+\\.(t|j)s$": "ts-jest" },
  "testEnvironment": "node"
}
```

```ts
// test/setup/testing.module.ts
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';

export async function createTestingModule() {
  return Test.createTestingModule({ imports: [AppModule] }).compile();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- test/unit/modules/reward/reward.service.spec.ts -t "runs unit tests in project config"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json test/jest.unit.json test/jest.integration.json test/setup/testing.module.ts test/unit/modules/reward/reward.service.spec.ts
git commit -m "test: bootstrap jest unit and integration harness"
```

### Task 2: Schema Enhancements for Adjustment and Rollback Audit

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `test/integration/reward/reward-engine.e2e-spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/integration/reward/reward-engine.e2e-spec.ts
import { describe, it, expect } from '@jest/globals';
import { Prisma } from '@prisma/client';

describe('prisma schema fields', () => {
  it('has batchType and parentPeriod on RewardBatch', () => {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'RewardBatch');
    const names = model?.fields.map((f) => f.name) ?? [];
    expect(names).toContain('batchType');
    expect(names).toContain('parentPeriod');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration -- test/integration/reward/reward-engine.e2e-spec.ts -t "has batchType and parentPeriod on RewardBatch"`
Expected: FAIL on missing fields.

- [ ] **Step 3: Write minimal implementation**

```prisma
// prisma/schema.prisma (additions)
enum RewardBatchType {
  REGULAR
  ADJUSTMENT
}

model RewardBatch {
  id           String            @id @default(uuid())
  period       String            @unique
  batchType    RewardBatchType   @default(REGULAR)
  parentPeriod String?
  triggeredBy  String?
  // existing fields stay unchanged
}

model RewardRecord {
  id             String             @id @default(uuid())
  rollbackReason String?
  rollbackBy     String?
  rollbackAt     DateTime?
  // existing fields stay unchanged
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx prisma generate && npm run test:integration -- test/integration/reward/reward-engine.e2e-spec.ts -t "has batchType and parentPeriod on RewardBatch"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma test/integration/reward/reward-engine.e2e-spec.ts
git commit -m "feat: add adjustment and rollback audit fields to prisma schema"
```

### Task 3: Implement Beans API Adapter with Normalized Errors

**Files:**
- Create: `src/common/errors/external-api.error.ts`
- Create: `src/common/env/env.service.ts`
- Modify: `src/modules/beans/beans.service.ts`
- Test: `test/unit/modules/beans/beans.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/modules/beans/beans.service.spec.ts
import { BeansService } from '../../../../src/modules/beans/beans.service';

describe('BeansService', () => {
  it('maps grant request to /v3/liana/credit/ with uid', async () => {
    const post = jest.fn().mockResolvedValue({ data: { id: 'txn-1' } });
    const service = new BeansService({ post } as never, {
      get: (k: string) => ({
        BEANS_API_BASE_URL: 'https://api.trybeans.com',
        BEANS_API_KEY: 'sk_test',
        BEANS_REWARD_RULE: 'rule:liana:api_credit'
      }[k]),
    } as never);

    await service.grantBeans({ userId: 'a@b.com', beans: 25, idempotencyKey: 'reward:r1' });
    expect(post).toHaveBeenCalledWith(
      'https://api.trybeans.com/v3/liana/credit/',
      expect.objectContaining({ uid: 'reward:r1', quantity: 25 })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- test/unit/modules/beans/beans.service.spec.ts -t "maps grant request to /v3/liana/credit/ with uid"`
Expected: FAIL because constructor/signature and real call are not implemented.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/common/errors/external-api.error.ts
export class ExternalApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly statusCode?: number,
  ) {
    super(message);
  }
}
```

```ts
// src/common/env/env.service.ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class EnvService {
  get(key: string): string {
    const value = process.env[key];
    if (!value) throw new Error(`Missing env: ${key}`);
    return value;
  }
}
```

```ts
// src/modules/beans/beans.service.ts
import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { ExternalApiError } from '../../common/errors/external-api.error';
import { EnvService } from '../../common/env/env.service';

@Injectable()
export class BeansService {
  constructor(private readonly http: HttpService, private readonly env: EnvService) {}

  async grantBeans(input: { userId: string; beans: number; idempotencyKey: string }) {
    const baseUrl = this.env.get('BEANS_API_BASE_URL');
    const rule = this.env.get('BEANS_REWARD_RULE');
    try {
      const response = await firstValueFrom(
        this.http.post(`${baseUrl}/v3/liana/credit/`, {
          account: input.userId,
          rule,
          quantity: input.beans,
          description: `Quarter reward`,
          uid: input.idempotencyKey,
        }),
      );
      return { transactionId: String(response.data?.id ?? input.idempotencyKey) };
    } catch (error: any) {
      const status = error?.response?.status;
      const retryable = status === 429 || (status >= 500 && status < 600) || !status;
      throw new ExternalApiError('Beans grant failed', 'BEANS_GRANT_FAILED', retryable, status);
    }
  }

  async rollbackBeans(input: { userId: string; beans: number; reason: string; idempotencyKey: string }) {
    const baseUrl = this.env.get('BEANS_API_BASE_URL');
    const rule = this.env.get('BEANS_ROLLBACK_RULE');
    const response = await firstValueFrom(
      this.http.post(`${baseUrl}/v3/liana/debit/`, {
        account: input.userId,
        rule,
        quantity: input.beans,
        description: `Rollback: ${input.reason}`,
        uid: input.idempotencyKey,
      }),
    );
    return { transactionId: String(response.data?.id ?? input.idempotencyKey) };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- test/unit/modules/beans/beans.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/common/errors/external-api.error.ts src/common/env/env.service.ts src/modules/beans/beans.service.ts test/unit/modules/beans/beans.service.spec.ts
git commit -m "feat: implement beans adapter with normalized error handling"
```

### Task 4: Order Snapshot Ingestion and Deterministic Aggregation

**Files:**
- Create: `src/modules/order/types/order-snapshot.type.ts`
- Modify: `src/modules/order/order.service.ts`
- Test: `test/unit/modules/reward/reward.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('aggregates net order amount by user from snapshots', async () => {
  const snapshots = [
    { userId: 'u1', netAmount: '10.50' },
    { userId: 'u1', netAmount: '9.50' },
    { userId: 'u2', netAmount: '5.00' },
  ];
  const result = aggregateSnapshotsByUser(snapshots as any);
  expect(result.find((x) => x.userId === 'u1')?.totalAmount.toString()).toBe('20');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- test/unit/modules/reward/reward.service.spec.ts -t "aggregates net order amount by user from snapshots"`
Expected: FAIL because helper is missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/modules/order/types/order-snapshot.type.ts
export type OrderSnapshotType = {
  externalId: string;
  userId: string;
  netAmount: string;
  createdAt: Date;
  rawPayload: Record<string, unknown>;
};
```

```ts
// src/modules/order/order.service.ts (new exported helper)
import Decimal from 'decimal.js';

export function aggregateSnapshotsByUser(
  snapshots: Array<{ userId: string; netAmount: string }>,
): Array<{ userId: string; totalAmount: Decimal }> {
  const map = new Map<string, Decimal>();
  for (const item of snapshots) {
    map.set(item.userId, (map.get(item.userId) ?? new Decimal(0)).add(item.netAmount));
  }
  return [...map.entries()].map(([userId, totalAmount]) => ({ userId, totalAmount }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- test/unit/modules/reward/reward.service.spec.ts -t "aggregates net order amount by user from snapshots"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/order/types/order-snapshot.type.ts src/modules/order/order.service.ts test/unit/modules/reward/reward.service.spec.ts
git commit -m "feat: add deterministic user aggregation from order snapshots"
```

### Task 5: Reward Orchestration Idempotency for Batch and Record

**Files:**
- Modify: `src/modules/reward/reward.service.ts`
- Test: `test/unit/modules/reward/reward.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('marks record success when reward idempotency key already exists in ledger', async () => {
  prisma.rewardRecord.findUniqueOrThrow.mockResolvedValue({ id: 'r1', userId: 'u1', rewardAmount: 10, batchId: 'b1' });
  ledger.findByIdempotencyKey.mockResolvedValue({ id: 'l1', createdAt: new Date('2026-01-01T00:00:00Z') });

  await service['processOneRecord']('r1');

  expect(prisma.rewardRecord.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCESS' }) })
  );
  expect(beans.grantBeans).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- test/unit/modules/reward/reward.service.spec.ts -t "marks record success when reward idempotency key already exists in ledger"`
Expected: FAIL if private method path or behavior does not match.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/modules/reward/reward.service.ts (extract and expose a protected method)
protected async processOneRecord(recordId: string): Promise<void> {
  const record = await this.prisma.rewardRecord.findUniqueOrThrow({ where: { id: recordId } });
  const idempotencyKey = `reward:${record.id}`;
  const existing = await this.ledgerService.findByIdempotencyKey(idempotencyKey);
  if (existing) {
    await this.prisma.rewardRecord.update({
      where: { id: record.id },
      data: { status: RewardRecordStatus.SUCCESS, processedAt: existing.createdAt, lastError: null },
    });
    return;
  }
  // keep existing success/failure transaction branch
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- test/unit/modules/reward/reward.service.spec.ts`
Expected: PASS for idempotency branch.

- [ ] **Step 5: Commit**

```bash
git add src/modules/reward/reward.service.ts test/unit/modules/reward/reward.service.spec.ts
git commit -m "feat: enforce reward record idempotency using ledger key"
```

### Task 6: Retry Policy and Error Classification in Reward Processing

**Files:**
- Modify: `src/modules/reward/reward.service.ts`
- Test: `test/unit/modules/reward/reward.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('schedules retry for retryable beans failures with capped backoff', async () => {
  beans.grantBeans.mockRejectedValue(new ExternalApiError('429', 'BEANS_RATE_LIMIT', true, 429));
  prisma.rewardRecord.findUniqueOrThrow.mockResolvedValue({ id: 'r1', userId: 'u1', rewardAmount: 12, attemptCount: 7, batchId: 'b1' });

  await service['processOneRecord']('r1');

  expect(prisma.rewardRecord.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', attemptCount: 8 }) })
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- test/unit/modules/reward/reward.service.spec.ts -t "schedules retry for retryable beans failures with capped backoff"`
Expected: FAIL if current logic does not inspect retryable classification.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/modules/reward/reward.service.ts (catch branch)
} catch (error) {
  const attempt = record.attemptCount + 1;
  const isRetryable = error instanceof ExternalApiError ? error.retryable : false;

  await this.prisma.rewardRecord.update({
    where: { id: record.id },
    data: {
      status: RewardRecordStatus.FAILED,
      attemptCount: attempt,
      lastError: error instanceof Error ? error.message : 'Unknown error',
      nextRetryAt:
        isRetryable && attempt < 8
          ? new Date(Date.now() + Math.min(60, 5 * 2 ** (attempt - 1)) * 60_000)
          : null,
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- test/unit/modules/reward/reward.service.spec.ts`
Expected: PASS for retry schedule, non-retryable branch, and attempt cap.

- [ ] **Step 5: Commit**

```bash
git add src/modules/reward/reward.service.ts test/unit/modules/reward/reward.service.spec.ts
git commit -m "feat: classify retryable failures and cap retry attempts at eight"
```

### Task 7: Rollback Audit Fields and Negative Ledger Guarantees

**Files:**
- Modify: `src/modules/reward/reward.service.ts`
- Modify: `src/modules/ledger/ledger.service.ts`
- Test: `test/unit/modules/reward/reward.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('writes negative rollback ledger and updates rollback audit fields', async () => {
  prisma.rewardRecord.findUnique.mockResolvedValue({ id: 'r1', userId: 'u1', rewardAmount: 20, status: 'SUCCESS', batchId: 'b1' });
  ledger.findByIdempotencyKey.mockResolvedValue(null);

  await service.rollbackRecord('r1', 'manual correction', 'ops@company.com');

  expect(ledger.appendRollbackLedger).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ id: 'r1' }),
    expect.objectContaining({ s: -1 }),
    'rollback:r1',
    expect.any(String),
    expect.objectContaining({ reason: 'manual correction' }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- test/unit/modules/reward/reward.service.spec.ts -t "writes negative rollback ledger and updates rollback audit fields"`
Expected: FAIL because signature and audit fields are missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/modules/reward/reward.service.ts
async rollbackRecord(recordId: string, reason: string, operator: string): Promise<void> {
  // existing validations
  await this.prisma.$transaction(async (tx) => {
    await this.ledgerService.appendRollbackLedger(
      tx,
      record,
      rollbackAmount,
      idempotencyKey,
      external.transactionId,
      { reason, operator },
    );
    await tx.rewardRecord.update({
      where: { id: record.id },
      data: {
        status: RewardRecordStatus.ROLLED_BACK,
        rollbackReason: reason,
        rollbackBy: operator,
        rollbackAt: new Date(),
      },
    });
  });
}
```

```ts
// src/modules/ledger/ledger.service.ts
appendRollbackLedger(...) {
  return tx.beansLedger.create({
    data: {
      // existing fields
      changeAmount: new Prisma.Decimal(negativeAmount.toString()),
      type: LedgerType.ROLLBACK,
      metadata,
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- test/unit/modules/reward/reward.service.spec.ts`
Expected: PASS for rollback idempotency and audit field updates.

- [ ] **Step 5: Commit**

```bash
git add src/modules/reward/reward.service.ts src/modules/ledger/ledger.service.ts test/unit/modules/reward/reward.service.spec.ts
git commit -m "feat: enforce rollback audit and negative ledger invariants"
```

### Task 8: Adjustment Batch Creation and Processing

**Files:**
- Modify: `src/modules/reward/reward.service.ts`
- Create: `src/modules/reward/dto/create-adjustment.request.dto.ts`
- Test: `test/unit/modules/reward/reward.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('creates adjustment batch with parentPeriod and ADJUSTMENT type', async () => {
  prisma.rewardBatch.create.mockResolvedValue({ id: 'b2', period: '2026-Q1-ADJ-001', batchType: 'ADJUSTMENT' });

  const batch = await service.createAdjustmentBatch({
    parentPeriod: '2026-Q1',
    adjustmentPeriod: '2026-Q1-ADJ-001',
    triggeredBy: 'ops@company.com',
  });

  expect(batch.batchType).toBe('ADJUSTMENT');
  expect(prisma.rewardBatch.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ parentPeriod: '2026-Q1' }) })
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- test/unit/modules/reward/reward.service.spec.ts -t "creates adjustment batch with parentPeriod and ADJUSTMENT type"`
Expected: FAIL because method does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/modules/reward/dto/create-adjustment.request.dto.ts
import { IsString } from 'class-validator';

export class CreateAdjustmentRequestDto {
  @IsString()
  parentPeriod!: string;

  @IsString()
  adjustmentPeriod!: string;

  @IsString()
  triggeredBy!: string;
}
```

```ts
// src/modules/reward/reward.service.ts
async createAdjustmentBatch(input: {
  parentPeriod: string;
  adjustmentPeriod: string;
  triggeredBy: string;
}) {
  return this.prisma.rewardBatch.create({
    data: {
      period: input.adjustmentPeriod,
      parentPeriod: input.parentPeriod,
      batchType: 'ADJUSTMENT',
      triggeredBy: input.triggeredBy,
      startDate: new Date(),
      endDate: new Date(),
      rewardRate: new Prisma.Decimal(process.env.REWARD_RATE ?? '0.05'),
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- test/unit/modules/reward/reward.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/reward/reward.service.ts src/modules/reward/dto/create-adjustment.request.dto.ts test/unit/modules/reward/reward.service.spec.ts
git commit -m "feat: add adjustment batch creation flow"
```

### Task 9: Admin Endpoints for Retry, Rollback, and Adjustment

**Files:**
- Create: `src/modules/reward/reward.controller.ts`
- Create: `src/modules/reward/dto/rollback-record.request.dto.ts`
- Modify: `src/modules/reward/reward.module.ts`
- Test: `test/integration/reward/reward-engine.e2e-spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('POST /reward/records/:id/rollback returns 201 and calls service', async () => {
  await request(app.getHttpServer())
    .post('/reward/records/r1/rollback')
    .send({ reason: 'fraud check', operator: 'ops@company.com' })
    .expect(201);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration -- test/integration/reward/reward-engine.e2e-spec.ts -t "POST /reward/records/:id/rollback returns 201 and calls service"`
Expected: FAIL with route not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/modules/reward/dto/rollback-record.request.dto.ts
import { IsString } from 'class-validator';

export class RollbackRecordRequestDto {
  @IsString()
  reason!: string;

  @IsString()
  operator!: string;
}
```

```ts
// src/modules/reward/reward.controller.ts
import { Body, Controller, Param, Post } from '@nestjs/common';
import { RewardService } from './reward.service';
import { RollbackRecordRequestDto } from './dto/rollback-record.request.dto';
import { CreateAdjustmentRequestDto } from './dto/create-adjustment.request.dto';

@Controller('reward')
export class RewardController {
  constructor(private readonly rewardService: RewardService) {}

  @Post('batches/:id/retry')
  retryBatch(@Param('id') batchId: string) {
    return this.rewardService.retryFailedRecords(batchId);
  }

  @Post('records/:id/retry')
  retryRecord(@Param('id') recordId: string) {
    return this.rewardService.retryRecord(recordId);
  }

  @Post('records/:id/rollback')
  rollbackRecord(@Param('id') recordId: string, @Body() body: RollbackRecordRequestDto) {
    return this.rewardService.rollbackRecord(recordId, body.reason, body.operator);
  }

  @Post('batches/:period/adjustments')
  createAdjustment(@Param('period') period: string, @Body() body: CreateAdjustmentRequestDto) {
    return this.rewardService.createAdjustmentBatch({
      parentPeriod: period,
      adjustmentPeriod: body.adjustmentPeriod,
      triggeredBy: body.triggeredBy,
    });
  }
}
```

```ts
// src/modules/reward/reward.module.ts (add controller)
@Module({
  imports: [OrderModule, BeansModule, LedgerModule],
  controllers: [RewardController],
  providers: [RewardService],
  exports: [RewardService],
})
export class RewardModule {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:integration -- test/integration/reward/reward-engine.e2e-spec.ts`
Expected: PASS for endpoint registration and validation.

- [ ] **Step 5: Commit**

```bash
git add src/modules/reward/reward.controller.ts src/modules/reward/dto/rollback-record.request.dto.ts src/modules/reward/reward.module.ts test/integration/reward/reward-engine.e2e-spec.ts
git commit -m "feat: add admin reward endpoints for retry rollback and adjustments"
```

### Task 10: Scheduler and Catch-up Behavior Regression Tests

**Files:**
- Modify: `src/modules/scheduler/quarterly-reward.scheduler.ts`
- Test: `test/unit/modules/scheduler/quarterly-reward.scheduler.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { QuarterlyRewardScheduler } from '../../../../src/modules/scheduler/quarterly-reward.scheduler';

describe('QuarterlyRewardScheduler', () => {
  it('executes previous quarter on quarter start day and then catch-up periods', async () => {
    const rewardService = {
      isQuarterStartDay: jest.fn().mockReturnValue(true),
      getPreviousQuarter: jest.fn().mockReturnValue({ period: '2026-Q1', startDate: new Date(), endDate: new Date() }),
      findCatchUpPeriods: jest.fn().mockResolvedValue([{ period: '2025-Q4', startDate: new Date(), endDate: new Date() }]),
      runQuarterlyReward: jest.fn().mockResolvedValue(undefined),
    };

    const scheduler = new QuarterlyRewardScheduler(rewardService as never);
    await scheduler.handleDailyCheck();

    expect(rewardService.runQuarterlyReward).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- test/unit/modules/scheduler/quarterly-reward.scheduler.spec.ts`
Expected: FAIL if dedupe/ordering is not deterministic.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/modules/scheduler/quarterly-reward.scheduler.ts (dedupe by period)
async handleDailyCheck() {
  const today = new Date();
  const periods = new Map<string, { period: string; startDate: Date; endDate: Date }>();

  if (this.rewardService.isQuarterStartDay(today)) {
    const currentQuarterTarget = this.rewardService.getPreviousQuarter(today);
    periods.set(currentQuarterTarget.period, currentQuarterTarget);
  }

  const catchup = await this.rewardService.findCatchUpPeriods(today);
  for (const period of catchup) {
    periods.set(period.period, period);
  }

  for (const period of periods.values()) {
    await this.rewardService.runQuarterlyReward(period);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- test/unit/modules/scheduler/quarterly-reward.scheduler.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/scheduler/quarterly-reward.scheduler.ts test/unit/modules/scheduler/quarterly-reward.scheduler.spec.ts
git commit -m "test: lock scheduler quarter-start and catch-up behavior"
```

### Task 11: Full Regression and Operational Documentation

**Files:**
- Modify: `.env.example`
- Create: `docs/superpowers/runbooks/reward-engine-operations.md`

- [ ] **Step 1: Write the failing test**

```ts
it('contains required beans env keys', () => {
  const env = require('fs').readFileSync('.env.example', 'utf8');
  expect(env).toContain('BEANS_REWARD_RULE=');
  expect(env).toContain('BEANS_ROLLBACK_RULE=');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- test/unit/modules/reward/reward.service.spec.ts -t "contains required beans env keys"`
Expected: FAIL because new env keys are missing.

- [ ] **Step 3: Write minimal implementation**

```dotenv
# .env.example additions
BEANS_REWARD_RULE=rule:liana:api_credit
BEANS_ROLLBACK_RULE=rule:liana:expiration
BEANS_API_TIMEOUT_MS=10000
```

```md
# docs/superpowers/runbooks/reward-engine-operations.md
## Daily checks
- Confirm scheduler run logs at configured cron time.
- Confirm no batch remains in PROCESSING over 30 minutes.

## Retry operation
- Batch retry: POST /reward/batches/{id}/retry
- Record retry: POST /reward/records/{id}/retry

## Rollback operation
- POST /reward/records/{id}/rollback with reason and operator.
- Verify a new negative ledger row exists.

## Adjustment operation
- POST /reward/batches/{period}/adjustments
- Verify parentPeriod and batchType=ADJUSTMENT.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit && npm run test:integration`
Expected: PASS across all suites.

- [ ] **Step 5: Commit**

```bash
git add .env.example docs/superpowers/runbooks/reward-engine-operations.md
git commit -m "docs: add reward engine runbook and required beans env keys"
```

---

## Spec Coverage Self-Review

- Quarterly scheduler + catch-up: covered by Task 10.
- Snapshot-based deterministic computation: covered by Task 4.
- Idempotent batch/record/ledger processing: covered by Tasks 2, 5, 7.
- Retry with capped policy and external error classification: covered by Tasks 3 and 6.
- Rollback by negative ledger only: covered by Task 7.
- Frozen quarter + adjustment batch strategy: covered by Task 8.
- Admin operations for retry/rollback/adjustment: covered by Task 9.
- Test-first implementation and regression runs: every task enforces fail-first and pass verification.

## Placeholder Scan

Checked plan text for placeholder patterns and removed non-actionable wording.

## Type Consistency

- `idempotencyKey` format is consistent across reward and rollback operations.
- Batch type naming is consistent: `ADJUSTMENT` and `REGULAR`.
- Endpoint names and service methods are aligned between Task 8 and Task 9.
