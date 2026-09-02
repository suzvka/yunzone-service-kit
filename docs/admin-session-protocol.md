# 管理后台认证协议（Admin Session Protocol）

> **协议版本**：v1.0
> **适用范围**：接入 kit `/ops` 管理后台能力的 Next.js 服务（协议本身与服务清单无关，不枚举具体部署实例）
> **设计日期**：2026-08-19

---

## 1. 背景与动机

集群各服务的管理后台认证此前存在多份重复且互不兼容的实现（HMAC 签名 / base64 明文 / Bearer 三种形态并存），其中 base64 明文会话内含明文密码，泄露即被永久伪造。本协议将管理后台认证收敛为**唯一协议**：以 HMAC-SHA256 签名会话为基准（防伪造、无状态、多实例自动可用），由 `yunzone-service-kit/ops` 提供唯一实现；**服务禁止自建 admin-auth 实现**（含默认密码回退、固定密钥 fallback），一律 `import { ... } from "yunzone-service-kit/ops"`。

---

## 2. 协议定义

### 2.1 环境变量契约（沿用 `adminFacet`）

| 变量 | 语义 | 未设置行为 |
|---|---|---|
| `ADMIN_PASSWORD` | 管理后台启用开关 + 密码 | **整体禁用**，所有 `/api/admin/*` 返回 `503 {code:"ADMIN_DISABLED"}` |
| `ADMIN_PATH` | 管理路径前缀 | 默认 `/admin` |
| `ADMIN_USERNAME`（可选） | 设置后启用「用户名 + 密码」双凭证认证 | 不设置 = 仅密码 |
| `ADMIN_SESSION_MAX_AGE`（可选） | 会话有效期（秒） | 默认 `86400`（24h） |

### 2.2 会话载体

- Cookie 名统一：`admin_session`
- 属性：`HttpOnly; Path=/; SameSite=Lax; Max-Age=<TTL>; Secure`
- `Secure` 判据统一：`loadEnv(...).DEPLOY_ENV === "PROD"`（经中立键读取，禁止裸读 `COZE_PROJECT_ENV` 等平台注入变量，见 TICKET-001）
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
- **禁止任何默认密码 / 默认用户回退**
- **禁用态下不得存在任何可签发、可验证的密钥**（无固定密钥 fallback）
- 登录接口一并返回 `503 {code:"ADMIN_DISABLED"}`，不提供登录尝试入口

### 2.7 路由守卫范式

```ts
// 包装器范式：未登录 401，禁用态 503；返回类型与入参 handler 相同
export function requireAdminAuth<THandler>(handler: THandler): THandler
```

**实现分层**：HMAC 会话函数（纯逻辑、零框架耦合）进 kit `ops/admin.ts`；`requireAdminAuth` 依赖 `next/server` 的 `NextResponse`，作为 Next.js 适配层放 kit 独立入口（`ops/next.ts`），**不得**混入纯逻辑层。

**类型解耦**：守卫**不引入 `NextRequest` 作为参数类型**——Next.js 的 `NextRequest`/`NextResponse` 携带内部私有标记，不同 `node_modules` 物理副本间类型互不兼容。守卫以宽松泛型 `THandler` 原样透传服务侧签名，内部按鸭子类型读取 `request.cookies`（Next.js 15.3+/16 为 getter 属性，旧版为方法，运行时按形态自适应）。

### 2.8 错误码

| HTTP | code | 场景 |
|---|---|---|
| 401 | `UNAUTHENTICATED` | 未登录 / 会话无效 / 已过期 |
| 503 | `ADMIN_DISABLED` | `ADMIN_PASSWORD` 未设置 |
