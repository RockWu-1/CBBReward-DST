# AdminJS UI and Admin Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为现有 NestJS 后端集成 AdminJS 管理页面（登录、列表、详情、操作）并实现本地 Admin 用户认证（email/password）。

**Architecture:** 新增 `admin` 与 `auth` 相关模块，使用 AdminJS 内嵌于现有应用。复用现有 reward 操作接口，并以 `MOCK_MODE` 单开关控制 admin action 是否执行真实调用，保持 mock 最小侵入、易移除。

**Tech Stack:** NestJS, AdminJS, @adminjs/nestjs, Prisma, express-session, bcrypt, Jest.

---

## File Structure Map

### New files
- `src/modules/admin/admin.module.ts`
- `src/modules/admin/admin.config.ts`
- `src/modules/admin/admin.actions.ts`
- `src/modules/auth/admin-auth.service.ts`
- `src/modules/auth/auth.module.ts`
- `src/modules/admin-user/admin-user.module.ts`
- `src/modules/admin-user/admin-user.service.ts`
- `src/modules/admin-user/dto/create-admin-user.dto.ts`
- `test/unit/modules/auth/admin-auth.service.spec.ts`
- `test/unit/modules/admin/admin.actions.spec.ts`
- `test/integration/admin/admin-wiring.e2e-spec.ts`

### Modified files
- `prisma/schema.prisma`
- `src/app.module.ts`
- `src/main.ts`
- `.env.example`
- `package.json`

---

### Task 1: 安装依赖并建立 AdminUser 数据模型

**Files:**
- Modify: `package.json`
- Modify: `prisma/schema.prisma`
- Test: `test/integration/admin/admin-wiring.e2e-spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('should expose AdminUser model with email unique and role fields', () => {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'AdminUser');
  const names = model?.fields.map((f) => f.name) ?? [];
  expect(names).toEqual(expect.arrayContaining(['email', 'passwordHash', 'role', 'isActive']));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration -- test/integration/admin/admin-wiring.e2e-spec.ts -t "AdminUser model"`
Expected: FAIL。

- [ ] **Step 3: Write minimal implementation**

```prisma
enum AdminRole {
  SUPER_ADMIN
  OPERATOR
}

model AdminUser {
  id           Int       @id @default(autoincrement())
  email        String    @unique
  passwordHash String
  role         AdminRole @default(OPERATOR)
  isActive     Boolean   @default(true)
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
}
```

```json
// package.json add deps
"dependencies": {
  "adminjs": "^7.8.0",
  "@adminjs/nestjs": "^6.1.0",
  "@adminjs/prisma": "^5.0.0",
  "express-session": "^1.18.1",
  "bcrypt": "^5.1.1"
},
"devDependencies": {
  "@types/express-session": "^1.18.0",
  "@types/bcrypt": "^5.0.2"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
- `npx prisma generate`
- `npm run test:integration -- test/integration/admin/admin-wiring.e2e-spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add package.json prisma/schema.prisma test/integration/admin/admin-wiring.e2e-spec.ts
git commit -m "feat: add admin user schema and adminjs dependencies"
```

### Task 2: 实现 Admin 认证服务（email/password + role）

**Files:**
- Create: `src/modules/auth/admin-auth.service.ts`
- Create: `src/modules/auth/auth.module.ts`
- Create: `test/unit/modules/auth/admin-auth.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('should authenticate active admin by email and password', async () => {
  // mock prisma adminUser + bcrypt.compare
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- test/unit/modules/auth/admin-auth.service.spec.ts`
Expected: FAIL。

- [ ] **Step 3: Write minimal implementation**

```ts
@Injectable()
export class AdminAuthService {
  constructor(private readonly prisma: PrismaService) {}

  async authenticate(email: string, password: string) {
    const admin = await this.prisma.adminUser.findUnique({ where: { email } });
    if (!admin || !admin.isActive) return null;
    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok) return null;
    return { id: admin.id, email: admin.email, role: admin.role };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- test/unit/modules/auth/admin-auth.service.spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/auth test/unit/modules/auth/admin-auth.service.spec.ts
git commit -m "feat: add admin email/password authentication service"
```

### Task 3: 集成 AdminJS 与资源列表详情

**Files:**
- Create: `src/modules/admin/admin.module.ts`
- Create: `src/modules/admin/admin.config.ts`
- Modify: `src/app.module.ts`
- Modify: `src/main.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write the failing test**

```ts
it('should wire admin module into app module imports', () => {
  const imports = Reflect.getMetadata('imports', AppModule) as unknown[];
  expect(imports).toContain(AdminModule);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration -- test/integration/admin/admin-wiring.e2e-spec.ts -t "wire admin module"`
Expected: FAIL。

- [ ] **Step 3: Write minimal implementation**

```ts
// admin.module.ts
@Module({ imports: [AuthModule, AdminUserModule, PrismaModule] })
export class AdminModule {}
```

```ts
// admin.config.ts
// register resources: RewardBatch, RewardRecord, BeansLedger, OrderSnapshot, AdminUser
// configure AdminJS auth callback using AdminAuthService
```

```ts
// main.ts
app.use(session({ secret: process.env.ADMIN_SESSION_SECRET!, resave: false, saveUninitialized: false }));
```

```env
# .env.example additions
ADMIN_SESSION_SECRET=replace-me
MOCK_MODE=true
ADMIN_DEFAULT_EMAIL=admin@example.com
ADMIN_DEFAULT_PASSWORD=replace-me
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:integration -- test/integration/admin/admin-wiring.e2e-spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/admin src/app.module.ts src/main.ts .env.example
git commit -m "feat: integrate adminjs resources and session auth wiring"
```

### Task 4: 接入现有操作 Action（retry/rollback/adjustment）

**Files:**
- Create: `src/modules/admin/admin.actions.ts`
- Create: `test/unit/modules/admin/admin.actions.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('should return mock result in MOCK_MODE without calling reward service', async () => {
  // assert no real service call when MOCK_MODE=true
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- test/unit/modules/admin/admin.actions.spec.ts`
Expected: FAIL。

- [ ] **Step 3: Write minimal implementation**

```ts
if (process.env.MOCK_MODE === 'true') {
  return { success: true, mode: 'mock', message: 'Mock action executed' };
}
// else call real RewardService methods
```

Actions:
- Batch retry
- Record retry
- Record rollback
- Adjustment create

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- test/unit/modules/admin/admin.actions.spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/admin/admin.actions.ts test/unit/modules/admin/admin.actions.spec.ts
git commit -m "feat: add admin action handlers with minimal mock mode switch"
```

### Task 5: Admin 用户创建（仅 SUPER_ADMIN）

**Files:**
- Create: `src/modules/admin-user/admin-user.module.ts`
- Create: `src/modules/admin-user/admin-user.service.ts`
- Create: `src/modules/admin-user/dto/create-admin-user.dto.ts`
- Modify: `src/modules/admin/admin.config.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('should allow SUPER_ADMIN to create admin user and deny OPERATOR', async () => {
  // role gate assertions
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- test/unit/modules/admin/admin.actions.spec.ts -t "SUPER_ADMIN"`
Expected: FAIL。

- [ ] **Step 3: Write minimal implementation**

```ts
// admin-user service
async createAdminUser(dto) {
  const passwordHash = await bcrypt.hash(dto.password, 10);
  return this.prisma.adminUser.create({ data: { email: dto.email.toLowerCase(), passwordHash, role: dto.role, isActive: true } });
}

// admin config action guard
if (currentAdmin.role !== 'SUPER_ADMIN') throw new ForbiddenException('Only SUPER_ADMIN can create admin user');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- test/unit/modules/admin/admin.actions.spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/admin-user src/modules/admin/admin.config.ts
git commit -m "feat: add super-admin only admin user creation"
```

### Task 6: 全量回归与初始化管理员脚本化

**Files:**
- Modify: `src/modules/auth/admin-auth.service.ts` (optional bootstrap helper)
- Modify: `docs/superpowers/runbooks/reward-engine-operations.md` (admin login section)

- [ ] **Step 1: Write the failing test**

```ts
it('should fail startup check when ADMIN_SESSION_SECRET is missing in production', () => {
  // env guard test
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL（env guard missing）。

- [ ] **Step 3: Write minimal implementation**

```ts
if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_SESSION_SECRET) {
  throw new Error('ADMIN_SESSION_SECRET is required in production');
}
```

Add runbook section:
- How to create first SUPER_ADMIN (env bootstrap or script)
- How to run in MOCK_MODE true/false

- [ ] **Step 4: Run test to verify it passes**

Run:
- `npm run test:unit`
- `npm run test:integration`
- `npm run build`
Expected: all PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/auth/admin-auth.service.ts docs/superpowers/runbooks/reward-engine-operations.md
git commit -m "chore: finalize admin env guards and runbook"
```

---

## Spec Coverage Self-Review

- AdminJS 集成（登录/列表/详情）：Task 3。
- 本地 email/password 登录：Task 2。
- 全核心表资源展示：Task 3。
- 现有操作接口前端可用：Task 4。
- SUPER_ADMIN 创建 admin：Task 5。
- Mock 最小化设计：Task 4（单开关薄层）。

## Placeholder Scan

- 已检查，无 TODO/TBD/implement later/fill in details。

## Type Consistency

- Admin 账号统一使用 `email`。
- Action 路由参数按现有服务入参类型（number）处理。
- MOCK_MODE 仅在 admin action handler 一层生效。
