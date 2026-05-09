import Decimal from 'decimal.js';
import { RewardBatchType, RewardRecordStatus } from '@prisma/client';
import { RewardService } from '../../../../src/modules/reward/reward.service';
import { PrismaService } from '../../../../src/common/prisma/prisma.service';
import { ExternalApiError } from '../../../../src/common/errors/external-api.error';
import { BeansService } from '../../../../src/modules/beans/beans.service';
import { LedgerService } from '../../../../src/modules/ledger/ledger.service';
import { BigcommerceService } from '../../../../src/modules/bigcommerce/bigcommerce.service';
import {
  aggregateSnapshotsByCustomer,
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
        { provide: BigcommerceService, useValue: {} },
      ],
    });

    const service = moduleRef.get(RewardService);
    expect(service).toBeInstanceOf(RewardService);
    await moduleRef.close();
  });
});

describe('aggregateSnapshotsByCustomer', () => {
  it('should aggregate multiple orders for the same customer', () => {
    const snapshots: OrderSnapshot[] = [
      { customerId: 101, totalAmount: new Decimal('100.25') } as any,
      { customerId: 101, totalAmount: new Decimal('50.75') } as any,
      { customerId: 202, totalAmount: new Decimal('10.00') } as any,
    ];

    const result = aggregateSnapshotsByCustomer(snapshots as any);

    expect(result).toHaveLength(2);
    expect(result[0].customerId).toBe(101);
    expect(result[0].totalAmount.toString()).toBe('151');
    expect(result[1].customerId).toBe(202);
    expect(result[1].totalAmount.toString()).toBe('10');
  });
});

describe('RewardService.createOrUpdateRewardRecords', () => {
  it('fetches customer profile and upserts by batchId_customerId', async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      rewardRecord: {
        upsert,
      },
    };
    const orderService = {};
    const beansService = {};
    const ledgerService = {};
    const getCustomer = jest.fn().mockResolvedValue({
      customerName: 'Alice',
      customerEmail: 'alice@example.com',
    });
    const bigcommerce = { getCustomer };

    const service = new RewardService(
      prisma as unknown as PrismaService,
      orderService as OrderService,
      beansService as BeansService,
      ledgerService as LedgerService,
      bigcommerce as unknown as BigcommerceService,
    );

    await (service as any).createOrUpdateRewardRecords(
      1,
      [{ customerId: 1001, totalAmount: new Decimal('20.00') }],
      new Decimal('0.05'),
    );

    expect(getCustomer).toHaveBeenCalledWith(1001);
    expect(upsert).toHaveBeenCalledWith({
      where: { batchId_customerId: { batchId: 1, customerId: 1001 } },
      update: {
        customerName: 'Alice',
        customerEmail: 'alice@example.com',
        totalOrderAmount: expect.anything(),
        rewardAmount: expect.anything(),
        status: RewardRecordStatus.PENDING,
        lastError: null,
        nextRetryAt: null,
      },
      create: {
        batchId: 1,
        customerId: 1001,
        customerName: 'Alice',
        customerEmail: 'alice@example.com',
        totalOrderAmount: expect.anything(),
        rewardAmount: expect.anything(),
      },
    });
  });
});

describe('RewardService.processOneRecord', () => {
  it('marks record SUCCESS and skips grantBeans when idempotency key already exists', async () => {
    const findUniqueOrThrow = jest.fn().mockResolvedValue({
      id: 1,
      customerId: 1001,
      customerEmail: 'c1001@example.com',
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
    const bigcommerce = {};

    const service = new RewardService(
      prisma as unknown as PrismaService,
      orderService as OrderService,
      beansService as unknown as BeansService,
      ledgerService as unknown as LedgerService,
      bigcommerce as BigcommerceService,
    );

    await (service as any).processOneRecord(1);

    expect(findByIdempotencyKey).toHaveBeenCalledWith('reward:1');
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

  it('schedules nextRetryAt when grantBeans throws retryable ExternalApiError', async () => {
    const before = Date.now();
    const findUniqueOrThrow = jest.fn().mockResolvedValue({
      id: 2,
      customerId: 1002,
      customerEmail: 'c1002@example.com',
      rewardAmount: new Decimal('8.88'),
      attemptCount: 2,
      totalOrderAmount: new Decimal('88.8'),
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
    const bigcommerce = {};

    const service = new RewardService(
      prisma as unknown as PrismaService,
      orderService as OrderService,
      beansService as unknown as BeansService,
      ledgerService as unknown as LedgerService,
      bigcommerce as BigcommerceService,
    );

    await (service as any).processOneRecord(2);

    expect(update).toHaveBeenCalledTimes(1);
    const payload = update.mock.calls[0][0];
    expect(payload.where).toEqual({ id: 2 });
    expect(payload.data.status).toBe(RewardRecordStatus.FAILED);
    expect(payload.data.attemptCount).toBe(3);
    expect(payload.data.nextRetryAt).toBeInstanceOf(Date);
    expect(payload.data.nextRetryAt.getTime()).toBeGreaterThan(before);
  });

  it('does not schedule nextRetryAt for non-retryable ExternalApiError', async () => {
    const findUniqueOrThrow = jest.fn().mockResolvedValue({
      id: 3,
      customerId: 1003,
      customerEmail: 'c1003@example.com',
      rewardAmount: new Decimal('3.21'),
      attemptCount: 1,
      totalOrderAmount: new Decimal('32.1'),
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
    const bigcommerce = {};

    const service = new RewardService(
      prisma as unknown as PrismaService,
      orderService as OrderService,
      beansService as unknown as BeansService,
      ledgerService as unknown as LedgerService,
      bigcommerce as BigcommerceService,
    );

    await (service as any).processOneRecord(3);

    expect(update).toHaveBeenCalledWith({
      where: { id: 3 },
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
      id: 4,
      customerId: 1004,
      customerEmail: 'c1004@example.com',
      rewardAmount: new Decimal('9.99'),
      attemptCount: 7,
      totalOrderAmount: new Decimal('99.9'),
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
    const bigcommerce = {};

    const service = new RewardService(
      prisma as unknown as PrismaService,
      orderService as OrderService,
      beansService as unknown as BeansService,
      ledgerService as unknown as LedgerService,
      bigcommerce as BigcommerceService,
    );

    await (service as any).processOneRecord(4);

    expect(update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: {
        status: RewardRecordStatus.FAILED,
        attemptCount: 8,
        lastError: 'temporarily unavailable',
        nextRetryAt: null,
      },
    });
  });

  it('marks record FAILED with clear error and does not call grantBeans when customerEmail is missing', async () => {
    const findUniqueOrThrow = jest.fn().mockResolvedValue({
      id: 5,
      customerId: 1005,
      customerEmail: null,
      rewardAmount: new Decimal('5.00'),
      totalOrderAmount: new Decimal('50.00'),
      attemptCount: 0,
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
    const findByIdempotencyKey = jest.fn().mockResolvedValue(null);
    const ledgerService = {
      findByIdempotencyKey,
      appendRewardLedger: jest.fn(),
    };
    const bigcommerce = {};

    const service = new RewardService(
      prisma as unknown as PrismaService,
      orderService as OrderService,
      beansService as unknown as BeansService,
      ledgerService as unknown as LedgerService,
      bigcommerce as BigcommerceService,
    );

    await (service as any).processOneRecord(5);

    expect(update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: {
        status: RewardRecordStatus.FAILED,
        attemptCount: 1,
        lastError: 'Missing customerEmail for reward record 5',
        nextRetryAt: null,
      },
    });
    expect(grantBeans).not.toHaveBeenCalled();
  });
});

describe('RewardService.rollbackRecord', () => {
  it('converges status and rollback audit fields when rollback idempotency key already exists', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: 11,
      customerId: 2001,
      customerEmail: 'c2001@example.com',
      batchId: 1,
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
    const bigcommerce = {};

    const service = new RewardService(
      prisma as unknown as PrismaService,
      orderService as OrderService,
      beansService as unknown as BeansService,
      ledgerService as unknown as LedgerService,
      bigcommerce as BigcommerceService,
    );

    await service.rollbackRecord(11, 'manual-adjustment', 'ops-user');

    expect(findByIdempotencyKey).toHaveBeenCalledWith('rollback:11');
    expect(update).toHaveBeenCalledTimes(1);
    const payload = update.mock.calls[0][0];
    expect(payload.where).toEqual({ id: 11 });
    expect(payload.data.status).toBe(RewardRecordStatus.ROLLED_BACK);
    expect(payload.data.rollbackReason).toBe('manual-adjustment');
    expect(payload.data.rollbackBy).toBe('ops-user');
    expect(payload.data.rollbackAt).toBeInstanceOf(Date);
    expect(rollbackBeans).not.toHaveBeenCalled();
  });

  it('throws clear error when customerEmail is missing', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: 12,
      customerId: 2002,
      customerEmail: null,
      batchId: 1,
      rewardAmount: new Decimal('10'),
      status: RewardRecordStatus.SUCCESS,
    });
    const prisma = {
      rewardRecord: {
        findUnique,
        update: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    const orderService = {};
    const beansService = { rollbackBeans: jest.fn() };
    const ledgerService = {
      findByIdempotencyKey: jest.fn(),
      appendRollbackLedger: jest.fn(),
    };
    const bigcommerce = {};

    const service = new RewardService(
      prisma as unknown as PrismaService,
      orderService as OrderService,
      beansService as unknown as BeansService,
      ledgerService as unknown as LedgerService,
      bigcommerce as BigcommerceService,
    );

    await expect(service.rollbackRecord(12, 'reason', 'ops-user')).rejects.toThrow(
      'Missing customerEmail for reward record 12',
    );
    expect(beansService.rollbackBeans).not.toHaveBeenCalled();
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
    const bigcommerce = {};

    const service = new RewardService(
      prisma as unknown as PrismaService,
      orderService as OrderService,
      beansService as BeansService,
      ledgerService as LedgerService,
      bigcommerce as BigcommerceService,
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
