# BigCommerce Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增独立 `bigcommerce` 模块用于订单拉取请求（按时间范围+分页），并接入现有 `order` 聚合流程。

**Architecture:** `bigcommerce` 模块只处理外部 API 客户端职责（URL、鉴权、分页请求、错误标准化）；`order` 模块继续负责业务过滤与金额聚合；`reward` 流程无行为改变，仅替换订单来源。

**Tech Stack:** NestJS, TypeScript, Prisma, Jest (unit/integration), @nestjs/axios.

---

## File Structure Map

### New files
- `src/modules/bigcommerce/bigcommerce.module.ts`
- `src/modules/bigcommerce/bigcommerce.service.ts`
- `src/modules/bigcommerce/types/bigcommerce-order.type.ts`
- `src/modules/bigcommerce/types/list-orders.input.ts`
- `test/unit/modules/bigcommerce/bigcommerce.service.spec.ts`
- `test/unit/modules/order/order.service.spec.ts`

### Modified files
- `src/app.module.ts`
- `src/modules/order/order.module.ts`
- `src/modules/order/order.service.ts`
- `.env.example`

---

### Task 1: 建立 BigCommerce 模块骨架

**Files:**
- Create: `src/modules/bigcommerce/bigcommerce.module.ts`
- Create: `src/modules/bigcommerce/types/bigcommerce-order.type.ts`
- Create: `src/modules/bigcommerce/types/list-orders.input.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/modules/bigcommerce/bigcommerce.service.spec.ts
import { Test } from '@nestjs/testing';
import { BigcommerceModule } from '../../../../src/modules/bigcommerce/bigcommerce.module';

describe('BigcommerceModule', () => {
  it('should compile module', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [BigcommerceModule] }).compile();
    expect(moduleRef).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- test/unit/modules/bigcommerce/bigcommerce.service.spec.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: Write minimal implementation**

```ts
// src/modules/bigcommerce/types/list-orders.input.ts
export type ListOrdersInput = {
  startDate: Date;
  endDate: Date;
  page: number;
  limit: number;
};
```

```ts
// src/modules/bigcommerce/types/bigcommerce-order.type.ts
export type BigcommerceOrder = {
  id: number;
  customer_id: number | null;
  date_created: string;
  status: string;
  total_inc_tax: string;
  total_ex_tax?: string;
};
```

```ts
// src/modules/bigcommerce/bigcommerce.module.ts
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BigcommerceService } from './bigcommerce.service';

@Module({
  imports: [HttpModule],
  providers: [BigcommerceService],
  exports: [BigcommerceService],
})
export class BigcommerceModule {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- test/unit/modules/bigcommerce/bigcommerce.service.spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/bigcommerce test/unit/modules/bigcommerce/bigcommerce.service.spec.ts
git commit -m "feat: scaffold bigcommerce module and types"
```

### Task 2: 实现 BigCommerce 订单分页请求

**Files:**
- Create: `src/modules/bigcommerce/bigcommerce.service.ts`
- Modify: `.env.example`
- Test: `test/unit/modules/bigcommerce/bigcommerce.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('should call v2 orders endpoint with auth header and pagination params', async () => {
  // mock HttpService.get and assert URL/headers/params
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- test/unit/modules/bigcommerce/bigcommerce.service.spec.ts -t "v2 orders endpoint"`
Expected: FAIL。

- [ ] **Step 3: Write minimal implementation**

```ts
// src/modules/bigcommerce/bigcommerce.service.ts
import { HttpService } from '@nestjs/axios';
import { Injectable, BadRequestException } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { BigcommerceOrder } from './types/bigcommerce-order.type';
import { ListOrdersInput } from './types/list-orders.input';

@Injectable()
export class BigcommerceService {
  private readonly baseUrl = 'https://api.bigcommerce.com';

  constructor(private readonly http: HttpService) {}

  async listOrdersByDateRange(input: ListOrdersInput): Promise<{ orders: BigcommerceOrder[]; hasNextPage: boolean }> {
    const storeHash = process.env.BIGCOMMERCE_STORE_HASH;
    const token = process.env.BIGCOMMERCE_ACCESS_TOKEN;

    if (!storeHash || !token) {
      throw new BadRequestException('Missing BIGCOMMERCE_STORE_HASH or BIGCOMMERCE_ACCESS_TOKEN');
    }

    try {
      const response = await firstValueFrom(
        this.http.get<BigcommerceOrder[]>(
          `${this.baseUrl}/stores/${storeHash}/v2/orders`,
          {
            headers: {
              'X-Auth-Token': token,
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
      return { orders, hasNextPage: orders.length >= input.limit };
    } catch (error: any) {
      const status = error?.response?.status;
      const message = error?.response?.data?.title || error?.message || 'BigCommerce request failed';
      throw new BadRequestException(`BigCommerce error${status ? ` (${status})` : ''}: ${message}`);
    }
  }
}
```

```env
# .env.example additions (if missing)
BIGCOMMERCE_STORE_HASH=your-store-hash
BIGCOMMERCE_ACCESS_TOKEN=your-access-token
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- test/unit/modules/bigcommerce/bigcommerce.service.spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/bigcommerce/bigcommerce.service.ts .env.example test/unit/modules/bigcommerce/bigcommerce.service.spec.ts
git commit -m "feat: implement bigcommerce v2 order list client"
```

### Task 3: 将 OrderService 接入 BigCommerceService

**Files:**
- Modify: `src/modules/order/order.module.ts`
- Modify: `src/modules/order/order.service.ts`
- Test: `test/unit/modules/order/order.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('should aggregate orders across multiple pages from BigcommerceService', async () => {
  // mock listOrdersByDateRange page 1 + page 2
  // assert aggregated user totals
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- test/unit/modules/order/order.service.spec.ts`
Expected: FAIL。

- [ ] **Step 3: Write minimal implementation**

```ts
// src/modules/order/order.module.ts
import { Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { BigcommerceModule } from '../bigcommerce/bigcommerce.module';

@Module({
  imports: [BigcommerceModule],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
```

```ts
// src/modules/order/order.service.ts (core logic)
import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { BigcommerceService } from '../bigcommerce/bigcommerce.service';

export type UserOrderAggregate = { userId: string; totalAmount: Decimal };

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(private readonly bigcommerceService: BigcommerceService) {}

  async fetchAndAggregateUserOrders(startDate: Date, endDate: Date): Promise<UserOrderAggregate[]> {
    const totals = new Map<string, Decimal>();
    let page = 1;
    const limit = 250;

    while (true) {
      const { orders, hasNextPage } = await this.bigcommerceService.listOrdersByDateRange({
        startDate,
        endDate,
        page,
        limit,
      });

      for (const order of orders) {
        if (!order.customer_id) continue;
        const userId = String(order.customer_id);
        const amount = new Decimal(order.total_inc_tax || '0');
        totals.set(userId, (totals.get(userId) ?? new Decimal(0)).add(amount));
      }

      if (!hasNextPage) break;
      page += 1;
    }

    this.logger.log(`Aggregated ${totals.size} users from BigCommerce orders`);
    return [...totals.entries()].map(([userId, totalAmount]) => ({ userId, totalAmount }));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- test/unit/modules/order/order.service.spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/order/order.module.ts src/modules/order/order.service.ts test/unit/modules/order/order.service.spec.ts
git commit -m "feat: wire order service to bigcommerce client with paged aggregation"
```

### Task 4: 应用层注册与回归验证

**Files:**
- Modify: `src/app.module.ts`
- Test: `test/integration/reward/reward-engine.e2e-spec.ts` (minimal wiring assertion)

- [ ] **Step 1: Write the failing test**

```ts
it('app module should resolve OrderService with Bigcommerce dependency', async () => {
  // create testing module imports AppModule and resolve OrderService
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration -- test/integration/reward/reward-engine.e2e-spec.ts`
Expected: FAIL（若未注册依赖）。

- [ ] **Step 3: Write minimal implementation**

```ts
// src/app.module.ts
import { BigcommerceModule } from './modules/bigcommerce/bigcommerce.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    BigcommerceModule,
    OrderModule,
    BeansModule,
    LedgerModule,
    RewardModule,
    SchedulerModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
- `npm run test:unit`
- `npm run test:integration`
- `npm run build`

Expected: all PASS。

- [ ] **Step 5: Commit**

```bash
git add src/app.module.ts test/integration/reward/reward-engine.e2e-spec.ts
git commit -m "chore: register bigcommerce module and pass full regression"
```

---

## Spec Coverage Self-Review

- 独立 bigcommerce 模块：Task 1, Task 2。
- 时间范围+分页拉单：Task 2。
- 固定 base URL + v2 + token/storeHash：Task 2。
- 无自动重试：Task 2（仅标准化抛错）。
- order 负责聚合：Task 3。
- 应用接入与回归：Task 4。

## Placeholder Scan

- 已检查，无 `TODO/TBD/implement later/fill in details` 占位语句。

## Type Consistency

- `listOrdersByDateRange` 在类型、服务实现、调用侧（OrderService）名称一致。
- `BigcommerceOrder.customer_id/total_inc_tax` 在类型与聚合逻辑中一致。
