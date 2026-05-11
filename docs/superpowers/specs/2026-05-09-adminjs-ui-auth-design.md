# AdminJS Frontend Integration and Admin Auth Design

- Date: 2026-05-09
- Scope: Integrate backend with AdminJS pages (login/list/detail/actions) and admin auth
- Status: Brainstormed and approved

## 1. Goal

Add a manageable admin frontend for the current backend service, including:
- Login page
- Data list pages
- Data detail pages
- Existing operational actions (retry/rollback/adjustment)
- Admin account creation in admin UI (only SUPER_ADMIN)

## 2. Confirmed Decisions

1. UI framework:
- Use AdminJS integrated directly into current NestJS app.

2. Login method:
- Local email/password auth with session.

3. Data scope:
- Include all core resources:
  - RewardBatch
  - RewardRecord
  - BeansLedger
  - OrderSnapshot

4. Action scope:
- Existing backend actions must be usable from frontend.

5. Admin registration:
- Admin creation is allowed in Admin UI.
- Only logged-in SUPER_ADMIN can create new admin users.
- Account identifier uses `email` (not username).

6. Mock policy:
- Keep mock minimal and easy to remove later.
- Default `MOCK_MODE=true` for development safety.
- Do not introduce heavy mock architecture.

## 3. Module Design

### 3.1 New modules
- `admin` module:
  - Mount AdminJS
  - Register resources and custom actions
  - Route path e.g. `/admin`
- `auth` module:
  - Admin local auth (email/password)
  - Session management
- `admin-user` service/resource:
  - Manage admin users from UI (SUPER_ADMIN only)

### 3.2 Existing modules reuse
- Reuse existing reward actions in admin custom actions:
  - Retry batch
  - Retry record
  - Rollback record
  - Create adjustment batch

## 4. Admin User Model

Add AdminUser table/model with:
- `id` (Int auto increment)
- `email` (unique)
- `passwordHash`
- `role` (`SUPER_ADMIN` / `OPERATOR`)
- `isActive`
- `createdAt`
- `updatedAt`

Notes:
- Passwords stored hashed only (bcrypt).
- Email validated and normalized.

## 5. Role and Permission Rules

- `SUPER_ADMIN`:
  - View all resources
  - Execute all operational actions
  - Create/manage admin users
- `OPERATOR`:
  - View all resources
  - Execute allowed operational actions (e.g., retry)
  - No admin user creation
  - No high-risk actions if restricted by policy

## 6. UI/Interaction Design

### 6.1 Login page
- Fields: `email`, `password`
- Invalid login -> clear error message

### 6.2 Resource list/detail pages
- Resources:
  - RewardBatch
  - RewardRecord
  - BeansLedger
  - OrderSnapshot
- Provide useful filters (status, period, customerId, time range, etc.)

### 6.3 Operational actions in UI
- Batch retry
- Record retry
- Record rollback
- Adjustment batch creation
- All actions require confirm step and toast feedback

### 6.4 Admin user management page
- Visible to SUPER_ADMIN only
- Create new admin with `email/password/role/isActive`

## 7. Minimal Mock Strategy (Easy to Remove)

Design principle: **single switch, thin wrapper, no parallel mock architecture**.

Implementation:
- Env switch: `MOCK_MODE=true|false`
- In admin action handlers only:
  - If `MOCK_MODE=true`: return deterministic mock result payload
  - If `MOCK_MODE=false`: call real service

Constraints:
- No separate mock data service tree
- No duplicated business logic for mock mode
- Mock mode applies only to admin-triggered actions, not core backend logic

This keeps final mock removal simple:
- Set `MOCK_MODE=false` in production
- Optionally remove small conditional branches later

## 8. Safety Controls

- Even in real mode, keep existing external-call safeguards (beans safe account policy) as defense in depth.
- Session secret must be configured explicitly.
- Production should enforce HTTPS and secure cookies.

## 9. Testing Strategy

### 9.1 Unit tests
- Auth (email login, password verification, role checks)
- Admin action handlers with `MOCK_MODE=true/false`
- Admin user creation permission (SUPER_ADMIN only)

### 9.2 Integration tests
- Admin route wiring and resource registration
- Permission gates for actions and user creation

### 9.3 Real external tests
- Not automated
- Manual by user only (as requested)

## 10. Non-Goals

- No OAuth/SSO in this iteration
- No custom full frontend app outside AdminJS
- No over-engineered mock system

## 11. Spec Self-Review

- Placeholder scan: no TODO/TBD placeholders
- Consistency: auth/account/action/mock decisions aligned
- Scope: implementable within current monolith
- Mock design intentionally minimal and removable
