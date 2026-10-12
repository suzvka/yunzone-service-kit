# 管理后台密码本协议（Admin Keybook Protocol）

> **协议版本**：v2.0
> **适用范围**：接入 kit `/ops` 管理后台能力的 Next.js 服务（协议本身与服务清单无关，不枚举具体部署实例）
> **设计日期**：2026-10-12
> **取代**：v1.0 Admin Session Protocol（`docs/admin-session-protocol.md`，保留供迁移期对照）

---

## 1. 背景与动机

v1.0 以 `ADMIN_PASSWORD` 环境变量字符串为唯一凭证：秘密散落在 `.env`、部署平台配置与 CI secret 中，登录时答案（密码）明文过网络，且单值凭证无法按管理员拆分与撤销。

v2.0 将凭证形态升级为**密码本（keybook）+ Ed25519 挑战应答**：

- **密码本 = 公钥清单**，本质上不是密钥——它被设计为可公开：泄露不能伪造任何签名；
- **私钥永不落网**：登录时网络上只出现"本次 nonce 的签名"，观察任意多次登录都不能推出下一次；
- **"必须持有密码本的机器才能访问"严格成立**：私钥文件在管理员本机，从上传输；
- **允许从云端对象存储 URL 拉取密码本**：因密码本非秘密，预签名 URL / 私有 bucket 均可安全使用；
- 页面上不存在"输入密钥"的控件——撞库、爆破、日志误记录密码这类攻击面整体消失。

**非目标**（明确不解决）：内网管理面隔离、页面 XSS 场景下的私钥保护（浏览器内签名必然接触私钥；更高保证需 CLI 伴侣或 mTLS，属下一层防御）、跨实例强一致的一次性 nonce。

会话载体沿用 v1.0 的 HMAC-SHA256 无状态签名（防伪造、多实例自动可用），仅 secret 派生物由密码哈希换为**密码本指纹**。

---

## 2. 环境变量契约与密码本形态

### 2.1 环境变量（`adminFacet`）

| 变量 | 语义 | 未设置行为 |
|---|---|---|
| `ADMIN_KEYBOOK` | 密码本启用开关 + 来源（本地路径，或 `http(s)://` URL） | **整体禁用**，所有 `/api/admin/*` 返回 `503 {code:"ADMIN_DISABLED"}` |
| `ADMIN_PATH` | 管理路径前缀 | 默认 `/admin` |
| `ADMIN_SESSION_MAX_AGE`（可选） | 会话有效期（秒） | 默认 `86400`（24h） |

退役键：`ADMIN_PASSWORD`、`ADMIN_USERNAME`（身份由密码本条目 `id` 承担）。

加载语义：**进程启动时一次性加载**（kit `initAdminRuntime`，进程内缓存）。换本 / 增删条目一律以重启为生效点；加载失败与未配置同语义（禁用态 503，禁用态下不得存在任何可签发、可验证的密钥，禁止任何默认回退）。

### 2.2 密码本 JSON 形态

```jsonc
{
  "version": 1,
  "keys": [
    {
      "id": "ops-laptop",                // [A-Za-z0-9][A-Za-z0-9_:-]{0,63}，不得含 `.`
      "public_key": "<base64url>",       // 32 字节 raw Ed25519 公钥（RFC 8032）
      "label": "运维本",                  // 展示用，不参与指纹
      "added_at": "2026-10-12",          // 展示用，不参与指纹
      "revoked_at": null                 // 非空即撤销：验签一律拒绝，但仍计入指纹
    }
  ]
}
```

校验规则（`parseAdminKeybook`，违规即加载失败）：`version === 1`；`keys` 非空数组（≤1000）；`id` 合法且唯一；`public_key` 为 base64url 且解码恰为 32 字节（回环校验防宽松字符）。

**撤销**：给条目填 `revoked_at`（或直接删除条目）→ 重启。空密码本等同配置错误（要求显式删除 `ADMIN_KEYBOOK` 表达禁用）。

### 2.3 指纹（一切派生的种子）

```text
canonical := JSON( sort_by_id(keys).map(k => [k.id, k.public_key, revoked_at or null]) )
fingerprint := sha256hex(canonical)
```

只取影响认证的三字段：改 `label` / `added_at` / 条目顺序不改变指纹（不炸会话）；改公钥、增删条目、改 `revoked_at` 均改变指纹 → 全部旧会话失效。

---

## 3. 登录：挑战应答

### 3.1 端点建议形态（路由由各服务实现，算法唯一实现在 kit）

```text
GET  /api/ops/login/challenge   → { token, nonceB64, issuedAt, expiresIn }
POST /api/ops/login             → { key_id, token, message, signature }
```

challenge 令牌（无状态，服务端不存会话表之外的任何状态）：

```text
nonce      := base64url(randomBytes(16))
issuedAt   := epochSeconds
challengeSecret := sha256hex("admin-challenge:" + fingerprint)
sig        := base64url(HMAC-SHA256(challengeSecret, nonce + "." + issuedAt + "." + host))
token      := nonce + "." + issuedAt + "." + sig
```

`host`（请求 Host）参与签名 = 通道绑定：A 服务领的 challenge 拿到 B 服务用不了（跨服务重放防御）。窗口默认 120s（`ADMIN_CHALLENGE_DEFAULT_MAX_AGE_SECONDS`）。

### 3.2 流程与规范串（浏览器伴侣与服务端逐字节一致）

```text
1. 客户端 GET challenge → { token, nonceB64, ... }
2. 本机私钥（PKCS8 PEM，WebCrypto importKey("ED25519")）签名规范串：
     message := "v2." + key_id + "." + nonceB64 + "." + host + "." + ts      // ts = epochSeconds
3. POST login { key_id, token, message, signature := base64url(Ed25519 raw 64B) }
4. 服务端依序校验（任一失败 → 401）：
   a. verifyAdminChallenge(token)：三段分隔符 → issuedAt 数值 → 时间窗 →
      host 绑定 → 签名长度短路 + timingSafeEqual → nonce 一次性消费（进程内 LRU）
   b. message 与 a 的 nonce、本次 host、窗口内 ts 逐字段一致
   c. verifyKeybookSignature：key_id 命中未撤销条目 → Ed25519 验签
5. 通过 → 签发会话（§4），payload.u = key_id
```

### 3.3 登录接口必须接入限流（沿用 v1.0 条款，引用平台 `platform-config/rate-limit.json`）。规范串中无口令类输入，爆破面仅剩"伪造签名"，数学上不可行；限流主要保护 challenge 端点自身。

### 3.4 防重放与残余风险（明示）

- nonce 一次性依赖**进程内** LRU（`defaultAdminChallengeSeenStore`，上限 1024、惰性过期）。多实例无 sticky 时，观察方理论上可在 120s 窗口内把一次完整登录流量重放到另一实例；窗口过后令牌自然过期。接受该残余风险的判据：能观察到登录流量的攻击者已具备中间人能力，此时应走内网管理面（非目标）。
- 私钥在浏览器内使用：admin 页面存在 XSS 时页面上下文可读取用户取入的私钥（同上，属下一层威胁）。

---

## 4. 会话（沿用 v1.0 结构，换派生种子）

- Cookie 名统一：`admin_session`；属性：`HttpOnly; Path=/; SameSite=Lax; Max-Age=<TTL>; Secure`
- `Secure` 判据沿用 v1.0：`loadEnv(...).DEPLOY_ENV === "PROD"`（禁止裸读平台注入变量）
- 格式：

```text
token      := payloadStr "." signature
payload    := JSON { u: key_id, i: randomBytes(8).hex, t: epochSeconds }
payloadStr := base64url(JSON.stringify(payload))
secret     := sha256hex("admin-session:" + fingerprint)
signature  := base64url(HMAC-SHA256(secret, payloadStr))
```

- 校验顺序与常量时间比较规则全部沿用 v1.0 §2.4；过期判据 `now - payload.t <= ADMIN_SESSION_MAX_AGE`。
- **无状态**：服务端不存会话表 → 多实例横向扩展不受影响；进程重启（同一密码本）不失效；换本（指纹变化）全部旧会话失效。

## 5. 路由守卫范式（不变）

```ts
// 包装器范式：未登录 401，禁用态 503；返回类型与入参 handler 相同
export function requireAdminAuth<THandler>(handler: THandler): THandler
```

实现分层不变：纯逻辑（密码本解析/加载、challenge、验签、会话）在 kit `ops/admin.ts` + `ops/runtime.ts`；`requireAdminAuth` 依赖 `next/server`，在 `ops/next.ts`。守卫数据源统一为 `initAdminRuntime()`（启动一次性装配，进程内缓存）。类型解耦（鸭子类型 cookies、宽松泛型透传）条款沿用 v1.0 §2.7。

## 6. 错误码

| HTTP | code | 场景 |
|---|---|---|
| 401 | `UNAUTHENTICATED` | 未登录 / 会话无效 / 已过期 / 验签失败 |
| 401 | `CHALLENGE_INVALID` | challenge 令牌缺失 / 过期 / 宿主不匹配 / 已使用 |
| 503 | `ADMIN_DISABLED` | `ADMIN_KEYBOOK` 未设置或密码本加载失败 |

禁用态下登录与 challenge 端点一并返回 503，不提供登录尝试入口（沿 v1.0 §2.6）。

## 7. kit 导出映射（唯一实现清单）

| 导出（`yunzone-service-kit/ops`） | 职责 |
|---|---|
| `resolveAdminConfig(env?)` | 同步 env 解析（enabled = `ADMIN_KEYBOOK` 非空） |
| `parseAdminKeybook(raw)` / `loadAdminKeybook(source, opts?)` | 密码本校验 / 本地+URL 双源加载 |
| `initAdminRuntime(opts?)` / `getAdminRuntimeCached()` | 启动一次性装配 + 进程内缓存（换本重启语义落点） |
| `createAdminChallenge(fingerprint, host)` / `verifyAdminChallenge(token, opts)` | challenge 签发 / 校验（含 nonce 一次性消费） |
| `buildAdminLoginMessage(params)` / `verifyKeybookSignature(keybook, keyId, message, sig)` | 规范串组装 / Ed25519 验签 |
| `createSignedAdminSession(fingerprint, keyId)` / `validateSignedAdminSession(session, fingerprint)` / `deriveAdminSessionSecret(fingerprint)` | HMAC 会话（同 v1.0 格式） |
| `computeKeybookFingerprint(keys)` | 指纹计算 |

服务**禁止自建 admin-auth 实现**（含默认密码回退、固定密钥 fallback），一律 `import { ... } from "yunzone-service-kit/ops"`。登录伴侣：kit 随包提供 `ops-companion/admin-login.html`（零依赖单文件，WebCrypto 本地签名）与 `scripts/adminctl.mjs`（`genkey` / `keybook` / `demo`）。

## 8. 迁移指引（v1.0 服务 → v2.0）

1. `adminctl genkey --id <机器名>` 生成密钥对；私钥离线保存到登录机，公钥条目并入密码本文件（或上传对象存储取 URL）；
2. 部署侧：删除 `ADMIN_PASSWORD` / `ADMIN_USERNAME`，设置 `ADMIN_KEYBOOK=<路径|URL>`；schema 组合处 `adminFacet` 键集已变化（`requiredFacet(adminFacet, ["ADMIN_PASSWORD"])` 之类引用需同步改）；
3. 服务侧 `lib/admin-session.ts`：删除 `hashAdminPassword/verifyAdminPasswordWithHash` 用法，`validateAdminCredentials(password)` 替换为 §3.2 的 challenge+验签两步（kit 提供全部纯函数）；`createSignedAdminSession` / `validateSignedAdminSession` 的第二参数从密码换为 `initAdminRuntime()` 的 `fingerprint`；
4. `ops/report.ts` 的 env 键白名单：`ADMIN_PASSWORD` → `ADMIN_KEYBOOK`；
5. 登录页改造为伴侣流程（引入或转发 `admin-login.html`），移除密码输入控件；
6. e2e / prod-verify 脚本：从"提交密码"改为"fixture 私钥 + 挑战应答"（`adminctl demo` 可生成本地开发密码本与配套私钥）。
