import { Body, Controller, HttpCode, HttpStatus, Param, ParseIntPipe, Post } from '@nestjs/common';
import { TaskTriggerSource, TaskType } from '@prisma/client';
import { RerunQuarterlyRewardRequestDto } from './dto/rerun-quarterly-reward.request.dto';
import { RetryRecordsRequestDto } from './dto/retry-records.request.dto';
import { RollbackRecordRequestDto } from './dto/rollback-record.request.dto';
import { RewardService } from './reward.service';
import { TaskService } from '../task/task.service';

@Controller('reward')
export class RewardController {
  constructor(
    private readonly rewardService: RewardService,
    private readonly taskService: TaskService,
  ) {}

  @Post('batches/:id/retry')
  async retryBatch(@Param('id', ParseIntPipe) batchId: number): Promise<void> {
    const task = await this.taskService.createTask({
      taskType: TaskType.BATCH_RETRY,
      triggerSource: TaskTriggerSource.API,
      title: `Retry failed records for batch ${batchId}`,
      rewardBatchId: batchId,
      triggeredBy: 'api',
      requestPayload: { batchId },
    });
    await this.rewardService.retryFailedRecords(batchId, task.id);
  }

  @Post('records/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  async retryRecords(@Body() body: RetryRecordsRequestDto): Promise<{ accepted: true }> {
    const task = await this.taskService.createTask({
      taskType: TaskType.RECORD_RETRY_BULK,
      triggerSource: TaskTriggerSource.API,
      title: `Bulk retry for ${body.ids.length} reward records`,
      targetIds: body.ids,
      triggeredBy: 'api',
      requestPayload: { recordIds: body.ids },
    });
    void this.rewardService.retryRecords(body.ids, task.id);
    return { accepted: true };
  }

  @Post('records/:id/retry')
  async retryRecord(@Param('id', ParseIntPipe) recordId: number): Promise<void> {
    const task = await this.taskService.createTask({
      taskType: TaskType.RECORD_RETRY,
      triggerSource: TaskTriggerSource.API,
      title: `Retry reward record ${recordId}`,
      rewardRecordId: recordId,
      triggeredBy: 'api',
      requestPayload: { recordId },
    });
    await this.rewardService.retryRecord(recordId, task.id);
  }

  @Post('records/:id/rollback')
  async rollbackRecord(
    @Param('id', ParseIntPipe) recordId: number,
    @Body() body: RollbackRecordRequestDto,
  ): Promise<void> {
    const task = await this.taskService.createTask({
      taskType: TaskType.RECORD_ROLLBACK,
      triggerSource: TaskTriggerSource.API,
      title: `Rollback reward record ${recordId}`,
      rewardRecordId: recordId,
      triggeredBy: body.operator,
      requestPayload: { reason: body.reason },
    });
    await this.rewardService.rollbackRecord(recordId, body.reason, body.operator, task.id);
  }

  @Post('periods/rerun')
  async rerunQuarterlyReward(
    @Body() body: RerunQuarterlyRewardRequestDto,
  ): Promise<{ success: true }> {
    const task = await this.taskService.createTask({
      taskType: TaskType.PERIOD_RERUN,
      triggerSource: TaskTriggerSource.API,
      title: `Rerun period ${body.period}`,
      period: body.period,
      triggeredBy: 'api',
      requestPayload: { period: body.period, source: 'RERUN' },
    });
    return this.rewardService.rerunQuarterlyReward(body.period, body.authToken, task.id);
  }
}
