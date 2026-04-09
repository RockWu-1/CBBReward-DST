import Decimal from 'decimal.js';
import { OrderService } from '../../../../src/modules/order/order.service';
import { BigcommerceService } from '../../../../src/modules/bigcommerce/bigcommerce.service';

describe('OrderService.fetchAndAggregateUserOrders', () => {
  it('aggregates total_inc_tax by customer_id across multiple pages', async () => {
    const listOrdersByDateRange = jest
      .fn()
      .mockResolvedValueOnce({
        orders: [
          {
            id: 1,
            customer_id: 1001,
            date_created: '2026-01-01T00:00:00.000Z',
            status: 'Completed',
            total_inc_tax: '10.25',
          },
          {
            id: 2,
            customer_id: null,
            date_created: '2026-01-01T00:00:00.000Z',
            status: 'Completed',
            total_inc_tax: '999.99',
          },
        ],
        hasNextPage: true,
      })
      .mockResolvedValueOnce({
        orders: [
          {
            id: 3,
            customer_id: 1001,
            date_created: '2026-01-02T00:00:00.000Z',
            status: 'Completed',
            total_inc_tax: '20.10',
          },
          {
            id: 4,
            customer_id: 1002,
            date_created: '2026-01-02T00:00:00.000Z',
            status: 'Completed',
            total_inc_tax: '5.00',
          },
        ],
        hasNextPage: false,
      });

    const bigcommerce = {
      listOrdersByDateRange,
    } as unknown as BigcommerceService;

    const service = new OrderService(bigcommerce);
    const startDate = new Date('2026-01-01T00:00:00.000Z');
    const endDate = new Date('2026-01-31T23:59:59.000Z');

    const result = await service.fetchAndAggregateUserOrders(startDate, endDate);

    expect(listOrdersByDateRange).toHaveBeenCalledTimes(2);
    expect(listOrdersByDateRange).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        startDate,
        endDate,
        page: 1,
      }),
    );
    expect(listOrdersByDateRange).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        startDate,
        endDate,
        page: 2,
      }),
    );

    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining([
        {
          userId: '1001',
          totalAmount: new Decimal('30.35'),
        },
        {
          userId: '1002',
          totalAmount: new Decimal('5'),
        },
      ]),
    );
  });

  it('returns empty array when all pages contain no aggregatable orders', async () => {
    const listOrdersByDateRange = jest.fn().mockResolvedValue({
      orders: [],
      hasNextPage: false,
    });
    const bigcommerce = {
      listOrdersByDateRange,
    } as unknown as BigcommerceService;

    const service = new OrderService(bigcommerce);
    const result = await service.fetchAndAggregateUserOrders(
      new Date('2026-02-01T00:00:00.000Z'),
      new Date('2026-02-28T23:59:59.000Z'),
    );

    expect(listOrdersByDateRange).toHaveBeenCalledTimes(1);
    expect(result).toEqual([]);
  });
});
