import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { EnvService } from '../../common/env/env.service';
import { BeansService } from './beans.service';

@Module({
  imports: [HttpModule],
  providers: [BeansService, EnvService],
  exports: [BeansService],
})
export class BeansModule {}
