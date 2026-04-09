import { Body, Controller, Param, Post } from '@nestjs/common';
import { CreateAdjustmentRequestDto } from './dto/create-adjustment.request.dto';
import { RollbackRecordRequestDto } from './dto/rollback-record.request.dto';
import { RewardService } from './reward.service';

type CreateAdjustmentPayload = Omit<CreateAdjustmentRequestDto, 'period'> & {
  startDate: Date | string;
  endDate: Date | string;
};

@Controller('reward')
export class RewardController {
  constructor(private readonly rewardService: RewardService) {}

  @Post('batches/:id/retry')
  async retryBatch(@Param('id') batchId: string): Promise<void> {
    await this.rewardService.retryFailedRecords(batchId);
  }

  @Post('records/:id/retry')
  async retryRecord(@Param('id') recordId: string): Promise<void> {
    await this.rewardService.retryRecord(recordId);
  }

  @Post('records/:id/rollback')
  async rollbackRecord(
    @Param('id') recordId: string,
    @Body() body: RollbackRecordRequestDto,
  ): Promise<void> {
    await this.rewardService.rollbackRecord(recordId, body.reason, body.operator);
  }

  @Post('batches/:period/adjustments')
  async createAdjustmentBatch(
    @Param('period') period: string,
    @Body() body: CreateAdjustmentPayload,
  ) {
    return this.rewardService.createAdjustmentBatch({
      ...body,
      period,
      startDate: new Date(body.startDate),
      endDate: new Date(body.endDate),
    });
  }
}