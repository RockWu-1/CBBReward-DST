# Bulk Retry Reward Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an asynchronous bulk reward-record retry entrypoint and AdminJS bulk action so admins can trigger retries for multiple selected reward records without waiting in the UI.

**Architecture:** Extend the existing reward retry flow instead of introducing a new queue system. The backend adds a validated bulk endpoint and a `RewardService.retryRecords` wrapper that reuses `retryRecord`; the admin layer adds one bulk action that forwards selected ids and reports scheduling-style feedback.

**Tech Stack:** NestJS, AdminJS, Jest, TypeScript, class-validator

---

## File Map

- Create: `src/modules/reward/dto/retry-records.request.dto.ts`
  - Validates the bulk retry request body.
- Modify: `src/modules/reward/reward.controller.ts`
  - Adds the bulk retry route and accepted response behavior.
- Modify: `src/modules/reward/reward.service.ts`
  - Adds asynchronous bulk retry orchestration that reuses `retryRecord`.
- Modify: `src/modules/admin/admin.actions.ts`
  - Adds the admin-facing bulk retry action method.
- Modify: `src/modules/admin/admin.config.ts`
  - Adds an AdminJS bulk action for selected reward records.
- Modify: `test/integration/reward/reward-engine.e2e-spec.ts`
  - Adds route coverage for the new backend endpoint.
- Modify: `test/unit/modules/reward/reward.service.spec.ts`
  - Adds `retryRecords` unit tests.
- Modify: `test/unit/modules/admin/admin.actions.spec.ts`
  - Adds unit coverage for the new admin action service method.

### Task 1: Add backend route coverage first

**Files:**
- Modify: `test/integration/reward/reward-engine.e2e-spec.ts`
- Modify: `src/modules/reward/reward.controller.ts`
- Create: `src/modules/reward/dto/retry-records.request.dto.ts`

- [ ] **Step 1: Write the failing integration tests**

```ts
  const rewardService = {
    retryFailedRecords: jest.fn().mockResolvedValue(undefined),
    retryRecord: jest.fn().mockResolvedValue(undefined),
    retryRecords: jest.fn().mockResolvedValue(undefined),
    rollbackRecord: jest.fn().mockResolvedValue(undefined),
    rerunQuarterlyReward: jest.fn().mockResolvedValue(undefined),
  };

  it('POST /reward/records/retry should call retryRecords with ids', async () => {
    const response = await fetch(`${baseUrl}/reward/records/retry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [1, 2, 3] }),
    });

    expect(response.status).toBe(201);
    expect(rewardService.retryRecords).toHaveBeenCalledWith([1, 2, 3]);
  });

  it('POST /reward/records/retry should validate payload', async () => {
    const response = await fetch(`${baseUrl}/reward/records/retry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [] }),
    });

    expect(response.status).toBe(400);
    expect(rewardService.retryRecords).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the integration test to verify it fails**

Run: `npm test -- test/integration/reward/reward-engine.e2e-spec.ts -t "POST /reward/records/retry"`
Expected: FAIL because `retryRecords` route/DTO do not exist yet.

- [ ] **Step 3: Add the minimal DTO and controller route**

```ts
// src/modules/reward/dto/retry-records.request.dto.ts
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt } from 'class-validator';

export class RetryRecordsRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @Type(() => Number)
  @IsInt({ each: true })
  ids!: number[];
}
```

```ts
// src/modules/reward/reward.controller.ts
import { Body, Controller, HttpCode, HttpStatus, Param, ParseIntPipe, Post } from '@nestjs/common';
import { RetryRecordsRequestDto } from './dto/retry-records.request.dto';

@Post('records/retry')
@HttpCode(HttpStatus.ACCEPTED)
async retryRecords(@Body() body: RetryRecordsRequestDto): Promise<{ accepted: true }> {
  void this.rewardService.retryRecords(body.ids);
  return { accepted: true };
}
```

- [ ] **Step 4: Run the integration test to verify it passes**

Run: `npm test -- test/integration/reward/reward-engine.e2e-spec.ts -t "POST /reward/records/retry"`
Expected: PASS with both new route assertions green.

- [ ] **Step 5: Commit**

```bash
git add test/integration/reward/reward-engine.e2e-spec.ts src/modules/reward/reward.controller.ts src/modules/reward/dto/retry-records.request.dto.ts
git commit -m "test: cover bulk reward record retry route"
```

### Task 2: Add reward service bulk retry orchestration

**Files:**
- Modify: `test/unit/modules/reward/reward.service.spec.ts`
- Modify: `src/modules/reward/reward.service.ts`

- [ ] **Step 1: Write the failing unit tests**

```ts
describe('RewardService.retryRecords', () => {
  it('deduplicates ids and retries each unique record once', async () => {
    const service = new RewardService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const retryRecordSpy = jest
      .spyOn(service, 'retryRecord')
      .mockResolvedValue(undefined);

    await service.retryRecords([3, 3, 5, 7, 5]);

    expect(retryRecordSpy).toHaveBeenCalledTimes(3);
    expect(retryRecordSpy).toHaveBeenNthCalledWith(1, 3);
    expect(retryRecordSpy).toHaveBeenNthCalledWith(2, 5);
    expect(retryRecordSpy).toHaveBeenNthCalledWith(3, 7);
  });

  it('continues retrying later ids when one retryRecord call fails', async () => {
    const service = new RewardService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const retryRecordSpy = jest
      .spyOn(service, 'retryRecord')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await expect(service.retryRecords([11, 12, 13])).resolves.toBeUndefined();
    expect(retryRecordSpy).toHaveBeenNthCalledWith(1, 11);
    expect(retryRecordSpy).toHaveBeenNthCalledWith(2, 12);
    expect(retryRecordSpy).toHaveBeenNthCalledWith(3, 13);
  });
});
```

- [ ] **Step 2: Run the unit tests to verify they fail**

Run: `npm test -- test/unit/modules/reward/reward.service.spec.ts -t "RewardService.retryRecords"`
Expected: FAIL because `retryRecords` does not exist yet.

- [ ] **Step 3: Add the minimal service implementation**

```ts
async retryRecords(recordIds: number[]): Promise<void> {
  const uniqueRecordIds = [...new Set(recordIds)];

  for (const recordId of uniqueRecordIds) {
    try {
      await this.retryRecord(recordId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Bulk retry failed for reward record ${recordId}: ${message}`);
    }
  }
}
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `npm test -- test/unit/modules/reward/reward.service.spec.ts -t "RewardService.retryRecords"`
Expected: PASS with both bulk retry tests green.

- [ ] **Step 5: Commit**

```bash
git add test/unit/modules/reward/reward.service.spec.ts src/modules/reward/reward.service.ts
git commit -m "feat: add bulk reward record retry service"
```

### Task 3: Add admin action service coverage

**Files:**
- Modify: `test/unit/modules/admin/admin.actions.spec.ts`
- Modify: `src/modules/admin/admin.actions.ts`

- [ ] **Step 1: Write the failing unit test**

```ts
  it('should schedule bulk record retry through reward service', async () => {
    const result = await service.retryRecords([10, 20, 30]);

    expect(result).toEqual({
      success: true,
      mode: 'live',
      message: 'Batch record retry scheduled',
    });
    expect(rewardService.retryRecords).toHaveBeenCalledWith([10, 20, 30]);
  });
```

- [ ] **Step 2: Run the unit test to verify it fails**

Run: `npm test -- test/unit/modules/admin/admin.actions.spec.ts -t "should schedule bulk record retry through reward service"`
Expected: FAIL because `AdminActionsService.retryRecords` does not exist yet.

- [ ] **Step 3: Add the minimal admin action service method**

```ts
async retryRecords(recordIds: number[]): Promise<AdminActionResult> {
  void this.rewardService.retryRecords(recordIds);
  return { success: true, mode: 'live', message: 'Batch record retry scheduled' };
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `npm test -- test/unit/modules/admin/admin.actions.spec.ts -t "should schedule bulk record retry through reward service"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/unit/modules/admin/admin.actions.spec.ts src/modules/admin/admin.actions.ts
git commit -m "feat: add admin bulk reward retry action service"
```

### Task 4: Add AdminJS bulk action

**Files:**
- Modify: `src/modules/admin/admin.config.ts`

- [ ] **Step 1: Add the bulk action next to the existing record action**

```ts
              retryRecords: {
                actionType: 'bulk',
                icon: 'Play',
                label: 'Retry Selected',
                guard: 'Are you sure you want to retry the selected reward records?',
                component: false,
                isVisible: (context: any) =>
                  Array.isArray(context.records) &&
                  context.records.some((record: any) =>
                    canRetryRecord(String(record?.params?.status ?? '')),
                  ),
                isAccessible: (context: any) =>
                  Array.isArray(context.records) &&
                  context.records.some((record: any) =>
                    canRetryRecord(String(record?.params?.status ?? '')),
                  ),
                handler: async (_request: any, _response: any, context: any) => {
                  const records = Array.isArray(context.records) ? context.records : [];
                  const ids = records
                    .map((record: any) => Number(record?.params?.id))
                    .filter((id: number) => Number.isInteger(id));

                  const result = await adminActionsService.retryRecords(ids);
                  return {
                    records: records.map((record: any) => record.toJSON(context.currentAdmin)),
                    notice: { message: result.message, type: 'success' },
                  };
                },
              },
```

- [ ] **Step 2: Run focused admin-related tests**

Run: `npm test -- test/unit/modules/admin/admin.actions.spec.ts`
Expected: PASS and no regression in existing admin action behavior.

- [ ] **Step 3: Sanity-check route coverage again**

Run: `npm test -- test/integration/reward/reward-engine.e2e-spec.ts -t "RewardController routes"`
Expected: PASS including the new bulk route tests.

- [ ] **Step 4: Commit**

```bash
git add src/modules/admin/admin.config.ts
git commit -m "feat: add admin bulk reward retry action"
```

### Task 5: Final verification

**Files:**
- Modify: `src/modules/reward/dto/retry-records.request.dto.ts`
- Modify: `src/modules/reward/reward.controller.ts`
- Modify: `src/modules/reward/reward.service.ts`
- Modify: `src/modules/admin/admin.actions.ts`
- Modify: `src/modules/admin/admin.config.ts`
- Modify: `test/integration/reward/reward-engine.e2e-spec.ts`
- Modify: `test/unit/modules/reward/reward.service.spec.ts`
- Modify: `test/unit/modules/admin/admin.actions.spec.ts`

- [ ] **Step 1: Run the full focused verification set**

Run: `npm test -- test/integration/reward/reward-engine.e2e-spec.ts test/unit/modules/reward/reward.service.spec.ts test/unit/modules/admin/admin.actions.spec.ts`
Expected: PASS with zero failing tests in these touched areas.

- [ ] **Step 2: Re-read the spec and diff**

Checklist:
- bulk endpoint exists and validates `ids`
- backend returns immediately
- service reuses `retryRecord`
- single-record failures do not stop later retries
- admin bulk action forwards selected ids
- UI success message says scheduled, not completed

- [ ] **Step 3: Commit final implementation**

```bash
git add src/modules/reward/dto/retry-records.request.dto.ts src/modules/reward/reward.controller.ts src/modules/reward/reward.service.ts src/modules/admin/admin.actions.ts src/modules/admin/admin.config.ts test/integration/reward/reward-engine.e2e-spec.ts test/unit/modules/reward/reward.service.spec.ts test/unit/modules/admin/admin.actions.spec.ts
git commit -m "feat: add async bulk reward record retry"
```
