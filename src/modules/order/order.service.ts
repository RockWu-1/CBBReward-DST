import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';

export type UserOrderAggregate = {
  userId: string;
  totalAmount: Decimal;
};

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(private readonly http: HttpService) {}

  async fetchAndAggregateUserOrders(
    startDate: Date,
    endDate: Date,
  ): Promise<UserOrderAggregate[]> {
    this.logger.log(
      `Fetch BigCommerce orders from ${startDate.toISOString()} to ${endDate.toISOString()}`,
    );

    // Placeholder:
    // 1. Pull paginated orders from BigCommerce API
    // 2. Filter paid/completed orders
    // 3. Aggregate by customer/user id

    return [
      { userId: '1001', totalAmount: new Decimal('1250.00') },
      { userId: '1002', totalAmount: new Decimal('480.25') },
    ];
  }
}
