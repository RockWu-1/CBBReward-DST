import { ConfigService } from '@nestjs/config';
import { AdminRole } from '@prisma/client';
import { AdminUserService } from '../../../../src/modules/admin-user/admin-user.service';
import { AdminActionsService } from '../../../../src/modules/admin/admin.actions';
import { RewardService } from '../../../../src/modules/reward/reward.service';

describe('AdminActionsService', () => {
  let service: AdminActionsService;
  let configService: jest.Mocked<ConfigService>;
  let rewardService: jest.Mocked<RewardService>;
  let adminUserService: jest.Mocked<AdminUserService>;

  beforeEach(() => {
    configService = {
      get: jest.fn().mockReturnValue('true'),
    } as unknown as jest.Mocked<ConfigService>;

    rewardService = {
      retryFailedRecords: jest.fn(),
      retryRecord: jest.fn(),
      rollbackRecord: jest.fn(),
      createAdjustmentBatch: jest.fn(),
    } as unknown as jest.Mocked<RewardService>;

    adminUserService = {
      createAdminUser: jest.fn(),
    } as unknown as jest.Mocked<AdminUserService>;

    service = new AdminActionsService(configService, rewardService, adminUserService);
  });

  it('should return mock result in MOCK_MODE without calling reward service', async () => {
    const result = await service.retryBatch(42);

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        mode: 'mock',
        message: 'Mock action executed',
      }),
    );
    expect(rewardService.retryFailedRecords).not.toHaveBeenCalled();
  });

  it('should allow SUPER_ADMIN to create admin user and deny OPERATOR', async () => {
    const operator = { id: 1, email: 'op@example.com', role: AdminRole.OPERATOR };
    const superAdmin = { id: 2, email: 'root@example.com', role: AdminRole.SUPER_ADMIN };

    await expect(
      service.createAdminUser(operator, {
        email: 'new-admin@example.com',
        password: 'pass123456',
        role: AdminRole.OPERATOR,
      }),
    ).rejects.toThrow('Only SUPER_ADMIN can create admin user');

    const mockCreated = await service.createAdminUser(superAdmin, {
      email: 'new-admin@example.com',
      password: 'pass123456',
      role: AdminRole.OPERATOR,
    });

    expect(mockCreated).toEqual(
      expect.objectContaining({
        success: true,
        mode: 'mock',
      }),
    );
    expect(adminUserService.createAdminUser).not.toHaveBeenCalled();
  });
});
