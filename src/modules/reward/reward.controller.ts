import { Body, Controller, Param, ParseIntPipe, Post } from '@nestjs/common';
import { CreateAdjustmentRequestDto } from './dto/create-adjustment.request.dto';
import { RerunQuarterlyRewardRequestDto } from './dto/rerun-quarterly-reward.request.dto';
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
  async retryBatch(@Param('id', ParseIntPipe) batchId: number): Promise<void> {
    await this.rewardService.retryFailedRecords(batchId);
  }

  @Post('records/:id/retry')
  async retryRecord(@Param('id', ParseIntPipe) recordId: number): Promise<void> {
    await this.rewardService.retryRecord(recordId);
  }

  @Post('records/:id/rollback')
  async rollbackRecord(
    @Param('id', ParseIntPipe) recordId: number,
    @Body() body: RollbackRecordRequestDto,
  ): Promise<void> {
    await this.rewardService.rollbackRecord(recordId, body.reason, body.operator);
  }

  @Post('periods/rerun')
  async rerunQuarterlyReward(
    @Body() body: RerunQuarterlyRewardRequestDto,
  ): Promise<{ success: true }> {
    return this.rewardService.rerunQuarterlyReward(body.period, body.authToken);
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
