# 管理后台认证协议（Admin Session Protocol）

> **协议版本**：v1.0
> **状态**：草案（待评审）
> **适用范围**：yunzone 集群全部 Next.js 服务（用户中心 / 鉴权中心 / WanyanAI / 重定向网关）
> **设计日期**：2026-08-19

---

## 0. 背景与动机

集群各服务的管理后台认证此前存在多份重复且互不兼容的实现：

| 服务 | 认证实现 | 会话格式 | 文件 |
|---|---|---|---|
| yunzone_user_center | 自建 HMAC-SHA256 签名 session | `payload.signature`（`admin_session` cookie） | `src/lib/admin-auth.ts` |
| yunzone_auth | 同上 + 用户名 | `payload.signature`（`admin_session` cookie） | `src/lib/admin-auth.ts` |
| WanyanAI | 已调 kit `createAdminSession`/`verifyAdminToken`，但为 base64 明文会话 | base64 明文（`admin_session` cookie，30min） | `/api/v1/admin/verify` + guard |
| yunzone_redirect_gateway | 已调 kit `verifyAdminToken`，但载体为 Bearer | 无 cookie，sessionStorage | `src/lib/auth.ts` |

既有实现对 kit 的**采纳程度不一、会话载体与格式分裂**：user_center / auth 自建了一套 HMAC 实现并双写；WanyanAI / redirect_gateway 已接入 kit 但仅用到零散函数，且 kit 当前的 base64 明文会话内含明文密码，泄露即被永久伪造（见 §1）。「登录 → 会话 → 校验 → 守卫」逻辑由此存在四种不兼容形态，约定与实现脱节。

本协议将管理后台认证收敛为**唯一协议**，由 `yunzone-service-kit/ops` 提供唯一实现。

---

## 1. 决策依据：会话格式选择

| 方案 | 现状 | 安全性 | 结论 |
|---|---|---|---|
| base64 明文（kit `ops/admin` 现状） | kit 已有、WanyanAI 在用 | ❌ cookie 内含明文密码，泄露即被伪造 | 废弃 |
| HMAC 签名 session（user_center / auth 现状） | 两服务在用 | ✅ 防伪造、无状态、多实例自动可用 | **采纳为基准** |
| Bearer + sessionStorage（redirect_gateway） | 单服务在用 | ⚠️ 无 cookie 会话、不防 XSS 窃取 | 收敛到统一实现 |

**决策：以 HMAC-SHA256 签名会话为唯一协议，反哺升级 kit 的 `ops/admin.ts`，各服务删除自有实现。**

---

## 2. 协议定义

### 2.1 环境变量契约（沿用 `adminFacet`）

| 变量 | 语义 | 未设置行为 |
|---|---|---|
| `ADMIN_PASSWORD` | 管理后台启用开关 + 密码 | **整体禁用**，所有 `/api/admin/*` 返回 `503 {code:"ADMIN_DISABLED"}` |
| `ADMIN_PATH` | 管理路径前缀 | 默认 `/admin` |
| `ADMIN_USERNAME`（可选） | 设置后启用「用户名 + 密码」双凭证认证 | 不设置 = 仅密码 |
| `ADMIN_SESSION_MAX_AGE`（新增可选） | 会话有效期（秒） | 默认 `86400`（24h） |

> WanyanAI 现为 30min、user_center/auth 为 24h，统一默认 24h；需要缩短的服务用 `ADMIN_SESSION_MAX_AGE` 覆盖。

### 2.2 会话载体

- Cookie 名统一：`admin_session`
- 属性：`HttpOnly; Path=/; SameSite=Lax; Max-Age=<TTL>; Secure`
- `Secure` 判据统一：`loadEnv(...).DEPLOY_ENV === "PROD"`（经中立键读取，禁止裸读 `COZE_PROJECT_ENV` 等各服务自用变量，见 TICKET-001）
- **无状态**：服务端不存会话表 → 多实例横向扩展、进程重启均不失效

### 2.3 会话格式（HMAC-SHA256 签名，防伪造）

```
token      := payloadStr "." signature
payload    := JSON { u: "admin"|username, i: randomBytes(8).hex, t: epochSeconds }
payloadStr := base64url(JSON.stringify(payload))
secret     := sha256hex("admin-session:" + sha256hex(ADMIN_PASSWORD))   // 密码哈希派生，重启后仍可验证
signature  := base64url(HMAC-SHA256(secret, payloadStr))
```

### 2.4 校验顺序（任一失败 → `401 {code:"UNAUTHENTICATED"}`）

1. 恰好 1 个 `.` 分隔符
2. 签名长度与期望值不等 → 直接失败；相等再 `timingSafeEqual`（常量时间比较；长度短路避免 `timingSafeEqual` 对不等长 buffer 抛异常）
3. 载荷 JSON 可解析
4. `now - payload.t <= ADMIN_SESSION_MAX_AGE`

### 2.5 登录密码比对（仅登录时执行一次）

- 模块加载时缓存 `sha256hex(ADMIN_PASSWORD)`，此后**不持有明文**
- 输入与期望值长度不等 → 直接失败；相等再 `timingSafeEqual`（用户名、密码均适用同一长度短路规则，防抛异常）
- 统一错误消息「用户名或密码错误」防枚举
- 若启用 `ADMIN_USERNAME`：先用 `timingSafeEqual` 校验用户名（沿用长度短路）
- **登录接口必须接入限流**（防暴力枚举），限流语义引用平台 `platform-config/rate-limit.json`

### 2.6 禁用语义

`ADMIN_PASSWORD` 未设置时：

- 所有 `/api/admin/*` 路由返回 `503 {code:"ADMIN_DISABLED", message:"管理后台已禁用"}`
- **禁止任何默认密码 / 默认用户回退**（user_center、auth 现存的 `admin`/`admin` 回退须随迁移一并移除）
- **禁用态下不得存在任何可签发、可验证的密钥**：删除 `dev-session-secret-insecure` 固定密钥 fallback
- 登录接口一并返回 `503 {code:"ADMIN_DISABLED"}`，不提供登录尝试入口

### 2.7 路由守卫范式

```ts
// 包装器范式：未登录 401，禁用态 503
export function requireAdminAuth(handler: AdminRouteHandler): AdminRouteHandler
```

**实现分层**：HMAC 会话函数（纯逻辑、零框架耦合）进 kit `ops/admin.ts`；`requireAdminAuth` 依赖 `NextRequest`/`NextResponse`，作为 Next.js 适配层放 kit 独立入口（`ops/next.ts`），**不得**混入纯逻辑层。

### 2.8 错误码

| HTTP | code | 场景 |
|---|---|---|
| 401 | `UNAUTHENTICATED` | 未登录 / 会话无效 / 已过期 |
| 503 | `ADMIN_DISABLED` | `ADMIN_PASSWORD` 未设置 |

> 各服务既有返回体须与本表对齐：WanyanAI verify/guard 现用 `ADMIN_NOT_CONFIGURED`、user_center 守卫 401 无 `code` 字段，均在迁移窗口内修正。

---

## 3. 与 kit 的关系

- `yunzone-service-kit/ops/admin.ts` **升级为 v1.0 协议的唯一实现（纯逻辑层）**：
  - 新增 `createSignedAdminSession` / `validateSignedAdminSession`（HMAC 实现）
  - 新增常量 `ADMIN_SESSION_COOKIE`、禁用语义相关导出
  - 现有 base64 明文函数（`createAdminSession` / `validateAdminSession`）标记 deprecated，过渡一个版本后移除
- `yunzone-service-kit/ops/next.ts`（新增）**Next.js 适配层**：提供 `requireAdminAuth`，保持纯逻辑层零框架耦合
- `yunzone-service-kit/config/specs.ts` 的 `adminFacet` 增加 `ADMIN_USERNAME`、`ADMIN_SESSION_MAX_AGE`
- **服务禁止自建 admin-auth 实现**（含默认密码回退、固定密钥 fallback），一律 `import { ... } from "yunzone-service-kit/ops"`

---

## 4. 落地改造清单

| 位置 | 动作 |
|---|---|
| **kit** `src/ops/admin.ts` | 新增 HMAC 签名/校验函数；旧 base64 函数标记 deprecated；`ADMIN_SESSION_MAX_AGE` 接入 `resolveAdminConfig` |
| **kit** `src/ops/next.ts`（新增） | `requireAdminAuth` Next.js 适配层（不混入纯逻辑层） |
| **kit** `src/config/specs.ts` | `adminFacet` 增加 `ADMIN_USERNAME`、`ADMIN_SESSION_MAX_AGE` |
| yunzone_user_center | 删除 `src/lib/admin-auth.ts`，改调 kit `ops/admin`；**移除默认密码回退与 `dev-session-secret-insecure` fallback**；守卫 401 body 补 `code:"UNAUTHENTICATED"`；登录接口接入限流 |
| yunzone_auth | 删除 `src/lib/admin-auth.ts`，改调 kit `ops/admin`（保留 `ADMIN_USERNAME` 支持）；**移除默认 admin/admin 回退与固定密钥 fallback**（顺带修复用户名长度不匹配时 `timingSafeEqual` 抛 500 的既有缺陷）；登录接口接入限流 |
| WanyanAI | verify/guard 改调 HMAC 会话函数；过期时间改为 `ADMIN_SESSION_MAX_AGE` 驱动；禁用态 `code` 统一为 `ADMIN_DISABLED`；登录接口接入限流 |
| yunzone_redirect_gateway | 管理页从「Bearer + sessionStorage」迁移为 cookie 协议；登录接口接入限流 |

---

## 5. 验收标准

1. 四个服务的 admin-auth 实现**归零**，统一 `import { ... } from "yunzone-service-kit/ops"`
2. `ADMIN_PASSWORD` 未配置时，四个服务一致返回 `503 {code:"ADMIN_DISABLED"}`，且不存在任何默认密码 / 默认用户 / 固定密钥回退
3. 会话 cookie 统一为 `admin_session`，属性一致（HttpOnly / SameSite=Lax / Secure-生产，`Secure` 判据统一为 `DEPLOY_ENV === "PROD"`）
4. 登录成功签发 HMAC 会话；篡改 cookie 任一字节 → 401
5. 会话过期（默认 24h）后 → 401，前端引导重新登录
6. 错误码对齐：未认证一律 `401 {code:"UNAUTHENTICATED"}`，禁用态一律 `503 {code:"ADMIN_DISABLED"}`
7. 登录接口已接入限流；会话校验在签名长度不等时短路返回失败（不抛异常）

---

## 6. 兼容与迁移

- 本协议为**一次性变更**，不提供同版本内双协议共存
- 迁移窗口：kit 升级发布后，四个服务在各自发版窗口内切换；`admin_session` cookie 名与 secret 派生方式不变的服务（user_center/auth）平滑过渡，无需用户重新登录（**前提：未缩短 `ADMIN_SESSION_MAX_AGE`**，否则旧会话按新 TTL 立即失效）
- WanyanAI、redirect_gateway 的旧会话在部署后失效，用户重新登录一次
- `ADMIN_PASSWORD` 轮换后所有已签发会话失效（secret 派生自密码），需全员重新登录；无状态会话无法单点撤销/踢出，属于设计固有权衡