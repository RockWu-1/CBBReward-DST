import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { BigcommerceService } from '../bigcommerce/bigcommerce.service';
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
  private static readonly ORDER_PAGE_SIZE = 250;

  constructor(private readonly bigcommerce: BigcommerceService) {}

  async fetchAndAggregateUserOrders(
    startDate: Date,
    endDate: Date,
  ): Promise<UserOrderAggregate[]> {
    this.logger.log(
      `Fetch BigCommerce orders from ${startDate.toISOString()} to ${endDate.toISOString()}`,
    );

    const snapshots: OrderSnapshot[] = [];
    let page = 1;
    let hasNextPage = true;

    while (hasNextPage) {
      const response = await this.bigcommerce.listOrdersByDateRange({
        startDate,
        endDate,
        page,
        limit: OrderService.ORDER_PAGE_SIZE,
      });

      for (const order of response.orders) {
        if (order.customer_id === null) {
          continue;
        }

        snapshots.push({
          userId: String(order.customer_id),
          totalAmount: new Decimal(order.total_inc_tax),
        });
      }

      hasNextPage = response.hasNextPage;
      page += 1;
    }

    return aggregateSnapshotsByUser(snapshots);
  }
}
