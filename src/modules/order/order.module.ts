import { Module } from '@nestjs/common';
import { BigcommerceModule } from '../bigcommerce/bigcommerce.module';
import { OrderService } from './order.service';

@Module({
  imports: [BigcommerceModule],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
