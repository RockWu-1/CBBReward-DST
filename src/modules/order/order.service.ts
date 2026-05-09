import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { BigcommerceService } from '../bigcommerce/bigcommerce.service';

type CustomerOrderSnapshot = {
  customerId: number;
  totalAmount: Decimal;
};

export type CustomerOrderAggregate = {
  customerId: number;
  totalAmount: Decimal;
};

export function aggregateSnapshotsByCustomer(
  snapshots: CustomerOrderSnapshot[],
): CustomerOrderAggregate[] {
  const totalsByCustomer = new Map<number, Decimal>();

  for (const snapshot of snapshots) {
    const current = totalsByCustomer.get(snapshot.customerId) ?? new Decimal(0);
    totalsByCustomer.set(snapshot.customerId, current.add(snapshot.totalAmount));
  }

  return Array.from(totalsByCustomer.entries()).map(([customerId, totalAmount]) => ({
    customerId,
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
  ): Promise<CustomerOrderAggregate[]> {
    this.logger.log(
      `Fetch BigCommerce orders from ${startDate.toISOString()} to ${endDate.toISOString()}`,
    );

    const snapshots: CustomerOrderSnapshot[] = [];
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
          customerId: order.customer_id,
          totalAmount: new Decimal(order.total_inc_tax),
        });
      }

      hasNextPage = response.hasNextPage;
      page += 1;
    }

    return aggregateSnapshotsByCustomer(snapshots);
  }
}
