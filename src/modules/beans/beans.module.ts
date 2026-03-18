import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BeansService } from './beans.service';

@Module({
  imports: [HttpModule],
  providers: [BeansService],
  exports: [BeansService],
})
export class BeansModule {}
