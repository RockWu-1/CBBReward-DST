import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { OrderSnapshot } from './types/order-snapshot.type';

export type UserOrderAggregate = {
  userId: string;
  totalAmount: Decimal;
};

export function aggregateSnapshotsByUser(
  snapshots: OrderSnapshot[],
): UserOrderAggregate[] {
  const totalsByUser = new Map<string, Decimal>();

  for (const snapshot of snapshots) {
    const current = totalsByUser.get(snapshot.userId) ?? new Decimal(0);
    totalsByUser.set(snapshot.userId, current.add(snapshot.totalAmount));
  }

  return Array.from(totalsByUser.entries()).map(([userId, totalAmount]) => ({
    userId,
    totalAmount,
  }));
}

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
    const snapshots: OrderSnapshot[] = [
      { userId: '1001', totalAmount: new Decimal('1250.00') },
      { userId: '1002', totalAmount: new Decimal('480.25') },
    ];

    return aggregateSnapshotsByUser(snapshots);
  }
}
