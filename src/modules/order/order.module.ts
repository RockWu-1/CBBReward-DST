import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { OrderService } from './order.service';

@Module({
  imports: [HttpModule],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
