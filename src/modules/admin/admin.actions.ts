import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminRole, AdminUser } from '@prisma/client';
import { CreateAdjustmentRequestDto } from '../reward/dto/create-adjustment.request.dto';
import { RewardService } from '../reward/reward.service';
import { AdminUserService } from '../admin-user/admin-user.service';
import { CreateAdminUserDto } from '../admin-user/dto/create-admin-user.dto';

type AdminActionResult = {
  success: true;
  mode: 'mock' | 'live';
  message: string;
  data?: unknown;
};

@Injectable()
export class AdminActionsService {
  constructor(
    private readonly configService: ConfigService,
    private readonly rewardService: RewardService,
    private readonly adminUserService: AdminUserService,
  ) {}

  async retryBatch(batchId: number): Promise<AdminActionResult> {
    if (this.isMockMode()) {
      return this.mockResult('batch.retry', { batchId });
    }
    await this.rewardService.retryFailedRecords(batchId);
    return { success: true, mode: 'live', message: 'Batch retry executed' };
  }

  async retryRecord(recordId: number): Promise<AdminActionResult> {
    if (this.isMockMode()) {
      return this.mockResult('record.retry', { recordId });
    }
    await this.rewardService.retryRecord(recordId);
    return { success: true, mode: 'live', message: 'Record retry executed' };
  }

  async rollbackRecord(
    recordId: number,
    reason: string,
    operator: string,
  ): Promise<AdminActionResult> {
    if (this.isMockMode()) {
      return this.mockResult('record.rollback', { recordId, reason, operator });
    }
    await this.rewardService.rollbackRecord(recordId, reason, operator);
    return { success: true, mode: 'live', message: 'Record rollback executed' };
  }

  async createAdjustment(dto: CreateAdjustmentRequestDto): Promise<AdminActionResult> {
    if (this.isMockMode()) {
      return this.mockResult('batch.adjustment.create', { period: dto.period });
    }
    const batch = await this.rewardService.createAdjustmentBatch(dto);
    return { success: true, mode: 'live', message: 'Adjustment batch created', data: batch };
  }

  async createAdminUser(
    currentAdmin: Pick<AdminUser, 'id' | 'email' | 'role'>,
    dto: CreateAdminUserDto,
  ): Promise<AdminActionResult> {
    if (currentAdmin.role !== AdminRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only SUPER_ADMIN can create admin user');
    }

    if (this.isMockMode()) {
      return this.mockResult('admin-user.create', {
        requestedBy: currentAdmin.email,
        email: dto.email,
        role: dto.role,
      });
    }

    const user = await this.adminUserService.createAdminUser(dto);
    return {
      success: true,
      mode: 'live',
      message: 'Admin user created',
      data: { id: user.id, email: user.email, role: user.role, isActive: user.isActive },
    };
  }

  private isMockMode(): boolean {
    return this.configService.get<string>('MOCK_MODE', 'true') === 'true';
  }

  private mockResult(action: string, payload: unknown): AdminActionResult {
    return {
      success: true,
      mode: 'mock',
      message: 'Mock action executed',
      data: { action, payload },
    };
  }
}
