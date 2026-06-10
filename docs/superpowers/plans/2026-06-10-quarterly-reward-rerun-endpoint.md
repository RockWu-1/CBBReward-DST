# Quarterly Reward Rerun Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual `POST /reward/periods/rerun` endpoint that validates `authToken`, validates `period`, blocks reruns for `PENDING` / `PROCESSING` / `COMPLETED` / `PARTIAL_FAILED`, and reuses the existing quarterly reward execution flow.

**Architecture:** Keep the controller thin by adding a dedicated request DTO and forwarding the request to a new `RewardService.rerunQuarterlyReward(...)` entrypoint. The service will own token validation, period parsing, batch status gating, quarter date calculation, and delegation into `runQuarterlyReward(...)`, while route and unit tests cover the new behavior end to end.

**Tech Stack:** NestJS, TypeScript, class-validator, Jest, Prisma

**Git note:** Git staging and commit steps are intentionally omitted from this plan per user preference.

---

## File Structure

- Create: `src/modules/reward/dto/rerun-quarterly-reward.request.dto.ts`
  - Request DTO for `period` and `authToken`
- Modify: `src/modules/reward/reward.controller.ts`
  - Add `POST /reward/periods/rerun`
- Modify: `src/modules/reward/reward.service.ts`
  - Add the manual rerun entrypoint
  - Add period parsing helper
  - Add batch status gate for `PENDING` / `PROCESSING` / `COMPLETED` / `PARTIAL_FAILED`
- Modify: `test/integration/reward/reward-engine.e2e-spec.ts`
  - Extend route coverage for the new endpoint
- Modify: `test/unit/modules/reward/reward.service.spec.ts`
  - Add service-level tests for token, period, status gate, and allowed reruns

### Task 1: Add Route-Level Failing Tests

**Files:**
- Modify: `test/integration/reward/reward-engine.e2e-spec.ts`
- Reference: `src/modules/reward/reward.controller.ts`

- [ ] **Step 1: Extend the mocked `rewardService` with the new rerun method**

```ts
const rewardService = {
  retryFailedRecords: jest.fn().mockResolvedValue(undefined),
  retryRecord: jest.fn().mockResolvedValue(undefined),
  rollbackRecord: jest.fn().mockResolvedValue(undefined),
  createAdjustmentBatch: jest.fn().mockResolvedValue({ id: 'batch-adjust-1' }),
  rerunQuarterlyReward: jest.fn().mockResolvedValue({
    success: true,
    message: 'Quarterly reward rerun started',
    period: '2026-Q2',
  }),
};
```

- [ ] **Step 2: Add a route test proving `POST /reward/periods/rerun` reaches the new service method**

```ts
it('POST /reward/periods/rerun should call rerunQuarterlyReward', async () => {
  const response = await fetch(`${baseUrl}/reward/periods/rerun`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      period: '2026-Q2',
      authToken: 'silk12345',
    }),
  });

  expect(response.status).toBe(201);
  expect(rewardService.rerunQuarterlyReward).toHaveBeenCalledWith('2026-Q2', 'silk12345');
});
```

- [ ] **Step 3: Add a route test proving DTO validation rejects a malformed request body**

```ts
it('POST /reward/periods/rerun should reject invalid request body', async () => {
  const response = await fetch(`${baseUrl}/reward/periods/rerun`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      period: '',
    }),
  });

  expect(response.status).toBe(400);
  expect(rewardService.rerunQuarterlyReward).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Run the route test target and verify the new cases fail because the endpoint does not exist yet**

Run: `npx jest --config test/jest.integration.json --runInBand test/integration/reward/reward-engine.e2e-spec.ts --testNamePattern "POST /reward/periods/rerun"`

Expected:
- FAIL with a route-not-found or missing-method failure
- FAIL because `RewardController` does not yet expose `/reward/periods/rerun`

### Task 2: Add Service-Level Failing Tests

**Files:**
- Modify: `test/unit/modules/reward/reward.service.spec.ts`
- Reference: `src/modules/reward/reward.service.ts`

- [ ] **Step 1: Add a test that rejects the wrong token**

```ts
describe('RewardService.rerunQuarterlyReward', () => {
  it('rejects rerun when authToken is invalid', async () => {
    const service = new RewardService(
      { rewardBatch: { findUnique: jest.fn() } } as unknown as PrismaService,
      {} as OrderService,
      {} as BeansService,
      {} as LedgerService,
      {} as BigcommerceService,
    );

    await expect(service.rerunQuarterlyReward('2026-Q2', 'wrong-token')).rejects.toThrow(
      'Invalid authToken',
    );
  });
});
```

- [ ] **Step 2: Add a test that rejects an invalid period format**

```ts
it('rejects rerun when period format is invalid', async () => {
  const service = new RewardService(
    { rewardBatch: { findUnique: jest.fn() } } as unknown as PrismaService,
    {} as OrderService,
    {} as BeansService,
    {} as LedgerService,
    {} as BigcommerceService,
  );

  await expect(service.rerunQuarterlyReward('2026Q2', 'silk12345')).rejects.toThrow(
    'Invalid period format',
  );
});
```

- [ ] **Step 3: Add a test that rejects `PENDING` / `PROCESSING` / `COMPLETED` / `PARTIAL_FAILED`**

```ts
it.each([
  RewardBatchStatus.PENDING,
  RewardBatchStatus.PROCESSING,
  RewardBatchStatus.COMPLETED,
  RewardBatchStatus.PARTIAL_FAILED,
])('rejects rerun when batch status is %s', async (status) => {
  const findUnique = jest.fn().mockResolvedValue({
    id: 1,
    period: '2026-Q2',
    status,
    startDate: new Date('2026-04-01T00:00:00.000Z'),
    endDate: new Date('2026-06-30T23:59:59.000Z'),
  });
  const service = new RewardService(
    { rewardBatch: { findUnique } } as unknown as PrismaService,
    {} as OrderService,
    {} as BeansService,
    {} as LedgerService,
    {} as BigcommerceService,
  );

  await expect(service.rerunQuarterlyReward('2026-Q2', 'silk12345')).rejects.toThrow(
    '创建period失败，季度已经跑过',
  );
});
```

- [ ] **Step 4: Add a test that allows rerun when no batch exists and delegates to `runQuarterlyReward(...)`**

```ts
it('allows rerun when batch does not exist and delegates to runQuarterlyReward', async () => {
  const findUnique = jest.fn().mockResolvedValue(null);
  const service = new RewardService(
    { rewardBatch: { findUnique } } as unknown as PrismaService,
    {} as OrderService,
    {} as BeansService,
    {} as LedgerService,
    {} as BigcommerceService,
  );
  const runSpy = jest.spyOn(service, 'runQuarterlyReward').mockResolvedValue(undefined);

  await expect(service.rerunQuarterlyReward('2026-Q2', 'silk12345')).resolves.toEqual({
    success: true,
    message: 'Quarterly reward rerun started',
    period: '2026-Q2',
  });

  expect(runSpy).toHaveBeenCalledWith({
    period: '2026-Q2',
    startDate: new Date('2026-04-01T00:00:00.000Z'),
    endDate: new Date('2026-06-30T23:59:59.000Z'),
  });
});
```

- [ ] **Step 5: Add a test that allows rerun when status is `FAILED`**

```ts
it('allows rerun when existing batch status is FAILED', async () => {
  const findUnique = jest.fn().mockResolvedValue({
    id: 2,
    period: '2026-Q2',
    status: RewardBatchStatus.FAILED,
    startDate: new Date('2026-04-01T00:00:00.000Z'),
    endDate: new Date('2026-06-30T23:59:59.000Z'),
  });
  const service = new RewardService(
    { rewardBatch: { findUnique } } as unknown as PrismaService,
    {} as OrderService,
    {} as BeansService,
    {} as LedgerService,
    {} as BigcommerceService,
  );
  const runSpy = jest.spyOn(service, 'runQuarterlyReward').mockResolvedValue(undefined);

  await service.rerunQuarterlyReward('2026-Q2', 'silk12345');

  expect(runSpy).toHaveBeenCalledWith({
    period: '2026-Q2',
    startDate: new Date('2026-04-01T00:00:00.000Z'),
    endDate: new Date('2026-06-30T23:59:59.000Z'),
  });
});
```

- [ ] **Step 6: Run the focused unit test target and verify the new cases fail because the method does not exist yet**

Run: `npx jest --config test/jest.unit.json --runInBand test/unit/modules/reward/reward.service.spec.ts --testNamePattern "RewardService.rerunQuarterlyReward"`

Expected:
- FAIL because `rerunQuarterlyReward` is not defined on `RewardService`
- FAIL before any business assertions pass

### Task 3: Implement DTO and Controller Route

**Files:**
- Create: `src/modules/reward/dto/rerun-quarterly-reward.request.dto.ts`
- Modify: `src/modules/reward/reward.controller.ts`
- Test: `test/integration/reward/reward-engine.e2e-spec.ts`

- [ ] **Step 1: Create the request DTO with body-level validation**

```ts
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class RerunQuarterlyRewardRequestDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-Q[1-4]$/)
  period!: string;

  @IsString()
  @IsNotEmpty()
  authToken!: string;
}
```

- [ ] **Step 2: Add the new controller route and forward the DTO fields to the service**

```ts
import { RerunQuarterlyRewardRequestDto } from './dto/rerun-quarterly-reward.request.dto';

@Post('periods/rerun')
  async rerunQuarterlyReward(@Body() body: RerunQuarterlyRewardRequestDto) {
    return this.rewardService.rerunQuarterlyReward(body.period, body.authToken);
  }
```

- [ ] **Step 3: Run the route test target and verify the new controller route now passes**

Run: `npx jest --config test/jest.integration.json --runInBand test/integration/reward/reward-engine.e2e-spec.ts --testNamePattern "POST /reward/periods/rerun"`

Expected:
- PASS for the happy-path route test
- PASS for the invalid-body rejection test

### Task 4: Implement the Service Rerun Flow

**Files:**
- Modify: `src/modules/reward/reward.service.ts`
- Test: `test/unit/modules/reward/reward.service.spec.ts`

- [ ] **Step 1: Add the exact Nest exception imports needed for token, period, and rerun-state failures**

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
```

- [ ] **Step 2: Add a helper that parses a `YYYY-Q[1-4]` string into the existing quarter shape**

```ts
private getQuarterPeriodFromLabel(period: string): QuarterPeriod {
  const match = /^(\d{4})-Q([1-4])$/.exec(period);
  if (!match) {
    throw new BadRequestException('Invalid period format');
  }

  const year = Number(match[1]);
  const quarter = Number(match[2]) as 1 | 2 | 3 | 4;
  return this.buildQuarter(year, quarter);
}
```

- [ ] **Step 3: Add the public rerun entrypoint and block the disallowed statuses**

```ts
async rerunQuarterlyReward(period: string, authToken: string): Promise<{
  success: true;
  message: string;
  period: string;
}> {
  if (authToken !== 'silk12345') {
    throw new UnauthorizedException('Invalid authToken');
  }

  const quarterPeriod = this.getQuarterPeriodFromLabel(period);
  const existingBatch = await this.prisma.rewardBatch.findUnique({
    where: { period: quarterPeriod.period },
  });

  if (
    existingBatch &&
    [
      RewardBatchStatus.PENDING,
      RewardBatchStatus.PROCESSING,
      RewardBatchStatus.COMPLETED,
      RewardBatchStatus.PARTIAL_FAILED,
    ].includes(existingBatch.status)
  ) {
    throw new ConflictException('创建period失败，季度已经跑过');
  }

  await this.runQuarterlyReward(quarterPeriod);

  return {
    success: true,
    message: 'Quarterly reward rerun started',
    period: quarterPeriod.period,
  };
}
```

- [ ] **Step 4: Run the focused unit test target and verify the rerun tests pass**

Run: `npx jest --config test/jest.unit.json --runInBand test/unit/modules/reward/reward.service.spec.ts --testNamePattern "RewardService.rerunQuarterlyReward"`

Expected:
- PASS for invalid token
- PASS for invalid period
- PASS for `PENDING` / `PROCESSING` / `COMPLETED` / `PARTIAL_FAILED` rejection
- PASS for allowed `FAILED` and missing-batch reruns

### Task 5: Verify the Combined Change

**Files:**
- Modify: `src/modules/reward/dto/rerun-quarterly-reward.request.dto.ts` only if validation tuning is needed
- Modify: `src/modules/reward/reward.controller.ts` only if route wiring needs follow-up
- Modify: `src/modules/reward/reward.service.ts` only if rerun logic needs follow-up
- Modify: `test/integration/reward/reward-engine.e2e-spec.ts` only if test wording needs follow-up
- Modify: `test/unit/modules/reward/reward.service.spec.ts` only if service expectations need follow-up

- [ ] **Step 1: Run the route and service rerun tests together for a clean feature-level confirmation**

Run: `npx jest --config test/jest.unit.json --runInBand test/unit/modules/reward/reward.service.spec.ts --testNamePattern "RewardService.rerunQuarterlyReward"`

Run: `npx jest --config test/jest.integration.json --runInBand test/integration/reward/reward-engine.e2e-spec.ts --testNamePattern "POST /reward/periods/rerun"`

Expected:
- PASS for the rerun service tests
- PASS for the rerun route tests

- [ ] **Step 2: Run a build check to confirm the new DTO and route compile**

Run: `npm run build`

Expected:
- PASS with exit code `0`

- [ ] **Step 3: Re-read the spec and confirm each requirement is covered by implementation or tests**

Checklist:
- `authToken` is required and checked against `silk12345`
- `period` uses `YYYY-Q[1-4]`
- `runQuarterlyReward(...)` is reused
- `PENDING` / `PROCESSING` / `COMPLETED` / `PARTIAL_FAILED` are blocked
- `FAILED` and missing batch remain allowed
- user-facing already-ran message is `创建period失败，季度已经跑过`
