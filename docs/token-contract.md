# Token Authority 服务契约（共识版 v1.9）

> 版本：v1.9（2026-11-01）
> 来源：用户中心「服务凭证（Service Credential）证书契约需求单 v1.0」，经鉴权中心（yunzone_auth）与消费方（yunzone_user_center / WanyanAI）评审修订；v1.4 新增「accountId 账户锚定」与「身份票据」契约；v1.5 结算 P1 事故（UC-TICKET-20260902-001）；v1.6 登记表去账户化——鉴权中心还原为纯 token 存储，业务用户 token 不再做 accountId 账户锚定，移除身份票据 / isPlatform 豁免；v1.8 撤销该归位：积分域已退场，自报 accountId 不再承载支付语义；**v1.9 把本文与鉴权中心的去产品化实现对齐**（不新增语义，只删除代码里已不存在的字段与错误码）。
> 单一事实源：本文件 + [src/auth/token-contract.ts](../src/auth/token-contract.ts) 类型定义；运行行为以鉴权中心实现（路由薄壳 Zod + `src/relay/cards/token-*.ts`）为准。
> 适用范围：Token Authority Service（鉴权中心）与宿主应用之间的服务凭证签发 / 校验 / 续期 / 吊销接口契约。

---

## 0. 修订记录（v1.0 → v1.9）

### v1.9

| # | 修订点 | 决策 |
|---|---|---|
| 32 | 隔离键换代为签发者凭证 id | 鉴权中心去产品化（DESIGN.md §9）后，`token_records.product_id` 列与产品索引已 DROP，活跃槽位唯一键 = `(issuer_credential_id, tag)`（`token_records_issuer_slot_unique`）。本文原 §2/§3/§5/§6 中一切“产品隔离 / productId 必填 / 服务端派生 tag”的描述均为**旧版本行为**，今日实现不存在 |
| 33 | `productId` 降为不透明透传 | issue 入参 `productId` 可选；仅当 `claims.productId` 未显式提供时由服务端并入 `claims` 存储，不参与键位/鉴权/隔离；**所有响应不再包含顶层 `productId`**（归属语义走 `claims`，消费方自读） |
| 34 | 实体类型分类法退场 | `claims.type` 白名单（`client-credential` / `sku` / `product`）、`claims.name` / `confidential` / `redirectUris` / `skuId` 的服务端严格校验、服务端派生 tag、受管类型拦截、同一槽位不同实体类型间的替换保护全部删除；`claims` 只剩**扁平约束**一条服务端校验 |
| 35 | 错误码值域收敛 | 删除 `PRODUCT_NOT_ALLOWED` / `PRODUCT_NOT_FOUND`；新增 `TOKEN_NOT_OWNED`(403)——单删 / 续期目标 token 非本凭证签发时的归属拒绝。凭证端点的 `CREDENTIAL_NOT_ALLOWED` / `CREDENTIAL_NOT_FOUND` 不属 token 端点值域 |
| 36 | `lookup` 单形态 | 入参只收 `{ id }`（`id` = `token_hash`）；`{ productId, skuId }` 形态随商品实体退场而删除 |

### v1.8

| # | 修订点 | 决策 |
|---|---|---|
| 31 | accountId 不再承载扣款语义 | 此前 §5.6 / §5.7 把 `publicClaims.accountId` 的公开性与风控归属均论证为“跨产品扣款/计费锚定”，并交由**积分域风控**兜底。随集群内积分逻辑整体退场（计量与定价上移平台计量域），该前提已不存在：**字段本身、其存储与公开行为均不变（不破既有签发与 introspect 形状），但任何消费方不得再拿自报的 accountId 作扣款或发放依据**。需可信主体时一律用鉴权中心签发的 `productId`；未来的计量契约应自定其对手方形状，不得沿用本字段 |

### v1.7

| # | 修订点 | 决策 |
|---|---|---|
| 30 | 服务凭证单渠道凭证文件 | 服务凭证配置（apiKey / productId / 鉴权中心地址）从环境变量迁往**凭证文件**（`auth-center.credential.json`）：签发/轮换响应在客户端拼装下载，全量明文，唯一渠道（契约见 kit `docs/credential-file.md`）；kit `authCenterFacet`（`AUTH_CENTER_*`）随之退役。admin 下载证书端点作为孤立面一并移除——服务端只存 hash，任何端点均无明文补发路径 |

### v1.6

| # | 修订点 | 决策 |
|---|---|---|
| 26 | 登记表去账户化 | 鉴权中心还原为**纯 token 存储**：业务用户 token（claims 无 type）签发不再做 accountId 账户锚定、不注入 `claims.accountId`/`publicClaims.accountId`、不强制 `userId===accountId`；accountId 由调用方自报进 `publicClaims`，登记表只存不校验 |
| 27 | 移除身份票据 / isPlatform 豁免 | 删除 `identityTicket`/`evidenceToken` 签发字段、`isPlatform` 平台指定、`PLATFORM_PRODUCT_ID`/`IDENTITY_TICKET_SECRET` 配置与 `IDENTITY_TICKET_REQUIRED`(412) 错误码——账户背书不再是登记表职责 |
| 28 | 账户背书与支付风控归位 | 账户身份以平台 `userinfo.sub` 为准；支付风险（限额 / 速率 / 账户↔产品授权）由积分域风控在结算边界兜底，不在 token 签发层设限 |
| 29 | 签发主体字段 `userId` → `tag` | v1 issue / introspect / revoke 的"签发主体"字段由 `userId` 更名为 **`tag`**（opaque 槽位标记，登记表不解释语义，仅用作 replace 键位）：业务用户 token 由调用方以自身身份语义填充（用户中心填 userId、设备型产品填 deviceId）；sku / client-credential 的 tag 由服务端派生（`sku:{skuId}` / `client:{productId}`），调用方不传。**API 变化隔离在基建边界——消费方在各自适配器内映射 userId↔tag，鉴权中心 API 只认 tag** |

### v1.5

| # | 修订点 | 决策 |
|---|---|---|
| 19 | 平台指定注册数据化 | 平台产品（账户权威）豁免资格改由**产品注册记录 `claims.isPlatform` 标记**指认（admin 授予/撤销，单一事实源）；环境变量 `PLATFORM_PRODUCT_ID` 仅作回退；**删除 `'user-center'` 硬编码默认值**——无显式指定 = 无豁免 |
| 20 | `claims.type` 白名单 | issue 仅接受 无 type（业务用户）/ `client-credential` / `sku`；未知值（含拼写偏差）一律 400，杜绝绕过锚定与严格校验的旁路 |
| 21 | 保留命名空间防护 | `userId` 命中 `client:` / `sku:` / `product:` 前缀必须与对应类型匹配；`product:` 仅 admin 通道可写 |
| 22 | 跨类型替换保护 | replace 语义仅允许同类型覆盖；目标现存异类型 active 行时签发返回 409 `TOKEN_CONFLICT`（防探测式签发误删真实凭证行） |
| 23 | 票据缺失错误码语义 | 第三方产品缺 `identityTicket` / `evidenceToken` 的拒绝由 400 `INVALID_ARGUMENT` 改为 **412 `IDENTITY_TICKET_REQUIRED`**（策略拒绝，响应附票据端点适配指引） |
| 24 | 商品契约去商业化 | 鉴权中心对 `claims.type='sku'` 仅保留结构性约束（`claims.skuId` 声明 + `userId = sku:{skuId}` 命名空间）；陈列/计价等**内容字段的语义校验退出基建**，由消费方（下单快照等读取路径）在自身边界校验 |
| 25 | 票据密钥契约化 | `IDENTITY_TICKET_SECRET` 纳入集群契约面 `authCenterFacet`（两侧同值注入；未配置时签发 503 / 校验 500，均 fail-closed） |

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
| `/api/v1/token/lookup` | POST | `{ id }`（`token_hash`） | 公开视图 / `{ active: false }`（同匿名 introspect 权） |
| `/api/v1/token/refresh` | POST | `{ token, ttl? }` | `{ success, expiresAt }` |
| `/api/v1/token/revoke` | POST | `{ token }` 或 `{ tag }` | `{ success: true }` |
| `/api/healthz`（运维探活） | GET | - | 2xx 即可用；消费方客户端执行层（kit `/auth` client）据此探活 |

---

## 2. 模型（token 与调用方凭证）

- 每枚 token 由**公开标识**（`token_hash`，服务端生成 SHA-256）与**凭证值**（`token` 明文，即 secret）构成；`token` 仅在签发响应中返回一次，`token_hash` 可经 `lookup` 反查公开视图。
- token 状态只有 **active**：过期由 `expiresAt` 判定（NULL = 永不过期），吊销 = 物理删除——**不存在 revoked / expired 持久态**，无效即不存在（防枚举的基础）。
- token 携带两类信息：
  - **顶层元数据**：有效性、有效期、权限域、签发者凭证 id（无归属产品语义）；
  - **claims / publicClaims**：调用方自报的结构化数据（只读视图，无就地修改端点；变更 = 重签或吊销）。
- 调用方凭证与服务侧概念：**凭证不是 token**——两档凭证（`admin` / `normal`）存独立 `credentials` 表，明文 `sk-auth-<id>.<key>` 自编码（id 段 = 签发者身份），以 `Authorization: Bearer` 携带；本契约的 token 是**业务用户 token**，由已验证凭证签发。
- token 记录写入**签发者凭证 id**（`issuer_credential_id`）作为唯一隔离键；服务端不解释 `claims` 内容，也不对 token 做产品/实体类型分类。
- 槽位（tag）约定：完全由调用方自定（opaque，≤128 字符），服务端**用而不解**；无服务端派生前缀。同一 `(签发者凭证 id, tag)` 至多一枚 active，重签即顶替；不同凭证的 tag 空间互不干扰。
- `accountId`：由调用方自报进 `publicClaims.accountId`，登记表只存不校（v1.6/v1.8，详见 §3.5）。

---

## 3. 接口契约字段明细

### 3.1 校验响应 · 顶层字段（introspect / lookup）

| 字段 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `active` | boolean | ✓ | token 是否有效（存在、未过期；吊销 = 物理删除，无效即不存在） |
| `expiresAt` | string(ISO8601) \| null | ✓ | 过期时间；`null` = 永不过期（签发未传 `ttl`） |
| `scope` | string[] | - | 权限域；未授予时为空数组 |
| `tag` | string | - | 槽位标记（opaque，即签发主体）；全量视图返回，公开视图仅在 `publicTag=true` 时返回（最小暴露） |

> 防枚举：对不存在 / 已吊销 / 已过期的 token，introspect / lookup 统一返回 `200 + { active: false }`，不区分原因、不返回 404。

### 3.2 校验响应 · claims 命名空间（公开只读视图）

> ⚠️ **历史形态（v1.9 注）**：下列字段来自旧的「服务凭证模式」（`claims.type='client-credential'`），
> 该实体类型已随去产品化从鉴权中心退出，**服务端不再校验、不再注入、不再解释任何 claims 字段**。
> OAuth 客户端配置（`redirectUris` / `confidential` 等）的权威已迁至产品中心。
> 本表仅作存量消费方的读取参考；新接入方应把 `claims` 当作调用方自报的 opaque 结构。

| 字段 | 类型 | 旧必填 | 语义 |
|---|---|---|---|
| `type` | string | ✓ | 旧凭证类型标记，固定 `"client-credential"`（服务端已不判据） |
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
| `tag` | 可选，≤128 字符 | opaque 槽位标记（replace 语义键，登记表不解释语义、不与身份绑定）：由调用方填充自身身份语义（用户中心填 userId，设备型填 deviceId）；不填 = 无槽位 `''`，同样参与唯一性（“无 tag 也是一种值”）。无服务端派生前缀（v1.9 #32） |
| `productId` | 可选，≤128 字符 | **不透明透传**：仅当 `claims.productId` 未显式提供时由服务端并入 `claims` 存储；不参与键位、鉴权、隔离（v1.9 #33） |
| `scope` | 可选，默认 `[]` | 权限域 |
| `claims` | 可选，默认 `{}` | 调用方自定义声明。唯一的服务端校验是**扁平约束**（值为对象/数组 → 400）；旧的实体类型语义（`type` / `skuId` / `confidential` / `redirectUris` …）已退出鉴权中心（v1.9 #34） |
| `publicClaims` | 可选，默认 `{}` | 匿名视图可见；`accountId` 可在此自报（仅透传标识，不得作扣款/发放依据，v1.8） |
| `publicTag` | 可选，默认 `false` | `tag` 是否进公开视图（最小暴露） |
| `publicScope` | 可选，默认 `true` | `scope` 是否进公开视图（授权判断需要，默认公开） |
| `ttl` | 可选 | 有效秒数；**不填 = 永不过期**（响应 `expiresAt: null`），鉴权中心不评判调用方的过期时间设置 |

> replace 语义：同一 `(签发者凭证 id, tag)` 槽位至多一枚 active，重签即顶替（事务内先删后插，物理覆盖）；并发双签发由部分唯一索引兜底 → 409 `TOKEN_CONFLICT`。签发者命名空间物理隔离，不存在越凭证的写路径（v1.9 #32）。

### 3.4 续期 / 吊销

- `refresh`：返回 `{ success, expiresAt }`，**令牌值不变，仅延长过期时间**；调用方描述 `ttl` 则按 `ttl` 续期（`expiresAt` 为新过期时间），**不填 `ttl` = 永不过期**（`expiresAt: null`）。无 TTL 硬上限（v1.3 起移除）。
- `revoke`：吊销 = **物理删除**（不保留「已吊销」痕迹，无效即不存在）。两种形态二选一：`{ token }` 删单枚（须为本凭证签发，否则 403 `TOKEN_NOT_OWNED`；不存在 404）或 `{ tag }` 清空**调用方自己命名空间**内该槽位的全部活跃 token（空槽位幂等 200）。

### 3.5 业务用户 token 与 accountId（v1.6：登记表去账户化）

> ⚠️ **v1.8 适用面限定**：本节描述的 accountId 仍按原样存储与公开，但它**不再是扣款参考**——
> 自报值不可校验，而积分账本与产品侧结算已退场（参 §0 v1.8 与 kit CHANGELOG 0.28.0）。

- **无实体类型区分**（v1.9 #34）：经本契约签发的 token 全部是业务用户 token——`claims.type` 只是调用方自报的普通字段，服务端不设白名单、不因此触发任何额外校验。
- **accountId**：签发产品自报的账户标识，历史值空间 = 平台 OAuth `sub`。登记表不保证它属于调用方，**不保证它存在于任何账户体系**（v1.8：不再承诺可用作账本主键）。
- **登记表纯存储**：签发成功时登记表将调用方提交的 `claims`/`publicClaims` 原样落库，**不注入、不覆盖、不校验 accountId**，也不强制 `userId === accountId`。账户锚点 `accountId` 由调用方（产品）自报进 `publicClaims.accountId`。
- **公开可解析**：`publicClaims.accountId` 对匿名 introspect 亦可见（v1.6 时为了跨产品扣款锚定而设；v1.8 后仅作为展示/关联用途的透传字段，不因此产生新义务），与 name/email 等 PII 完全分离（PII 仅存私有 claims）。
- **账户背书不再由谁提供**：登记表不判定“谁能声明哪个 accountId”；而历史上接手风控的“积分域”已退场，因此 v1.8 的结论是：**自报 accountId 上没有可信的支付语义，不得在其上做扣款/发放判定**。历史 v1.4/v1.5 的 `identityTicket` / `evidenceToken` / `isPlatform` 豁免机制已整体退役，不得重建。

---

## 4. 错误契约

统一错误响应体：`{ code: string, message: string, requestId?: string }`

| HTTP | code | 场景 |
|---|---|---|
| 400 | `INVALID_ARGUMENT` | 缺少必填字段、字段格式错误、`claims` 违反扁平约束 |
| 400 | `TOKEN_NOT_ACTIVE` | 目标 Token 不处于活跃状态 |
| 401 | `UNAUTHENTICATED` | 调用方凭证无效或缺失（fail-closed，不降级放行） |
| 403 | `TOKEN_NOT_OWNED` | 单删 / 续期目标 token 非本凭证签发（签发者命名空间隔离，v1.9 #35） |
| 404 | `TOKEN_NOT_FOUND` | refresh / revoke（按 token）目标 token 不存在（含已物理删除） |
| 409 | `TOKEN_CONFLICT` | 并发双签发命中部分唯一索引 |
| 429 | `RATE_LIMITED` | 请求频率超限（响应含 `Retry-After`） |
| 500 | `INTERNAL` | 内部服务错误 |

> 凭证端点（`/api/v1/credentials/issue|revoke`，仅 `admin` 档可调）另用 `CREDENTIAL_NOT_ALLOWED`(403) / `CREDENTIAL_NOT_FOUND`(404)，**不属上表值域**（本表只覆盖 v1 token 端点）。

> introspect / lookup 不参与上述错误码（防枚举，统一 200 + `{active:false}`）——校验不通过的具体原因（过期 / 已吊销 / 访问权撤销 / scope 不符）**不进入错误码值域**，消费方只读 `active` 字段。
> 本表即 kit `TOKEN_ERROR_CODES` 的值域来源：两端必须同步，否则消费方「服务端业务拒绝 vs 通信层失败」的判据会误判（把业务拒绝当成服务不可达而触发探活降级）。

---

## 5. 安全与最小化约束

1. `token`（secret）仅在签发 / 轮换（admin 通道）响应中返回一次；其余端点任何响应不得包含 secret 明文或可反推出 secret 的信息。消费方凭证文件（kit `docs/credential-file.md`）由该响应在客户端拼装，服务端只存 hash，无补发路径。
2. 除本契约声明字段外，不得携带其他信息（最小化；匿名视图仅返回 `publicClaims` 声明公开的字段）。
3. 新增字段只允许为可选字段，且不得改变既有字段的类型与语义（向前兼容）。
4. `claims` / `publicClaims` 一律禁止嵌套对象与数组（无例外），保证各语言消费方解析无歧义。
5. **签发者命名空间隔离**（v1.9 #32，取代旧“产品隔离”）：写路径只能落在自己签发的记录上（越签发者 → 403 `TOKEN_NOT_OWNED`）；读路径（introspect / lookup）非本签发者时降级为公开视图，不泄露他方私有声明。
6. **公开字段不得携带 PII**：`publicClaims` 对匿名视图公开，因此只允许非敏感的标识与展示字段（`accountId` 作为调用方自报的透传标识保留）；name / email / 手机号等 PII 一律只允许出现在私有 `claims`，不得进入 `publicClaims`。
7. **token 层不做支付担保**：登记表不校验 accountId 归属，也不为任何金额操作提供可信主体。需识别调用方时用其**凭证身份**（`sk-auth-<id>` 的 id 段 = 签发者，或产品中心的 sk-pc 验真），而不是自报的 `productId`——后者已是透传数据（v1.9 #33）；计量与风控归平台计量域，不回填 token 签发层（v1.8）。

---

## 6. 验收标准

1. 对任意已签发 token 执行 `introspect` / `lookup`：响应含 §3.1 全部必填字段（`active` / `expiresAt`）且值与签发时一致；**响应不含顶层 `productId`**。
2. 同一 `(签发者凭证 id, tag)` 重复签发：旧行物理消失，仅一枚 active；异凭证同 tag 互不顶替（命名空间隔离）。
3. `token`（secret）仅出现在 `issue` 响应一次。
4. `refresh` 按调用方 `ttl` 续期（不填 = 永不过期，`expiresAt: null`）；`revoke` 按 §3.4 语义（物理删除，空槽位幂等）。
5. 错误响应符合第 4 节统一格式；无效 token 的 introspect / lookup 符合防枚举条款。
6. `claims` / `publicClaims` 与调用方提交一致（登记表不注入、不覆盖 accountId）；调用方自报的 `publicClaims.accountId` 可经匿名 introspect 解析。
7. 不存在 `identityTicket` / `evidenceToken` / 412 `IDENTITY_TICKET_REQUIRED` / `isPlatform` 豁免概念，也不存在 `PRODUCT_NOT_ALLOWED` / `PRODUCT_NOT_FOUND`（v1.9 #35）。
8. `tag` 完全由调用方自填（服务端不派生、不校验前缀）；`claims.type` / `skuId` / `confidential` / `redirectUris` 不再触发任何服务端严格校验（v1.9 #34）。
9. 越签发者：单删 / 续期 → 403 `TOKEN_NOT_OWNED`；读取 → 仅公开视图（未声明公开的字段不得出现）。
10. 凭证档位：`normal` 凭证调 `/api/v1/credentials/issue|revoke` → 403 `CREDENTIAL_NOT_ALLOWED`。

---

## 7. 配置项

本契约**无服务端配置项**（v1.9）：旧 `ISSUER_ID` env 与 `authCenterFacet`（`AUTH_CENTER_*`）均已退场。
消费方侧唯一配置渠道 = 凭证文件（`auth-center.credential.json`，见 kit `docs/credential-file.md`）；
管理面开关见 kit `/config` 的 `adminFacet`（`ADMIN_KEYBOOK`）。
