# BigCommerce Module Design

- Date: 2026-04-09
- Scope: Add a dedicated `bigcommerce` module for API requests (orders first)
- Status: Brainstormed and approved

## 1. Goal and Scope

Introduce a dedicated BigCommerce integration module that owns HTTP concerns (auth, request building, pagination request execution, external error normalization), while keeping business aggregation logic inside `order` module.

This version includes only order retrieval by date range + pagination.

## 2. Confirmed Decisions

1. Module boundary:
- `bigcommerce` module = API client responsibilities only.
- `order` module = business filtering and aggregation.

2. API scope (v1):
- Support order list retrieval by date range + pagination only.

3. Auth mode:
- Use BigCommerce standard REST auth with `X-Auth-Token` + `storeHash`.

4. API version/base constraints:
- Use fixed BigCommerce base URL: `https://api.bigcommerce.com`.
- Use fixed API path version: `v2`.
- Do NOT add `BIGCOMMERCE_API_BASE_URL`.
- Do NOT add `BIGCOMMERCE_API_VERSION`.

5. Retry policy:
- No automatic retry in this version.

## 3. Environment Variables

Only two variables are required:
- `BIGCOMMERCE_STORE_HASH`
- `BIGCOMMERCE_ACCESS_TOKEN`

No additional BigCommerce env vars will be introduced in this version.

## 4. File Structure

### 4.1 New files
- `src/modules/bigcommerce/bigcommerce.module.ts`
- `src/modules/bigcommerce/bigcommerce.service.ts`
- `src/modules/bigcommerce/types/bigcommerce-order.type.ts`
- `src/modules/bigcommerce/types/list-orders.input.ts`

### 4.2 Modified files
- `src/app.module.ts` (register `BigcommerceModule`)
- `src/modules/order/order.module.ts` (import `BigcommerceModule`)
- `src/modules/order/order.service.ts` (use `BigcommerceService` instead of placeholder source)
- `test/unit/modules/order/...` (add/update order tests)
- `test/unit/modules/bigcommerce/...` (new service tests)

## 5. API Client Contract

Service method:
- `listOrdersByDateRange(input)`

Input (`ListOrdersInput`):
- `startDate: Date`
- `endDate: Date`
- `page: number`
- `limit: number`

Output:
- `orders: BigcommerceOrder[]`
- `hasNextPage: boolean`

## 6. Data Flow

1. `RewardService.runQuarterlyReward()` triggers `OrderService.fetchAndAggregateUserOrders(startDate, endDate)`.
2. `OrderService` loops pages by calling `BigcommerceService.listOrdersByDateRange(...)`.
3. `BigcommerceService` sends requests to:
   - `https://api.bigcommerce.com/stores/{storeHash}/v2/orders`
   - headers include `X-Auth-Token` and `Accept: application/json`
4. `OrderService` applies business filtering/mapping and aggregates amount by user.
5. Aggregated totals return to reward pipeline unchanged.

## 7. Error Handling

1. `BigcommerceService` catches HTTP/client errors and maps them into normalized domain error.
2. This version does not auto-retry in the BigCommerce client.
3. Upstream reward batch flow handles resulting failures through existing record/batch status logic.

## 8. Testing Strategy

### 8.1 Unit tests: BigcommerceService
- Builds correct v2 URL using `storeHash`.
- Sends `X-Auth-Token` header.
- Sends date-range and paging parameters.
- Normalizes external failures into expected internal error type.

### 8.2 Unit tests: OrderService
- Aggregates results across multiple pages from mocked BigcommerceService.
- Handles empty list correctly.
- Handles partial/invalid records with deterministic behavior.

### 8.3 Integration tests (light)
- Nest injection wiring for `BigcommerceModule` and `OrderModule`.
- Mocked end-to-end flow in application layer (no real BigCommerce call).

## 9. Non-Goals (This Iteration)

- No OAuth token refresh flow.
- No webhook implementation.
- No automatic 429/5xx retry/backoff.
- No additional endpoints (customers/products/etc.).

## 10. Spec Self-Review

- Placeholder scan: no TODO/TBD placeholders.
- Consistency: module boundaries, env constraints, and flow are aligned.
- Scope check: focused single sub-project (orders client integration) and implementation-ready.
- Ambiguity check: base URL/version/env decisions explicitly fixed.
