import { Prisma, RewardRecord } from '@prisma/client';
import { BadRequestException, ConflictException, ValidationPipe } from '@nestjs/common';
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

  it('should expose RewardRecord rollback audit fields', () => {
    const rewardRecordFields = getFieldNames('RewardRecord');
    expect(rewardRecordFields).toEqual(
      expect.arrayContaining(['rollbackReason', 'rollbackBy', 'rollbackAt']),
    );
  });

  it('should use Int autoincrement ids for core reward tables', () => {
    const models = ['RewardBatch', 'RewardRecord', 'BeansLedger', 'CustomerQuarterSnapshot'];

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
      expect.arrayContaining([
        'customerId',
        'customerName',
        'customerEmail',
        'bobReward',
        'csReward',
      ]),
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

  it('should expose CustomerQuarterSnapshot fields and constraints', () => {
    const snapshotFields = getFieldNames('CustomerQuarterSnapshot');
    expect(snapshotFields).toEqual(
      expect.arrayContaining([
        'customerId',
        'customerName',
        'customerEmail',
        'season',
        'totalAmount',
        'bobAmount',
        'csAmount',
        'level',
      ]),
    );

    const customerIdField = getField('CustomerQuarterSnapshot', 'customerId');
    expect(customerIdField?.type).toBe('Int');
    expect(customerIdField?.isRequired).toBe(true);

    const model = getModel('CustomerQuarterSnapshot');
    expect(model?.uniqueFields).toContainEqual(['customerId', 'season']);
  });
});

describe('RewardController routes', () => {
  let app: INestApplication;
  let baseUrl: string;
  const rewardService = {
    retryFailedRecords: jest.fn().mockResolvedValue(undefined),
    retryRecord: jest.fn().mockResolvedValue(undefined),
    retryRecords: jest.fn().mockResolvedValue(undefined),
    rollbackRecord: jest.fn().mockResolvedValue(undefined),
    rerunQuarterlyReward: jest.fn().mockResolvedValue(undefined),
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

  it('POST /reward/records/retry should call retryRecords with ids and return accepted', async () => {
    const response = await fetch(`${baseUrl}/reward/records/retry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [1, 2, 3] }),
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ accepted: true });
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

  it('POST /reward/periods/rerun should call rerunQuarterlyReward', async () => {
    const response = await fetch(`${baseUrl}/reward/periods/rerun`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        period: '2026-Q1',
        authToken: 'secret-token',
      }),
    });

    expect(response.status).toBe(201);
    expect(rewardService.rerunQuarterlyReward).toHaveBeenCalledWith(
      '2026-Q1',
      'secret-token',
    );
  });

  it('POST /reward/periods/rerun should validate payload', async () => {
    const response = await fetch(`${baseUrl}/reward/periods/rerun`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        period: '2026-Q5',
        authToken: '',
      }),
    });

    expect(response.status).toBe(400);
    expect(rewardService.rerunQuarterlyReward).not.toHaveBeenCalled();
  });

  it('POST /reward/periods/rerun should surface quarter-not-ended business validation', async () => {
    rewardService.rerunQuarterlyReward.mockRejectedValueOnce(
      new BadRequestException(
        'Cannot rerun period 2026-Q2 before quarter end in timezone America/New_York.',
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

    expect(response.status).toBe(400);
    expect(body.message).toBe(
      'Cannot rerun period 2026-Q2 before quarter end in timezone America/New_York.',
    );
    expect(rewardService.rerunQuarterlyReward).toHaveBeenCalledWith(
      '2026-Q2',
      'secret-token',
    );
  });

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
  it('should write customerId for reward ledger and update existing ledger for rollback', async () => {
    const create = jest.fn().mockResolvedValue({ id: 1 });
    const update = jest.fn().mockResolvedValue({ id: 1, type: 'ROLLBACK' });
    const tx = {
      beansLedger: { create, update },
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

    const existingLedger = {
      id: 1,
      customerId: record.customerId,
      rewardRecordId: record.id,
      idempotencyKey: 'test',
      referenceId: `${record.batchId}:${record.id}`,
    } as any;

    await service.appendRollbackLedger(
      tx,
      existingLedger,
      { reason: 'manual', operator: 'ops' },
    );

    const rewardData = create.mock.calls[0][0].data as Record<string, unknown>;

    expect(rewardData.customerId).toBe(record.customerId);
    expect(rewardData.userId).toBeUndefined();

    expect(update).toHaveBeenCalledWith({
      where: { id: existingLedger.id },
      data: {
        type: 'ROLLBACK',
        metadata: { reason: 'manual', operator: 'ops' },
      },
    });
  });
});
