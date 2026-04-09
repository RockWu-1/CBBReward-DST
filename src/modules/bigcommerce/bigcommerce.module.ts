import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { BigcommerceService } from './bigcommerce.service';

@Module({
  imports: [HttpModule],
  providers: [BigcommerceService],
  exports: [BigcommerceService],
})
export class BigcommerceModule {}
