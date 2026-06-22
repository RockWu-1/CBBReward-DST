# Task Audit Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single audit-focused `Task` table that records reward operational actions such as scheduled period runs, reruns, retries, and rollbacks.

**Architecture:** Add a new Prisma-backed `Task` model and a dedicated `TaskService` to centralize creation and status updates. Create tasks at operation entry points in scheduler, admin, and controller layers, then update status and result data inside reward execution flows without introducing a job orchestration system.

**Tech Stack:** NestJS, Prisma, PostgreSQL, Jest, TypeScript

---

## File Map

- Modify: `prisma/schema.prisma`
  - Add `TaskType`, `TaskTriggerSource`, and `TaskStatus` enums plus the `Task` model and relations from `RewardBatch` and `RewardRecord`.
- Create: `src/modules/task/task.service.ts`
  - Encapsulate all task creation and state transition writes.
- Create: `src/modules/task/task.module.ts`
  - Export `TaskService` for scheduler, reward, and admin usage.
- Modify: `src/app.module.ts`
  - Register `TaskModule`.
- Modify: `src/modules/reward/reward.module.ts`
  - Import `TaskModule`.
- Modify: `src/modules/admin/admin.module.ts`
  - Import `TaskModule`.
- Modify: `src/modules/scheduler/scheduler.module.ts`
  - Import `TaskModule` if the scheduler module does not already reach `TaskService` through imports.
- Modify: `src/modules/admin/admin.actions.ts`
  - Create admin-originated tasks with `triggeredBy` and request metadata.
- Modify: `src/modules/reward/reward.controller.ts`
  - Create API-originated tasks for non-admin entry points and pass task ids into reward service methods.
- Modify: `src/modules/reward/reward.service.ts`
  - Mark tasks `RUNNING`, `SUCCESS`, `FAILED`, or `PARTIAL_FAILED` and record summaries for each supported operation.
- Modify: `src/modules/scheduler/quarterly-reward.scheduler.ts`
  - Create scheduler-originated period run tasks.
- Create: `test/unit/modules/task/task.service.spec.ts`
  - Unit coverage for task creation and state transitions.
- Modify: `test/unit/modules/admin/admin.actions.spec.ts`
  - Verify admin actions create task rows and pass task ids downstream.
- Modify: `test/unit/modules/reward/reward.service.spec.ts`
  - Verify reward flows update tasks with the correct status and payloads.
- Modify: `test/unit/modules/scheduler/quarterly-reward.scheduler.spec.ts`
  - Verify scheduler creates `PERIOD_RUN` task records before execution.
- Modify: `test/integration/reward/reward-engine.e2e-spec.ts`
  - Verify controller-originated task creation for reward endpoints.

### Task 1: Add the Prisma audit model and schema coverage

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `test/integration/reward/reward-engine.e2e-spec.ts`

- [ ] **Step 1: Write the failing schema metadata tests**

```ts
  it('should expose Task enums and relations for operational audit records', () => {
    const taskType = Prisma.dmmf.datamodel.enums.find((schemaEnum) => schemaEnum.name === 'TaskType');
    const taskStatus = Prisma.dmmf.datamodel.enums.find((schemaEnum) => schemaEnum.name === 'TaskStatus');
    const triggerSource = Prisma.dmmf.datamodel.enums.find(
      (schemaEnum) => schemaEnum.name === 'TaskTriggerSource',
    );
    const taskFields = getFieldNames('Task');

    expect(taskType?.values.map((value) => value.name)).toEqual(
      expect.arrayContaining([
        'PERIOD_RUN',
        'PERIOD_RERUN',
        'BATCH_RETRY',
        'RECORD_RETRY',
        'RECORD_RETRY_BULK',
        'RECORD_ROLLBACK',
      ]),
    );
    expect(taskStatus?.values.map((value) => value.name)).toEqual(
      expect.arrayContaining(['PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'PARTIAL_FAILED']),
    );
    expect(triggerSource?.values.map((value) => value.name)).toEqual(
      expect.arrayContaining(['SCHEDULER', 'ADMIN', 'API', 'SYSTEM']),
    );
    expect(taskFields).toEqual(
      expect.arrayContaining([
        'taskType',
        'triggerSource',
        'status',
        'title',
        'period',
        'rewardBatchId',
        'rewardRecordId',
        'targetIds',
        'triggeredBy',
        'requestPayload',
        'resultPayload',
        'errorMessage',
        'startedAt',
        'finishedAt',
      ]),
    );
  });
```

- [ ] **Step 2: Run the integration test to verify it fails**

Run: `npx jest --config test/jest.integration.json test/integration/reward/reward-engine.e2e-spec.ts -t "Task enums and relations"`
Expected: FAIL because the Prisma schema does not define `Task`, `TaskType`, `TaskTriggerSource`, or `TaskStatus` yet.

- [ ] **Step 3: Add the minimal Prisma schema changes**

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

model RewardBatch {
  ...
  tasks Task[]
}

model RewardRecord {
  ...
  tasks Task[]
}
```

- [ ] **Step 4: Run the integration test to verify it passes**

Run: `npx jest --config test/jest.integration.json test/integration/reward/reward-engine.e2e-spec.ts -t "Task enums and relations"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma test/integration/reward/reward-engine.e2e-spec.ts
git commit -m "feat: add task audit schema"
```

### Task 2: Add the dedicated TaskService

**Files:**
- Create: `src/modules/task/task.service.ts`
- Create: `src/modules/task/task.module.ts`
- Modify: `src/app.module.ts`
- Modify: `test/unit/modules/task/task.service.spec.ts`

- [ ] **Step 1: Write the failing TaskService unit tests**

```ts
describe('TaskService', () => {
  it('creates a task with PENDING status and persisted metadata', async () => {
    const create = jest.fn().mockResolvedValue({ id: 88, status: 'PENDING' });
    const service = new TaskService({
      task: { create, update: jest.fn() },
    } as any);

    await service.createTask({
      taskType: 'RECORD_RETRY_BULK',
      triggerSource: 'ADMIN',
      title: 'Bulk retry for 3 reward records',
      targetIds: [1, 2, 3],
      triggeredBy: 'admin@test.com',
      requestPayload: { recordIds: [1, 2, 3] },
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskType: 'RECORD_RETRY_BULK',
        triggerSource: 'ADMIN',
        status: 'PENDING',
        title: 'Bulk retry for 3 reward records',
        targetIds: [1, 2, 3],
        triggeredBy: 'admin@test.com',
      }),
    });
  });

  it('marks a task as PARTIAL_FAILED with result payload and finish time', async () => {
    const update = jest.fn().mockResolvedValue({ id: 88, status: 'PARTIAL_FAILED' });
    const service = new TaskService({
      task: { create: jest.fn(), update },
    } as any);

    await service.markPartialFailed(88, {
      requestedCount: 3,
      successCount: 2,
      failedCount: 1,
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: 88 },
      data: expect.objectContaining({
        status: 'PARTIAL_FAILED',
        resultPayload: {
          requestedCount: 3,
          successCount: 2,
          failedCount: 1,
        },
        finishedAt: expect.any(Date),
      }),
    });
  });
});
```

- [ ] **Step 2: Run the unit test to verify it fails**

Run: `npx jest --config test/jest.unit.json test/unit/modules/task/task.service.spec.ts`
Expected: FAIL because `TaskService` and `TaskModule` do not exist yet.

- [ ] **Step 3: Add the minimal TaskService and module**

```ts
// src/modules/task/task.service.ts
import { Injectable } from '@nestjs/common';
import { Prisma, TaskStatus, TaskTriggerSource, TaskType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

type CreateTaskInput = {
  taskType: TaskType;
  triggerSource: TaskTriggerSource;
  title: string;
  period?: string;
  rewardBatchId?: number;
  rewardRecordId?: number;
  targetIds?: Prisma.JsonValue;
  triggeredBy?: string;
  requestPayload?: Prisma.JsonValue;
};

@Injectable()
export class TaskService {
  constructor(private readonly prisma: PrismaService) {}

  createTask(input: CreateTaskInput) {
    return this.prisma.task.create({
      data: {
        ...input,
        status: TaskStatus.PENDING,
      },
    });
  }

  markRunning(taskId: number) {
    return this.prisma.task.update({
      where: { id: taskId },
      data: { status: TaskStatus.RUNNING, startedAt: new Date() },
    });
  }

  markSuccess(taskId: number, resultPayload?: Prisma.JsonValue) {
    return this.prisma.task.update({
      where: { id: taskId },
      data: {
        status: TaskStatus.SUCCESS,
        resultPayload: resultPayload ?? Prisma.JsonNull,
        finishedAt: new Date(),
      },
    });
  }

  markFailed(taskId: number, errorMessage: string, resultPayload?: Prisma.JsonValue) {
    return this.prisma.task.update({
      where: { id: taskId },
      data: {
        status: TaskStatus.FAILED,
        errorMessage,
        resultPayload: resultPayload ?? Prisma.JsonNull,
        finishedAt: new Date(),
      },
    });
  }

  markPartialFailed(taskId: number, resultPayload: Prisma.JsonValue) {
    return this.prisma.task.update({
      where: { id: taskId },
      data: {
        status: TaskStatus.PARTIAL_FAILED,
        resultPayload,
        finishedAt: new Date(),
      },
    });
  }
}
```

```ts
// src/modules/task/task.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { TaskService } from './task.service';

@Module({
  imports: [PrismaModule],
  providers: [TaskService],
  exports: [TaskService],
})
export class TaskModule {}
```

```ts
// src/app.module.ts
import { TaskModule } from './modules/task/task.module';

@Module({
  imports: [
    ...,
    TaskModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `npx jest --config test/jest.unit.json test/unit/modules/task/task.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/task/task.service.ts src/modules/task/task.module.ts src/app.module.ts test/unit/modules/task/task.service.spec.ts
git commit -m "feat: add task audit service"
```

### Task 3: Create tasks at admin and API entry points

**Files:**
- Modify: `src/modules/admin/admin.module.ts`
- Modify: `src/modules/admin/admin.actions.ts`
- Modify: `src/modules/reward/reward.module.ts`
- Modify: `src/modules/reward/reward.controller.ts`
- Modify: `test/unit/modules/admin/admin.actions.spec.ts`
- Modify: `test/integration/reward/reward-engine.e2e-spec.ts`

- [ ] **Step 1: Write the failing admin and controller tests**

```ts
  const taskService = {
    createTask: jest.fn().mockResolvedValue({ id: 77 }),
  };

  it('creates a RECORD_RETRY_BULK task before scheduling bulk retry', async () => {
    await service.retryRecords([10, 20, 30], 'admin@test.com');

    expect(taskService.createTask).toHaveBeenCalledWith({
      taskType: 'RECORD_RETRY_BULK',
      triggerSource: 'ADMIN',
      title: 'Bulk retry for 3 reward records',
      targetIds: [10, 20, 30],
      triggeredBy: 'admin@test.com',
      requestPayload: { recordIds: [10, 20, 30] },
    });
    expect(rewardService.retryRecords).toHaveBeenCalledWith([10, 20, 30], 77);
  });
```

```ts
  it('POST /reward/records/retry should create API task and return accepted', async () => {
    const response = await fetch(`${baseUrl}/reward/records/retry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [1, 2, 3] }),
    });

    expect(response.status).toBe(202);
    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: 'RECORD_RETRY_BULK',
        triggerSource: 'API',
      }),
    );
    expect(rewardService.retryRecords).toHaveBeenCalledWith([1, 2, 3], 91);
  });
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npx jest --config test/jest.unit.json test/unit/modules/admin/admin.actions.spec.ts -t "creates a RECORD_RETRY_BULK task"`
Expected: FAIL because `AdminActionsService` does not inject `TaskService` or pass task ids.

Run: `npx jest --config test/jest.integration.json test/integration/reward/reward-engine.e2e-spec.ts -t "create API task"`
Expected: FAIL because `RewardController` does not create tasks.

- [ ] **Step 3: Add minimal entry-point task creation**

```ts
// src/modules/admin/admin.actions.ts
constructor(
  private readonly configService: ConfigService,
  private readonly rewardService: RewardService,
  private readonly adminUserService: AdminUserService,
  private readonly taskService: TaskService,
) {}

async retryRecords(recordIds: number[], operator = 'admin'): Promise<AdminActionResult> {
  const task = await this.taskService.createTask({
    taskType: TaskType.RECORD_RETRY_BULK,
    triggerSource: TaskTriggerSource.ADMIN,
    title: `Bulk retry for ${recordIds.length} reward records`,
    targetIds: recordIds,
    triggeredBy: operator,
    requestPayload: { recordIds },
  });
  void this.rewardService.retryRecords(recordIds, task.id);
  return { success: true, mode: 'live', message: 'Batch record retry scheduled' };
}
```

```ts
// src/modules/reward/reward.controller.ts
constructor(
  private readonly rewardService: RewardService,
  private readonly taskService: TaskService,
) {}

@Post('records/retry')
@HttpCode(HttpStatus.ACCEPTED)
async retryRecords(@Body() body: RetryRecordsRequestDto): Promise<{ accepted: true }> {
  const task = await this.taskService.createTask({
    taskType: TaskType.RECORD_RETRY_BULK,
    triggerSource: TaskTriggerSource.API,
    title: `Bulk retry for ${body.ids.length} reward records`,
    targetIds: body.ids,
    triggeredBy: 'api',
    requestPayload: { recordIds: body.ids },
  });
  void this.rewardService.retryRecords(body.ids, task.id);
  return { accepted: true };
}
```

Also update `RewardModule` and `AdminModule` imports to include `TaskModule`.

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `npx jest --config test/jest.unit.json test/unit/modules/admin/admin.actions.spec.ts -t "creates a RECORD_RETRY_BULK task"`
Expected: PASS

Run: `npx jest --config test/jest.integration.json test/integration/reward/reward-engine.e2e-spec.ts -t "create API task"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/admin/admin.module.ts src/modules/admin/admin.actions.ts src/modules/reward/reward.module.ts src/modules/reward/reward.controller.ts test/unit/modules/admin/admin.actions.spec.ts test/integration/reward/reward-engine.e2e-spec.ts
git commit -m "feat: create task audit records at entry points"
```

### Task 4: Update reward execution flows to drive task status

**Files:**
- Modify: `src/modules/reward/reward.service.ts`
- Modify: `src/modules/scheduler/quarterly-reward.scheduler.ts`
- Modify: `src/modules/scheduler/scheduler.module.ts`
- Modify: `test/unit/modules/reward/reward.service.spec.ts`
- Modify: `test/unit/modules/scheduler/quarterly-reward.scheduler.spec.ts`

- [ ] **Step 1: Write the failing task-status unit tests**

```ts
describe('RewardService.retryRecords task auditing', () => {
  it('marks a bulk retry task PARTIAL_FAILED when one record retry fails', async () => {
    const taskService = {
      markRunning: jest.fn().mockResolvedValue(undefined),
      markPartialFailed: jest.fn().mockResolvedValue(undefined),
      markSuccess: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    const service = new RewardService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      taskService as any,
    );
    jest.spyOn(service, 'retryRecord')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    await service.retryRecords([11, 12, 13], 99);

    expect(taskService.markRunning).toHaveBeenCalledWith(99);
    expect(taskService.markPartialFailed).toHaveBeenCalledWith(99, {
      requestedCount: 3,
      deduplicatedCount: 3,
      successCount: 2,
      failedCount: 1,
      failedRecordIds: [12],
    });
  });
});
```

```ts
describe('QuarterlyRewardScheduler task auditing', () => {
  it('creates a PERIOD_RUN task before invoking reward execution', async () => {
    const taskService = {
      createTask: jest.fn().mockResolvedValue({ id: 501 }),
    };
    const rewardService = {
      getPreviousQuarter: jest.fn().mockReturnValue({
        period: '2026-Q1',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2026-03-31T23:59:59.000Z'),
      }),
      runQuarterlyReward: jest.fn().mockResolvedValue(undefined),
    };
    const scheduler = new QuarterlyRewardScheduler(rewardService as any, taskService as any);

    await scheduler.handleDailyCheck();

    expect(taskService.createTask).toHaveBeenCalledWith({
      taskType: 'PERIOD_RUN',
      triggerSource: 'SCHEDULER',
      title: 'Scheduled period run for 2026-Q1',
      period: '2026-Q1',
      triggeredBy: 'scheduler',
      requestPayload: { source: 'SCHEDULED' },
    });
    expect(rewardService.runQuarterlyReward).toHaveBeenCalledWith(
      expect.objectContaining({ period: '2026-Q1' }),
      undefined,
      501,
    );
  });
});
```

- [ ] **Step 2: Run the unit tests to verify they fail**

Run: `npx jest --config test/jest.unit.json test/unit/modules/reward/reward.service.spec.ts -t "task auditing"`
Expected: FAIL because reward methods do not accept task ids or update task state.

Run: `npx jest --config test/jest.unit.json test/unit/modules/scheduler/quarterly-reward.scheduler.spec.ts`
Expected: FAIL because scheduler does not inject `TaskService` or create tasks.

- [ ] **Step 3: Implement minimal task-state integration**

```ts
// reward.service.ts constructor
constructor(
  private readonly prisma: PrismaService,
  private readonly orderService: OrderService,
  private readonly beansService: BeansService,
  private readonly ledgerService: LedgerService,
  private readonly bigcommerce: BigcommerceService,
  private readonly rewardCalculator: RewardCalculatorService = new RewardCalculatorService(),
  private readonly taskService?: TaskService,
) {}
```

```ts
async retryRecords(recordIds: number[], taskId?: number): Promise<void> {
  const uniqueRecordIds = [...new Set(recordIds)];
  const failedRecordIds: number[] = [];
  let successCount = 0;

  if (taskId) {
    await this.taskService?.markRunning(taskId);
  }

  for (const recordId of uniqueRecordIds) {
    try {
      await this.retryRecord(recordId);
      successCount += 1;
    } catch (error) {
      failedRecordIds.push(recordId);
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Bulk retry failed for reward record ${recordId}: ${message}`);
    }
  }

  if (!taskId) return;

  const resultPayload = {
    requestedCount: recordIds.length,
    deduplicatedCount: uniqueRecordIds.length,
    successCount,
    failedCount: failedRecordIds.length,
    failedRecordIds,
  };

  if (failedRecordIds.length && successCount) {
    await this.taskService?.markPartialFailed(taskId, resultPayload);
    return;
  }
  if (failedRecordIds.length) {
    await this.taskService?.markFailed(taskId, 'Bulk retry failed for all requested records', resultPayload);
    return;
  }
  await this.taskService?.markSuccess(taskId, resultPayload);
}
```

```ts
// quarterly-reward.scheduler.ts
constructor(
  private readonly rewardService: RewardService,
  private readonly taskService: TaskService,
) {}

const task = await this.taskService.createTask({
  taskType: TaskType.PERIOD_RUN,
  triggerSource: TaskTriggerSource.SCHEDULER,
  title: `Scheduled period run for ${currentQuarterTarget.period}`,
  period: currentQuarterTarget.period,
  triggeredBy: 'scheduler',
  requestPayload: { source: 'SCHEDULED' },
});
await this.rewardService.runQuarterlyReward(currentQuarterTarget, undefined, task.id);
```

Also extend `runQuarterlyReward`, `retryFailedRecords`, `retryRecord`, and `rollbackRecord` signatures as needed so task ids can be propagated without changing operation semantics.

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `npx jest --config test/jest.unit.json test/unit/modules/reward/reward.service.spec.ts -t "task auditing"`
Expected: PASS

Run: `npx jest --config test/jest.unit.json test/unit/modules/scheduler/quarterly-reward.scheduler.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/reward/reward.service.ts src/modules/scheduler/quarterly-reward.scheduler.ts src/modules/scheduler/scheduler.module.ts test/unit/modules/reward/reward.service.spec.ts test/unit/modules/scheduler/quarterly-reward.scheduler.spec.ts
git commit -m "feat: track task audit status in reward flows"
```

### Task 5: Final focused verification

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/modules/task/task.service.ts`
- Create: `src/modules/task/task.module.ts`
- Modify: `src/app.module.ts`
- Modify: `src/modules/reward/reward.module.ts`
- Modify: `src/modules/admin/admin.module.ts`
- Modify: `src/modules/scheduler/scheduler.module.ts`
- Modify: `src/modules/admin/admin.actions.ts`
- Modify: `src/modules/reward/reward.controller.ts`
- Modify: `src/modules/reward/reward.service.ts`
- Modify: `src/modules/scheduler/quarterly-reward.scheduler.ts`
- Create: `test/unit/modules/task/task.service.spec.ts`
- Modify: `test/unit/modules/admin/admin.actions.spec.ts`
- Modify: `test/unit/modules/reward/reward.service.spec.ts`
- Modify: `test/unit/modules/scheduler/quarterly-reward.scheduler.spec.ts`
- Modify: `test/integration/reward/reward-engine.e2e-spec.ts`

- [ ] **Step 1: Run the focused verification set**

Run: `npx jest --config test/jest.unit.json test/unit/modules/task/task.service.spec.ts test/unit/modules/admin/admin.actions.spec.ts test/unit/modules/reward/reward.service.spec.ts test/unit/modules/scheduler/quarterly-reward.scheduler.spec.ts`
Expected: PASS

Run: `npx jest --config test/jest.integration.json test/integration/reward/reward-engine.e2e-spec.ts`
Expected: PASS

- [ ] **Step 2: Re-read the spec and diff**

Checklist:
- `Task` model and enums exist
- entry points create one task per operation
- reward service updates task status and summaries
- bulk retry uses one task row, not one per record
- first version covers scheduler, rerun, retry, bulk retry, and rollback
- no task-event or parent-task architecture was introduced

- [ ] **Step 3: Commit final implementation**

```bash
git add prisma/schema.prisma src/app.module.ts src/modules/task/task.service.ts src/modules/task/task.module.ts src/modules/reward/reward.module.ts src/modules/admin/admin.module.ts src/modules/scheduler/scheduler.module.ts src/modules/admin/admin.actions.ts src/modules/reward/reward.controller.ts src/modules/reward/reward.service.ts src/modules/scheduler/quarterly-reward.scheduler.ts test/unit/modules/task/task.service.spec.ts test/unit/modules/admin/admin.actions.spec.ts test/unit/modules/reward/reward.service.spec.ts test/unit/modules/scheduler/quarterly-reward.scheduler.spec.ts test/integration/reward/reward-engine.e2e-spec.ts
git commit -m "feat: add task audit trail for reward operations"
```
