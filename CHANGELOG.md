# Changelog

> **记录边界**：本日志只记录 kit 自身的契约 / 实现 / 兼容性变更。消费方（下游服务）的内部迁移细节、文件清单、依赖版本对齐一律不记——那是反向依赖：下游一改，本日志立刻变成错误信息源。需要表述下游影响时，只以「兼容性 / 升级提示」的中立形式写 kit 侧的行为约束，必要时点名**角色**（鉴权中心、用户中心、宿主应用）而不点名具体仓库。

## 0.30.0 — 2026-09-16

凭证来源扩展：凭证（静态内容）的**来源**从"仅本地文件"扩展为"本地文件 / 远端 URL 显式二选一"，两种来源统一走**进程内缓存快照**；新增 `refreshAuthCenterCredential()` 作为唯一更新入口（启动即预取，运行期可刷新）。

### 新增

- **远端来源 `AUTH_CENTER_CREDENTIAL_URL`（可选）**：显式设置即启用远端来源（fetch 取件）；与 `AUTH_CENTER_CREDENTIAL_FILE`（本地路径指示，同版本纳入本契约）互斥，同时设置抛 `CredentialFileError`；远端模式忽略 `options.path`
- **`refreshAuthCenterCredential(options?)`**：从来源刷新缓存（幂等、**永不抛错**——失败仅 `console.warn` 且缓存不更新）；`timeoutMs` 控制远端抓取超时（默认 10000）；部署约定 = 各服务启动流程调用一次，运行期热更新（如管理台刷新按钮）同调
- **统一缓存快照**：文件 / 远端来源一致——首次读取（文件来源可同步直读兜底）或 refresh 装入缓存，此后加载一律走缓存；**更新生效点 = 进程重启或显式刷新**；缓存挂载 `globalThis`（CJS / ESM 双构建实例共享，避免预取与读取分属不同实例）
- **`resetAuthCenterCredentialCacheForTest()`**：测试专用缓存重置（同进程用例隔离）
- 导出常量 `AUTH_CENTER_CREDENTIAL_URL_ENV` / `AUTH_CENTER_CREDENTIAL_FILE_ENV`

### 兼容性 / 升级提示

- **读取快照化（行为变化）**：`loadAuthCenterCredential` 从"逐次读文件"变为"读缓存快照"——升级后**替换本地文件不再对运行中进程即时生效**，需重启或调用 `refreshAuthCenterCredential()`（与远端来源语义统一；"热更新"以显式刷新形式保留）
- **失败语义**：远端取件失败（网络 / 非 2xx / 超时 / 运行时无 fetch）记入"缺失"——读侧走既有 ENOENT 分支（`optional ? null : CredentialFileError`），不新增错误族；校验分支（非法 JSON / schema 失败）不变
- **脱敏**：远端 URL 视为凭证材料——错误 / 告警消息不回显 URL（内嵌 URL 精确替换为 `<remote-url>`）；`sourcePath` 在远端模式返回 `remote://auth-center.credential.json`（不含 URL）
- 升级动作：在服务启动流程加一行 `await refreshAuthCenterCredential()`（`loadDotEnv` 之后；启动即部署 = "部署时自动调一次"）；仅文件来源且不加该行也可用（读取走同步直读兜底），但跨构建实例的快照一致性以启动预取为准
- 契约单一事实源：[docs/credential-file.md](docs/credential-file.md) §3（来源 / 缓存 / 刷新 / 失败语义）

## 0.29.0 — 2026-09-10

产品凭证文件分段交付（对齐产品中心 DESIGN.md §3 统一交付物）：凭证文件定位升级为"产品接入集群的唯一配置交付物"——注册/轮换时由产品中心一次性下发完整文件；kit 装配层职责不变（形态校验 + 结构化装配），不消费、不解释任何段的内容语义。

### 新增

- **凭证文件产品段 `product`（可选）**：`{ id, name? }`——产品在产品中心的权威指代（`product.id` 轮换不变）；消费方据此自指（如 claims.productId、归属校验）。管理员凭证等非产品交付物无此段。
- **凭证文件产品中心段 `productCenter`（可选）**：`{ baseUrl, apiKey }`——调产品中心 v1 的地址与 Bearer（sk-pc）；`baseUrl` 装配时归一化尾部斜杠。
- **`AuthCenterCredential.product` / `.productCenter`**：两段装配结果（文件含该段则存在，否则 undefined）。

### 兼容性 / 迁移提示

- 顶层鉴权段（`authCenterUrl` + `apiKey`）不变：旧文件即合法新文件（缺新段 → 对应字段 undefined），旧消费方零改动；
- `client.productId` 保留为合一时代兼容字段（可选）：新签发文件以 `product.id` 为权威指代，旧消费链（读 `credential.productId`）继续可用；
- 未知字段仍被 zod 默认剥离：旧加载器读新文件不炸。

## 0.28.0 — 2026-09-09

计量与定价从共享基础设施层退出：`/points` 整面退役。本 kit 不再提供任何“积分”形状——它把
一个尚未定形的平台义务（价格裁决与账本写入）当作了既定契约向下广播。

### 移除（破坏性）

- **导出子路径 `yunzone-service-kit/points` 整体下线**：`POINTS_ENDPOINTS`、`PointsClient` /
  `createPointsClient`（`balance` / `deduct` / `deposit`）、`Points*Request` / `Points*Response` 契约类型全部删除
- **`PointsServiceError` 类移除**：不再是 `KitError` 的下游错误族；根入口 `yunzone-service-kit` 同步不再 re-export 上述符号
- **配置分面 `userCenterFacet` 下线**（`/config` 导出）：`USER_CENTER_URL` 与预留的 `USER_CENTER_API_KEY` 两个键一并删除。它是积分时代“浏览器侧余额展示”的下发通道，现在全集群零消费者（`USER_CENTER_API_KEY` 自接入以来从未被读）。需引用用户中心地址的产品在自己的私有 schema 里显式声明

### 兼容性 / 升级提示

- 升级本版本的仓必须同时删掉对 `/points` 的 import；**仅改 package.json 版本号而不改调用点会直接构建失败**（无向后兼容层，不提供空壳转发）
- 同理，在 `composeFacets(...)` 里引了 `userCenterFacet` 的仓必须去掉该分面（否则 import 直接报错）；它自己的 `.env` 里残留的 `USER_CENTER_URL=` 不报错（通用契约不再声明该键，也不会再被 `loadEnv` 输出），但需自行改接至私有 schema
- 历史版本（≤ 0.27.x）仍可解析，但已无维护：不要在新代码里引入它
- “服务间幂等、失败可安全重试”的语义仍成立，但不再由本 kit 提供契约形状；重建时它属于**平台计量域**
  的契约（对手方为产品而非用户账户），而非集群公共设施
- 账本本体（余额 / 流水 / 幂等约束）自始不在本 kit，本次也不涉入其数据迁移

## 0.27.0 — 2026-09-09

AppManifest v1 新增**可选顶层 `apis` 命名空间**：子产品自述"本应用提供哪些 API"，宿主（用户中心）按既有拉取链路聚合后在 API 展示版面消费。纯增量可选字段，`schemaVersion` 不变。

### 新增

- **`AppApiEntry` / `AppApiMethod`**：API 条目契约（`id` / `name` / `summary` / `method` / `path` / `tags`），纯展示形态——只声明人可读标识信息，不承载请求 / 响应 schema 等机器契约
- **`appManifestSchema.apis`**：顶层可选数组（`z.array(appApiEntrySchema).default([])`）；解析归一化：`apis` 缺省 `[]`、条目 `method` 缺省 `"GET"`、`tags` 缺省 `[]`
- **`appApiEntrySchema`**：条目 schema 单独导出，宿主可复用组合扩展
- **`ResolvedApp.apis`**：清单经 `resolveAppCatalog` 透传（恒为数组）；无编排覆盖语义（API 清单是子产品自述）
- **错误码 `APP_MANIFEST_API_DUPLICATE_ID`**：`apis` 条目 `id` 重复在解析期 fail-fast（对齐编排目录重复 `id` 行为）

### 兼容性 / 升级提示

- 纯增量：不声明 `apis` 的 manifest 解析结果不变（`apis` 归一化为 `[]`），既有消费方无感
- **方向性兼容（zod strip）**：旧版解析器（≤ 0.26.x）对带 `apis` 的 manifest 会静默丢弃该字段（zod 默认 strip 未声明字段）而非报错——宿主消费 `apis` 前须升级到本版本（kit 先发，下游后升）
- 条目契约的单一事实源见 [docs/app-manifest.md](docs/app-manifest.md) §2.5

## 0.26.0 — 2026-09-09

服务凭证配置迁移到单渠道**凭证文件**：鉴权中心服务凭证（apiKey / productId / 服务地址）不再走环境变量，`authCenterFacet` 退役，`/auth` 新增凭证文件加载面。

### 新增

- **`/auth` 凭证文件加载**：`loadAuthCenterCredential(options?)` 读取 `auth-center.credential.json`（默认 `<cwd>/`，`path` 可指定，`optional: true` 时缺失降级为 `null`），返回三要素（`authCenterUrl` 尾部斜杠归一化 / `apiKey` / `productId`，附 `clientId` / `name` / `expiresAt` 签发快照）与 `sourcePath`；缺失（默认）/ 非法 JSON / 字段校验失败抛 `CredentialFileError`，**不回显凭证值**
- **`.gitignore` 启发式检查**：加载时从文件位置向上找最近 `.git`，凭证文件疑似被 git 跟踪时 `console.warn` 一次（启发式子集：精确名 / `*` 通配 / 目录前缀；提示非保证，防泄漏以 `.gitignore` 维护约定为准）

### 移除（破坏性）

- **`authCenterFacet` 导出移除**：`AUTH_CENTER_URL` / `AUTH_CENTER_API_KEY` / `AUTH_CENTER_PRODUCT_ID` 退出集群契约面。私有 schema 组合了该面的消费方（`composeFacets` / `requiredFacet`）须删除对应声明，鉴权中心客户端配置改用 `loadAuthCenterCredential`

### 兼容性 / 升级提示

- 凭证文件由鉴权中心管理后台在**签发/轮换时刻**从响应体客户端拼装下载（明文 apiKey 全量携带）；服务端只存 hash，**无任何补发路径**，丢件即重签。下载后放置到服务目录并加入 `.gitignore`
- 文件内 `expiresAt` 为签发时快照（auto-renew 场景会失真），仅供展示；运行时有效性以 introspect 为准。refresh / 自动续期不改令牌值，文件持续有效；轮换后旧文件立即失效（introspect 返回 `active: false`）
- 契约单一事实源：[docs/credential-file.md](docs/credential-file.md)（内含未来整文件加密的信封预留，内层 schema 不变）

## 0.25.0 — 2026-09-06

`/points` 契约扩展 **deposit**（算力报酬存入）。生态循环的产出侧：infer 控制面将算力提供者积累的内部台账汇总后存入平台积分账户，与 deduct（消费侧）共同构成完整积分生命周期。

### 新增

- **`POINTS_ENDPOINTS.deposit`**：`/api/internal/points/deposit`（平台内部端点，非 B 端产品 API）
- **`PointsDepositRequest`** / **`PointsDepositResponse`**：存入契约（requestId 幂等、orderNo 存入凭证、balance 存入后余额）
- **`PointsClient.deposit()`**：官方通信实现，镜像 deduct 行为（业务结果正常返回、协议层失败抛 `PointsServiceError`）

### 信任层级

- deposit 端点位于 `/api/internal/` 前缀，用户中心侧以 productId 白名单限制调用方（仅平台基础设施可调）
- 与 deduct（`/api/points/`，任何 B 端产品凭证可调）形成信任分层
- 任务完成验证、防滥用、限额等安全逻辑全在 infer 内部承担，用户中心只做记账

### 兼容性 / 升级提示

- 纯增量：`PointsClient` 接口新增 `deposit` 方法，现有 `balance` / `deduct` 行为不变
- 消费方无需升级即可继续使用现有功能；仅 infer 控制面需使用新契约

## 0.24.0 — 2026-09-05

`/ops` 运维报告新增**宿主扩展段**（`addSection` / `OpsReport.sections`）。标准报告此前是闭合四段（service / deployment / registries / envFingerprint），宿主自有的运维数据（API 调用热度、队列积压、卡片目录快照等）无承载面，只能各服务私改报告形状导致跨服务口径分叉。

### 新增

- **`OpsReporter.addSection(id, provider)`**：注册一个扩展段，`id` 为报告 `sections` 中的 key（同 id 后注册者覆盖前者）；provider 在每次 `report()` 时调用，类型 `() => unknown | Promise<unknown>`（同步 / 异步皆可）
- **`OpsReport.sections: Record<string, OpsSectionResult>`**：扩展段快照，信封为 `{ ok: true, data }` / `{ ok: false, error }`；数据形状由宿主自定义，kit 不解释语义
- **单段故障隔离**：provider 抛错（含返回 rejected promise）只把该段降级为 `{ ok: false, error }`（只留消息不留堆栈），其余段与整份报告照常产出——运维报告不因任一扩展段失效而整体不可用；各段并发聚合（宿主代码耗时未知，不串行拖长报告）

### 兼容性 / 升级提示

- `OpsReport` 新增**必填**字段 `sections`（未注册扩展段时为 `{}`）。只读取报告的消费方无感；仅在代码里手工构造 `OpsReport` 字面量的场景（如测试桩）需补该字段
- 扩展段是宿主自有数据的出口，**kit 不为其定义契约**：跨服务口径统一由消费方约定 `id` 命名（如 `apiHeat`）与 `data` 形状
- 扩展段不得携带密钥 / 明文凭证：`sections` 与 `envFingerprint` 同属对外可读的运维面，脏数据治理属宿主职责（kit 不过滤、不脏检查）

## 0.23.1 — 2026-09-05

代码清理（0.23.0 的后续轮次）：删除不可达兜底分支、清理旧术语残留、`/points` 契约副本对齐用户中心实现。非破坏性（契约变更面已核实集群内零引用）。

### `/points` 契约副本对齐用户中心实现

- **`PointsBalanceResponse` 补 `success: boolean`**：balance 端点（服务间 POST）经用户中心统一响应助手返回 `{ success: true, balance }`（数据字段展开顶层），原契约缺该信封字段；`deduct` 响应为裸 JSON（无信封字段），两端口径差异已在契约注释分别注明。**已核实 `PointsBalanceResponse` 集群内零引用，纯增量**
- 配套：模块头注释端点语义同步；`tests/points-client.test.ts` balance 用例 mock 与断言同步

### 实现简化

- **`KitError` 删除 ES2022 以下 cause 兜底分支**：`engines` 声明 node>=18（tsup target node18 / tsconfig target ES2022），`new Error(msg, { cause })` 由运行时原生安装 cause，原「`(this as { cause?: unknown }).cause === undefined` 时显式挂载」分支不可达，行为等价删除

### 注释/文档纠偏

- 清理「db-core / storage-core」历史术语残留 4 处（`src/index.ts` storage 行、`db/index.ts` / `db/types.ts`、`storage/index.ts` / `storage/types.ts`——0.9.0/0.13.0 时代内部命名，「core」概念无承载面，跨仓零引用）；`config/env.ts` `LoadEnvOptions` JSDoc 格式修正

### 验证

`tsc -p tsconfig.json` 0 错误；vitest 15 文件 199 用例全绿；`tsup` 构建（ESM + CJS + DTS）成功。

## 0.23.0 — 2026-09-02

代码清理：删除零消费者的死代码、收敛重复实现与不可达兜底分支、修正契约副本与文档对实现的漂移。**含破坏性变更**（导出面收缩 + `/auth` 契约类型收紧）。

### 删除（死代码，均已核实集群内零消费者）

- **`/ops` 移除 legacy base64 明文会话 `createAdminSession` / `validateAdminSession` / `ValidateAdminSessionOptions`**：0.7.0 标记 `@deprecated` 并承诺「过渡一个版本后移除」，至此已跨 15 个版本；base64 明文会话内含明文密码，泄露即被永久伪造。替代：`createSignedAdminSession` / `validateSignedAdminSession`（v1.0 HMAC 协议）
- **`/ops` 移除 `verifyAdminToken`**：明文密码直接比较，已被 `verifyAdminPasswordWithHash`（哈希比对，协议 2.5「模块加载时缓存哈希、此后不持有明文」）取代；其函数体与内部私有 `safeEqual` 逐字重复，常量时间比较现由后者单一承载
- **`/config` 移除 `defineEnv`**：恒等函数（`return schema`），对类型推断无贡献——`loadEnv(z.object({...}))` 与 `loadEnv(defineEnv(z.object({...})))` 完全等价，多一层不降低心智负担
- **`/ops/next` 移除 `AdminRouteHandler` / `AdminRouteRequestLike` / `AdminRequestCookiesLike` / `AdminRouteParams`**：四者均不参与实现（`requireAdminAuth` 以宽松泛型 `THandler` 原样透传服务侧签名），且 `AdminRouteHandler` 诱导出与实现不符的文档签名（见下「文档纠偏」）
- **`/auth` `TOKEN_ERROR_CODES` 移除 `TTL_LIMIT_EXCEEDED`**：`docs/token-contract.md` v1.3 修订 #13 已删除该码（移除 TTL 硬上限），鉴权中心错误码值域中亦不存在
- 配套：删除 `tests/type-experiment2.ts`（临时类型复现实验残留——不在 `tsconfig` include 内、非 `.test.ts` 故不被 vitest 执行，双重不可达）；`tests/admin.test.ts` 移除对应 10 用例；`tests/config.test.ts` 改用裸 `z.object`

### `/auth` 契约副本对齐鉴权中心实现（破坏性）

契约副本与服务端实现漂移，本次以服务端实现为准修正：

- **`expiresAt` 可空**：`TokenIssueResponse.expiresAt` / `TokenRefreshResponse.expiresAt` 由 `string` 改为 `string | null`，`TokenIntrospectResponse.expiresAt` 由 `string | undefined` 改为 `string | null | undefined`——签发 / 续期未传 `ttl` 即永不过期，服务端返回 `null`。**破坏性**：读取该字段的消费方需处理 `null`
- **`ttl` 语义纠正**：原注释「有效秒数，默认 86400」→「不填 = 不设过期时间」；`TokenRefreshResponse` 原注释「受总有效期硬上限约束（超限返回 400 TTL_LIMIT_EXCEEDED）」→「无 TTL 硬上限（基建不评判调用方对过期时间的设置）」，与 v1.3 修订 #12/#13 及服务端 `ttl ? ... : null` 实现一致
- **`TOKEN_ERROR_CODES` 补齐 `TOKEN_CONFLICT` / `PRODUCT_NOT_FOUND` / `TOKEN_NOT_ACTIVE`**（鉴权中心 v1 token 端点实际返回，此前缺失）；**移除 `PRODUCT_NOT_REGISTERED` / `PRODUCT_DISABLED` / `TOKEN_EXPIRED` / `TOKEN_REVOKED`**（服务端错误码联合类型中存在但全仓零抛出点；且 introspect / lookup 按防枚举统一 200 + `active:false`，校验不通过的原因不经错误码通道）。`docs/token-contract.md` §4 错误表同步，并标注该表即 `TOKEN_ERROR_CODES` 的值域来源
- **升级提示**：`TOKEN_ERROR_CODES` 被消费方用作「服务端业务拒绝 vs 通信层失败」的判据（命中值域即服务可达）。缺码会把业务拒绝误判为服务不可达而触发探活降级——补齐 `TOKEN_CONFLICT`（409 并发双签发）即修正该误判

### 实现修正

- **`PgSqlDb` 事务代理不再泄漏连接池**：原 `PgSqlDbTransaction extends PgSqlDb` 以 `super("__tx__")` 构造，注释称「跳过父类的 Pool 创建」，实际父类构造函数会创建一个随即被 `this.pool = client` 覆盖丢弃的 `Pool`（每次 `withTransaction` 泄漏一个池对象）。改为独立实现 `SqlDb`；查询 / 写语句原语抽为模块级 `runQuery` / `runExecute`，供连接池与事务连接共用（消除为复用归一化逻辑而继承的动机）。连带消除 `disconnect()` 的 `instanceof Pool` 兜底分支与 `getPool()` 的 override 抛错，`PgSqlDb.pool` 类型由 `Pool | PoolClient` 收窄为 `Pool`
- **`isPoolProvider` 守卫语义收紧**：事务代理不再实现 `PoolProvider`，守卫对其返回 `false`——「守卫通过即可调用 `getPool()`」，消除原「守卫通过但调用抛错」的脏语义
- **`ProviderRegistry.getStatus()` 去除不可达兜底**：内层已 `try/catch` 吞掉健康检查异常（不可用即 `false`），外层 `Promise.allSettled` + `status === "fulfilled"` 判断为永不触发的第二重兜底，改用 `Promise.all`
- **渠道工厂穷尽性守卫改为 fail-fast**：`createSqlDb` / `createObjectStore` 的 `default` 分支原为 `return String(exhaustive) as never`（把字符串断言成 `never` 返回，运行期若触达即产生类型谎言），改为抛 `StorageConfigError` / `ObjectStoreConfigError`；`const exhaustive: never` 的编译期穷尽性保证不变
- **重复实现收敛**：`config/env.ts` 私有 `schemaKeys` 与 `config/specs.ts` 公共 `facetKeys` 实现逐字相同，删除前者，`loadEnv` 失败诊断改用后者

### 文档纠偏

- **模块描述与实现对齐**：`src/index.ts` 的 `/db` 描述「互斥后端抽象（db-core：存储后端契约 + memory 实现）」→「SQL 数据库抽象（SqlDb 契约 + PgSqlDb 渠道适配器）」（memory 实现于 0.9.0 已删除）；`db/index.ts` / `core/index.ts`「渠道两模式」→「渠道三值域」（`none` 于 0.11.1 加入）；`db/types.ts` 删除「取代旧的『互斥后端』DbAdapter 通用 CRUD 原语」历史演进说明；`db/errors.ts` / `storage/errors.ts` 配置错误注释「当前无可用实现」（互斥后端时代措辞）→ 实际触发场景
- **职责边界表述**：`ops/types.ts`「库不提供路由/响应封装」→ 限定为本入口并指向 `/ops/next`；`ops/admin.ts` 删除与逐函数 JSDoc 重复的「函数清单」目录式注释；`app/types.ts` 删除指向宿主内部类型（`Service` / `ServiceCard`）的耦合说明；`points/client.ts` 歧义表述「通信错误不带 cause 重试逻辑」→「kit 不代持重试」
- **过期承诺叙述清理**：`config/specs.ts` 与 `.env.example` 删除 `AUTH_SERVER_*` legacy 别名的版本移除承诺（0.4.0 已兑现）；`config/base-url.ts` 纠正 `onmi-auth` → `omni-auth` 拼写
- **`docs/admin-session-protocol.md` §2.7**：守卫签名 `requireAdminAuth(handler: AdminRouteHandler): AdminRouteHandler` → 实际泛型形态 `requireAdminAuth<THandler>(handler: THandler): THandler`；「依赖 `NextRequest`/`NextResponse`」→ 仅依赖 `next/server` 的 `NextResponse`，并补充「不引入 `NextRequest` 作为参数类型」的类型解耦依据
- **`README.md`**：补齐缺失的 `/core`、`/ops/next`、`/auth`、`/points`、`/app`、`/app/next` 六个章节（原文只覆盖 5 个模块，且 `/ops` 章节列的是本次删除的 legacy 会话函数）；「零框架耦合（不依赖 Next.js/React）」→ 限定为纯逻辑层；`/db` 渠道补 `none`、补 `PoolProvider` / `isPoolProvider`、补事务边界约束；`/storage` 契约补 `getUploadUrl`；`adminFacet` 补 `ADMIN_USERNAME` / `ADMIN_SESSION_MAX_AGE`；删除 `defineEnv`
- **`.env.example`**：删除重复声明的「对外 baseUrl」段（`PUBLIC_BASE_URL` 在文件中出现两次，`parseDotEnv` 下同键后值覆盖前值，构成配置陷阱），`BETTER_AUTH_URL` 归入部署面；补齐 `/storage` 全套变量（`STORAGE_PROVIDER` / `S3_*` / `COZE_BUCKET_*`）与管理面 `ADMIN_USERNAME` / `ADMIN_SESSION_MAX_AGE`、数据库面 `none` 渠道说明

### 验证

`tsc -p tsconfig.json` 0 错误；vitest 15 文件 199 用例全绿（清理前 209，差额为删除死代码的 10 个用例）；`tsup` 构建（ESM + CJS + DTS）成功。

## 0.21.0 — 2026-09-02

`/auth` Token Authority 契约文档升级至 v1.6（登记表去账户化）；`/config` 契约面移除身份票据密钥。鉴权中心还原为纯 token 存储，业务用户 token 不再做 accountId 账户锚定，账户背书与支付风控归消费方与积分域。

- **`docs/token-contract.md` v1.5 → v1.6**：新增修订 #26~#28——业务用户 token 签发改为登记表纯存储（不注入 / 不校验 accountId，accountId 由调用方自报进 `publicClaims.accountId`）；移除 `identityTicket` / `evidenceToken` 签发字段、`isPlatform` 平台指定、412 `IDENTITY_TICKET_REQUIRED` 错误码；§3.5 重写、§3.6 身份票据契约整体退役；错误表 / 安全约束 / 验收标准 / 配置项表同步
- **`TokenIssueRequest` 移除 `identityTicket?` / `evidenceToken?` 字段**：账户锚定不再是登记表职责。**破坏性**：v1.4/v1.5 依赖票据签发的调用方需改为自报 `publicClaims.accountId`
- **`/auth` 契约类型 `userId` → `tag`（破坏性）**：跟随鉴权中心 v1 API 的槽位模型，`TokenIssueRequest` / `TokenIssueResponse` / `TokenIntrospectResponse` / `TokenRevokeRequest` 的"签发主体"字段由 `userId` 更名为 `tag`（opaque 槽位，登记表不解释语义），`publicUserId` → `publicTag`；`docs/token-contract.md` §1/§2/§3.1/§3.3/§6 与修订 #29 同步。**升级提示**：API 变化隔离在消费方适配器边界——用户中心 / WanyanAI 适配器已映射 userId↔tag；直接用 kit `/auth` 类型读 `userId` 的消费方（如 relay introspect 的 accountId 兜底）升级后需改读 `tag`
- **`authCenterFacet` 移除 `IDENTITY_TICKET_SECRET`**：身份票据机制退役，集群契约面不再持有该密钥。**破坏性**：升级后消费方私有 schema 若仍声明该键应一并删除
- 配套：`tests/specs.test.ts` facetKeys 断言同步移除该键
- **兼容性**：含破坏性变更（移除签发字段与契约面键）——与鉴权中心去账户化、消费方 accountId 自报为同一批协同上线

## 0.20.0 — 2026-09-02

`/config` 契约面补齐身份票据密钥；`/auth` Token Authority 契约文档升级至 v1.5（结算账户锚定 P1：平台指定注册数据化、签发校验加固、错误码语义化、商品契约去商业化）。

- **`authCenterFacet` 新增 `IDENTITY_TICKET_SECRET`（optional）**：身份票据共享 HMAC 密钥提升进集群契约面（此前仅存在于个别消费方私有 schema）；平台侧签发 / 鉴权中心本地验签必须注入同一值，未配置时签发 503 / 校验 500（均 fail-closed）。**升级提示**：已在私有 schema 声明该键的消费方，升级后应删除私有声明，避免与契约面重复
- **`docs/token-contract.md` v1.4 → v1.5**：新增修订 #19~#25——平台资格指定改由产品注册记录 `claims.isPlatform` 指认（环境变量 `PLATFORM_PRODUCT_ID` 仅回退，删除硬编码默认值）；`claims.type` 白名单与保留命名空间防护；跨类型替换保护（409）；票据缺失拒绝码 412 `IDENTITY_TICKET_REQUIRED`；商品 token 仅保留结构性约束（内容字段语义校验由消费方边界承担）；配置项表新增 `PLATFORM_PRODUCT_ID` / `IDENTITY_TICKET_SECRET`
- **`/auth` 类型源注释同步 v1.5**（`TokenIssueRequest` 结构不变，仍为 v1.4 引入的 `identityTicket?` / `evidenceToken?`）
- 配套：`tests/specs.test.ts` facetKeys 断言同步新键，全量 209 用例全绿
- **兼容性**：纯增量（可选键 + 文档），既有调用方零破坏

## 0.19.0 — 2026-08-30

平台服务对接协议封装收编：新增鉴权中心客户端执行层（`/auth`）与积分服务契约 + 客户端（`/points`，新导出子路径 `yunzone-service-kit/points`）。对接协议封装（端点、鉴权头、超时、错误归一化）由 kit 统一提供；消费方策略（探活节奏、降级回退、身份映射、重试时序）仍由消费方实现——kit 尽契约责任，通信实现不再散落各消费方。

- **`/auth` 新增客户端执行层 `createAuthCenterClient(options)`**：`introspect(request)` POST 至契约端点（Bearer 服务凭证头、AbortController 超时默认 5000ms）并透传响应——无效 token 统一 200 + `{ active: false }`（防枚举）为服务端语义，客户端原样返回不抛错；`healthz()` GET 契约端点，可用性以 boolean 返回（不可达 / 非 2xx 一律 false，探活是轮询查询不抛错）。配置项 `baseUrl`（尾部斜杠归一化）/ `apiKey?`（为空不带 Authorization 头，匿名 introspect → 公开视图）/ `timeoutMs?`
- **`TOKEN_ENDPOINTS` 增补 `healthz: '/api/healthz'`**（端点常量单源，此前仅存在于个别消费方实现内）
- **新增错误族 `AuthCenterError`**（extends `KitError`）：网络失败 / 超时 / 非 2xx / 响应体非法等协议层失败统一归一化；非 2xx 响应体可解析出服务端错误码时保留至 `error.code`（如 `RATE_LIMITED`），否则默认 `AUTH_CENTER_PROTOCOL_ERROR`；网络失败保留 cause
- **新增 `/points` 积分服务模块**：`POINTS_ENDPOINTS`（`/api/points/balance` / `/api/points/deduct`）+ 请求 / 响应契约类型（`PointsBalanceRequest/Response`、`PointsDeductRequest/Response`）+ 客户端 `createPointsClient(options)`（`balance` / `deduct`，与 `/auth` 同构）。**幂等语义入契约文档**：`requestId` 为幂等键（用户中心流水 UNIQUE 约束保证同一 requestId 至多实扣一次）；重复请求返回 `duplicate: true` 不视为失败；deduct 协议层失败时服务端状态不可确知，调用方可按契约以**同一 requestId 安全重试**（重复入账由服务端幂等兜底）。余额不足 / `ok: false` 等业务结果正常返回不抛错
- **新增错误族 `PointsServiceError`**（extends `KitError`，code `POINTS_PROTOCOL_ERROR`）；重试 / 退避策略由消费方按业务时序决定，kit 不代持
- **新增导出子路径 `./auth` 与 `./points`**（tsup entry、package.json exports 同步）；根入口 `/auth` 导出面由 token-contract 扩为整个 auth 模块（既有类型导出不变，纯增量）
- 配套：`tests/auth-client.test.ts` 新增 10 用例、`tests/points-client.test.ts` 新增 7 用例（契约透传 / 鉴权头 / 错误归一化 / 超时 / 探活三态），全量 209 用例全绿

## 0.18.0 — 2026-08-26

`/auth` Token Authority 服务契约升级至 v1.4：新增「accountId 账户锚定」与「身份票据」契约，支撑跨产品积分扣款锚定与第三方产品安全接入。

- **`TokenIssueRequest` 新增 `identityTicket?` 字段**：第三方产品签发业务用户 token（claims 无 type 声明）时，必须携带平台（user_center）签发的短时身份票据（格式 `yzid1.<payload>.<sig>`，默认 300s 有效），证明账户归属经平台 OAuth 流程背书；与 `evidenceToken` 二选一
- **`TokenIssueRequest` 新增 `evidenceToken?` 字段**：同一产品现存有效业务用户 token 作为链式证据（会员换发等续签场景），鉴权中心校验 active + 同 productId + 业务类型后以其 accountId 为锚；与 `identityTicket` 二选一
- **`publicUserId` JSDoc 更新**：v1.4 起业务用户 token 的账户锚点走 `publicClaims.accountId`，不再依赖本开关
- 配套：`docs/token-contract.md` 同步升级至 v1.4（新增 §3.5 业务用户 token 与 accountId / §3.6 身份票据契约；修订记录追加 4 条决策；安全边界与签发约束补充 3 条）；模块头注释同步 v1.4
- **兼容性**：纯增量可选字段，既有调用方零破坏；未携带票据 / 证据的签发请求行为不变（签发侧的账户锚定约束以 `docs/token-contract.md` v1.4 为准）

## 0.17.0 — 2026-08-24

`/app` 新增标准端点托管（新导出子路径 `yunzone-service-kit/app/next`）：子产品把 manifest 托管到约定路径 `/.well-known/app-manifest.json`，消费方（如用户中心）按该路径拉取，URL 约定随契约稳定演进。

- **`createAppManifestHandler(options)` 路由适配层**（对齐 `/ops/next` 鸭子类型 + 宽松泛型策略，规避 Next.js 内部私有标记跨副本类型不兼容）：`options.manifest` 支持静态对象或函数形态（每次请求求值，支持运行时动态状态）；每次请求经 `parseAppManifest` 契约校验，非法 manifest 返回 `500 { code: "APP_MANIFEST_INVALID" }`（不输出非法契约、不泄漏诊断细节）；成功响应统一 `Cache-Control: public, max-age=300` 与 JSON Content-Type；与静态文件方式（`public/.well-known/app-manifest.json`）二选一，完全静态场景零代码
- **路径约定常量 `APP_MANIFEST_WELL_KNOWN_PATH = "/.well-known/app-manifest.json"`**（RFC 8615 well-known 前缀）：加入 `app/types.ts` 与 `docs/app-manifest.md`「标准端点约定」章节
- 配套：`tests/app-next.test.ts` 新增 4 用例（静态 200 + 缓存头 / 函数式动态 status / 非法 500 固定错误码且不泄漏诊断 / 常量路径），全量 192 用例全绿；tsup entry 与 package.json exports 新增 `./app/next` 子路径

## 0.16.0 — 2026-08-24

新增 `/app` 应用目录契约模块（新导出子路径 `yunzone-service-kit/app`）：为集群子产品提供标准「应用介绍」自描述契约（Headless 纯数据层，零框架 / 零 React 依赖），宿主（如用户中心）聚合后标准渲染、随意编排。

- **`AppManifest` v1 契约（zod schema `appManifestSchema`）**：`schemaVersion`（当前仅支持 `"1.0"`，其余抛错 `APP_MANIFEST_VERSION_UNSUPPORTED`）/ `app.id`（唯一标识）/ `name`（应用名）/ `tagline?`（一句话简介，缺省回退 `description`）/ `description`（详细介绍）/ `href`（访问链接）/ `status?`（`live` / `beta` / `coming_soon` / `maintenance`，缺省 `live`）/ `assets.icon`（必填，标准方块按钮用）+ `cover?` / `banner?`（封面图 / 背景图，应用主页用）/ `tags?`（缺省 `[]`）/ `links?`（`docs` / `source` / `support`，全部可选）——字段集为宿主应用目录既有类型的**超集**（新增 tagline / cover / banner / links / schemaVersion），宿主既有卡片组件可直接消费 `ResolvedApp`
- **`parseAppManifest(input, source?)` 解析器**：校验 + 默认值归一化（`status` → `live`、`tags` → `[]`）；失败抛 `AppManifestError`（code `APP_MANIFEST_INVALID`，message 含 zod 字段路径诊断，`source` 如文件名 / URL 前置标注）；`schemaVersion` 不支持显式抛错，禁止静默降级
- **`resolveAppCatalog(entries, options?)` 目录聚合纯函数（Headless 数据层核心）**：输入 `AppCatalogEntry[]`（`manifest` 可为已解析对象或 JSON 字符串）+ 本地编排覆盖（`name` / `status` 覆盖 manifest 声明、`order` 排序、`hidden` 隐藏标志），输出标准卡片数据 `ResolvedApp[]`（`tagline` 回退 `description`、`links` 缺省字段归一化为 `undefined`、有 `order` 数值升序在前、无 `order` 按 `id` localeCompare 稳定排后）；重复 `id` 抛错（`APP_CATALOG_DUPLICATE_ID`，fail-fast，防止编排配置错误）；`{ skipInvalid: true }` 时解析失败 `console.warn` 跳过（默认抛错，构建期友好）；纯同步、无副作用、幂等
- **错误族**：`AppManifestError`（extends `KitError`，复用 core 基类；错误码值域 `APP_MANIFEST_INVALID` / `APP_MANIFEST_VERSION_UNSUPPORTED` / `APP_CATALOG_DUPLICATE_ID`）
- 配套：`tests/app.test.ts` 新增 18 用例（契约解析全字段 / 缺省归一化 / 非法输入诊断含路径 / 版本不支持 / source 标注 / 单条聚合 / 编排覆盖 / 排序 / hidden / JSON 字符串输入 / fail-fast / skipInvalid / 重复 id / 幂等 / 版本常量），全量 188 用例全绿；`docs/app-manifest.md` 契约文档（设计动机 / 字段明细 / 示例 / API 用法 / 错误码 / 版本策略）；`src/index.ts` 入口注释、package.json exports 与 description 新增 `/app`
- 后续规划：插件式注册中心（manifest 拉取 / 健康检查）另行排期

## 0.15.0 — 2026-08-24

`/storage` 契约新增「上传预签名 URL（PUT，客户端直写）」能力：`ObjectStore.getUploadUrl(options)`。

- **`ObjectStore` 契约追加 `getUploadUrl(options: GetUploadUrlOptions): Promise<string>`**：返回一个临时 URL，持有者可在有效期内以 `PUT` 方法向指定 key 直写文件（客户端直写场景，数据流不经过应用服务器）；与 `getSignedUrl`（GET 读签名）对称，同样禁止自行拼接 URL（必须 SDK 生成）。既有 4 方法（`upload` / `getSignedUrl` / `delete` / `exists`）签名零改动，纯增量
- **新增 `GetUploadUrlOptions` 导出**：`key`（最终落库 key，调用方组织目录前缀并保证唯一性，kit 不校验前缀）/ `contentType?`（固定 MIME）/ `expireSeconds?`（默认 **300**）
- **写签名默认 300s 为独立安全默认**：与读签名 `defaultExpireSeconds`（构造可注入，默认 86400）机制**有意不同**——写签名泄露代价高于读签名，短时效最小化泄露窗口，注释与 JSDoc 已显式声明，不引入新的构造选项
- **Content-Type 强制一致依赖对象存储实现**：签名时指定 `contentType` 后，AWS S3 对不一致的客户端 PUT 返回 403；阿里云 OSS 实测**不强制**（不一致仍 200 通过），JSDoc 已如实声明差异并注明「需要强制 MIME 时由调用方校验」
- **渠道零成本覆盖**：`S3ObjectStore` 同时服务 `s3` / `coze` 渠道（渠道差异仅凭证获取方式），新方法自动生效；`none` 渠道工厂 fail-fast 行为不变
- 配套：`tests/storage.test.ts` 新增 4 用例（契约形状透传 / PutObjectCommand 构造与 expiresIn 默认 300 及覆盖 / 未传 contentType 时命令不含该字段 / 签名异常包装 `ObjectStoreError` 保留 cause），全量 170 用例全绿

## 0.14.0 — 2026-08-24

`/storage` S3 兼容适配器可配置化改造：支持阿里云 OSS 等要求 virtual-hosted 寻址与地域签名的 S3 兼容服务。

- **`ResolvedStorageConfig` 新增 `forcePathStyle: boolean` 与 `region: string` 字段**：`S3ObjectStore` 构造 `S3Client` 时以配置替代原先硬编码的 `forcePathStyle: true` / `region: "us-east-1"`
- **`s3` 渠道读取新环境变量**：`S3_FORCE_PATH_STYLE`（默认 `true`，`"0"/"false"/"no"` 归一为 `false`）与 `S3_REGION`（默认 `"us-east-1"`）；`coze` 渠道读 `COZE_BUCKET_FORCE_PATH_STYLE`（region 恒为 `"us-east-1"`）
- **兼容性**：默认值与旧行为完全一致（path-style + us-east-1），存量 MinIO / Coze 等端点到零影响；阿里云 OSS 场景配置 `S3_FORCE_PATH_STYLE=false` + `S3_REGION=<实际地域>`（如 `cn-hangzhou`）即可
- **背景**：阿里云 OSS 的 S3 兼容端点禁止 path-style（`SecondLevelDomainForbidden`），且 SigV4 签名 credential scope 需实际地域（硬编码 `us-east-1` 会导致 `SignatureDoesNotMatch`）
- 配套：`tests/storage.test.ts` 新增 3 组用例（OSS 覆盖默认 / bool 归一化矩阵 / coze 关闭 path-style），并修正 2 处 `toEqual` 全量断言，全量 166 用例全绿

## 0.13.0 — 2026-08-22

新增 `/storage` 对象存储抽象模块（新导出子路径 `yunzone-service-kit/storage`），心智模型与 `/db` 完全同构；同期并入 `/db` 数据库连接串「分段输入」增强（原 0.12.0 排期内容，未单独发布）。

### 新增 `/storage` — 对象存储抽象（storage-core）

- **`ObjectStore` 契约**：`upload(params)` 上传返回 key / `getSignedUrl(key, expireSeconds?)` 生成签名 URL（禁止自行拼接）/ `delete(key)` / `exists(key)`，继承 `LifecycleAware`（init/disconnect 由组合根调度）；**key 即真理**——调用方直接组织 storage key（如 `avatars/user123.jpg`），无字段映射层，对应 db 的「SQL 字符串即真理」；契约内不声明 isAvailable（可用性与 db 同构：工厂创建时凭证解析 fail-fast）
- **渠道三值域（`StorageChannel`）**：`s3`（通用 S3，实现需额外获取连接凭证 `S3_ENDPOINT_URL` / `S3_BUCKET_NAME`）/ `coze`（按平台注入行为运行，`COZE_BUCKET_*` 变量组）/ `none`（显式无存储声明，任何存储操作对其 fail-fast）——与 `DatabaseChannel` 同构，显式声明禁止嗅探
- **`S3ObjectStore`（kit 官方渠道适配器）**：`@aws-sdk/client-s3` 实现（path-style 寻址兼容 MinIO / Coze 等非 AWS 端点），**一个适配器服务 s3/coze 两渠道**（渠道差异仅凭证解析，与 PgSqlDb 同构）；upload 不做隐式改名（key 即 fileName，防覆盖由调用方组织文件名）、签名 URL 用 `@aws-sdk/s3-request-presigner` 生成、HeadObject 404 归一化为 false、底层 SDK 错误统一包装 `ObjectStoreError`（保留 cause）；构造支持注入 `S3Client` 便于单测
- **`resolveStorageChannel` / `createObjectStore` / `resolveStorageConfig`**：渠道解析唯一来源 `STORAGE_PROVIDER`（未设置默认 `s3`，不自动嗅探）；渠道工厂 switch 分派、none fail-fast；凭证解析带诊断快照（只输出 set/unset、不回显值）、凭证只设置其一即抛错（配置不完整 fail-fast，禁止隐式降级）
- **错误族**：`ObjectStoreError` 基类 / `ObjectStoreConfigError`（配置错误；命名避开 db 已占用的 `StorageError` 族）
- **kit 新增运行时依赖**：`@aws-sdk/client-s3` / `@aws-sdk/s3-request-presigner`（^3）
- 配套：`tests/storage.test.ts` 新增 22 用例（契约形状 / 渠道解析 / 凭证解析 / 工厂分派 / S3 命令构造与错误归一化），全量 163 用例全绿；README 新增 `/storage` 章节与 `resolveStorageConfig` 工具表项；package.json exports 新增 `./storage` 子路径

### `/db` 数据库连接串「分段输入」

postgres 渠道支持 `DATABASE_PASSWORD` 单独提供原始明文密码，kit 负责 URL 编码（外部 PostgreSQL 部署痛点：运维手册写真实密码但 URL 特殊字符必须百分号编码，照填连接失败、转义值又与实际密码不一致）。

- **`resolveDatabaseUrl` postgres 分支新增分段输入**：设置 `DATABASE_PASSWORD` 时解析 `DATABASE_URL`（此时 URL 不含密码、无歧义），以 `encodeURIComponent` 预编码后重建连接串，scheme / username / host / port / database / query（如 `sslmode`）原样保留；不设置时行为与存量完全一致（零破坏），coze 渠道不读该变量
- **编码实现要点**：必须 `encodeURIComponent` 预编码再经 WHATWG `URL.password` 赋值——setter 的 userinfo percent-encode set 不包含 `%`，直接赋值会导致含 `%` 的密码被 pg 解码为错误值（静默连错）；预编码后含 `@ # : / ? % 空格、非 ASCII` 的密码均解码往返一致
- **优先级与约束**：同时提供时以 `DATABASE_PASSWORD` 为准（覆盖 URL 内嵌已编码密码）；分段输入模式下 URL 的 userinfo 不得含未编码特殊字符（解析即错乱，无法恢复，靠文档约束）
- **错误归一化**：`DATABASE_PASSWORD` 已设置而 `DATABASE_URL` 非法时，`new URL()` 的裸 `TypeError` 包装为 `StorageConfigError`（带诊断快照、密码值不回显），与其余配置错误风格一致
- 配套：`tests/config.test.ts` 新增 6 组用例（存量兼容 / 明文编码与连接要素保留 / 特殊字符矩阵含 `%` 与中文 / 覆盖优先级 / 非法 URL 报错 / coze 回归与空密码）；`.env.example` 补充 `DATABASE_PASSWORD` 说明

## 0.11.2 — 2026-08-21

`/ops/next` 路由守卫修复：Next.js 15.3+/16 将 `NextRequest.cookies` 由方法改为 getter 属性，旧实现 `request.cookies?.()?.get(...)` 按函数调用抛 `TypeError: cookies is not a function`，导致全部 admin 接口 500 空响应体、前端 `res.json()` 报 Unexpected end of JSON input。

- **`requireAdminAuth` cookie 读取双形态兼容**：运行时按 `typeof cookies === "function"` 自适应——函数形态按旧版调用，否则按 getter 属性直接读取；鸭子类型 `AdminRouteRequestLike.cookies` 声明为 `AdminRequestCookiesLike | (() => AdminRequestCookiesLike)`
- 配套：`tests/next.test.ts` 新增守卫三态用例（503 禁用 / 401 未登录 / 放行透传），属性式（Next.js 16）与函数式（旧版）双形态全覆盖

## 0.11.1 — 2026-08-20

`/db` 渠道值域扩展 `none`（显式无库声明）+ 配置错误类型统一。

- **`DatabaseChannel` 新增 `none` 渠道**：`DATABASE_PROVIDER=none` 显式声明"本服务无数据库"；`resolveDatabaseChannel` 将其解析为合法渠道（未设置仍默认 postgres，零迁移）；`createSqlDb` 对 none 直接抛 `StorageConfigError`（fail-fast，不做降级或空实现），消费方应据此选择非库存储后端（如文件）
- **配置错误类型统一**：`resolveDatabaseUrl` 三处抛错（Unknown provider / DATABASE_URL 缺失 / coze 变量缺失）由普通 `Error` 统一为 `StorageConfigError`，半配置（有渠道无凭证）可被消费方按类捕获，message 诊断快照不变
- 配套：`tests/db.test.ts` 新增 none 渠道解析/异常路径用例、凭证缺失类型断言

## 0.11.0 — 2026-08-20

`/db` 契约补全：连接池提供能力入契约（消灭消费者类型断言）+ 错误码值域与 omni-auth SDK 对齐。

- **新增 `PoolProvider` 能力接口 + `isPoolProvider` 类型守卫**：`PgSqlDb` 声明 `implements SqlDb, PoolProvider`；`SqlDb` 契约保持纯净（SQL 执行器心智），消费方可用该守卫替代 `(db as PgSqlDb)` 类型断言，事务代理 getPool 抛错（fail-fast）语义不变
- **`UniqueViolationError` 显式 `code = "UNIQUE_VIOLATION"`**：与 omni-auth SDK 同一语义错误码对齐（SDK 侧同步删除同名类，改用 `OmniAuthError` + code），跨抽象（认证域/业务域）判断唯一冲突统一按 `err.code`，消除同名不同类型陷阱
- **事务契约声明**：`SqlDb.withTransaction` / `PgSqlDb.withTransaction` 文档显式声明——回调内禁止调用 omni-auth 等外部库的认证/写 API（跨抽象事务互相不可见，其写入会静默逃逸本事务）
- 配套：`tests/db.test.ts` 新增 isPoolProvider 守卫测试组、错误码断言，工厂测试改用守卫

## 0.10.0 — 2026-08-20

SqlDb 渠道适配器落地：`/db` 从"纯契约"变为"契约 + 官方实现"。

- **新增 `PgSqlDb`（kit 官方渠道适配器）**：实现 `SqlDb`（query / execute / withTransaction / disconnect）；真事务 BEGIN/COMMIT/ROLLBACK、事务代理禁止嵌套（fail-fast）；pg 23505 → `UniqueViolationError` 归一化；构造支持 `PgSqlDbOptions`（`ssl` / `max` / `idleTimeoutMillis`，适配 Coze/云数据库 SSL 连接）
- **`createSqlDb` 真正实例化**：按 channel 分派凭证获取（`postgres` → `DATABASE_URL`；`coze` → 平台注入 `PGDATABASE_URL` / `PG*` 变量组），env 可注入便于测试；凭证缺失抛错（fail-fast，禁止自动嗅探）
- **kit 新增运行时依赖 `pg`**（@types/pg 为 devDependency）：`/db` 由零依赖变为自带官方适配器
- **兼容性**：`query` 返回保持 `QueryResult` 行形状，既有 pg 风格调用方可直接平移
- 配套：`tests/db.test.ts` 工厂测试更新（渠道分派返回实例 / 凭证缺失抛错）

## 0.9.0 — 2026-08-20

`/db` 重构为 SQL 字符串抽象（BREAKING）："互斥后端通用 CRUD 原语" → "SQL 字符串直传"。

- **新增 `SqlDb` 契约**：`query(sql, params)` 返回行 / `execute(sql, params)` 返回影响行数 / `withTransaction(fn)` 事务强承诺（单一接口，所有实现必须支持事务）；`DatabaseChannel`（`postgres` | `coze`）取代 `StorageBackend` 4 值；`SqlDbConfig` 显式声明，禁止自动嗅探
- **删除旧契约**：`DbAdapter` / `TransactionalDbAdapter` / `KeyValueStore` / `Condition` / `OrderBy` / `StorageBackend` 4 值 / `resolveStorageBackend`（旧键兼容退役）/ `RecordNotFoundError` / `TransactionUnavailableError` / memory 适配器
- **错误族精简**：`StorageError` 基类 + `UniqueViolationError`（唯一键冲突归一化）+ `StorageConfigError`
- **`resolveDatabaseChannel`**：唯一来源 `DATABASE_PROVIDER`，未设置默认 `postgres`（与 `resolveDatabaseUrl` 一致）
- **`createSqlDb`**：渠道工厂（当时适配器延后，一律抛 `StorageConfigError`）
- **kit 新增运行时依赖 `pg`**：/db 由零依赖变为自带官方适配器（0.10.0 落地）
- 配套：`tests/db.test.ts` 契约测试重写（桩验证接口形状 / 事务提交回滚 / 错误归一化）；README 新增 `/db` 章节

## 0.7.0 — 2026-08-19

管理后台认证协议 v1.0（Admin Session Protocol）落地：`/ops` 升级为集群内管理后台认证的唯一实现，消费方据此删除各自 admin-auth 实现。

- **`/ops` 新增 HMAC 签名会话（协议 2.3/2.4）**：`createSignedAdminSession` / `validateSignedAdminSession`（`payload.signature` 两段 base64url；secret 由 `sha256hex("admin-session:" + sha256hex(ADMIN_PASSWORD))` 派生，密码轮换即全员失效；校验顺序含签名长度短路，防 `timingSafeEqual` 抛异常）、`deriveAdminSessionSecret`、`hashAdminPassword` / `verifyAdminPasswordWithHash`（登录密码常量时间比对）、常量 `ADMIN_SESSION_COOKIE` / `ADMIN_SESSION_DEFAULT_MAX_AGE_SECONDS`
- **`resolveAdminConfig` 新增 `sessionMaxAgeSeconds`**：读 `ADMIN_SESSION_MAX_AGE`（秒，默认 86400），非法/非正数值回退默认
- **`/ops/next`（新入口 `yunzone-service-kit/ops/next`）**：`requireAdminAuth` 路由守卫（禁用态 503 `ADMIN_DISABLED`、未登录 401 `UNAUTHENTICATED`）；采用鸭子类型 + 宽松泛型透传，规避 Next.js 16 内部私有标记导致的跨副本类型不兼容
- **`/config` adminFacet 新增键**：`ADMIN_USERNAME`（双凭证认证）、`ADMIN_SESSION_MAX_AGE`
- **旧 base64 明文函数（`createAdminSession` / `validateAdminSession`）标记 `@deprecated`**：内含明文密码、泄露即被伪造，过渡一个版本后移除
- **peerDependencies 新增 `next`（optional）**：`/ops/next` 依赖 next/server 运行时，纯逻辑层（`/ops` 主入口）保持零框架耦合
- **升级提示**：旧 base64 会话与 Bearer / sessionStorage 类自建会话形态均不再受支持，管理接口统一经 HttpOnly cookie 会话；守卫错误码统一为 `ADMIN_DISABLED` / `UNAUTHENTICATED`；`ADMIN_PASSWORD` 未设置即禁用（无默认密码回退、无固定密钥 fallback）
- 配套：`tests/admin.test.ts` 新增 HMAC 会话/MAX_AGE/密码比对测试组（共 107 例全绿）

## 0.6.0 — 2026-08-19

配置契约合规化收口（BREAKING）：`DEPLOY_PROVIDER` 缺省行为由 `coze` 改为 `self`（通用模式），删除 `userCenterFacet` 的 `NEXT_PUBLIC_USER_CENTER_URL` 键。

- **`DEPLOY_PROVIDER` 缺省改为 `self`（通用模式）**：未设置时中立键直读、不启用平台注入回退；Coze 部署必须显式设置 `DEPLOY_PROVIDER=coze` 才能启用 `COZE_*` / `DEPLOY_RUN_PORT` 回退（原先缺省 coze 实质默认绑定单平台，与 TICKET-001「平台名作为值（分派键）」的合规基线一致化；当前仅一家平台支持，正是切换成本最小的时机）。缺省警告文案同步更新
- **`userCenterFacet` 删键**：移除 `NEXT_PUBLIC_USER_CENTER_URL`（全集群无内联消费者，浏览器侧统一由服务端运行时接口下发），保留 `USER_CENTER_URL` 与预留 `USER_CENTER_API_KEY`
- 配套：`tests/deploy.test.ts` / `tests/config.test.ts` 同步（默认 self 直读断言 + 显式 coze 回退覆盖），README、`.env.example` 措辞收口
- **升级提示**：`resolveListenAddress` / `resolveBaseUrl` 不再隐式回退平台注入旧名，Coze 部署需显式设置 `DEPLOY_PROVIDER=coze` 才能保留原回退行为；已自行传入 `deploymentAliases` 或自建别名映射的调用方无运行时影响

## 0.5.0 — 2026-08-19

0.5 排期兑现：裸读禁令**可执行化**（平台注入变量只能经 schema 声明读取）+ 适配层**正名收口**。集群暂无外部用户，「移除」修订为「永久适配」：平台注入变量名不可改名，`deploymentAliases` / `normalizeDeployEnv` 为永久机制，不再承诺移除版本。

- **适配层正名**：删除全部「过渡至 v0.5 移除」表述（`deploy.ts` 注释、README、`.env.example`），统一为「平台注入适配别名（永久机制，读取时回退，禁止裸读）」
- **裸读禁令可执行化**：`loadEnv` + 消费方自有 `env-schema` 足以将 `process.env.COZE_*` 直读全部收敛为声明式读取（具体服务的清零进度不属本日志范围）
- **私有层读取合规化**：`COZE_SUPABASE_*`、`COZE_BUCKET_*`、`COZE_CAPTCHA_*`、`COZE_WORKLOAD_API_TOKEN` 等平台注入私有组经消费端 schema 显式声明后由 `loadEnv` 读取（裸读禁令的合法例外）
- **zod 跨副本兼容约束**：kit 构建于 zod 4.4.3，消费方需对齐至同一 4.x 次版本——zod 4.x 类型内部 `_zod.version.minor` 字面量不一致（如 '3' vs '4'）会使 `loadEnv` / `composeFacets` 类型不兼容（同一包多副本时的类型炸弹）
- 配套：`tests/deploy.test.ts` 测试描述同步正名（断言不变）；TICKET-001 排期表 0.5 行标记完成

## 0.4.0 — 2026-08-18

配置键命名中立化（TICKET-001，机制层 + 中立键切换合并实施，不跳版本）。平台注入变量名不变，`DEPLOY_PROVIDER` 缺省回退 coze，**现有部署行为零变化**。

- `/config` 新增**部署适配层**（`normalizeDeployEnv` / `deploymentAliases`）：按 `DEPLOY_PROVIDER`（默认 `coze`，缺省一次性警告；`self` 直读；未知值显式报错）分派，把平台注入旧名（`COZE_PROJECT_ENV` / `COZE_PROJECT_DOMAIN_DEFAULT` / `COZE_WORKSPACE_PATH` / `DEPLOY_RUN_PORT`）**读取时**回退映射到中立键，不写 `process.env`
- `deploymentFacet` 中立键化：`DEPLOY_ENV` / `PROJECT_DOMAIN_DEFAULT` / `PUBLIC_BASE_URL`（新增，解析链最高优先级）/ `DEPLOY_PROVIDER`（新增）/ `HOSTNAME` / `PORT` / `WORKSPACE_PATH`
- `resolveBaseUrl` 解析链：`PUBLIC_BASE_URL` → `BETTER_AUTH_URL`（历史遗留兼容键）→（DEV 回退）→ `PROJECT_DOMAIN_DEFAULT` → fallback；`resolveListenAddress` 端口统一读 `PORT`（旧名经适配层回退）
- `/ops` 报告 `deployment.env` 改读中立键 `DEPLOY_ENV`
- 兑现 0.2 声明的 v0.3 移除承诺：legacy 别名 `AUTH_SERVER_*` 正式移除（`aliases` 机制本身保留，供部署面过渡复用）
- 规范落库：README「配置键命名规范」小节（三层命名空间模型 + 裸读禁令）+ `specs.ts` 头部注释；`.env.example` 同步中立键化并标注 legacy 键与移除版本（v0.5）
- 配套：vitest 单测更新与新增（适配层、aliases 优先级、解析链、报告中立键）

## 0.3.0 — 2026-08-18

- `/config` 新增本地 `.env` 文件加载：`parseDotEnv`（纯函数解析：引号值/注释/export 前缀，`strict: false` 宽容跳过）与 `loadDotEnv`（默认不覆盖平台注入变量，`override`/`required` 可选）；`loadEnv` 支持 `{ dotenv: true }` 一键先加载 `.env` 再校验；`EnvFileError` 只报行号不回显变量值

## 0.2.0 — 2026-08-18

环境变量分面规范与运维数据接口。

- `/config` 新增 **Env Facets 分面规范**：`deploymentFacet` / `authCenterFacet` / `userCenterFacet` / `adminFacet`，配套 `composeFacets`（重复 key 抛错）、`requiredFacet`（模块级必填，output 类型同步收紧）、`facetKeys`
- `loadEnv` 支持 `aliases` 过渡兼容（`AUTH_SERVER_*` → `AUTH_CENTER_*`，文档标注 v0.3 移除）；抽公共 `envSnapshot`（set/unset 指纹，不回显值）
- `resolveListenAddress`：统一监听地址解析（`HOSTNAME` + `DEPLOY_RUN_PORT`/`PORT`）
- 新增 `/ops` 子模块：`createOpsReporter` 运维报告聚合（服务/部署/注册中心/环境指纹）、`resolveAdminConfig`/`verifyAdminToken`/`createAdminSession`/`validateAdminSession` 管理后台公共逻辑（常量时间比较、会话过期校验；`ADMIN_PASSWORD` 未设置 = 管理禁用）
- 配套：vitest 单测新增 29 用例（共 54）

## 0.1.0 — 2026-08-18

初始版本：从 `yunzone_user_center/packages/service-kit` 抽离为独立项目。

- `/registry`：泛型 `ProviderRegistry<T, P>`（注册/优先级/健康检查降级/状态快照/describeProvider 扩展）
- `/config`：`defineEnv`/`loadEnv`/`EnvConfigError`（防泄漏诊断快照）、`resolveDatabaseUrl`（postgres/coze）、`resolveBaseUrl`
- 配套：vitest 单元测试（25 用例）、tsup 构建（ESM+CJS+DTS）、CI 与发布工作流
