import { Prisma, RewardRecord } from '@prisma/client';
import { ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import Decimal from 'decimal.js';
import { AppModule } from '../../../src/app.module';
import { BigcommerceModule } from '../../../src/modules/bigcommerce/bigcommerce.module';
import { BigcommerceService } from '../../../src/modules/bigcommerce/bigcommerce.service';
import { LedgerService } from '../../../src/modules/ledger/ledger.service';
import { OrderService } from '../../../src/modules/order/order.service';
import { RewardController } from '../../../src/modules/reward/reward.controller';
import { RewardService } from '../../../src/modules/reward/reward.service';

describe('Reward schema metadata', () => {
  const getModel = (name: string) =>
    Prisma.dmmf.datamodel.models.find((model) => model.name === name);

  const getField = (modelName: string, fieldName: string) =>
    getModel(modelName)?.fields.find((field) => field.name === fieldName);

  const getFieldNames = (name: string) =>
    getModel(name)?.fields.map((field) => field.name) ?? [];

  it('should expose RewardBatchType enum and RewardBatch new fields', () => {
    const rewardBatchType = Prisma.dmmf.datamodel.enums.find(
      (schemaEnum) => schemaEnum.name === 'RewardBatchType',
    );

    expect(rewardBatchType).toBeDefined();
    expect(rewardBatchType?.values.map((value) => value.name)).toEqual(
      expect.arrayContaining(['REGULAR', 'ADJUSTMENT']),
    );

    const rewardBatchFields = getFieldNames('RewardBatch');
    expect(rewardBatchFields).toEqual(
      expect.arrayContaining(['batchType', 'parentPeriod', 'triggeredBy']),
    );
  });

  it('should expose RewardRecord rollback audit fields', () => {
    const rewardRecordFields = getFieldNames('RewardRecord');
    expect(rewardRecordFields).toEqual(
      expect.arrayContaining(['rollbackReason', 'rollbackBy', 'rollbackAt']),
    );
  });

  it('should use Int autoincrement ids for core reward tables', () => {
    const models = ['RewardBatch', 'RewardRecord', 'BeansLedger', 'OrderSnapshot'];

    for (const modelName of models) {
      const idField = getField(modelName, 'id');
      expect(idField?.isId).toBe(true);
      expect(idField?.type).toBe('Int');
      expect(idField?.hasDefaultValue).toBe(true);
      const idDefault = idField?.default;
      if (
        typeof idDefault === 'object' &&
        idDefault !== null &&
        !Array.isArray(idDefault) &&
        'name' in idDefault
      ) {
        expect(idDefault.name).toBe('autoincrement');
      } else {
        fail(`Expected ${modelName}.id default to be an autoincrement function`);
      }
    }
  });

  it('should expose RewardRecord customer fields and unique key', () => {
    const rewardRecordFields = getFieldNames('RewardRecord');
    expect(rewardRecordFields).toEqual(
      expect.arrayContaining(['customerId', 'customerName', 'customerEmail']),
    );
    expect(rewardRecordFields).not.toContain('userId');

    const customerIdField = getField('RewardRecord', 'customerId');
    expect(customerIdField?.type).toBe('Int');
    expect(customerIdField?.isRequired).toBe(true);

    const customerNameField = getField('RewardRecord', 'customerName');
    expect(customerNameField?.type).toBe('String');
    expect(customerNameField?.isRequired).toBe(false);

    const customerEmailField = getField('RewardRecord', 'customerEmail');
    expect(customerEmailField?.type).toBe('String');
    expect(customerEmailField?.isRequired).toBe(false);

    const rewardRecordModel = getModel('RewardRecord');
    expect(rewardRecordModel?.uniqueFields).toContainEqual(['batchId', 'customerId']);
  });

  it('should expose BeansLedger customer and rewardRecord relation id types', () => {
    const beansLedgerFields = getFieldNames('BeansLedger');
    expect(beansLedgerFields).toContain('customerId');
    expect(beansLedgerFields).not.toContain('userId');

    const customerIdField = getField('BeansLedger', 'customerId');
    expect(customerIdField?.type).toBe('Int');
    expect(customerIdField?.isRequired).toBe(true);

    const rewardRecordIdField = getField('BeansLedger', 'rewardRecordId');
    expect(rewardRecordIdField?.type).toBe('Int');
    expect(rewardRecordIdField?.isRequired).toBe(false);
  });

  it('should expose OrderSnapshot customerId as Int', () => {
    const customerIdField = getField('OrderSnapshot', 'customerId');
    expect(customerIdField?.type).toBe('Int');
    expect(customerIdField?.isRequired).toBe(true);
  });
});

describe('RewardController routes', () => {
  let app: INestApplication;
  let baseUrl: string;
  const rewardService = {
    retryFailedRecords: jest.fn().mockResolvedValue(undefined),
    retryRecord: jest.fn().mockResolvedValue(undefined),
    rollbackRecord: jest.fn().mockResolvedValue(undefined),
    createAdjustmentBatch: jest.fn().mockResolvedValue({ id: 'batch-adjust-1' }),
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [RewardController],
      providers: [{ provide: RewardService, useValue: rewardService }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /reward/batches/:id/retry should call retryFailedRecords', async () => {
    const response = await fetch(`${baseUrl}/reward/batches/1/retry`, {
      method: 'POST',
    });

    expect(response.status).toBe(201);
    expect(rewardService.retryFailedRecords).toHaveBeenCalledWith(1);
  });

  it('POST /reward/records/:id/retry should call retryRecord', async () => {
    const response = await fetch(`${baseUrl}/reward/records/1/retry`, {
      method: 'POST',
    });

    expect(response.status).toBe(201);
    expect(rewardService.retryRecord).toHaveBeenCalledWith(1);
  });

  it('POST /reward/records/:id/rollback should be reachable and call rollbackRecord', async () => {
    const response = await fetch(`${baseUrl}/reward/records/1/rollback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reason: 'manual correction',
        operator: 'ops-user',
      }),
    });

    expect(response.status).toBe(201);
    expect(rewardService.rollbackRecord).toHaveBeenCalledWith(
      1,
      'manual correction',
      'ops-user',
    );
  });

  it('POST /reward/batches/:period/adjustments should call createAdjustmentBatch', async () => {
    const response = await fetch(`${baseUrl}/reward/batches/2026-Q1/adjustments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        parentPeriod: '2026-Q1',
        triggeredBy: 'ops-user',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-03-31T23:59:59.000Z',
        rewardRate: '0.05',
      }),
    });

    expect(response.status).toBe(201);
    expect(rewardService.createAdjustmentBatch).toHaveBeenCalledWith({
      period: '2026-Q1',
      parentPeriod: '2026-Q1',
      triggeredBy: 'ops-user',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: new Date('2026-03-31T23:59:59.000Z'),
      rewardRate: '0.05',
    });
  });
});

describe('App module wiring', () => {
  it('should register BigcommerceModule and resolve OrderService/BigcommerceService', async () => {
    const imports = Reflect.getMetadata('imports', AppModule) as unknown[];
    expect(imports).toContain(BigcommerceModule);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(moduleRef.get(OrderService)).toBeDefined();
    expect(moduleRef.get(BigcommerceService)).toBeDefined();

    await moduleRef.close();
  });
});

describe('Ledger customer semantics', () => {
  it('should write customerId (not userId) for reward and rollback ledger entries', async () => {
    const create = jest.fn().mockResolvedValue({ id: 1 });
    const tx = {
      beansLedger: { create },
    } as unknown as Prisma.TransactionClient;
    const service = new LedgerService({} as never);
    const record = {
      id: 101,
      batchId: 202,
      customerId: 303,
    } as unknown as RewardRecord;

    await service.appendRewardLedger(
      tx,
      record,
      new Decimal('12.34'),
      'reward:101',
      'txn-reward-1',
    );
    await service.appendRollbackLedger(
      tx,
      record,
      new Decimal('-12.34'),
      'rollback:101',
      'txn-rollback-1',
      { reason: 'manual', operator: 'ops' },
    );

    const rewardData = create.mock.calls[0][0].data as Record<string, unknown>;
    const rollbackData = create.mock.calls[1][0].data as Record<string, unknown>;

    expect(rewardData.customerId).toBe(record.customerId);
    expect(rollbackData.customerId).toBe(record.customerId);
    expect(rewardData.userId).toBeUndefined();
    expect(rollbackData.userId).toBeUndefined();
  });
});
