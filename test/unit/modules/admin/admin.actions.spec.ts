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
      retryRecords: jest.fn(),
      rollbackRecord: jest.fn(),
    } as unknown as jest.Mocked<RewardService>;

    adminUserService = {
      createAdminUser: jest.fn(),
    } as unknown as jest.Mocked<AdminUserService>;

    service = new AdminActionsService(configService, rewardService, adminUserService);
  });

  it('should execute batch retry through reward service', async () => {
    const result = await service.retryBatch(42);

    expect(result).toEqual({
      success: true,
      mode: 'live',
      message: 'Batch retry executed',
    });
    expect(rewardService.retryFailedRecords).toHaveBeenCalledWith(42);
  });

  it('should schedule bulk record retry through reward service', async () => {
    const result = await service.retryRecords([10, 20, 30]);

    expect(result).toEqual({
      success: true,
      mode: 'live',
      message: 'Batch record retry scheduled',
    });
    expect(rewardService.retryRecords).toHaveBeenCalledWith([10, 20, 30]);
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

    adminUserService.createAdminUser.mockResolvedValue({
      id: 5,
      email: 'new-admin@example.com',
      role: AdminRole.OPERATOR,
      isActive: true,
    } as any);

    const created = await service.createAdminUser(superAdmin, {
      email: 'new-admin@example.com',
      password: 'pass123456',
      role: AdminRole.OPERATOR,
    });

    expect(created).toEqual({
      success: true,
      mode: 'live',
      message: 'Admin user created',
      data: {
        id: 5,
        email: 'new-admin@example.com',
        role: AdminRole.OPERATOR,
        isActive: true,
      },
    });
    expect(adminUserService.createAdminUser).toHaveBeenCalledWith({
      email: 'new-admin@example.com',
      password: 'pass123456',
      role: AdminRole.OPERATOR,
    });
  });
});
