import { HttpService } from '@nestjs/axios';
import { AxiosError } from 'axios';
import { of, throwError } from 'rxjs';
import { ExternalApiError } from '../../../../src/common/errors/external-api.error';
import { EnvService } from '../../../../src/common/env/env.service';
import { BeansService } from '../../../../src/modules/beans/beans.service';
import { createTestingModule } from '../../../setup/testing.module';

type EnvServiceMock = {
  isBeansRealCallEnabled: jest.Mock<boolean, []>;
  isBeansNonTestAccountAllowed: jest.Mock<boolean, []>;
  getBeansSafeAccount: jest.Mock<string, []>;
  getBeansBaseUrl: jest.Mock<string, []>;
  getBeansApiKey: jest.Mock<string | undefined, []>;
  getBeansRewardRule: jest.Mock<string, []>;
  getBeansRollbackRule: jest.Mock<string, []>;
  getBeansRequestTimeoutMs: jest.Mock<number, []>;
};

describe('BeansService', () => {
  let service: BeansService;
  let http: { post: jest.Mock };
  let env: EnvServiceMock;

  beforeEach(async () => {
    http = { post: jest.fn() };
    env = {
      isBeansRealCallEnabled: jest.fn().mockReturnValue(false),
      isBeansNonTestAccountAllowed: jest.fn().mockReturnValue(false),
      getBeansSafeAccount: jest.fn().mockReturnValue('rock.wu@silksoftware.com'),
      getBeansBaseUrl: jest.fn().mockReturnValue('https://beans.example.test'),
      getBeansApiKey: jest.fn().mockReturnValue('token-1'),
      getBeansRewardRule: jest.fn().mockReturnValue('rule:liana:api_credit'),
      getBeansRollbackRule: jest.fn().mockReturnValue('rule:liana:expiration'),
      getBeansRequestTimeoutMs: jest.fn().mockReturnValue(5000),
    };

    const moduleRef = await createTestingModule({
      providers: [
        BeansService,
        { provide: HttpService, useValue: http },
        { provide: EnvService, useValue: env },
      ],
    });

    service = moduleRef.get(BeansService);
  });

  it('returns synthetic transaction id when real call switch is disabled', async () => {
    const result = await service.grantBeans({
      userId: 'user-1',
      beans: 12,
      idempotencyKey: 'abc',
      orderAmount: 24
    });

    expect(result).toEqual({ transactionId: 'txn_reward_abc' });
    expect(http.post).not.toHaveBeenCalled();
  });

  it('blocks real call for non-safe account by default', async () => {
    env.isBeansRealCallEnabled.mockReturnValue(true);
    env.isBeansNonTestAccountAllowed.mockReturnValue(false);

    await expect(
      service.grantBeans({
        userId: 'normal.user@silksoftware.com',
        beans: 9,
        idempotencyKey: 'ik-1',
        orderAmount: 18
      }),
    ).rejects.toMatchObject({
      name: ExternalApiError.name,
      retryable: false,
    });

    expect(http.post).not.toHaveBeenCalled();
  });

  it('calls beans api for safe account when real call switch is enabled', async () => {
    env.isBeansRealCallEnabled.mockReturnValue(true);
    http.post.mockReturnValue(
      of({
        data: { transactionId: 'txn-100' },
      }),
    );

    const result = await service.grantBeans({
      userId: 'rock.wu@silksoftware.com',
      beans: 66,
      idempotencyKey: 'ik-2',
      orderAmount: 132
    });

    expect(result).toEqual({ transactionId: 'txn-100' });
    expect(http.post).toHaveBeenCalledWith(
      'https://beans.example.test/v3/liana/credit/',
      expect.objectContaining({
        account: 'rock.wu@silksoftware.com',
        rule: 'rule:liana:api_credit',
        quantity: 66,
        uid: 'ik-2',
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Idempotency-Key': 'ik-2',
        }),
      }),
    );
  });

  it('maps 503 external error as retryable', async () => {
    env.isBeansRealCallEnabled.mockReturnValue(true);
    http.post.mockReturnValue(
      throwError(() => {
        const err = new AxiosError('Service Unavailable');
        err.response = {
          status: 503,
          statusText: 'Service Unavailable',
          headers: {},
          config: {} as never,
          data: { message: 'downstream down' },
        };
        return err;
      }),
    );

    await expect(
      service.grantBeans({
        userId: 'rock.wu@silksoftware.com',
        beans: 20,
        idempotencyKey: 'ik-3',
        orderAmount: 40
      }),
    ).rejects.toMatchObject({
      name: ExternalApiError.name,
      retryable: true,
      statusCode: 503,
    });
  });

  it('maps 400 external error as non-retryable', async () => {
    env.isBeansRealCallEnabled.mockReturnValue(true);
    http.post.mockReturnValue(
      throwError(() => {
        const err = new AxiosError('Bad Request');
        err.response = {
          status: 400,
          statusText: 'Bad Request',
          headers: {},
          config: {} as never,
          data: { message: 'invalid payload' },
        };
        return err;
      }),
    );

    await expect(
      service.rollbackBeans({
        userId: 'rock.wu@silksoftware.com',
        beans: 20,
        reason: 'fix',
        idempotencyKey: 'ik-4',
      }),
    ).rejects.toMatchObject({
      name: ExternalApiError.name,
      retryable: false,
      statusCode: 400,
    });
  });
});
