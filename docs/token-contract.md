# Token Authority 服务契约（共识版 v1.4）

> 版本：v1.4（2026-08）
> 来源：用户中心「服务凭证（Service Credential）证书契约需求单 v1.0」，经鉴权中心（yunzone_auth）与消费方（yunzone_user_center / WanyanAI）评审修订；v1.4 新增「accountId 账户锚定」与「身份票据」契约。
> 单一事实源：本文件 + [src/auth/token-contract.ts](../src/auth/token-contract.ts) 类型定义。
> 适用范围：Token Authority Service（鉴权中心）与宿主应用之间的服务凭证签发 / 校验 / 续期 / 吊销接口契约。

---

## 0. 修订记录（v1.0 → v1.4）

### v1.4

| # | 修订点 | 决策 |
|---|---|---|
| 15 | `accountId` 语义确立 | 业务用户 token（claims 无 `type` 声明）**必含 accountId = 平台统一账户 id**（值空间 = user_center OAuth `sub` = `point_account.user_id`）。服务端签发时**强制注入** `claims.accountId` 与 `publicClaims.accountId`（公开视图可匿名解析，供 relay 等消费方作扣款锚点）；`userId` 与 `accountId` 强一致 |
| 16 | 身份票据 `identityTicket` | 第三方产品签发业务用户 token 必须携带平台（user_center）签发的短时身份票据（见 §3.6），或携带同产品现存有效业务用户 token 作为链式证据（`evidenceToken`，用于会员换发等续签场景）；账户归属**不可由产品自填** |
| 17 | 平台产品豁免 | 平台自身产品（默认 `user-center`，见 `PLATFORM_PRODUCT_ID`）签发业务用户 token 不受票据约束——平台即账户权威（账户标识由平台 OAuth 流程背书） |
| 18 | 服务凭证命名空间强制 | `claims.type='client-credential'` 的签发强制 `userId = client:{productId}`（原为调用方约定，现服务端校验），杜绝以任意 userId 伪装服务凭证 |

### v1.3

| # | 修订点 | 决策 |
|---|---|---|
| 12 | `ttl` 语义 | issue / refresh 的 `ttl` 均改为可选且**无默认值**：不填 = 不设过期时间（永不过期，响应 `expiresAt: null`）。鉴权中心为通用基建，不评判调用方对过期时间的设置 |
| 13 | 移除 TTL 硬上限 | 删除 `MAX_TOKEN_TTL_SECONDS` 全局上限与 `TTL_LIMIT_EXCEEDED` 错误码（基建不评判业务；凭证生命周期终结由管理员操作决定） |
| 14 | 自动续签 | 服务端策略（管理员显式配置）不受任何上限约束，无上限持续直到被吊销 / 换发 / 注销 |

### v1.1

| # | 修订点 | 决策 |
|---|---|---|
| 1 | `claims` 字段命名 | 对齐实现现状 camelCase（`clientId` / `name` / `redirectUris` / `clientUri`），消费方零适配 |
| 2 | `claims.type` | 固定 `"client-credential"`（与 middleware 凭证判据一致，删除 `"oauth_client"`） |
| 3 | `client_id` 生成方 | 服务端生成（= token_hash，与顶层 `id` 一致），删除「调用方声明」 |
| 4 | 顶层 `userId` | 补充为可选字段（仅凭证调用 / 全量视图返回），用户中心 OAuth 校验依赖 |
| 5 | 顶层 `productId` | 明确公开视图亦返回（业务归属标识，非机密） |
| 6 | `refresh` 语义 | 固定「令牌不变、仅延长过期时间」；新增总有效期硬上限（`TOKEN_MAX_TTL_SECONDS`，默认 365 天） |
| 7 | `revoke` | 固定幂等语义（删除 409 分支）；`productId` 可选（按 token 吊销时服务端推导） |
| 8 | 错误契约 | 对齐实现错误码体系（`INVALID_ARGUMENT` / `UNAUTHENTICATED` 等）；补充防枚举条款 |
| 9 | `issued_at` | 预留可选字段（服务端暂不返回，映射 `TokenRecord.createdAt`，后续版本提供） |

### v1.2

| # | 修订点 | 决策 |
|---|---|---|
| 10 | `claims.redirectUris` | **可选 → 服务凭证模式必填**（1~10 个合法 URL）。OAuth 授权回调白名单是授权页校验 `redirect_uri` 的单一事实源，漏填/错填会导致接入方登录报「redirect_uri does not match registered URIs」（WanyanAI 线上事故）；admin 签发与 v1 issue 两通道同步强制 |
| 11 | 校验响应 `redirectUris` | 公开只读视图同步标记必填（服务凭证模式） |

---

## 1. 契约总览

鉴权中心对外提供 5 个端点，另有 1 个运维探活端点：

| 端点 | 方法 | 请求 | 响应 |
|---|---|---|---|
| `/api/v1/token/issue` | POST | 签发请求（见 3.3） | 签发响应（含一次性 `token`，即 secret） |
| `/api/v1/token/introspect` | POST | `{ token, scope? }` | 校验响应（见 3.1 / 3.2） |
| `/api/v1/token/lookup` | POST | `{ id }` | 校验响应（同 introspect） |
| `/api/v1/token/refresh` | POST | `{ token, ttl? }` | `{ success, expiresAt }` |
| `/api/v1/token/revoke` | POST | `{ token }` 或 `{ userId, productId }` | `{ success: true }` |
| `/api/healthz`（运维探活） | GET | - | 2xx 即可用；消费方客户端执行层（kit `/auth` client）据此探活 |

---

## 2. 凭证模型

- 每张凭证由**唯一标识**（`client_id` = token_hash）与**凭证值**（`token`，即 secret）构成。
- `token` 仅在签发响应中返回一次；`client_id` 可用于后续查询（lookup）。
- 凭证携带两类信息：
  - **顶层元数据**：有效性、归属、有效期、权限域；
  - **公开 claims**：供消费方读取的结构化身份信息（只读视图，无就地修改端点）。
- 凭证状态：`active`（有效）/ 已过期 / 已吊销。
- 凭证类型由 `claims.type === "client-credential"` 标记（middleware 以此作为调用方凭证判据）。
- 凭证的 userId 命名空间约定：服务凭证固定为 `client:{productId}`，与业务用户 token 空间隔离；同 productId 重签自动 replace 旧凭证（每产品至多一个活跃凭证）。
- **业务用户 token 的账户锚定**：claims 无 `type` 声明的 token 即业务用户 token，其 `userId` = `accountId`（平台统一账户 id），且 `claims.accountId` / `publicClaims.accountId` 由服务端强制注入——账户归属以平台签发的身份票据或同产品链式证据为准，**产品不得自填**（详见 §3.5 / §3.6）。

---

## 3. 接口契约字段明细

### 3.1 校验响应 · 顶层字段（introspect / lookup）

| 字段 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `active` | boolean | ✓ | 凭证是否有效（未过期、未吊销、签发主体未被停用） |
| `productId` | string | ✓ | 凭证归属的产品标识（公开视图亦返回；业务侧唯一键，签发后不可变更） |
| `expiresAt` | string(ISO8601) | ✓ | 过期时间 |
| `scope` | string[] | - | 权限域；未授予时为空数组 |
| `userId` | string | - | 签发主体；仅「携带有效凭证且产品匹配」的全量视图返回（匿名不返回，最小暴露） |

> 防枚举：对不存在 / 已吊销 / 已过期的 token，introspect / lookup 统一返回 `200 + { active: false }`，不区分原因、不返回 404。

### 3.2 校验响应 · claims 命名空间（公开只读视图）

| 字段 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `type` | string | ✓ | 凭证类型，固定 `"client-credential"` |
| `clientId` | string | ✓ | 凭证唯一标识（服务端生成 = token_hash，与顶层 `id` 一致） |
| `name` | string | ✓ | 凭证名称（非空字符串） |
| `confidential` | boolean | ✓ | 是否机密凭证（决定 secret 是否允许暴露于非安全环境） |
| `redirectUris` | string[] | ✓（服务凭证模式） | 授权回调地址白名单（签发必填，1~10 个） |
| `clientUri` | string | - | 凭证关联的站点地址 |
| `issuer` | string | - | 签发方 / 环境标识（`ISSUER_ID` env，默认 `token-authority`） |
| `issued_at` | string(ISO8601) | - | **预留**：签发时间（映射 `TokenRecord.createdAt`，服务端暂不返回） |

> `claims` 为只读视图：不提供就地修改端点，字段变更一律通过「吊销 → 重新签发」完成。

### 3.3 签发请求（issue）约束

| 字段 | 约束 | 说明 |
|---|---|---|
| `userId` | **必填** | 签发主体；服务凭证模式传 `client:{productId}`（replace 语义键） |
| `productId` | **必填**，禁止默认值兜底 | 缺失或为空返回 400 `INVALID_ARGUMENT` |
| `claims.type` | 服务凭证模式必填 `"client-credential"` | 由调用方声明，鉴权中心校验 |
| `claims.name` | 服务凭证模式必填 | 非空字符串，缺失不降级签发 |
| `claims.confidential` | 服务凭证模式必填 | 布尔值 |
| `claims.redirectUris` | 服务凭证模式必填 | 1~10 个合法 URL，缺失/为空返回 400 `INVALID_ARGUMENT` |
| `claims.clientUri` | 可选 | 按需传入（URL 格式校验） |
| `claims` 扁平约束 | 服务凭证模式强制 | 除 `redirectUris` 外，禁止嵌套对象 / 数组（各语言消费方解析无歧义） |
| `ttl` | 可选 | 有效秒数；**不填 = 永不过期**（响应 `expiresAt: null`），鉴权中心不评判调用方的过期时间设置 |

> 服务凭证模式的严格校验由鉴权中心在 issue 端点强制（`claims.type === "client-credential"` 时），普通用户 token 签发的 claims 保持自由。

### 3.4 续期 / 吊销

- `refresh`：返回 `{ success, expiresAt }`，**令牌值不变，仅延长过期时间**；调用方描述 `ttl` 则按 `ttl` 续期（`expiresAt` 为新过期时间），**不填 `ttl` = 永不过期**（`expiresAt: null`）。无 TTL 硬上限（v1.3 起移除）。
- `revoke`：吊销后凭证立即失效；**幂等语义**——重复吊销已吊销凭证返回 `{ success: true }`（对不存在的 token 返回 404 `TOKEN_NOT_FOUND`）。按 token 吊销时 `productId` 可省略（服务端从记录推导归属产品做隔离校验）。

### 3.5 业务用户 token 与 accountId（v1.4）

- **判定**：请求体 `claims.type` 未声明（即非 `client-credential` / `oauth_client` / `client_credentials` / `product` 等机器类型）的签发即业务用户 token 签发。
- **accountId**：平台统一账户 id，值空间 = user_center OAuth `sub` = `point_account.user_id`（同一账户空间，消费方直接用作积分账本主键）。
- **服务端强制注入**：签发成功时服务端将 `claims.accountId`、`publicClaims.accountId` 统一写为账户 id（覆盖调用方传入值），并强制 `userId === accountId`（不一致返回 400 `INVALID_ARGUMENT`）。
- **公开可解析**：`publicClaims.accountId` 使匿名 introspect 亦能解析账户锚点（relay 计费管线依赖），与 name/email 等 PII 完全分离（PII 仅存私有 claims）。
- **强制锚定规则**（按调用方凭证判定）：
  - 平台产品（调用凭证归属 `PLATFORM_PRODUCT_ID`，默认 `user-center`）签发业务用户 token：免票据，accountId 以调用方可信 `userId` 为准（平台 OAuth 流程背书）；
  - 第三方产品签发：必须携带 **`identityTicket`**（§3.6）或 **`evidenceToken`**（同产品现存有效业务用户 token，链式换发）；缺失 / 无效 / 过期 / 归属不符 → 400 `INVALID_ARGUMENT` 或 403 `PRODUCT_NOT_ALLOWED`；
  - 无有效调用凭证（原型降级）：维持现状放行（仅限未配置凭证的开发形态，生产必须配置平台凭证）。

### 3.6 身份票据（identityTicket）契约（v1.4）

- **签发方**：user_center（平台账户权威）。端点 `POST /api/v1/identity/ticket`，携带用户 OAuth access token（Bearer），校验通过后返回 `{ accountId, ticket, expiresIn }`。
- **票据格式**：`yzid1.<base64url(payload)>.<base64url(hmac-sha256)>`；payload = `{ v:1, a:accountId, i:签发秒, e:过期秒 }`；HMAC 密钥 = 共享环境变量 `IDENTITY_TICKET_SECRET`（user_center 与鉴权中心各持一份，部署时注入）。
- **有效期**：默认 300 秒（短时效，防重放面收窄）。
- **消费方**：第三方产品在**用户 OAuth 授权完成后、签发业务用户 token 时**向鉴权中心提交；鉴权中心本地验签（无需回调 user_center）。
- **链式证据 `evidenceToken`**：同一产品现有有效业务用户 token（如会员换发场景），鉴权中心校验其 active + 同 productId + 业务类型 + 从 `publicClaims.accountId ?? claims.accountId ?? userId` 提取账户 id 后作锚；适用于「同一用户、无需重新授权」的续签路径。
- **安全边界**：票据与证据均只证明「该账户确实被平台/OAuth 流程背书」，不承载任何金额语义；扣款上限、授权票（escrow）属于积分域另行设计。

---

## 4. 错误契约

统一错误响应体：`{ code: string, message: string, requestId?: string }`

| HTTP | code | 场景 |
|---|---|---|
| 400 | `INVALID_ARGUMENT` | 缺少必填字段、字段格式错误、claims 违反扁平约束 |
| 401 | `UNAUTHENTICATED` | 调用方凭证无效或缺失 |
| 403 | `PRODUCT_NOT_ALLOWED` | 真实凭证调用方越权操作其他产品 |
| 404 | `TOKEN_NOT_FOUND` | refresh / revoke 目标 token 不存在 |
| 429 | `RATE_LIMITED` | 请求频率超限（响应含 `Retry-After`） |
| 502 | `INTERNAL` | 内部服务错误 |

> introspect / lookup 不参与上述错误码（防枚举，统一 200 + `{active:false}`）。

---

## 5. 安全与最小化约束

1. `token`（secret）仅在 `issue` 响应中返回一次；其余端点任何响应不得包含 secret 明文或可反推出 secret 的信息（admin 下载证书亦不含明文）。
2. 除本契约声明字段外，不得携带其他信息（最小化；匿名视图仅返回 `publicClaims` 声明公开的字段）。
3. 新增字段只允许为可选字段，且不得改变既有字段的类型与语义（向前兼容）。
4. `claims` 中禁止出现嵌套对象 / 数组（`redirectUris` 除外），保证各语言消费方解析无歧义。
5. 产品隔离：真实凭证调用方只能签发 / 续期 / 吊销自己 productId 下的凭证；introspect 产品不匹配时降级为匿名视图。
6. **账户锚点公开、PII 私有**：业务用户 token 的 `publicClaims.accountId`（平台账户锚点）对匿名视图公开（跨产品扣款锚定所必需）；name / email / 手机号等 PII 一律只允许出现在私有 `claims`，不得进入 `publicClaims`。
7. **账户归属不可产品自填**：第三方产品无法通过 requests 参数指定业务用户 token 的账户归属（服务端以票据 / 链式证据为唯一来源，并强制覆盖 `claims/publicClaims.accountId`）。

---

## 6. 验收标准

1. 对任意已签发凭证执行 `introspect` / `lookup`，响应均包含第 3.1、3.2 节全部必填字段，且值与签发时一致。
2. 签发请求缺少 `productId`、`userId` 或服务凭证模式的 `claims.name` / `claims.confidential` 时返回 400 `INVALID_ARGUMENT`，不允许降级签发。
3. `token`（secret）仅出现在 `issue` 响应一次。
4. `refresh` 按调用方 `ttl` 续期（不填 = 永不过期，`expiresAt: null`）；`revoke` 幂等。
5. 错误响应符合第 4 节统一格式；无效 token 的 introspect / lookup 符合防枚举条款。
6. 业务用户 token 签发后：`claims.accountId === publicClaims.accountId === userId`，且匿名 introspect 的 `claims.accountId` 可解析。
7. 第三方产品签发业务用户 token 未携带有效 `identityTicket` / `evidenceToken` 时返回 400 `INVALID_ARGUMENT`；携带他人账户票据 / 证据时拒绝签发。
8. 服务凭证模式（`claims.type='client-credential'`）签发强制 `userId = client:{productId}`，违反返回 400。

---

## 7. 配置项

| 配置 | 默认 | 语义 |
|---|---|---|
| `ISSUER_ID` | `token-authority` | 签发方 / 环境标识，写入凭证公开 claims（可选字段） |
