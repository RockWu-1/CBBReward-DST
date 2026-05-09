import { HttpService } from '@nestjs/axios';
import { BadRequestException, Injectable } from '@nestjs/common';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { BigcommerceOrder } from './types/bigcommerce-order.type';
import { ListOrdersInput } from './types/list-orders.input';

type ListOrdersResult = {
  orders: BigcommerceOrder[];
  hasNextPage: boolean;
};

type GetCustomerResult = {
  customerName: string;
  customerEmail: string;
};

type BigcommerceCustomerResponse = {
  name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
};

@Injectable()
export class BigcommerceService {
  private readonly baseUrl = 'https://api.bigcommerce.com';

  constructor(private readonly http: HttpService) {}

  async listOrdersByDateRange(input: ListOrdersInput): Promise<ListOrdersResult> {
    const storeHash = process.env.BIGCOMMERCE_STORE_HASH;
    const accessToken = process.env.BIGCOMMERCE_ACCESS_TOKEN;

    if (!storeHash || !accessToken) {
      throw new BadRequestException(
        'Missing BIGCOMMERCE_STORE_HASH or BIGCOMMERCE_ACCESS_TOKEN',
      );
    }

    try {
      const response = await firstValueFrom(
        this.http.get<BigcommerceOrder[]>(
          `${this.baseUrl}/stores/${storeHash}/v2/orders`,
          {
            headers: {
              'X-Auth-Token': accessToken,
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            params: {
              min_date_created: input.startDate.toISOString(),
              max_date_created: input.endDate.toISOString(),
              page: input.page,
              limit: input.limit,
            },
          },
        ),
      );

      const orders = Array.isArray(response.data) ? response.data : [];
      return {
        orders,
        hasNextPage: orders.length >= input.limit,
      };
    } catch (error: unknown) {
      const axiosError = error as AxiosError<{ title?: string }>;
      const status = axiosError.response?.status;
      const title = axiosError.response?.data?.title;
      const detail = title ?? axiosError.message ?? 'BigCommerce request failed';
      throw new BadRequestException(
        `BigCommerce error${status ? ` (${status})` : ''}: ${detail}`,
      );
    }
  }

  async getCustomer(customerId: number): Promise<GetCustomerResult> {
    const storeHash = process.env.BIGCOMMERCE_STORE_HASH;
    const accessToken = process.env.BIGCOMMERCE_ACCESS_TOKEN;

    if (!storeHash || !accessToken) {
      throw new BadRequestException(
        'Missing BIGCOMMERCE_STORE_HASH or BIGCOMMERCE_ACCESS_TOKEN',
      );
    }

    try {
      const response = await firstValueFrom(
        this.http.get<BigcommerceCustomerResponse>(
          `${this.baseUrl}/stores/${storeHash}/v2/customers/${customerId}`,
          {
            headers: {
              'X-Auth-Token': accessToken,
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      const customer = response.data ?? {};
      const fallbackName = [customer.first_name, customer.last_name]
        .map((part) => (part ?? '').trim())
        .filter((part) => part.length > 0)
        .join(' ');
      const customerName = (customer.name ?? '').trim() || fallbackName;

      return {
        customerName,
        customerEmail: customer.email ?? '',
      };
    } catch (error: unknown) {
      const axiosError = error as AxiosError<{ title?: string }>;
      const status = axiosError.response?.status;
      const title = axiosError.response?.data?.title;
      const detail = title ?? axiosError.message ?? 'BigCommerce request failed';
      throw new BadRequestException(
        `BigCommerce error${status ? ` (${status})` : ''}: ${detail}`,
      );
    }
  }
}
