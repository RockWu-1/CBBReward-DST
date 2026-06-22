import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminRole, AdminUser, TaskTriggerSource, TaskType } from '@prisma/client';
import { RewardService } from '../reward/reward.service';
import { AdminUserService } from '../admin-user/admin-user.service';
import { CreateAdminUserDto } from '../admin-user/dto/create-admin-user.dto';
import { TaskService } from '../task/task.service';

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
    private readonly taskService: TaskService,
  ) {}

  async retryBatch(batchId: number): Promise<AdminActionResult> {
    const task = await this.taskService.createTask({
      taskType: TaskType.BATCH_RETRY,
      triggerSource: TaskTriggerSource.ADMIN,
      title: `Retry failed records for batch ${batchId}`,
      rewardBatchId: batchId,
      triggeredBy: 'admin',
      requestPayload: { batchId },
    });
    await this.rewardService.retryFailedRecords(batchId, task.id);
    return { success: true, mode: 'live', message: 'Batch retry executed' };
  }

  async retryRecord(recordId: number): Promise<AdminActionResult> {
    const task = await this.taskService.createTask({
      taskType: TaskType.RECORD_RETRY,
      triggerSource: TaskTriggerSource.ADMIN,
      title: `Retry reward record ${recordId}`,
      rewardRecordId: recordId,
      triggeredBy: 'admin',
      requestPayload: { recordId },
    });
    await this.rewardService.retryRecord(recordId, task.id);
    return { success: true, mode: 'live', message: 'Record retry executed' };
  }

  async retryRecords(recordIds: number[], operator = 'admin'): Promise<AdminActionResult> {
    const task = await this.taskService.createTask({
      taskType: TaskType.RECORD_RETRY_BULK,
      triggerSource: TaskTriggerSource.ADMIN,
      title: `Bulk retry for ${recordIds.length} reward records`,
      targetIds: recordIds,
      triggeredBy: operator,
      requestPayload: { recordIds },
    });
    void this.rewardService.retryRecords(recordIds, task.id);
    return { success: true, mode: 'live', message: 'Batch record retry scheduled' };
  }

  async rollbackRecord(
    recordId: number,
    reason: string,
    operator: string,
  ): Promise<AdminActionResult> {
    const task = await this.taskService.createTask({
      taskType: TaskType.RECORD_ROLLBACK,
      triggerSource: TaskTriggerSource.ADMIN,
      title: `Rollback reward record ${recordId}`,
      rewardRecordId: recordId,
      triggeredBy: operator,
      requestPayload: { reason },
    });
    await this.rewardService.rollbackRecord(recordId, reason, operator, task.id);
    return { success: true, mode: 'live', message: 'Record rollback executed' };
  }

  async createAdminUser(
    currentAdmin: Pick<AdminUser, 'id' | 'email' | 'role'>,
    dto: CreateAdminUserDto,
  ): Promise<AdminActionResult> {
    if (currentAdmin.role !== AdminRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only SUPER_ADMIN can create admin user');
    }


    const user = await this.adminUserService.createAdminUser(dto);
    return {
      success: true,
      mode: 'live',
      message: 'Admin user created',
      data: { id: user.id, email: user.email, role: user.role, isActive: user.isActive },
    };
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
