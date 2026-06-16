import { LedgerType } from '@prisma/client';
import { LedgerService } from '../../../../src/modules/ledger/ledger.service';

describe('LedgerService.hasIssuedRewardForBatch', () => {
  it('returns true when a reward ledger with an external transaction exists for the batch', async () => {
    const count = jest.fn().mockResolvedValue(1);
    const service = new LedgerService({
      beansLedger: { count },
    } as any);

    await expect(service.hasIssuedRewardForBatch(12)).resolves.toBe(true);
    expect(count).toHaveBeenCalledWith({
      where: {
        type: LedgerType.REWARD,
        externalTxnId: { not: null },
        rewardRecord: { batchId: 12 },
      },
    });
  });
});
