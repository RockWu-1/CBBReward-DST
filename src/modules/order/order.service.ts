import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { BigcommerceService } from '../bigcommerce/bigcommerce.service';

type CustomerOrderSnapshot = {
  customerId: number;
  bobAmount: Decimal;
  csAmount: Decimal;
};

export type CustomerOrderAggregate = {
  customerId: number;
  totalAmount: Decimal;
  bobAmount: Decimal;
  csAmount: Decimal;
};

export function aggregateSnapshotsByCustomer(
  snapshots: CustomerOrderSnapshot[],
): CustomerOrderAggregate[] {
  const totalsByCustomer = new Map<number, { bobAmount: Decimal; csAmount: Decimal }>();

  for (const snapshot of snapshots) {
    const current = totalsByCustomer.get(snapshot.customerId) ?? {
      bobAmount: new Decimal(0),
      csAmount: new Decimal(0),
    };
    totalsByCustomer.set(snapshot.customerId, {
      bobAmount: current.bobAmount.add(snapshot.bobAmount),
      csAmount: current.csAmount.add(snapshot.csAmount),
    });
  }

  return Array.from(totalsByCustomer.entries()).map(([customerId, amount]) => {
    const totalAmount = amount.bobAmount.add(amount.csAmount);
    return {
      customerId,
      totalAmount,
      bobAmount: amount.bobAmount,
      csAmount: amount.csAmount,
    };
  });
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
        const products = await this.bigcommerce.listOrderProducts(order.id);
        let bobAmount = new Decimal(0);
        let csAmount = new Decimal(0);

        for (const product of products) {
          const rawAmount = product.total_ex_tax ?? '0';
          const amount = new Decimal(rawAmount);
          const brandName = (product.brand ?? '').trim().toLowerCase();
          if (brandName === 'back of bottle') {
            bobAmount = bobAmount.add(amount);
          } else if (brandName === 'color space') {
            csAmount = csAmount.add(amount);
          }
        }

        snapshots.push({
          customerId: order.customer_id,
          bobAmount,
          csAmount,
        });
      }

      hasNextPage = response.hasNextPage;
      page += 1;
    }

    return aggregateSnapshotsByCustomer(snapshots);
  }
}
