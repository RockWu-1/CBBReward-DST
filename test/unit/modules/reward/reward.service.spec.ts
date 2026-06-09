import Decimal from 'decimal.js';
import { RewardBatchType, RewardRecordStatus } from '@prisma/client';
import { RewardService } from '../../../../src/modules/reward/reward.service';
import { PrismaService } from '../../../../src/common/prisma/prisma.service';
import { ExternalApiError } from '../../../../src/common/errors/external-api.error';
import { BeansService } from '../../../../src/modules/beans/beans.service';
import { LedgerService } from '../../../../src/modules/ledger/ledger.service';
import { BigcommerceService } from '../../../../src/modules/bigcommerce/bigcommerce.service';
import { RewardCalculatorService } from '../../../../src/modules/reward/reward-calculator.service';
import {
  aggregateSnapshotsByCustomer,
  OrderService,
} from '../../../../src/modules/order/order.service';
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
        { provide: RewardCalculatorService, useValue: new RewardCalculatorService() },
      ],
    });

    const service = moduleRef.get(RewardService);
    expect(service).toBeInstanceOf(RewardService);
    await moduleRef.close();
  });
});

describe('aggregateSnapshotsByCustomer', () => {
  it('should aggregate multiple orders for the same customer', () => {
    const snapshots: Array<{
      customerId: number;
      bobAmount: Decimal;
      csAmount: Decimal;
    }> = [
      { customerId: 101, bobAmount: new Decimal('100.25'), csAmount: new Decimal('0') } as any,
      { customerId: 101, bobAmount: new Decimal('0'), csAmount: new Decimal('50.75') } as any,
      { customerId: 202, bobAmount: new Decimal('10.00'), csAmount: new Decimal('0') } as any,
    ];

    const result = aggregateSnapshotsByCustomer(snapshots as any);

    expect(result).toHaveLength(2);
    expect(result[0].customerId).toBe(101);
    expect(result[0].totalAmount.toString()).toBe('151');
    expect(result[0].bobAmount.toString()).toBe('100.25');
    expect(result[0].csAmount.toString()).toBe('50.75');
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
      customerQuarterSnapshot: {
        upsert: jest.fn().mockResolvedValue(undefined),
        findFirst: jest.fn().mockResolvedValue(null),
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
      '2026-Q1',
      [{
        customerId: 1001,
        totalAmount: new Decimal('20.00'),
        bobAmount: new Decimal('20.00'),
        csAmount: new Decimal('0'),
      }],
      new Date('2026-03-31T23:59:59.000Z'),
    );

    expect(getCustomer).toHaveBeenCalledWith(1001);
    expect(upsert).toHaveBeenCalledWith({
      where: { batchId_customerId: { batchId: 1, customerId: 1001 } },
      update: {
        customerName: 'Alice',
        customerEmail: 'alice@example.com',
        totalOrderAmount: expect.anything(),
        bobReward: expect.anything(),
        csReward: expect.anything(),
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
        bobReward: expect.anything(),
        csReward: expect.anything(),
        rewardAmount: expect.anything(),
      },
    });
  });
});

describe('RewardService.processOneRecord', () => {
  it('marks record SUCCESS and skips grantBeans when a reward ledger already exists for the record', async () => {
    const findUniqueOrThrow = jest.fn().mockResolvedValue({
      id: 1,
      customerId: 1001,
      customerEmail: 'c1001@example.com',
      rewardAmount: new Decimal('12.34'),
      totalOrderAmount: new Decimal('123.4'),
      attemptCount: 2,
      batchId: 10,
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
    const findByRewardRecordId = jest.fn().mockResolvedValue({
      id: 'ledger-1',
      externalTxnId: 'txn-1',
      createdAt: new Date('2026-01-02T03:04:05.000Z'),
    });
    const ledgerService = {
      findByRewardRecordId,
      findByIdempotencyKey: jest.fn(),
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

    expect(findByRewardRecordId).toHaveBeenCalledWith(1);
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
      }),
    );
    const prisma = {
      rewardRecord: {
        findUniqueOrThrow,
      },
      $transaction: transaction,
    };
    const orderService = {};
    const grantBeans = jest.fn().mockResolvedValue({ transactionId: 'txn-2' });
    const beansService = { grantBeans };
    const appendRewardLedger = jest.fn().mockResolvedValue(undefined);
    const ledgerService = {
      findByRewardRecordId: jest.fn().mockResolvedValue(null),
      findByIdempotencyKey: jest.fn(),
      appendRewardLedger,
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
    const txUpdate = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      rewardRecord: {
        findUniqueOrThrow,
      },
      $transaction: jest.fn().mockImplementation(async (callback: any) =>
        callback({
          rewardRecord: { update: txUpdate },
        }),
      ),
    };
    const orderService = {};
    const grantBeans = jest.fn().mockResolvedValue({ transactionId: 'txn-3' });
    const beansService = { grantBeans };
    const appendRewardLedger = jest.fn().mockResolvedValue(undefined);
    const ledgerService = {
      findByRewardRecordId: jest.fn().mockResolvedValue(null),
      findByIdempotencyKey: jest
        .fn()
        .mockResolvedValueOnce({ id: 'existing-key' })
        .mockResolvedValueOnce(null),
      appendRewardLedger,
    };
    const bigcommerce = {};

    const service = new RewardService(
      prisma as unknown as PrismaService,
      orderService as OrderService,
      beansService as unknown as BeansService,
      ledgerService as unknown as LedgerService,
      bigcommerce as BigcommerceService,
    );

    const generateSpy = jest
      .spyOn(service as any, 'generateRandomRewardIdempotencyKey')
      .mockReturnValueOnce('reward_AAAAAAAAAAAA')
      .mockReturnValueOnce('reward_BBBBBBBBBBBB');

    await service.retryRecord(3);

    expect(generateSpy).toHaveBeenCalledTimes(2);
    expect(ledgerService.findByIdempotencyKey).toHaveBeenNthCalledWith(1, 'reward_AAAAAAAAAAAA');
    expect(ledgerService.findByIdempotencyKey).toHaveBeenNthCalledWith(2, 'reward_BBBBBBBBBBBB');
    expect(grantBeans).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'reward_BBBBBBBBBBBB' }),
    );
    expect(appendRewardLedger).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 3 }),
      expect.anything(),
      'reward_BBBBBBBBBBBB',
      'txn-3',
    );
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
      findByRewardRecordId: jest.fn().mockResolvedValue(null),
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
      findByRewardRecordId: jest.fn().mockResolvedValue(null),
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
      findByRewardRecordId: jest.fn().mockResolvedValue(null),
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
      findByRewardRecordId: jest.fn().mockResolvedValue(null),
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

describe('RewardService.retryFailedRecords', () => {
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
});

describe('RewardService.rollbackRecord', () => {
  it('rolls back via existing reward ledger and updates rollback audit fields', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: 11,
      customerId: 2001,
      customerEmail: 'c2001@example.com',
      batchId: 1,
      rewardAmount: new Decimal('15.5'),
      status: RewardRecordStatus.SUCCESS,
    });
    const txUpdate = jest.fn().mockResolvedValue(undefined);
    const transaction = jest.fn().mockImplementation(async (callback: any) =>
      callback({
        rewardRecord: { update: txUpdate },
      }),
    );
    const prisma = {
      rewardRecord: {
        findUnique,
      },
      $transaction: transaction,
    };
    const orderService = {};
    const rollbackBeans = jest.fn().mockResolvedValue({ transactionId: 'rollback-txn-1' });
    const beansService = { rollbackBeans };
    const findByIdempotencyKey = jest.fn().mockResolvedValue({
      id: 'ledger-r-1',
      externalTxnId: 'txn-r-1',
      idempotencyKey: 'reward_11',
      createdAt: new Date('2026-02-03T04:05:06.000Z'),
    });
    const ledgerService = {
      findByRewardRecordId: findByIdempotencyKey,
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

    expect(findByIdempotencyKey).toHaveBeenCalledWith(11);
    expect(rollbackBeans).toHaveBeenCalledTimes(1);
    expect(ledgerService.appendRollbackLedger).toHaveBeenCalledTimes(1);
    expect(txUpdate).toHaveBeenCalledTimes(1);
    const payload = txUpdate.mock.calls[0][0];
    expect(payload.where).toEqual({ id: 11 });
    expect(payload.data.status).toBe(RewardRecordStatus.ROLLED_BACK);
    expect(payload.data.rollbackReason).toBe('manual-adjustment');
    expect(payload.data.rollbackBy).toBe('ops-user');
    expect(payload.data.rollbackAt).toBeInstanceOf(Date);
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
      findByRewardRecordId: jest.fn(),
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
