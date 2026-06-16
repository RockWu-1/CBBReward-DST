# Reward Rerun Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the unused adjustment batch flow, stop persisting `rewardRate`, and make rerun the only supported manual recovery path with safe issued-ledger blocking.

**Architecture:** Replace batch type metadata with batch source metadata in Prisma, then thread that source through batch creation and rerun orchestration in `RewardService`. Keep `RewardBatchStatus` focused on lifecycle state, move rerun origin into `RewardBatchSource`, and enforce a pre-rerun safety gate through `LedgerService` before any failed batch is reset.

**Tech Stack:** NestJS, Prisma, PostgreSQL, Jest, TypeScript, Decimal.js

**Plan note:** Per user preference, this plan intentionally omits any git commands or commit steps.

---

## File Map

**Modify**
- `D:/MyCode/CBBReward-DST/prisma/schema.prisma`
- `D:/MyCode/CBBReward-DST/src/modules/reward/reward.service.ts`
- `D:/MyCode/CBBReward-DST/src/modules/reward/reward.controller.ts`
- `D:/MyCode/CBBReward-DST/src/modules/admin/admin.actions.ts`
- `D:/MyCode/CBBReward-DST/src/modules/ledger/ledger.service.ts`
- `D:/MyCode/CBBReward-DST/test/integration/reward/reward-engine.e2e-spec.ts`
- `D:/MyCode/CBBReward-DST/test/unit/modules/reward/reward.service.spec.ts`
- `D:/MyCode/CBBReward-DST/test/unit/modules/admin/admin.actions.spec.ts`

**Create**
- `D:/MyCode/CBBReward-DST/prisma/migrations/20260611000000_reward_batch_source/migration.sql`
- `D:/MyCode/CBBReward-DST/test/unit/modules/ledger/ledger.service.spec.ts`

**Delete**
- `D:/MyCode/CBBReward-DST/src/modules/reward/dto/create-adjustment.request.dto.ts`

**Responsibilities**
- `schema.prisma`: Replace batch type with batch source and remove stale batch fields.
- `migration.sql`: Apply the schema transition safely to PostgreSQL.
- `reward.service.ts`: Remove `rewardRate`, wire `source`, block reruns when issuance exists, reset failed batches safely.
- `reward.controller.ts`: Remove adjustment-only DTO imports and dead route scaffolding.
- `admin.actions.ts`: Remove dead adjustment admin action.
- `ledger.service.ts`: Add a batch-level issued-ledger lookup for rerun safety.
- `reward-engine.e2e-spec.ts`: Lock the public schema and rerun API behavior.
- `reward.service.spec.ts`: Drive the rerun orchestration and batch-source behavior with failing unit tests first.
- `admin.actions.spec.ts`: Remove mocks for deleted adjustment surface.
- `ledger.service.spec.ts`: Drive the new issued-ledger lookup with a focused unit test.

### Task 1: Lock The New Schema And API Surface In Tests

**Files:**
- Modify: `D:/MyCode/CBBReward-DST/test/integration/reward/reward-engine.e2e-spec.ts`

- [ ] **Step 1: Write the failing integration expectations for `RewardBatchSource` and remove adjustment-route expectations**

Replace the current `RewardBatchType` metadata test and the adjustment route mock usage with this code:

```ts
import { BadRequestException, ConflictException, ValidationPipe } from '@nestjs/common';

it('should expose RewardBatchSource enum and reward batch source field', () => {
  const rewardBatchSource = Prisma.dmmf.datamodel.enums.find(
    (schemaEnum) => schemaEnum.name === 'RewardBatchSource',
  );

  expect(rewardBatchSource).toBeDefined();
  expect(rewardBatchSource?.values.map((value) => value.name)).toEqual(
    expect.arrayContaining(['SCHEDULED', 'RERUN']),
  );

  const rewardBatchFields = getFieldNames('RewardBatch');
  expect(rewardBatchFields).toContain('source');
  expect(rewardBatchFields).toContain('triggeredBy');
  expect(rewardBatchFields).not.toContain('batchType');
  expect(rewardBatchFields).not.toContain('parentPeriod');
  expect(rewardBatchFields).not.toContain('rewardRate');
});

const rewardService = {
  retryFailedRecords: jest.fn().mockResolvedValue(undefined),
  retryRecord: jest.fn().mockResolvedValue(undefined),
  rollbackRecord: jest.fn().mockResolvedValue(undefined),
  rerunQuarterlyReward: jest.fn().mockResolvedValue({ success: true }),
};

it('POST /reward/periods/rerun should surface issued-ledger conflict', async () => {
  rewardService.rerunQuarterlyReward.mockRejectedValueOnce(
    new ConflictException(
      'Cannot rerun period 2026-Q2 because reward beans have already been issued for this batch.',
    ),
  );

  const response = await fetch(`${baseUrl}/reward/periods/rerun`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      period: '2026-Q2',
      authToken: 'secret-token',
    }),
  });

  const body = await response.json();

  expect(response.status).toBe(409);
  expect(body.message).toBe(
    'Cannot rerun period 2026-Q2 because reward beans have already been issued for this batch.',
  );
});
```

Delete the obsolete test block:

```ts
it('POST /reward/batches/:period/adjustments should call createAdjustmentBatch', async () => {
  // delete this entire test
});
```

- [ ] **Step 2: Run the focused integration test and confirm it fails for the expected schema mismatch**

Run:

```bash
npm run test:integration -- test/integration/reward/reward-engine.e2e-spec.ts -t "should expose RewardBatchSource enum and reward batch source field"
```

Expected: `FAIL` because `RewardBatchSource` and `source` do not exist yet in the generated Prisma client metadata.

- [ ] **Step 3: Run the focused rerun-route conflict test and confirm the route still passes through the controller**

Run:

```bash
npm run test:integration -- test/integration/reward/reward-engine.e2e-spec.ts -t "POST /reward/periods/rerun should surface issued-ledger conflict"
```

Expected: `PASS` once the obsolete `createAdjustmentBatch` mock is removed from the test double. If it fails, fix the test setup before changing production code.

### Task 2: Apply The Prisma Model Transition

**Files:**
- Modify: `D:/MyCode/CBBReward-DST/prisma/schema.prisma`
- Create: `D:/MyCode/CBBReward-DST/prisma/migrations/20260611000000_reward_batch_source/migration.sql`

- [ ] **Step 1: Update the Prisma schema to replace batch type with batch source**

Replace the enum and `RewardBatch` fields in `prisma/schema.prisma` with:

```prisma
enum RewardBatchSource {
  SCHEDULED
  RERUN
}

model RewardBatch {
  id          Int               @id @default(autoincrement())
  period      String            @unique
  source      RewardBatchSource @default(SCHEDULED)
  triggeredBy String?
  startDate   DateTime
  endDate     DateTime
  status      RewardBatchStatus @default(PENDING)
  startedAt   DateTime?
  finishedAt  DateTime?
  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt

  records     RewardRecord[]

  @@index([status, createdAt])
}
```

Delete these old schema elements entirely:

```prisma
enum RewardBatchType {
  REGULAR
  ADJUSTMENT
}

batchType   RewardBatchType   @default(REGULAR)
parentPeriod String?
rewardRate  Decimal           @db.Decimal(8, 6)
```

- [ ] **Step 2: Write the manual SQL migration for the field and enum swap**

Create `prisma/migrations/20260611000000_reward_batch_source/migration.sql` with:

```sql
CREATE TYPE "RewardBatchSource" AS ENUM ('SCHEDULED', 'RERUN');

ALTER TABLE "RewardBatch"
  ADD COLUMN "source" "RewardBatchSource" NOT NULL DEFAULT 'SCHEDULED',
  DROP COLUMN "rewardRate",
  DROP COLUMN "parentPeriod",
  DROP COLUMN "batchType";

DROP TYPE "RewardBatchType";
```

This keeps all historical rows and backfills them through the new default.

- [ ] **Step 3: Regenerate the Prisma client**

Run:

```bash
npm run prisma:generate
```

Expected: Prisma client generation completes without schema validation errors.

- [ ] **Step 4: Re-run the schema integration test and confirm it passes**

Run:

```bash
npm run test:integration -- test/integration/reward/reward-engine.e2e-spec.ts -t "should expose RewardBatchSource enum and reward batch source field"
```

Expected: `PASS`

### Task 3: Drive The New Ledger Safety Query And Rerun Orchestration With Failing Unit Tests

**Files:**
- Create: `D:/MyCode/CBBReward-DST/test/unit/modules/ledger/ledger.service.spec.ts`
- Modify: `D:/MyCode/CBBReward-DST/test/unit/modules/reward/reward.service.spec.ts`
- Modify: `D:/MyCode/CBBReward-DST/test/unit/modules/admin/admin.actions.spec.ts`

- [ ] **Step 1: Write the failing `LedgerService.hasIssuedRewardForBatch()` unit test**

Create `test/unit/modules/ledger/ledger.service.spec.ts`:

```ts
import { LedgerType } from '@prisma/client';
import { LedgerService } from '../../../../src/modules/ledger/ledger.service';

describe('LedgerService.hasIssuedRewardForBatch', () => {
  it('returns true when a reward ledger with an external transaction exists for the batch', async () => {
    const count = jest.fn().mockResolvedValue(1);
    const service = new LedgerService({
      beansLedger: { count },
    } as any);

    await expect(service.hasIssuedRewardForBatch(12)).resolves.toBe(true);
    expect(count).toHaveBeenCalledWith({
      where: {
        type: LedgerType.REWARD,
        externalTxnId: { not: null },
        rewardRecord: { batchId: 12 },
      },
    });
  });
});
```

- [ ] **Step 2: Extend `reward.service.spec.ts` with failing tests for source handling and rerun blocking**

Update the imports and add these tests near the existing rerun suite:

```ts
import {
  RewardBatchSource,
  RewardBatchStatus,
  RewardRecordStatus,
} from '@prisma/client';
import { ConflictException } from '@nestjs/common';

it('creates scheduled batches with SCHEDULED source', async () => {
  const create = jest.fn().mockResolvedValue({
    id: 1,
    period: '2026-Q3',
    source: RewardBatchSource.SCHEDULED,
    status: RewardBatchStatus.PENDING,
  });

  const service = new RewardService(
    { rewardBatch: { create } } as unknown as PrismaService,
    {} as OrderService,
    {} as BeansService,
    {} as LedgerService,
    {} as BigcommerceService,
  );

  await (service as any).getOrCreateBatch(
    {
      period: '2026-Q3',
      startDate: new Date('2026-07-01T00:00:00.000Z'),
      endDate: new Date('2026-09-30T23:59:59.000Z'),
    },
    RewardBatchSource.SCHEDULED,
  );

  expect(create).toHaveBeenCalledWith({
    data: {
      period: '2026-Q3',
      startDate: new Date('2026-07-01T00:00:00.000Z'),
      endDate: new Date('2026-09-30T23:59:59.000Z'),
      source: RewardBatchSource.SCHEDULED,
    },
  });
});

it('rejects rerun for a failed batch when reward beans have already been issued', async () => {
  const findUnique = jest.fn().mockResolvedValue({
    id: 1,
    period: '2026-Q3',
    status: RewardBatchStatus.FAILED,
    startDate: new Date('2026-07-01T00:00:00.000Z'),
    endDate: new Date('2026-09-30T23:59:59.000Z'),
  });
  const hasIssuedRewardForBatch = jest.fn().mockResolvedValue(true);

  const service = new RewardService(
    { rewardBatch: { findUnique } } as unknown as PrismaService,
    {} as OrderService,
    {} as BeansService,
    { hasIssuedRewardForBatch } as unknown as LedgerService,
    {} as BigcommerceService,
  );

  await expect(service.rerunQuarterlyReward('2026-Q3', 'silk12345')).rejects.toThrow(
    new ConflictException(
      'Cannot rerun period 2026-Q3 because reward beans have already been issued for this batch.',
    ),
  );
});

it('marks a failed batch as RERUN and clears non-successful records before reprocessing', async () => {
  const batch = {
    id: 1,
    period: '2026-Q3',
    status: RewardBatchStatus.FAILED,
    startDate: new Date('2026-07-01T00:00:00.000Z'),
    endDate: new Date('2026-09-30T23:59:59.000Z'),
  };
  const findUnique = jest.fn().mockResolvedValue(batch);
  const update = jest.fn().mockResolvedValue(undefined);
  const deleteMany = jest.fn().mockResolvedValue({ count: 2 });
  const hasIssuedRewardForBatch = jest.fn().mockResolvedValue(false);

  const service = new RewardService(
    {
      rewardBatch: { findUnique, update },
      rewardRecord: { deleteMany },
    } as unknown as PrismaService,
    {} as OrderService,
    {} as BeansService,
    { hasIssuedRewardForBatch } as unknown as LedgerService,
    {} as BigcommerceService,
  ) as RewardService & {
    runQuarterlyReward(
      period: { period: string; startDate: Date; endDate: Date },
      source?: RewardBatchSource,
    ): Promise<void>;
  };

  const runQuarterlyReward = jest.spyOn(service, 'runQuarterlyReward').mockResolvedValue();

  await expect(service.rerunQuarterlyReward('2026-Q3', 'silk12345')).resolves.toEqual({
    success: true,
  });

  expect(update).toHaveBeenCalledWith({
    where: { id: 1 },
    data: {
      source: RewardBatchSource.RERUN,
      status: RewardBatchStatus.PENDING,
      startedAt: null,
      finishedAt: null,
    },
  });
  expect(deleteMany).toHaveBeenCalledWith({
    where: {
      batchId: 1,
      status: { not: RewardRecordStatus.SUCCESS },
    },
  });
  expect(runQuarterlyReward).toHaveBeenCalledWith(
    {
      period: '2026-Q3',
      startDate: new Date('2026-07-01T00:00:00.000Z'),
      endDate: new Date('2026-09-30T23:59:59.000Z'),
    },
    RewardBatchSource.RERUN,
  );
});
```

Also remove the obsolete adjustment suite at the bottom of the file:

```ts
describe('RewardService.createAdjustmentBatch', () => {
  // delete this entire describe block
});
```

- [ ] **Step 3: Remove stale adjustment mocks from `admin.actions.spec.ts`**

Delete the dead mock property:

```ts
rewardService = {
  retryFailedRecords: jest.fn(),
  retryRecord: jest.fn(),
  rollbackRecord: jest.fn(),
} as unknown as jest.Mocked<RewardService>;
```

- [ ] **Step 4: Run the focused unit tests and confirm they fail for missing production code**

Run:

```bash
npm run test:unit -- test/unit/modules/ledger/ledger.service.spec.ts
npm run test:unit -- test/unit/modules/reward/reward.service.spec.ts -t "creates scheduled batches with SCHEDULED source"
npm run test:unit -- test/unit/modules/reward/reward.service.spec.ts -t "rejects rerun for a failed batch when reward beans have already been issued"
npm run test:unit -- test/unit/modules/reward/reward.service.spec.ts -t "marks a failed batch as RERUN and clears non-successful records before reprocessing"
```

Expected: `FAIL` because `hasIssuedRewardForBatch()`, `RewardBatchSource`, and the new rerun orchestration do not exist yet.

### Task 4: Implement The Source Model, Remove Adjustment Flow, And Enforce Safe Rerun

**Files:**
- Modify: `D:/MyCode/CBBReward-DST/src/modules/ledger/ledger.service.ts`
- Modify: `D:/MyCode/CBBReward-DST/src/modules/reward/reward.service.ts`
- Modify: `D:/MyCode/CBBReward-DST/src/modules/reward/reward.controller.ts`
- Modify: `D:/MyCode/CBBReward-DST/src/modules/admin/admin.actions.ts`
- Delete: `D:/MyCode/CBBReward-DST/src/modules/reward/dto/create-adjustment.request.dto.ts`

- [ ] **Step 1: Add the batch-level issued-ledger lookup to `LedgerService`**

Add this method to `src/modules/ledger/ledger.service.ts`:

```ts
async hasIssuedRewardForBatch(batchId: number): Promise<boolean> {
  const count = await this.prisma.beansLedger.count({
    where: {
      type: LedgerType.REWARD,
      externalTxnId: { not: null },
      rewardRecord: { batchId },
    },
  });

  return count > 0;
}
```

- [ ] **Step 2: Remove adjustment imports and API scaffolding**

Update `src/modules/reward/reward.controller.ts` to remove the dead DTO import and commented adjustment route:

```ts
import { Body, Controller, Param, ParseIntPipe, Post } from '@nestjs/common';
import { RerunQuarterlyRewardRequestDto } from './dto/rerun-quarterly-reward.request.dto';
import { RollbackRecordRequestDto } from './dto/rollback-record.request.dto';
import { RewardService } from './reward.service';

@Controller('reward')
export class RewardController {
  constructor(private readonly rewardService: RewardService) {}

  @Post('batches/:id/retry')
  async retryBatch(@Param('id', ParseIntPipe) batchId: number): Promise<void> {
    await this.rewardService.retryFailedRecords(batchId);
  }

  @Post('records/:id/retry')
  async retryRecord(@Param('id', ParseIntPipe) recordId: number): Promise<void> {
    await this.rewardService.retryRecord(recordId);
  }

  @Post('records/:id/rollback')
  async rollbackRecord(
    @Param('id', ParseIntPipe) recordId: number,
    @Body() body: RollbackRecordRequestDto,
  ): Promise<void> {
    await this.rewardService.rollbackRecord(recordId, body.reason, body.operator);
  }

  @Post('periods/rerun')
  async rerunQuarterlyReward(
    @Body() body: RerunQuarterlyRewardRequestDto,
  ): Promise<{ success: true }> {
    return this.rewardService.rerunQuarterlyReward(body.period, body.authToken);
  }
}
```

Update `src/modules/admin/admin.actions.ts` to remove the deleted adjustment entrypoint:

```ts
import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminRole, AdminUser } from '@prisma/client';
import { RewardService } from '../reward/reward.service';
import { AdminUserService } from '../admin-user/admin-user.service';
import { CreateAdminUserDto } from '../admin-user/dto/create-admin-user.dto';

@Injectable()
export class AdminActionsService {
  constructor(
    private readonly configService: ConfigService,
    private readonly rewardService: RewardService,
    private readonly adminUserService: AdminUserService,
  ) {}

  async retryBatch(batchId: number): Promise<AdminActionResult> {
    await this.rewardService.retryFailedRecords(batchId);
    return { success: true, mode: 'live', message: 'Batch retry executed' };
  }

  async retryRecord(recordId: number): Promise<AdminActionResult> {
    await this.rewardService.retryRecord(recordId);
    return { success: true, mode: 'live', message: 'Record retry executed' };
  }

  async rollbackRecord(recordId: number, reason: string, operator: string): Promise<AdminActionResult> {
    await this.rewardService.rollbackRecord(recordId, reason, operator);
    return { success: true, mode: 'live', message: 'Record rollback executed' };
  }
}
```

Delete `src/modules/reward/dto/create-adjustment.request.dto.ts`.

- [ ] **Step 3: Rework `RewardService` to use `RewardBatchSource` and remove `rewardRate`**

Update the imports and batch creation path:

```ts
import { Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  RewardBatchSource,
  RewardBatchStatus,
  RewardRecordStatus,
} from '@prisma/client';
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import Decimal from 'decimal.js';

async runQuarterlyReward(
  period: QuarterPeriod,
  source: RewardBatchSource = RewardBatchSource.SCHEDULED,
): Promise<void> {
  const batch = await this.getOrCreateBatch(period, source);

  if (batch.status === RewardBatchStatus.COMPLETED) {
    this.logger.log(`Skip completed period=${period.period}`);
    return;
  }

  await this.prisma.rewardBatch.update({
    where: { id: batch.id },
    data: { status: RewardBatchStatus.PROCESSING, startedAt: new Date() },
  });

  const aggregates = await this.orderService.fetchAndAggregateUserOrders(
    period.startDate,
    period.endDate,
  );
  await this.createOrUpdateRewardRecords(batch.id, period.period, aggregates, period.endDate);

  const pendingOrFailedCount = await this.prisma.rewardRecord.count({
    where: {
      batchId: batch.id,
      status: { in: [RewardRecordStatus.PENDING, RewardRecordStatus.FAILED] },
    },
  });

  await this.prisma.rewardBatch.update({
    where: { id: batch.id },
    data: {
      status:
        pendingOrFailedCount === 0
          ? RewardBatchStatus.COMPLETED
          : RewardBatchStatus.PARTIAL_FAILED,
      finishedAt: new Date(),
    },
  });
}

private async getOrCreateBatch(period: QuarterPeriod, source: RewardBatchSource) {
  try {
    return await this.prisma.rewardBatch.create({
      data: {
        period: period.period,
        startDate: period.startDate,
        endDate: period.endDate,
        source,
      },
    });
  } catch {
    return this.prisma.rewardBatch.findUniqueOrThrow({ where: { period: period.period } });
  }
}
```

Delete the entire adjustment-only method:

```ts
async createAdjustmentBatch(dto: CreateAdjustmentRequestDto) {
  // delete this method
}
```

- [ ] **Step 4: Implement the rerun safety gate and failed-batch reset flow**

Replace the current `rerunQuarterlyReward()` logic with:

```ts
async rerunQuarterlyReward(
  period: string,
  authToken: string,
): Promise<{ success: true }> {
  if (authToken !== process.env.AUTH_TOKEN) {
    throw new UnauthorizedException('Invalid auth token');
  }

  const quarter = this.parseQuarterPeriod(period);
  this.assertQuarterEndedForRerun(quarter);
  const batch = await this.prisma.rewardBatch.findUnique({
    where: { period: quarter.period },
  });

  if (
    batch &&
    [
      RewardBatchStatus.PENDING,
      RewardBatchStatus.PROCESSING,
      RewardBatchStatus.COMPLETED,
      RewardBatchStatus.PARTIAL_FAILED,
    ].includes(batch.status)
  ) {
    throw new BadRequestException(
      `Cannot rerun period ${quarter.period} because batch status is ${batch.status}.`,
    );
  }

  if (batch?.status === RewardBatchStatus.FAILED) {
    const hasIssuedReward = await this.ledgerService.hasIssuedRewardForBatch(batch.id);
    if (hasIssuedReward) {
      throw new ConflictException(
        `Cannot rerun period ${quarter.period} because reward beans have already been issued for this batch.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.rewardBatch.update({
        where: { id: batch.id },
        data: {
          source: RewardBatchSource.RERUN,
          status: RewardBatchStatus.PENDING,
          startedAt: null,
          finishedAt: null,
        },
      });

      await tx.rewardRecord.deleteMany({
        where: {
          batchId: batch.id,
          status: { not: RewardRecordStatus.SUCCESS },
        },
      });
    });
  }

  void this.runQuarterlyReward(quarter, RewardBatchSource.RERUN);

  return { success: true };
}
```

- [ ] **Step 5: Prevent stale non-successful records from surviving zero-reward recalculation**

Update the zero-reward branch in `createOrUpdateRewardRecords()`:

```ts
if (rewards.totalReward.equals(0)) {
  await this.prisma.rewardRecord.deleteMany({
    where: {
      batchId,
      customerId: item.customerId,
      status: { not: RewardRecordStatus.SUCCESS },
    },
  });
  continue;
}
```

This keeps rerun cleanup aligned with the approved design and prevents old failed or pending rows from surviving when a customer no longer qualifies.

- [ ] **Step 6: Re-run the focused unit tests and confirm they pass**

Run:

```bash
npm run test:unit -- test/unit/modules/ledger/ledger.service.spec.ts
npm run test:unit -- test/unit/modules/reward/reward.service.spec.ts -t "creates scheduled batches with SCHEDULED source"
npm run test:unit -- test/unit/modules/reward/reward.service.spec.ts -t "rejects rerun for a failed batch when reward beans have already been issued"
npm run test:unit -- test/unit/modules/reward/reward.service.spec.ts -t "marks a failed batch as RERUN and clears non-successful records before reprocessing"
```

Expected: `PASS`

### Task 5: Run The Full Focused Verification Set

**Files:**
- Modify: `D:/MyCode/CBBReward-DST/test/integration/reward/reward-engine.e2e-spec.ts`
- Modify: `D:/MyCode/CBBReward-DST/test/unit/modules/reward/reward.service.spec.ts`
- Modify: `D:/MyCode/CBBReward-DST/test/unit/modules/admin/admin.actions.spec.ts`
- Create: `D:/MyCode/CBBReward-DST/test/unit/modules/ledger/ledger.service.spec.ts`

- [ ] **Step 1: Run the reward-focused unit suite**

Run:

```bash
npm run test:unit -- test/unit/modules/reward/reward.service.spec.ts
npm run test:unit -- test/unit/modules/admin/admin.actions.spec.ts
npm run test:unit -- test/unit/modules/ledger/ledger.service.spec.ts
```

Expected: `PASS`

- [ ] **Step 2: Run the reward integration suite**

Run:

```bash
npm run test:integration -- test/integration/reward/reward-engine.e2e-spec.ts
```

Expected: `PASS`

- [ ] **Step 3: Run a compile check for the cleaned API surface**

Run:

```bash
npm run build
```

Expected: NestJS compilation succeeds without references to `CreateAdjustmentRequestDto`, `RewardBatchType`, `parentPeriod`, or `rewardRate`.

## Self-Review

### Spec Coverage

- Remove adjustment workflow: covered by Task 1 test cleanup and Task 4 dead-code removal.
- Remove `rewardRate`: covered by Task 2 schema change and Task 4 `RewardService` refactor.
- Remove `parentPeriod` and `ADJUSTMENT`: covered by Task 2 schema change and Task 3/Task 4 test and code cleanup.
- Add `RewardBatchSource`: covered by Task 1 metadata test, Task 2 schema/migration, and Task 4 service refactor.
- Keep lifecycle status separate from trigger source: covered by Task 4 rerun logic and scheduled batch source test.
- Block rerun when `BeansLedger` already proves issuance: covered by Task 3 failing tests and Task 4 ledger/service implementation.
- Return explicit rerun API messages: covered by Task 1 route conflict test and Task 4 rerun message implementation.

### Placeholder Scan

- No placeholder markers remain in executable steps.
- Every code-changing step includes concrete code.
- Every verification step includes exact commands and expected outcomes.

### Type Consistency

- `RewardBatchSource` is the only new batch-origin enum used across schema, tests, and service code.
- `runQuarterlyReward(period, source)` and `getOrCreateBatch(period, source)` use the same source model everywhere in the plan.
- `hasIssuedRewardForBatch(batchId)` is the single ledger safety interface referenced by both tests and implementation.
