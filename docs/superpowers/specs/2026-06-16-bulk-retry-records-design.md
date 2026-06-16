# Bulk Retry Reward Records Design

## Goal

Add an asynchronous bulk retry capability for reward records so admins can select multiple reward records in the admin UI, trigger retries in one action, and receive an immediate response without waiting for all retry work to finish.

## Current Context

- The backend already supports single-record retry through `POST /reward/records/:id/retry`.
- The backend already supports batch retry by batch id through `POST /reward/batches/:id/retry`.
- The admin UI is built with AdminJS resource actions, and reward record retry currently exists as a record-level action only.
- Existing retry behavior is encapsulated in `RewardService.retryRecord(recordId)`.

## Requirements

- Add a backend endpoint that accepts an array of reward record ids.
- The endpoint must return immediately instead of waiting for all retries to finish.
- The retry logic for each record must remain aligned with the existing single-record retry behavior.
- A failure on one record must not prevent retry attempts for the remaining records.
- Add an admin bulk action so admins can select multiple reward records and trigger the new capability from the existing admin UI.
- The admin UI should show a scheduling-style success notice rather than implying synchronous completion.

## Recommended Approach

### Backend API

Add a new endpoint:

- `POST /reward/records/retry`

Request body:

```json
{
  "ids": [1, 2, 3]
}
```

Validation rules:

- `ids` must be present
- `ids` must be an array
- `ids` must not be empty
- every entry must be an integer

The controller should trigger the work in fire-and-forget mode:

- call `void this.rewardService.retryRecords(ids)`
- return immediately with an accepted-style response

This keeps the client from waiting on record-by-record processing.

### Reward Service

Add a new method:

- `retryRecords(recordIds: number[]): Promise<void>`

Behavior:

- deduplicate incoming ids
- iterate over the ids in order
- call the existing `retryRecord(recordId)` for each id
- catch per-record errors and log them
- continue processing remaining ids even if one retry fails

This keeps the retry rules centralized in the existing single-record flow and avoids duplicating business logic.

### Admin UI

Add a new AdminJS bulk action on the `RewardRecord` resource:

- action id: `retryRecords`
- action type: `bulk`
- label: `Retry Selected`

Behavior:

- collect selected record ids from `context.records`
- pass them to a new admin action service method
- show a notice such as `Batch retry scheduled`

Visibility/access:

- visible and accessible when at least one selected record is in a retryable status

If desired, non-retryable selected records can still be included in the submitted ids because the backend already owns the actual retry rules. The initial implementation should favor consistency with existing retryability checks and avoid adding extra record filtering rules beyond what the current admin action model already uses.

### Admin Action Service

Add:

- `retryRecords(recordIds: number[]): Promise<AdminActionResult>`

Behavior:

- invoke the new reward service bulk entrypoint
- return a success message indicating scheduling, not completion

## Error Handling

- Invalid request payload should be rejected by DTO validation.
- Individual record retry failures should be logged inside `RewardService.retryRecords`.
- The bulk endpoint should not fail just because one asynchronous retry later fails.
- The UI success message should reflect that the request was accepted, not that all retries completed successfully.

## Testing Strategy

### Backend

- Add controller/integration coverage for `POST /reward/records/retry`
- verify the route accepts valid payloads
- verify invalid payloads are rejected
- verify the controller passes the ids to the reward service entrypoint

### Service

- add a unit test proving `retryRecords` deduplicates ids
- add a unit test proving it calls `retryRecord` once per unique id
- add a unit test proving one thrown error does not stop later ids from being attempted

### Admin

- add unit coverage for the admin actions service bulk method
- add unit coverage for the AdminJS bulk action handler to ensure selected ids are forwarded correctly

## Out of Scope

- introducing a dedicated job queue or worker system
- adding a progress page or polling UI
- changing the core business rules inside `retryRecord`
