import { Injectable } from '@nestjs/common';

@Injectable()
export class EnvService {
  isBeansRealCallEnabled(): boolean {
    return this.readBoolean('BEANS_REAL_CALL_ENABLED', false);
  }

  isBeansNonTestAccountAllowed(): boolean {
    return this.readBoolean('BEANS_ALLOW_NON_SAFE_ACCOUNT_REAL_CALL', false);
  }

  getBeansSafeAccount(): string {
    return process.env.BEANS_SAFE_ACCOUNT ?? 'rock.wu@silksoftware.com';
  }

  getBeansBaseUrl(): string {
    return process.env.BEANS_API_BASE_URL ?? '';
  }

  getBeansApiKey(): string | undefined {
    return process.env.BEANS_API_KEY;
  }

  getBeansRewardRule(): string {
    return process.env.BEANS_REWARD_RULE ?? 'rule:liana:api_credit';
  }

  getBeansRollbackRule(): string {
    return process.env.BEANS_ROLLBACK_RULE ?? 'rule:liana:expiration';
  }

  getBeansRequestTimeoutMs(): number {
    const raw = process.env.BEANS_API_TIMEOUT_MS;
    const timeout = Number(raw);
    if (!raw || !Number.isFinite(timeout) || timeout <= 0) {
      return 5000;
    }
    return timeout;
  }

  private readBoolean(name: string, fallback: boolean): boolean {
    const value = process.env[name];
    if (!value) {
      return fallback;
    }
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  }
}
