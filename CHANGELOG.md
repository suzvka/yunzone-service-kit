# Changelog

## 0.14.0 — 2026-08-24

`/storage` S3 兼容适配器可配置化改造：支持阿里云 OSS 等要求 virtual-hosted 寻址与地域签名的 S3 兼容服务。

- **`ResolvedStorageConfig` 新增 `forcePathStyle: boolean` 与 `region: string` 字段**：`S3ObjectStore` 构造 `S3Client` 时以配置替代原先硬编码的 `forcePathStyle: true` / `region: "us-east-1"`
- **`s3` 渠道读取新环境变量**：`S3_FORCE_PATH_STYLE`（默认 `true`，`"0"/"false"/"no"` 归一为 `false`）与 `S3_REGION`（默认 `"us-east-1"`）；`coze` 渠道读 `COZE_BUCKET_FORCE_PATH_STYLE`（region 恒为 `"us-east-1"`）
- **兼容性**：默认值与旧行为完全一致（path-style + us-east-1），存量 MinIO / Coze 等端点到零影响；阿里云 OSS 场景配置 `S3_FORCE_PATH_STYLE=false` + `S3_REGION=<实际地域>`（如 `cn-hangzhou`）即可
- **背景**：阿里云 OSS 的 S3 兼容端点禁止 path-style（`SecondLevelDomainForbidden`），且 SigV4 签名 credential scope 需实际地域（硬编码 `us-east-1` 会导致 `SignatureDoesNotMatch`）
- 配套：`tests/storage.test.ts` 新增 3 组用例（OSS 覆盖默认 / bool 归一化矩阵 / coze 关闭 path-style），并修正 2 处 `toEqual` 全量断言，全量 166 用例全绿
- 消费侧：yunzone_user_center 接入阿里云 OSS（`STORAGE_PROVIDER=s3` + 上述变量），见 CouplingRecord

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
- 消费侧：yunzone_user_center `src/lib/storage`（StorageService 注册表 + URL 前缀路由）后续迁移为 kit 抽象（`STORAGE_PROVIDER=coze-s3` 改 `coze`），本次不随 kit 发布

### `/db` 数据库连接串「分段输入」

postgres 渠道支持 `DATABASE_PASSWORD` 单独提供原始明文密码，kit 负责 URL 编码（外部 PostgreSQL 部署痛点：运维手册写真实密码但 URL 特殊字符必须百分号编码，照填连接失败、转义值又与实际密码不一致）。

- **`resolveDatabaseUrl` postgres 分支新增分段输入**：设置 `DATABASE_PASSWORD` 时解析 `DATABASE_URL`（此时 URL 不含密码、无歧义），以 `encodeURIComponent` 预编码后重建连接串，scheme / username / host / port / database / query（如 `sslmode`）原样保留；不设置时行为与存量完全一致（零破坏），coze 渠道不读该变量
- **编码实现要点**：必须 `encodeURIComponent` 预编码再经 WHATWG `URL.password` 赋值——setter 的 userinfo percent-encode set 不包含 `%`，直接赋值会导致含 `%` 的密码被 pg 解码为错误值（静默连错）；预编码后含 `@ # : / ? % 空格、非 ASCII` 的密码均解码往返一致
- **优先级与约束**：同时提供时以 `DATABASE_PASSWORD` 为准（覆盖 URL 内嵌已编码密码）；分段输入模式下 URL 的 userinfo 不得含未编码特殊字符（解析即错乱，无法恢复，靠文档约束）
- **错误归一化**：`DATABASE_PASSWORD` 已设置而 `DATABASE_URL` 非法时，`new URL()` 的裸 `TypeError` 包装为 `StorageConfigError`（带诊断快照、密码值不回显），与其余配置错误风格一致
- 配套：`tests/config.test.ts` 新增 6 组用例（存量兼容 / 明文编码与连接要素保留 / 特殊字符矩阵含 `%` 与中文 / 覆盖优先级 / 非法 URL 报错 / coze 回归与空密码）；`.env.example` 补充 `DATABASE_PASSWORD` 说明
- 消费侧：yunzone_auth 等基于 `createSqlDb({ channel })` 的服务无需代码改动，部署时可选切换为分段输入写法（运维手册与实际配置零歧义）

## 0.11.2 — 2026-08-21

`/ops/next` 路由守卫修复：Next.js 15.3+/16 将 `NextRequest.cookies` 由方法改为 getter 属性，旧实现 `request.cookies?.()?.get(...)` 按函数调用抛 `TypeError: cookies is not a function`，导致全部 admin 接口 500 空响应体、前端 `res.json()` 报 Unexpected end of JSON input。

- **`requireAdminAuth` cookie 读取双形态兼容**：运行时按 `typeof cookies === "function"` 自适应——函数形态按旧版调用，否则按 getter 属性直接读取；鸭子类型 `AdminRouteRequestLike.cookies` 声明为 `AdminRequestCookiesLike | (() => AdminRequestCookiesLike)`
- 配套：`tests/next.test.ts` 新增守卫三态用例（503 禁用 / 401 未登录 / 放行透传），属性式（Next.js 16）与函数式（旧版）双形态全覆盖

## 0.11.1 — 2026-08-20

`/db` 渠道值域扩展 `none`（显式无库声明）+ 配置错误类型统一。

- **`DatabaseChannel` 新增 `none` 渠道**：`DATABASE_PROVIDER=none` 显式声明"本服务无数据库"；`resolveDatabaseChannel` 将其解析为合法渠道（未设置仍默认 postgres，零迁移）；`createSqlDb` 对 none 直接抛 `StorageConfigError`（fail-fast，不做降级或空实现），消费方应据此选择非库存储后端（如文件）
- **配置错误类型统一**：`resolveDatabaseUrl` 三处抛错（Unknown provider / DATABASE_URL 缺失 / coze 变量缺失）由普通 `Error` 统一为 `StorageConfigError`，半配置（有渠道无凭证）可被消费方按类捕获，message 诊断快照不变
- 消费侧适配：yunzone_redirect_gateway `detectStorageMode` 改为白名单判定（显式 postgres/coze → db；none/未设置/空 → file），避免显式 none 误入 db 模式导致首次请求瘫痪
- 配套：`tests/db.test.ts` 新增 none 渠道解析/异常路径用例、凭证缺失类型断言

## 0.11.0 — 2026-08-20

`/db` 契约补全：连接池提供能力入契约（消灭消费者类型断言）+ 错误码值域与 omni-auth SDK 对齐。

- **新增 `PoolProvider` 能力接口 + `isPoolProvider` 类型守卫**：`PgSqlDb` 声明 `implements SqlDb, PoolProvider`；`SqlDb` 契约保持纯净（SQL 执行器心智），消费者（yunzone_user_center raw.ts / onmi-auth client.ts）以守卫替代 `(db as PgSqlDb)` 类型断言，事务代理 getPool 抛错（fail-fast）语义不变
- **`UniqueViolationError` 显式 `code = "UNIQUE_VIOLATION"`**：与 omni-auth SDK 同一语义错误码对齐（SDK 侧同步删除同名类，改用 `OmniAuthError` + code），跨抽象（认证域/业务域）判断唯一冲突统一按 `err.code`，消除同名不同类型陷阱
- **事务契约声明**：`SqlDb.withTransaction` / `PgSqlDb.withTransaction` 文档显式声明——回调内禁止调用 omni-auth 等外部库的认证/写 API（跨抽象事务互相不可见，其写入会静默逃逸本事务）
- 配套：`tests/db.test.ts` 新增 isPoolProvider 守卫测试组、错误码断言，工厂测试改用守卫

## 0.10.0 — 2026-08-20

SqlDb 渠道适配器落地：`/db` 从"纯契约"变为"契约 + 官方实现"。

- **新增 `PgSqlDb`（kit 官方渠道适配器）**：实现 `SqlDb`（query / execute / withTransaction / disconnect）；真事务 BEGIN/COMMIT/ROLLBACK、事务代理禁止嵌套（fail-fast）；pg 23505 → `UniqueViolationError` 归一化；构造支持 `PgSqlDbOptions`（`ssl` / `max` / `idleTimeoutMillis`，适配 Coze/云数据库 SSL 连接）
- **`createSqlDb` 真正实例化**：按 channel 分派凭证获取（`postgres` → `DATABASE_URL`；`coze` → 平台注入 `PGDATABASE_URL` / `PG*` 变量组），env 可注入便于测试；凭证缺失抛错（fail-fast，禁止自动嗅探）
- **kit 新增运行时依赖 `pg`**（@types/pg 为 devDependency）：`/db` 由零依赖变为自带官方适配器
- **消费侧迁移**：yunzone_auth 删除本地 pg-sql-db.ts 改调 kit（`createSqlDb` + `resolveDatabaseChannel`，db-provider 合并简化）；yunzone_user_center raw.ts 基于 SqlDb（保持 QueryResult 形状，15+ 调用方零改动）；WanyanAI config-store 去 Drizzle 查询改 SqlDb
- 配套：`tests/db.test.ts` 工厂测试更新（渠道分派返回实例 / 凭证缺失抛错）

## 0.9.0 — 2026-08-20

`/db` 重构为 SQL 字符串抽象（BREAKING）："互斥后端通用 CRUD 原语" → "SQL 字符串直传"。

- **新增 `SqlDb` 契约**：`query(sql, params)` 返回行 / `execute(sql, params)` 返回影响行数 / `withTransaction(fn)` 事务强承诺（单一接口，所有实现必须支持事务）；`DatabaseChannel`（`postgres` | `coze`）取代 `StorageBackend` 4 值；`SqlDbConfig` 显式声明，禁止自动嗅探
- **删除旧契约**：`DbAdapter` / `TransactionalDbAdapter` / `KeyValueStore` / `Condition` / `OrderBy` / `StorageBackend` 4 值 / `resolveStorageBackend`（旧键兼容退役）/ `RecordNotFoundError` / `TransactionUnavailableError` / memory 适配器
- **错误族精简**：`StorageError` 基类 + `UniqueViolationError`（唯一键冲突归一化）+ `StorageConfigError`
- **`resolveDatabaseChannel`**：唯一来源 `DATABASE_PROVIDER`，未设置默认 `postgres`（与 `resolveDatabaseUrl` 一致）
- **`createSqlDb`**：渠道工厂（当时适配器延后，一律抛 `StorageConfigError`）
- **kit 新增运行时依赖 `pg`**：/db 由零依赖变为自带官方适配器（0.10.0 落地）
- 消费侧迁移：yunzone_auth（PgTokenDb / PgCertificateDb 改基于 SqlDb 执行，自建 PgSqlDb 适配器，0.10.0 后切换为 kit 实现）
- 配套：`tests/db.test.ts` 契约测试重写（桩验证接口形状 / 事务提交回滚 / 错误归一化）；README 新增 `/db` 章节

## 0.7.0 — 2026-08-19

管理后台认证协议 v1.0（Admin Session Protocol）落地：`/ops` 升级为全集群唯一实现，四个服务（用户中心 / 鉴权中心 / WanyanAI / 重定向网关）删除各自 admin-auth 实现，统一走 kit。

- **`/ops` 新增 HMAC 签名会话（协议 2.3/2.4）**：`createSignedAdminSession` / `validateSignedAdminSession`（`payload.signature` 两段 base64url；secret 由 `sha256hex("admin-session:" + sha256hex(ADMIN_PASSWORD))` 派生，密码轮换即全员失效；校验顺序含签名长度短路，防 `timingSafeEqual` 抛异常）、`deriveAdminSessionSecret`、`hashAdminPassword` / `verifyAdminPasswordWithHash`（登录密码常量时间比对）、常量 `ADMIN_SESSION_COOKIE` / `ADMIN_SESSION_DEFAULT_MAX_AGE_SECONDS`
- **`resolveAdminConfig` 新增 `sessionMaxAgeSeconds`**：读 `ADMIN_SESSION_MAX_AGE`（秒，默认 86400），非法/非正数值回退默认
- **`/ops/next`（新入口 `yunzone-service-kit/ops/next`）**：`requireAdminAuth` 路由守卫（禁用态 503 `ADMIN_DISABLED`、未登录 401 `UNAUTHENTICATED`）；采用鸭子类型 + 宽松泛型透传，规避 Next.js 16 内部私有标记导致的跨副本类型不兼容
- **`/config` adminFacet 新增键**：`ADMIN_USERNAME`（双凭证认证）、`ADMIN_SESSION_MAX_AGE`
- **旧 base64 明文函数（`createAdminSession` / `validateAdminSession`）标记 `@deprecated`**：内含明文密码、泄露即被伪造，过渡一个版本后移除
- **peerDependencies 新增 `next`（optional）**：`/ops/next` 依赖 next/server 运行时，纯逻辑层（`/ops` 主入口）保持零框架耦合
- 消费端迁移：yunzone_user_center / yunzone_auth 删 `src/lib/admin-auth.ts` 改调 kit（含移除默认密码回退与固定密钥 fallback、守卫 `code` 字段对齐、登录接口限流）；WanyanAI verify/guard 改 HMAC 会话并统一 `ADMIN_DISABLED`/`UNAUTHENTICATED` 码；yunzone_redirect_gateway 由 Bearer + sessionStorage 迁移为 HttpOnly cookie 会话协议
- 配套：`tests/admin.test.ts` 新增 HMAC 会话/MAX_AGE/密码比对测试组（共 107 例全绿）

## 0.6.0 — 2026-08-19

配置契约合规化收口（BREAKING）：`DEPLOY_PROVIDER` 缺省行为由 `coze` 改为 `self`（通用模式），删除 `userCenterFacet` 的 `NEXT_PUBLIC_USER_CENTER_URL` 键。

- **`DEPLOY_PROVIDER` 缺省改为 `self`（通用模式）**：未设置时中立键直读、不启用平台注入回退；Coze 部署必须显式设置 `DEPLOY_PROVIDER=coze` 才能启用 `COZE_*` / `DEPLOY_RUN_PORT` 回退（原先缺省 coze 实质默认绑定单平台，与 TICKET-001「平台名作为值（分派键）」的合规基线一致化；当前仅一家平台支持，正是切换成本最小的时机）。缺省警告文案同步更新
- **`userCenterFacet` 删键**：移除 `NEXT_PUBLIC_USER_CENTER_URL`（全集群无内联消费者，浏览器侧统一由服务端运行时接口下发），保留 `USER_CENTER_URL` 与预留 `USER_CENTER_API_KEY`
- 配套：`tests/deploy.test.ts` / `tests/config.test.ts` 同步（默认 self 直读断言 + 显式 coze 回退覆盖），README、`.env.example` 措辞收口
- **消费端影响**：WanyanAI 的 `resolveListenAddress` / `resolveBaseUrl` 不再隐式回退平台注入旧名——生产部署（Coze）需显式 `DEPLOY_PROVIDER=coze`；`yunzone_redirect_gateway`（loadEnv + deploymentAliases 静态回退）与 `yunzone_user_center`（自有 ALIAS_MAP）无运行时影响

## 0.5.0 — 2026-08-19

0.5 排期兑现：服务代码对 legacy `COZE_*` / `DEPLOY_RUN_PORT` 的**裸读清零** + 适配层**正名收口**。集群暂无外部用户，「移除」修订为「永久适配」：平台注入变量名不可改名，`deploymentAliases` / `normalizeDeployEnv` 为永久机制，不再承诺移除版本。

- **适配层正名**：删除全部「过渡至 v0.5 移除」表述（`deploy.ts` 注释、README、`.env.example`），统一为「平台注入适配别名（永久机制，读取时回退，禁止裸读）」
- **消费端裸读清零**（`process.env.COZE_*` 服务代码直读全量迁移，零残留）：
  - WanyanAI：`stations/openai-forward`、`stations/coze`、`app/api/v1/admin/verify/route.ts`、`storage/database/supabase-client.ts`、`config-store/file-store.ts`
  - yunzone_redirect_gateway：新建统一 `lib/env-schema.ts`；`src/config.ts`、`src/app/layout.tsx`、`storage/database/supabase-client.ts`、`scripts/sync-mappings-to-db.ts`
  - yunzone_user_center：新建统一 `lib/env-schema.ts`（Supabase / S3 / 验证码私有层显式声明）；`lib/supabase/admin.ts`、`lib/storage/providers/coze-s3.ts`、`lib/captcha/providers/coze.ts`、`lib/verification/providers/supabase.ts`、`lib/admin-auth.ts`、`app/layout.tsx`、`app/api/admin/oauth-clients/route.ts`
- **私有层读取合规化**：`COZE_SUPABASE_*`、`COZE_BUCKET_*`、`COZE_CAPTCHA_*`、`COZE_WORKLOAD_API_TOKEN` 等平台注入私有组经消费端 schema 显式声明后由 `loadEnv` 读取（裸读禁令的合法例外）
- **消费端 zod 版本对齐（4.4.3）**：yunzone_redirect_gateway / yunzone_user_center 由 4.3.6 对齐至与 kit 构建（4.4.3）一致的 zod，消除 zod 4.x 类型内部 `_zod.version.minor` 字面量（'3' vs '4'）跨副本不兼容导致的 `loadEnv`/`composeFacets` 类型炸弹
- 配套：`tests/deploy.test.ts` 测试描述同步正名（断言不变）；TICKET-001 排期表 0.5 行标记完成

## 0.4.0 — 2026-08-18

配置键命名中立化（TICKET-001，机制层 + 中立键切换合并实施，不跳版本）。平台注入变量名不变，`DEPLOY_PROVIDER` 缺省回退 coze，**现有部署行为零变化**。

- `/config` 新增**部署适配层**（`normalizeDeployEnv` / `deploymentAliases`）：按 `DEPLOY_PROVIDER`（默认 `coze`，缺省一次性警告；`self` 直读；未知值显式报错）分派，把平台注入旧名（`COZE_PROJECT_ENV` / `COZE_PROJECT_DOMAIN_DEFAULT` / `COZE_WORKSPACE_PATH` / `DEPLOY_RUN_PORT`）**读取时**回退映射到中立键，不写 `process.env`
- `deploymentFacet` 中立键化：`DEPLOY_ENV` / `PROJECT_DOMAIN_DEFAULT` / `PUBLIC_BASE_URL`（新增，解析链最高优先级）/ `DEPLOY_PROVIDER`（新增）/ `HOSTNAME` / `PORT` / `WORKSPACE_PATH`
- `resolveBaseUrl` 解析链：`PUBLIC_BASE_URL` → `BETTER_AUTH_URL`（历史遗留兼容键）→（DEV 回退）→ `PROJECT_DOMAIN_DEFAULT` → fallback；`resolveListenAddress` 端口统一读 `PORT`（旧名经适配层回退）
- `/ops` 报告 `deployment.env` 改读中立键 `DEPLOY_ENV`
- 兑现 0.2 声明的 v0.3 移除承诺：legacy 别名 `AUTH_SERVER_*` 正式移除（`aliases` 机制本身保留，供部署面过渡复用）
- 规范落库：README「配置键命名规范」小节（三层命名空间模型 + 裸读禁令）+ `specs.ts` 头部注释；`.env.example` 同步中立键化并标注 legacy 键与移除版本（v0.5）
- 消费端迁移：WanyanAI（env-schema 调用点传 `deploymentAliases`、server.ts 裸读点改读 `DEPLOY_ENV`）、yunzone_redirect_gateway（server.ts 裸读点）、yunzone_user_center（移除 `AUTH_SERVER_*` aliases）
- 配套：vitest 单测更新与新增（适配层、aliases 优先级、解析链、报告中立键）

## 0.3.0 — 2026-08-18

- `/config` 新增本地 `.env` 文件加载：`parseDotEnv`（纯函数解析：引号值/注释/export 前缀，`strict: false` 宽容跳过）与 `loadDotEnv`（默认不覆盖平台注入变量，`override`/`required` 可选）；`loadEnv` 支持 `{ dotenv: true }` 一键先加载 `.env` 再校验；`EnvFileError` 只报行号不回显变量值

## 0.2.0 — 2026-08-18

环境变量分面规范与运维数据接口。

- `/config` 新增 **Env Facets 分面规范**：`deploymentFacet` / `authCenterFacet` / `userCenterFacet` / `adminFacet`，配套 `composeFacets`（重复 key 抛错）、`requiredFacet`（模块级必填，output 类型同步收紧）、`facetKeys`
- `loadEnv` 支持 `aliases` 过渡兼容（`AUTH_SERVER_*` → `AUTH_CENTER_*`，文档标注 v0.3 移除）；抽公共 `envSnapshot`（set/unset 指纹，不回显值）
- `resolveListenAddress`：统一监听地址解析（`HOSTNAME` + `DEPLOY_RUN_PORT`/`PORT`）
- 新增 `/ops` 子模块：`createOpsReporter` 运维报告聚合（服务/部署/注册中心/环境指纹）、`resolveAdminConfig`/`verifyAdminToken`/`createAdminSession`/`validateAdminSession` 管理后台公共逻辑（常量时间比较、会话过期校验；`ADMIN_PASSWORD` 未设置 = 管理禁用）
- 消费端迁移：WanyanAI（env-schema 分面化、admin 路由/guard 库化、server.ts）、yunzone_user_center（`AUTH_SERVER_*` → `AUTH_CENTER_*`）、yunzone_redirect_gateway（移除默认管理密码回退）
- 配套：vitest 单测新增 29 用例（共 54）

## 0.1.0 — 2026-08-18

初始版本：从 `yunzone_user_center/packages/service-kit` 抽离为独立项目。

- `/registry`：泛型 `ProviderRegistry<T, P>`（注册/优先级/健康检查降级/状态快照/describeProvider 扩展）
- `/config`：`defineEnv`/`loadEnv`/`EnvConfigError`（防泄漏诊断快照）、`resolveDatabaseUrl`（postgres/coze）、`resolveBaseUrl`
- 配套：vitest 单元测试（25 用例）、tsup 构建（ESM+CJS+DTS）、CI 与发布工作流
