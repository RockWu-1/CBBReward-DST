import Decimal from 'decimal.js';
import { RewardBatchType, RewardRecordStatus } from '@prisma/client';
import { RewardService } from '../../../../src/modules/reward/reward.service';
import { PrismaService } from '../../../../src/common/prisma/prisma.service';
import { ExternalApiError } from '../../../../src/common/errors/external-api.error';
import { BeansService } from '../../../../src/modules/beans/beans.service';
import { LedgerService } from '../../../../src/modules/ledger/ledger.service';
import {
  aggregateSnapshotsByUser,
  OrderService,
} from '../../../../src/modules/order/order.service';
import { OrderSnapshot } from '../../../../src/modules/order/types/order-snapshot.type';
import { createTestingModule } from '../../../setup/testing.module';

describe('RewardService (smoke)', () => {
  it('should be defined', async () => {
    const moduleRef = await createTestingModule({
      providers: [
        RewardService,
        { provide: PrismaService, useValue: {} },
        { provide: OrderService, useValue: {} },
        { provide: BeansService, useValue: {} },
        { provide: LedgerService, useValue: {} },
      ],
    });

    const service = moduleRef.get(RewardService);
    expect(service).toBeInstanceOf(RewardService);
    await moduleRef.close();
  });
});

describe('aggregateSnapshotsByUser', () => {
  it('should aggregate multiple orders for the same user', () => {
    const snapshots: OrderSnapshot[] = [
      { userId: 'u1', totalAmount: new Decimal('100.25') },
      { userId: 'u1', totalAmount: new Decimal('50.75') },
      { userId: 'u2', totalAmount: new Decimal('10.00') },
    ];

    const result = aggregateSnapshotsByUser(snapshots);

    expect(result).toHaveLength(2);
    expect(result[0].userId).toBe('u1');
    expect(result[0].totalAmount.toString()).toBe('151');
    expect(result[1].userId).toBe('u2');
    expect(result[1].totalAmount.toString()).toBe('10');
  });
});

describe('RewardService.processOneRecord', () => {
  it('marks record SUCCESS and skips grantBeans when idempotency key already exists', async () => {
    const findUniqueOrThrow = jest.fn().mockResolvedValue({
      id: 'record-1',
      userId: 'user-1',
      rewardAmount: new Decimal('12.34'),
      attemptCount: 2,
    });
    const update = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      rewardRecord: {
        findUniqueOrThrow,
        update,
      },
      $transaction: jest.fn(),
    };
    const orderService = {};
    const grantBeans = jest.fn();
    const beansService = { grantBeans };
    const findByIdempotencyKey = jest.fn().mockResolvedValue({
      id: 'ledger-1',
      createdAt: new Date('2026-01-02T03:04:05.000Z'),
    });
    const ledgerService = {
      findByIdempotencyKey,
      appendRewardLedger: jest.fn(),
    };

    const service = new RewardService(
      prisma as unknown as PrismaService,
      orderService as OrderService,
      beansService as unknown as BeansService,
      ledgerService as unknown as LedgerService,
    );

    await (service as any).processOneRecord('record-1');

    expect(findByIdempotencyKey).toHaveBeenCalledWith('reward:record-1');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'record-1' },
      data: {
        status: RewardRecordStatus.SUCCESS,
        processedAt: new Date('2026-01-02T03:04:05.000Z'),
        lastError: null,
        nextRetryAt: null,
      },
    });
    expect(grantBeans).not.toHaveBeenCalled();
  });

  it('schedules nextRetryAt when grantBeans throws retryable ExternalApiError', async () => {
    const before = Date.now();
    const findUniqueOrThrow = jest.fn().mockResolvedValue({
      id: 'record-2',
      userId: 'user-2',
      rewardAmount: new Decimal('8.88'),
      attemptCount: 2,
    });
    const update = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      rewardRecord: {
        findUniqueOrThrow,
        update,
      },
      $transaction: jest.fn(),
    };
    const orderService = {};
    const grantBeans = jest.fn().mockRejectedValue(
      new ExternalApiError({
        provider: 'partner',
        operation: 'grantBeans',
        message: 'service unavailable',
        retryable: true,
        statusCode: 503,
      }),
    );
    const beansService = { grantBeans };
    const findByIdempotencyKey = jest.fn().mockResolvedValue(null);
    const ledgerService = {
      findByIdempotencyKey,
      appendRewardLedger: jest.fn(),
    };

    const service = new RewardService(
      prisma as unknown as PrismaService,
      orderService as OrderService,
      beansService as unknown as BeansService,
      ledgerService as unknown as LedgerService,
    );

    await (service as any).processOneRecord('record-2');

    expect(update).toHaveBeenCalledTimes(1);
    const payload = update.mock.calls[0][0];
    expect(payload.where).toEqual({ id: 'record-2' });
    expect(payload.data.status).toBe(RewardRecordStatus.FAILED);
    expect(payload.data.attemptCount).toBe(3);
    expect(payload.data.nextRetryAt).toBeInstanceOf(Date);
    expect(payload.data.nextRetryAt.getTime()).toBeGreaterThan(before);
  });

  it('does not schedule nextRetryAt for non-retryable ExternalApiError', async () => {
    const findUniqueOrThrow = jest.fn().mockResolvedValue({
      id: 'record-3',
      userId: 'user-3',
      rewardAmount: new Decimal('3.21'),
      attemptCount: 1,
    });
    const update = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      rewardRecord: {
        findUniqueOrThrow,
        update,
      },
      $transaction: jest.fn(),
    };
    const orderService = {};
    const grantBeans = jest.fn().mockRejectedValue(
      new ExternalApiError({
        provider: 'partner',
        operation: 'grantBeans',
        message: 'bad request',
        retryable: false,
        statusCode: 400,
      }),
    );
    const beansService = { grantBeans };
    const findByIdempotencyKey = jest.fn().mockResolvedValue(null);
    const ledgerService = {
      findByIdempotencyKey,
      appendRewardLedger: jest.fn(),
    };

    const service = new RewardService(
      prisma as unknown as PrismaService,
      orderService as OrderService,
      beansService as unknown as BeansService,
      ledgerService as unknown as LedgerService,
    );

    await (service as any).processOneRecord('record-3');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'record-3' },
      data: {
        status: RewardRecordStatus.FAILED,
        attemptCount: 2,
        lastError: 'bad request',
        nextRetryAt: null,
      },
    });
  });

  it('does not schedule nextRetryAt when attempt reaches retry limit', async () => {
    const findUniqueOrThrow = jest.fn().mockResolvedValue({
      id: 'record-4',
      userId: 'user-4',
      rewardAmount: new Decimal('9.99'),
      attemptCount: 7,
    });
    const update = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      rewardRecord: {
        findUniqueOrThrow,
        update,
      },
      $transaction: jest.fn(),
    };
    const orderService = {};
    const grantBeans = jest.fn().mockRejectedValue(
      new ExternalApiError({
        provider: 'partner',
        operation: 'grantBeans',
        message: 'temporarily unavailable',
        retryable: true,
        statusCode: 503,
      }),
    );
    const beansService = { grantBeans };
    const findByIdempotencyKey = jest.fn().mockResolvedValue(null);
    const ledgerService = {
      findByIdempotencyKey,
      appendRewardLedger: jest.fn(),
    };

    const service = new RewardService(
      prisma as unknown as PrismaService,
      orderService as OrderService,
      beansService as unknown as BeansService,
      ledgerService as unknown as LedgerService,
    );

    await (service as any).processOneRecord('record-4');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'record-4' },
      data: {
        status: RewardRecordStatus.FAILED,
        attemptCount: 8,
        lastError: 'temporarily unavailable',
        nextRetryAt: null,
      },
    });
  });
});

describe('RewardService.rollbackRecord', () => {
  it('converges status and rollback audit fields when rollback idempotency key already exists', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: 'record-rollback-1',
      userId: 'user-r-1',
      batchId: 'batch-r-1',
      rewardAmount: new Decimal('15.5'),
      status: RewardRecordStatus.SUCCESS,
    });
    const update = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      rewardRecord: {
        findUnique,
        update,
      },
      $transaction: jest.fn(),
    };
    const orderService = {};
    const rollbackBeans = jest.fn();
    const beansService = { rollbackBeans };
    const findByIdempotencyKey = jest.fn().mockResolvedValue({
      id: 'ledger-r-1',
      createdAt: new Date('2026-02-03T04:05:06.000Z'),
    });
    const ledgerService = {
      findByIdempotencyKey,
      appendRollbackLedger: jest.fn(),
    };

    const service = new RewardService(
      prisma as unknown as PrismaService,
      orderService as OrderService,
      beansService as unknown as BeansService,
      ledgerService as unknown as LedgerService,
    );

    await service.rollbackRecord('record-rollback-1', 'manual-adjustment', 'ops-user');

    expect(findByIdempotencyKey).toHaveBeenCalledWith('rollback:record-rollback-1');
    expect(update).toHaveBeenCalledTimes(1);
    const payload = update.mock.calls[0][0];
    expect(payload.where).toEqual({ id: 'record-rollback-1' });
    expect(payload.data.status).toBe(RewardRecordStatus.ROLLED_BACK);
    expect(payload.data.rollbackReason).toBe('manual-adjustment');
    expect(payload.data.rollbackBy).toBe('ops-user');
    expect(payload.data.rollbackAt).toBeInstanceOf(Date);
    expect(rollbackBeans).not.toHaveBeenCalled();
  });
});

describe('RewardService.createAdjustmentBatch', () => {
  it('creates adjustment batch with ADJUSTMENT type and audit fields', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'batch-adjust-1',
      period: '2026-Q2-ADJ-001',
    });
    const prisma = {
      rewardBatch: {
        create,
      },
    };
    const orderService = {};
    const beansService = {};
    const ledgerService = {};

    const service = new RewardService(
      prisma as unknown as PrismaService,
      orderService as OrderService,
      beansService as BeansService,
      ledgerService as LedgerService,
    );

    await service.createAdjustmentBatch({
      period: '2026-Q2-ADJ-001',
      parentPeriod: '2026-Q2',
      triggeredBy: 'ops-user',
      startDate: new Date('2026-07-01T00:00:00.000Z'),
      endDate: new Date('2026-09-30T23:59:59.000Z'),
      rewardRate: '0.050000',
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        period: '2026-Q2-ADJ-001',
        batchType: RewardBatchType.ADJUSTMENT,
        parentPeriod: '2026-Q2',
        triggeredBy: 'ops-user',
        startDate: new Date('2026-07-01T00:00:00.000Z'),
        endDate: new Date('2026-09-30T23:59:59.000Z'),
        rewardRate: expect.anything(),
      },
    });
  });
});
