import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { ExternalApiError } from '../../common/errors/external-api.error';
import { EnvService } from '../../common/env/env.service';

type GrantBeansInput = {
  customerEmail: string;
  beans: number;
  idempotencyKey: string;
  orderAmount: number;
};

type RollbackBeansInput = {
  customerEmail: string;
  beans: number;
  reason: string;
  idempotencyKey: string;
  externalTxnId: string;
};

@Injectable()
export class BeansService {
  private readonly logger = new Logger(BeansService.name);

  constructor(
    private readonly http: HttpService,
    private readonly env: EnvService,
  ) {}

  async grantBeans(input: GrantBeansInput): Promise<{ transactionId: string }> {
    this.logger.log(`Grant beans user=${input.customerEmail} amount=${input.beans}`);

    if (!this.env.isBeansRealCallEnabled()) {
      return { transactionId: `txn_reward_${input.idempotencyKey}` };
    }

    this.assertRealCallAllowed(input.customerEmail);
    return this.postToBeans(
      '/v3/liana/credit/',
      {
        account: input.customerEmail,
        rule: this.env.getBeansRewardRule(),
        quantity: String(input.beans),
        description: `Customer loyalty rewarded for spending $${input.orderAmount} for last quarter`,
        uid: input.idempotencyKey,
      },
      input.idempotencyKey,
      'grantBeans',
    );
  }

  async rollbackBeans(input: RollbackBeansInput): Promise<{ transactionId: string }> {
    this.logger.warn(
      `Rollback beans user=${input.customerEmail} amount=${input.beans} reason=${input.reason}`,
    );
    return this.postToBeans(
      `/v3/liana/credit/${input.externalTxnId}/cancel`,
      {},
      input.idempotencyKey,
      'rollbackBeans',
    );
  }

  private assertRealCallAllowed(userId: string): void {
    const safeAccount = this.env.getBeansSafeAccount().toLowerCase();
    const normalizedUserId = userId.toLowerCase();
    if (normalizedUserId === safeAccount || this.env.isBeansNonTestAccountAllowed()) {
      return;
    }

    throw new ExternalApiError({
      provider: 'Beans',
      operation: 'real-call-guard',
      message:
        'Beans real call blocked for non-safe account. Set BEANS_ALLOW_NON_SAFE_ACCOUNT_REAL_CALL=true to allow.',
      retryable: false,
      code: 'BEANS_REAL_CALL_BLOCKED',
    });
  }

  private async postToBeans(
    path: string,
    body: object,
    idempotencyKey: string,
    operation: string,
  ): Promise<{ transactionId: string }> {
    const baseUrl = this.env.getBeansBaseUrl().trim().replace(/\/$/, '');
    if (!baseUrl) {
      throw new ExternalApiError({
        provider: 'Beans',
        operation,
        message: 'Missing BEANS_API_BASE_URL',
        retryable: false,
        code: 'BEANS_CONFIG_MISSING_BASE_URL',
      });
    }

    const headers: Record<string, string> = {};


    const apiKey = this.env.getBeansApiKey();
    if (apiKey) {
      headers.Authorization = `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;
    }

    try {
      const response = await firstValueFrom(
        this.http.post<{ id?: string }>(`${baseUrl}${path}`, body, {
          headers,
          timeout: this.env.getBeansRequestTimeoutMs(),
        }),
      );
      console.log("🚀 ~ BeansService ~ postToBeans ~ response:", response)

      const transactionId = response.data?.id;
      if (typeof transactionId !== 'string' || transactionId.length === 0) {
        throw new ExternalApiError({
          provider: 'Beans',
          operation,
          message: 'Invalid beans response: missing transactionId',
          retryable: false,
          code: 'BEANS_INVALID_RESPONSE',
        });
      }

      return { transactionId };
    } catch (error:any) {
      console.error('error when send post to beans',JSON.stringify(error));
      throw ExternalApiError.fromUnknown('Beans', operation, error);
    }
  }
}
