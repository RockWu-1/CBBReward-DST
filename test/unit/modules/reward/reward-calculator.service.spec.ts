import Decimal from 'decimal.js';
import { RewardCalculatorService } from '../../../../src/modules/reward/reward-calculator.service';

describe('RewardCalculatorService', () => {
  const service = new RewardCalculatorService();

  it('resolves tier boundaries correctly', () => {
    expect(service.resolveTier(new Decimal('1499.99'))).toBe('NONE');
    expect(service.resolveTier(new Decimal('1500'))).toBe('COLLECTIVE');
    expect(service.resolveTier(new Decimal('2499.99'))).toBe('COLLECTIVE');
    expect(service.resolveTier(new Decimal('2500'))).toBe('TOP_SHELF');
    expect(service.resolveTier(new Decimal('4999.99'))).toBe('TOP_SHELF');
    expect(service.resolveTier(new Decimal('5000'))).toBe('CRAFT');
    expect(service.resolveTier(new Decimal('9999.99'))).toBe('CRAFT');
    expect(service.resolveTier(new Decimal('10000'))).toBe('STUDIO');
    expect(service.resolveTier(new Decimal('18749.99'))).toBe('STUDIO');
    expect(service.resolveTier(new Decimal('18750'))).toBe('ICON');
  });

  it('applies 10% flat BOB rate for existing BOB-only customers until 2027-06-30', () => {
    const rates = service.resolveRates({
      tier: 'CRAFT',
      isExistingCustomer: true,
      bobAmount: new Decimal('5000'),
      csAmount: new Decimal('0'),
      allocationDate: new Date('2027-06-30T00:00:00.000Z'),
    });

    expect(rates).toEqual({ bobRate: 0.1, csRate: 0 });
  });

  it('falls back to tier rates after 2027-06-30 for existing BOB-only customers', () => {
    const rates = service.resolveRates({
      tier: 'CRAFT',
      isExistingCustomer: true,
      bobAmount: new Decimal('5000'),
      csAmount: new Decimal('0'),
      allocationDate: new Date('2027-07-01T00:00:00.000Z'),
    });

    expect(rates).toEqual({ bobRate: 0.08, csRate: 0.02 });
  });

  it('uses zero cs rate at COLLECTIVE tier', () => {
    const rates = service.resolveRates({
      tier: 'COLLECTIVE',
      isExistingCustomer: false,
      bobAmount: new Decimal('1500'),
      csAmount: new Decimal('500'),
      allocationDate: new Date('2026-04-01T00:00:00.000Z'),
    });

    expect(rates).toEqual({ bobRate: 0.05, csRate: 0 });
  });

  it('calculates brand rewards and total reward', () => {
    const result = service.calculateRewards({
      bobAmount: new Decimal('5000'),
      csAmount: new Decimal('3000'),
      rates: { bobRate: 0.08, csRate: 0.02 },
    });

    expect(result.bobReward.toString()).toBe('400');
    expect(result.csReward.toString()).toBe('60');
    expect(result.totalReward.toString()).toBe('460');
  });
});
