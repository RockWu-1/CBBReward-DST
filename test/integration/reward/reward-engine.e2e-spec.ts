import { Prisma } from '@prisma/client';
import { ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../../../src/app.module';
import { BigcommerceModule } from '../../../src/modules/bigcommerce/bigcommerce.module';
import { BigcommerceService } from '../../../src/modules/bigcommerce/bigcommerce.service';
import { OrderService } from '../../../src/modules/order/order.service';
import { RewardController } from '../../../src/modules/reward/reward.controller';
import { RewardService } from '../../../src/modules/reward/reward.service';

describe('Reward schema metadata', () => {
  const getModel = (name: string) =>
    Prisma.dmmf.datamodel.models.find((model) => model.name === name);

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
    const response = await fetch(`${baseUrl}/reward/batches/batch-1/retry`, {
      method: 'POST',
    });

    expect(response.status).toBe(201);
    expect(rewardService.retryFailedRecords).toHaveBeenCalledWith('batch-1');
  });

  it('POST /reward/records/:id/retry should call retryRecord', async () => {
    const response = await fetch(`${baseUrl}/reward/records/record-1/retry`, {
      method: 'POST',
    });

    expect(response.status).toBe(201);
    expect(rewardService.retryRecord).toHaveBeenCalledWith('record-1');
  });

  it('POST /reward/records/:id/rollback should be reachable and call rollbackRecord', async () => {
    const response = await fetch(`${baseUrl}/reward/records/record-1/rollback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reason: 'manual correction',
        operator: 'ops-user',
      }),
    });

    expect(response.status).toBe(201);
    expect(rewardService.rollbackRecord).toHaveBeenCalledWith(
      'record-1',
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
