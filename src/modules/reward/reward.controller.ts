import { Body, Controller, HttpCode, HttpStatus, Param, ParseIntPipe, Post } from '@nestjs/common';
import { RerunQuarterlyRewardRequestDto } from './dto/rerun-quarterly-reward.request.dto';
import { RetryRecordsRequestDto } from './dto/retry-records.request.dto';
import { RollbackRecordRequestDto } from './dto/rollback-record.request.dto';
import { RewardService } from './reward.service';

@Controller('reward')
export class RewardController {
  constructor(private readonly rewardService: RewardService) {}

  @Post('batches/:id/retry')
  async retryBatch(@Param('id', ParseIntPipe) batchId: number): Promise<void> {
    await this.rewardService.retryFailedRecords(batchId);
  }

  @Post('records/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  async retryRecords(@Body() body: RetryRecordsRequestDto): Promise<{ accepted: true }> {
    void this.rewardService.retryRecords(body.ids);
    return { accepted: true };
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
}
