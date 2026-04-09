import { HttpService } from '@nestjs/axios';
import { BadRequestException } from '@nestjs/common';
import { AxiosError } from 'axios';
import { of, throwError } from 'rxjs';
import { BigcommerceService } from '../../../../src/modules/bigcommerce/bigcommerce.service';
import { createTestingModule } from '../../../setup/testing.module';

describe('BigcommerceService', () => {
  let service: BigcommerceService;
  let http: { get: jest.Mock };

  const oldStoreHash = process.env.BIGCOMMERCE_STORE_HASH;
  const oldAccessToken = process.env.BIGCOMMERCE_ACCESS_TOKEN;

  beforeEach(async () => {
    process.env.BIGCOMMERCE_STORE_HASH = 'store-abc';
    process.env.BIGCOMMERCE_ACCESS_TOKEN = 'token-abc';

    http = { get: jest.fn() };

    const moduleRef = await createTestingModule({
      providers: [
        BigcommerceService,
        { provide: HttpService, useValue: http },
      ],
    });

    service = moduleRef.get(BigcommerceService);
  });

  afterAll(() => {
    process.env.BIGCOMMERCE_STORE_HASH = oldStoreHash;
    process.env.BIGCOMMERCE_ACCESS_TOKEN = oldAccessToken;
  });

  it('should call v2 orders endpoint with auth header and pagination params', async () => {
    http.get.mockReturnValue(
      of({
        data: [{ id: 1 }, { id: 2 }],
      }),
    );

    const startDate = new Date('2026-01-01T00:00:00.000Z');
    const endDate = new Date('2026-01-31T23:59:59.000Z');

    const result = await service.listOrdersByDateRange({
      startDate,
      endDate,
      page: 2,
      limit: 2,
    });

    expect(result).toEqual({
      orders: [{ id: 1 }, { id: 2 }],
      hasNextPage: true,
    });

    expect(http.get).toHaveBeenCalledWith(
      'https://api.bigcommerce.com/stores/store-abc/v2/orders',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Auth-Token': 'token-abc',
          Accept: 'application/json',
          'Content-Type': 'application/json',
        }),
        params: {
          min_date_created: startDate.toISOString(),
          max_date_created: endDate.toISOString(),
          page: 2,
          limit: 2,
        },
      }),
    );
  });

  it('should return hasNextPage false when returned orders are less than limit', async () => {
    http.get.mockReturnValue(
      of({
        data: [{ id: 10 }],
      }),
    );

    const result = await service.listOrdersByDateRange({
      startDate: new Date('2026-02-01T00:00:00.000Z'),
      endDate: new Date('2026-02-02T00:00:00.000Z'),
      page: 1,
      limit: 2,
    });

    expect(result).toEqual({
      orders: [{ id: 10 }],
      hasNextPage: false,
    });
  });

  it('should throw BadRequestException when required env vars are missing', async () => {
    delete process.env.BIGCOMMERCE_STORE_HASH;

    await expect(
      service.listOrdersByDateRange({
        startDate: new Date('2026-02-01T00:00:00.000Z'),
        endDate: new Date('2026-02-02T00:00:00.000Z'),
        page: 1,
        limit: 50,
      }),
    ).rejects.toThrow(BadRequestException);

    expect(http.get).not.toHaveBeenCalled();
  });

  it('should wrap downstream axios status error in BadRequestException', async () => {
    http.get.mockReturnValue(
      throwError(() => {
        const err = new AxiosError('Unauthorized');
        err.response = {
          status: 401,
          statusText: 'Unauthorized',
          headers: {},
          config: {} as never,
          data: { title: 'Invalid token' },
        };
        return err;
      }),
    );

    await expect(
      service.listOrdersByDateRange({
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2026-01-02T00:00:00.000Z'),
        page: 1,
        limit: 50,
      }),
    ).rejects.toThrow(/401/);
  });
});
