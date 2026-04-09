# CBBReward-DST Reward Engine Design

- Date: 2026-04-03
- Scope: Backend reward settlement design (single service)
- Status: Draft reviewed with user during brainstorming

## 1. Goal and Boundaries

This design defines quarterly reward settlement for BigCommerce orders, with idempotent issuance to Beans, retry, rollback by negative ledger, and full auditability.

Confirmed constraints:
- Architecture style: monolith service (NestJS + PostgreSQL + Prisma + Docker)
- Order eligibility: only paid and completed orders
- Amount basis: net order amount (refunds deducted)
- Quarter freeze: completed quarter batch is immutable
- Late changes: handled by adjustment batch, never rewrite original completed batch
- Beans API capability: supports idempotency and explicit reversal
- Retry strategy: automatic retries up to 8 attempts with exponential backoff (cap 60 minutes) + manual retry

## 2. Architecture and Module Responsibilities

### 2.1 Scheduler module
- Runs daily cron (not quarter-day-only).
- If quarter start day, trigger previous quarter settlement.
- Always scans unfinished batches for catch-up execution after downtime/restart.

### 2.2 Reward module (orchestration core)
- Creates/loads reward batch by period.
- Orchestrates: snapshot orders -> aggregate -> build reward records -> call Beans -> write ledger -> finalize batch status.
- Exposes manual actions: retry record/batch, rollback record, create adjustment batch.

### 2.3 Order module
- Pulls BigCommerce orders in quarter window.
- Applies eligibility filter: paid + completed.
- Computes net amount after refunds.
- Stores order snapshots for deterministic re-computation and audit.

### 2.4 Beans module
- Encapsulates external Beans API (credit/debit).
- Maps internal DTO to API payload.
- Normalizes external errors and marks retryable/non-retryable.

### 2.5 Ledger module
- Append-only financial ledger.
- REWARD entries are positive; ROLLBACK entries are negative.
- Never delete historical records.

## 3. Data Model

Core tables:
- reward_batches
- reward_records
- beans_ledger
- order_snapshots

Recommended key fields:

### 3.1 reward_batches
- id
- period (UNIQUE, e.g. 2026-Q1)
- start_date
- end_date
- status (PENDING, PROCESSING, PARTIAL_FAILED, COMPLETED, FAILED)
- reward_rate
- started_at
- finished_at

Optional enhanced fields:
- batch_type (REGULAR, ADJUSTMENT)
- parent_period (for adjustment lineage)
- triggered_by (system/manual/operator)

### 3.2 reward_records
- id
- batch_id
- user_id
- total_order_amount
- reward_amount
- status (PENDING, SUCCESS, FAILED, ROLLED_BACK)
- attempt_count
- last_error
- next_retry_at
- processed_at

Unique constraints:
- UNIQUE(batch_id, user_id)

Optional rollback audit fields:
- rollback_reason
- rollback_by
- rollback_at

### 3.3 beans_ledger
- id
- user_id
- reward_record_id
- change_amount (positive reward, negative rollback)
- type (REWARD, ROLLBACK)
- reference_id
- idempotency_key (UNIQUE)
- external_txn_id
- metadata (JSON)
- created_at

### 3.4 order_snapshots
- id
- batch_id
- external_id
- customer_id
- order_amount (net)
- order_created
- raw_payload (JSON)
- created_at

Unique constraints:
- UNIQUE(batch_id, external_id)

## 4. Core Data Flow with Control Points

1) Daily scheduler tick
- Idempotency: repeated ticks converge to one valid batch per period.

2) getOrCreateBatch(period)
- Idempotency: UNIQUE(period) ensures single batch identity.

3) Mark batch PROCESSING (if not COMPLETED)
- Idempotency: COMPLETED batches are skipped.

4) Pull BigCommerce orders
- Retry: page-level retries on timeout/429/5xx.

5) Persist order snapshots
- Idempotency: UNIQUE(batch_id, external_id).

6) Aggregate net amount by user
- Determinism: based on stored snapshot set.

7) Upsert reward records
- Idempotency: UNIQUE(batch_id, user_id).

8) Process pending/failed records
- Idempotency: idempotency_key = reward:{reward_record_id}.
- Double guard: local ledger key + external API idempotency key.

9) On success
- Transaction: write positive ledger + update reward_record SUCCESS atomically.

10) On failure
- Retry: update attempt_count/last_error/next_retry_at.
- Policy: up to 8 attempts with exponential backoff, capped at 60 minutes.

11) Finalize batch
- COMPLETED if all records successful.
- PARTIAL_FAILED if any remain failed/pending.

12) Rollback path
- Call Beans debit with idempotency_key = rollback:{reward_record_id}.
- Transaction: append negative ledger + mark record ROLLED_BACK.
- Rule: never delete old ledger entries.

13) Late changes after freeze
- Create ADJUSTMENT batch against completed quarter.
- Never reopen or overwrite original completed batch.

## 5. Beans API Adapter Design

Confirmed local references:
- docs/apis/Beans.postman_collection.json
- Online doc: https://api.trybeans.com/v3/doc/

### 5.1 Endpoint mapping
- Grant: POST /v3/liana/credit/
- Rollback: POST /v3/liana/debit/

### 5.2 Payload mapping
- account: user account identifier (email for now)
- rule: env configured rule
- quantity: computed beans amount
- description: business context text
- uid: idempotent business key
  - reward uid: reward:{reward_record_id}
  - rollback uid: rollback:{reward_record_id}

### 5.3 Auth
- Basic auth via env variables only.
- No hard-coded token in code.

### 5.4 Error normalization
Normalized categories:
- BEANS_TIMEOUT
- BEANS_RATE_LIMIT
- BEANS_SERVER_ERROR
- BEANS_INVALID_REQUEST
- BEANS_AUTH_FAILED
- BEANS_ACCOUNT_NOT_FOUND
- BEANS_DUPLICATE_UID

Retryable:
- timeout, 429, 5xx

Non-retryable:
- 400/401/403/422 and semantic business hard errors

## 6. Rollback and Adjustment Design

### 6.1 Rollback rules
- Trigger per reward record.
- Must write negative ledger entry (type=ROLLBACK).
- Must keep original positive REWARD entry immutable.
- Must be idempotent with rollback key.

### 6.2 Adjustment batch rules
- Trigger when frozen quarter has late order/status/refund changes.
- Create new batch with lineage (parent_period).
- Compute delta only.
- Positive delta => reward ledger, negative delta => rollback ledger.

## 7. API Actions (Minimum Admin Surface)

- POST /reward/batches/:id/retry
- POST /reward/records/:id/retry
- POST /reward/records/:id/rollback
- POST /reward/batches/:period/adjustments
- GET /reward/batches/:id/audit

## 8. Testing Strategy

### 8.1 Unit
- quarter boundary functions
- reward record upsert idempotency
- processOneRecord success/idempotent/failure branches
- Beans adapter mapping and error normalization
- ledger append rules for REWARD/ROLLBACK

### 8.2 Integration
- UNIQUE(period) and UNIQUE(batch_id,user_id) enforcement
- transactional consistency (ledger + status)
- retry scheduling and re-processing
- rollback negative ledger correctness
- adjustment batch isolation from frozen original batch

### 8.3 End-to-end critical flows
- quarter-day settlement
- catch-up settlement after downtime
- manual retry/rollback/adjustment flow

## 9. Observability and Audit

Required persisted audit signals:
- Batch lifecycle timestamps/status transitions
- Record attempts/errors/retry schedule
- Ledger idempotency keys and external transaction ids
- Beans request/response diagnostic metadata (sanitized)

## 10. Out of Scope for this design version

- Multi-service decomposition
- Event bus/outbox architecture
- Cross-region HA design

## 11. Spec Self-Review Checklist

- Placeholder scan: no TODO/TBD placeholders remain.
- Consistency: data model, flow, and retry/rollback logic are aligned.
- Scope: focused to one implementable backend service.
- Ambiguity reduced by explicit confirmed choices in Section 1.
