# Changelog

## Unreleased

### Changed

- **产品凭证文件鉴权段改为成对可选**（`/auth` credential-file）：`authCenterUrl` /
  `authCenterApiKey` 改为可选且齐套校验（只设其一即校验失败，消息含缺失字段名；
  惯例对齐 `/config` storage credentials）——无鉴权段形态（OAuth 段 + product /
  productCenter）为合法交付物，面向匿名 introspect（公开视图）消费方。
  `AuthCenterCredential` 两字段类型同步收紧为可选，**消费方需判空适配**：
  调鉴权中心端点的调用方判空后传入 `createAuthCenterClient`（如 product_center
  `token-authority.ts`）；匿名 introspect 消费方不受影响（无需创建客户端）。
  动机：产品中心自助台首签交付物即为无鉴权段形态（`issueAuthCredential`
  默认不签），且匿名 introspect 语义下鉴权段无增量（active / productId 均为
  token-contract §3.1 公开视图字段）。

## 0.35.0 — 2026-10-30

### Added

- **离线 SQL 渠道（新子路径 `yunzone-service-kit/db/offline`）**：PGlite（WASM 版
  PostgreSQL）作为 `SqlDb` 实现，经 `registerDatabaseChannel` + `createSqlDb` 同一
  分派路径生效——这是 0.34.0 渠道开放注册的官方内存方案，业务侧零分支、零旁路。
  导出：`registerOfflineChannel()`（幂等注册 `offline` 渠道）、`getOfflineDb()`、
  `resetOfflineDb()` / `disposeOfflineDb()`（用例间清空 / 收尾释放）、
  `isOfflineChannelRegistered()` / `isOfflineDbActive()`（配置自检）、
  `OFFLINE_DB_CHANNEL` / `OFFLINE_DB_CONTRACT_VERSION`，以及可替换驱动面
  `OfflineDriver` / `OfflineDriverFactory` / `pgliteDriver`。
  语义对齐：真事务（禁止嵌套）、pg 23505 → `UniqueViolationError`、`information_schema`
  自省、`now()` 事务内恒定、`gen_random_uuid()` 默认值、JSONB 往返为对象、
  `ON CONFLICT` / `RETURNING`、`getPool()` 提供 omni-auth 所需的结构化 PoolLike。
  单例语义：同进程内任意次数 `createSqlDb({ channel: "offline" })` 共享同一引擎与同一库。
  必然差异：单连接 FIFO 串行（事务期间其它语句排队而非交错）、不落盘、仅 `public` schema。
  **兼容性**：`@electric-sql/pglite` 为可选 peer（`peerDependenciesMeta.optional`），
  仅 `registerOfflineChannel()` 后按需动态加载；主入口与 `/db` 产物不引用它，
  生产安装与生产构建不触达。宿主项目需将其加入 devDependencies。

### Changed

- **`SqlDbConfig.options`**（`/db`）：`createSqlDb({ channel, options? })` 现支持透传
  连接池选项（`PgSqlDbOptions`：`ssl` / `max` / `idleTimeoutMillis`），与既有
  `new PgSqlDb(url, options)` 等价。目的是消除“为传 SSL 而直连构造”的旁路——直连
  会绕过渠道分派，使自定义渠道与离线渠道在那些项目里永远不生效。向后兼容（选填）。
- **`normalizeDbError` 导出**（`/db` 内部）：错误归一化（23505 → `UniqueViolationError`）
  自 `pg.ts` 抽出并与离线引擎共用，两套适配器的错误语义从此只有一处真理；
  `PgSqlDb` 行为不变。

## 0.34.0 — 2026-10-13

### Added

- **渠道开放注册（/storage + /db）**：`registerStorageChannel(channel, factory)` /
  `registerDatabaseChannel(channel, factory)` 允许业务为自有后端注册新渠道
  （本地内存方案、厂商专有 SDK 等），经同一 `resolveStorageChannel` /
  `createObjectStore`（及 db 侧同构面）分派——业务侧零分支、零旁路，渠道选择决策
  统一收口在 kit 抽象层。配套诊断面：`listRegisteredStorageChannels` /
  `listRegisteredDatabaseChannels` / `isKnown*Channel` / `unregister*Channel`。
  注册语义：同名覆盖（组合根责任自负）；内置渠道名（s3/coze/none、postgres/coze/none）
  禁止注册覆盖（官方适配器语义与 none 哨兵不被业务置换）；工厂接收调用时环境快照
  `{ env }`，凭证自管（内置渠道凭证解析仍归 /config 统一诊断）。

### Changed

- **`StorageChannel` / `DatabaseChannel` 值域开放**：内置三值域 + `(string & {})`
  开放面（保留内置名自动补全）；`resolve*Channel` 合法值域 = 内置 ∪ 已注册，
  非法值错误消息在存在注册渠道时附「已注册」清单（无注册时消息格式不变）。
  动机：kit 定位为集群辅助设施、不得约束业务——封闭渠道 switch 迫使业务在 kit
  之外重抄渠道分支（旁路实现绕过抽象层），违背辅助定位（消费实例：yunzone-infer
  数据面本地内存渠道，见其 CouplingRecord 20261013-115500）。

## 0.33.0 — 2026-10-12

### Breaking

- **管理面凭证从密码字符串升级为密码本（v2.0 Admin Keybook Protocol，新增
  `docs/admin-keybook-protocol.md`；`docs/admin-session-protocol.md` 标注 superseded）**：
  - `ADMIN_PASSWORD` / `ADMIN_USERNAME` 退役，`adminFacet` 键集变更——新增
    `ADMIN_KEYBOOK`（本地路径或 http(s) URL，进程启动时一次性加载，换本须重启）；
    未设置/加载失败 = 管理后台禁用（503），禁止任何默认回退（铁律不变）。
  - 密码本 = Ed25519 **公钥清单**（设计为可公开，泄露不能伪造签名）；私钥由管理员
    本机持有、从不上网；登录 = 对服务器一次性 challenge（HMAC 无状态令牌 + 120s
    窗口 + host 通道绑定）做本地签名，服务端查本验签。
  - 会话格式与 cookie（`admin_session`）沿用 v1.0，secret 派生物由
    `sha256hex(ADMIN_PASSWORD)` 换为**密码本指纹**（`sha256hex(canonical(keys))`）；
    换本（指纹变化）后全部旧会话失效；会话主体从固定 "admin" 变为登录所用 `key_id`。
  - `/ops` 导出替换：删除 `hashAdminPassword` / `verifyAdminPasswordWithHash`；
    `deriveAdminSessionSecret` / `createSignedAdminSession` /
    `validateSignedAdminSession` 第二参数从密码换为指纹（破坏性）；新增
    `parseAdminKeybook` / `loadAdminKeybook` / `initAdminRuntime` /
    `createAdminChallenge` / `verifyAdminChallenge` / `verifyKeybookSignature` /
    `buildAdminLoginMessage` / `computeKeybookFingerprint` / `AdminKeybookError` 等。
  - `/ops/next` `requireAdminAuth` 守卫数据源统一为 `initAdminRuntime()`（内部
    异步加载，签名不变仍为同步包装器——包装后的 handler 本为 async）。
- **服务侧迁移指引见 `docs/admin-keybook-protocol.md` §8**；本仓库 `platform/` 五服务
  （core / auth / product_center / user_center / infer）适配层与 e2e 脚本迁移为后续任务。

### Added

- `ops-companion/admin-login.html`：零依赖单文件登录伴侣（WebCrypto 本地签名、
  私钥仅驻内存、浏览器能力自检），随 npm 包发布（`files` 新增 `ops-companion`）。
- `scripts/adminctl.mjs`（npm script `adminctl`）：`genkey`（密钥对 + 密码本条目）、
  `keybook`（指纹与条目核对）、`demo`（本地开发密码本，严禁上生产）。

## 0.32.0 — 2026-09-26

### Breaking

- **凭证文件 v2 强切**（`/auth` credential-file）：字段命名统一为 OAuth 2.0 协议术语——
  - 顶层 `apiKey` → `authCenterApiKey`（与 `authCenterUrl` 配对，消除泛名）；
  - `client.id` → `clientId`、`client.name` → `clientName`、`client.role` → `clientRole`；
  - `productCenter.apiKey` → `clientSecret`（提升到顶层，值只存一处；调产品中心 v1 的 Bearer 复用该值）；
  - `productCenter` 段仅保留 `baseUrl`；`client.productId` / `client.expiresAt` 移除（合一时代残留）。
- v1 形态不再受支持：加载即校验失败，错误消息附迁移指引；存量文件用部署侧迁移脚本做字段重排（凭证值不变）或从签发方重新获取。
- 装配返回类型 `AuthCenterCredential` 同步换名与收紧：`authCenterApiKey`（必填）/ `clientId`（必填）/ `clientSecret?` / `clientName?` / `clientRole?` / `productCenter?: { baseUrl }`。

### Docs

- `docs/credential-file.md` 重写为 v3.0：v2 形态（产品凭证 / 管理员凭证）、字段表、v1→v2 迁移对照。
