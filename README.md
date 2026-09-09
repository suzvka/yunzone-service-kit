# yunzone-service-kit · 云洲接口套件

云洲服务集群通用基础设施：
**共享原语**（`/core`）
**插件式注册中心基座**（`/registry`）
**运行时配置层**（`/config`）
**SQL 数据库抽象**（`/db`）
**对象存储抽象**（`/storage`）
**运维数据接口与管理后台认证**（`/ops`）
**鉴权中心契约与客户端**（`/auth`）
**应用目录契约**（`/app`）

纯逻辑层零框架耦合，任何 Node 服务可直接引用。Next.js 路由适配层拆为独立入口（`/ops/next`、`/app/next`；`next` 为 optional peerDependency），不引入这些子路径即不产生框架依赖。

## 子模块

### `/core` — 共享原语

集群共用的基础形状：
- `KitError`：领域错误统一基类，提供 `code`（默认取类名）/ `cause` / `toJSON()`（结构化日志用，不泄露堆栈）。各领域错误族（`StorageError` / `ObjectStoreError` / `AuthCenterError` / `AppManifestError`）均继承它，消费方按类 catch，不依赖字符串匹配
- `LifecycleAware`：`init?()` / `disconnect?()` 钩子形状，由组合根统一调度（`SqlDb` / `ObjectStore` 均继承）

### `/registry` — 泛型 Provider 注册中心基座

提供插件式泛型注册中心模块：
- `KitProvider`：最小接口（元信息 `meta` + 健康检查 `isAvailable()`）
- `ProviderRegistry<T, P>`：注册（重复 id 忽略）、优先级排序、健康检查优雅降级、`getStatus()` 状态快照
- 领域注册中心通过继承复用调度逻辑，可扩展 `describeProvider` 追加领域字段

```ts
import { ProviderRegistry } from "yunzone-service-kit/registry";

class MyRegistry extends ProviderRegistry<MyProvider> {
  constructor() {
    super({ name: "MyRegistry" });
  }
}

const registry = new MyRegistry();
registry.register(myProvider);
const active = await registry.getActiveProvider();
const status = await registry.getStatus(); // { registeredCount, availableCount, activeProvider, providers }
```

### `/config` — 运行时配置层

#### 环境变量分面规范（Env Facets）

环境变量按"服务角色"分面声明，服务用 `composeFacets` 组合自己需要的面：

| 分面 | 变量 | 说明 |
|------|------|------|
| `deploymentFacet` | `DEPLOY_ENV`、`PROJECT_DOMAIN_DEFAULT`、`PUBLIC_BASE_URL`、`DEPLOY_PROVIDER`、`HOSTNAME`、`PORT`、`WORKSPACE_PATH` | 部署面（中立键，TICKET-001） |
| `adminFacet` | `ADMIN_PASSWORD`、`ADMIN_PATH`（默认 `/admin`）、`ADMIN_USERNAME`（可选，启用双凭证）、`ADMIN_SESSION_MAX_AGE`（可选，默认 `86400`） | 管理后台；**未设置密码 = 禁用（503）** |

> `userCenterFacet`（`USER_CENTER_URL` / `USER_CENTER_API_KEY`）已于 0.28.0 退役：计量与定价上移平台计量域后全集群无消费者。

```ts
import {
  adminFacet,
  composeFacets,
  deploymentFacet,
  requiredFacet,
} from "yunzone-service-kit/config";

// 组合分面
const envSchema = composeFacets(deploymentFacet, adminFacet);

// 模块级必填（如管理后台密码）
const adminEnvSchema = requiredFacet(adminFacet, ["ADMIN_PASSWORD"]);
const env = loadEnv(adminEnvSchema);
```

> 鉴权中心服务凭证不走环境变量：`authCenterFacet` 已退役，唯一渠道是凭证文件（见 `/auth` 的 `loadAuthCenterCredential`）。

**aliases 选项**：`loadEnv(schema, { aliases })` 支持规范 key 未设置时回退别名（通用机制；诊断快照只列规范名、不回显值）。平台注入适配（TICKET-001）用预构建的 `deploymentAliases` 常量——**永久机制**（平台注入变量名不可改名，适配层在读取时回退，禁止服务代码裸读）：

```ts
// COZE_PROJECT_ENV 等平台注入旧名经适配层回退到中立键（永久，禁止裸读）
loadEnv(deploymentFacet, { aliases: deploymentAliases });
```

#### 本地 .env 文件加载

部署时只需拷贝一份 `.env` 到服务目录，启动时一次灌入，无需运维逐行设置环境变量：

```ts
// 方式一：独立加载（文件不存在默认静默跳过，开发环境无 .env 可启动）
loadDotEnv();

// 方式二：loadEnv 一键组合（先加载 .env 再校验）
const env = loadEnv(envSchema, { dotenv: true });
```

**合并语义**：默认**不覆盖** process.env 已有变量（平台注入优先），`override: true` 显式覆盖；`required: true` 时文件缺失报错。

**语法子集**：`KEY=VALUE`、单/双引号值（双引号支持 `\n` `\r` `\t` 转义）、`#` 整行注释、空行、`export` 前缀；**不支持**行尾内联注释与多行值（含 `#` 的值按字面量保留）。解析失败抛 `EnvFileError`，只报行号、**不回显变量值**。

#### 其他解析工具

| 导出 | 说明 |
|---|---|
| `loadEnv` / `EnvConfigError` / `envSnapshot` | zod 环境变量契约懒解析；失败抛出带诊断快照的错误（**只显示 set/unset，不回显变量值**） |
| `parseDotEnv` / `loadDotEnv` / `EnvFileError` | 本地 `.env` 文件解析与加载（默认不覆盖平台注入变量）；`loadEnv` 可传 `{ dotenv: true }` 一键组合 |
| `resolveDatabaseUrl` | 数据库连接 URL 解析：`DATABASE_PROVIDER` 显式选择 `postgres`（`DATABASE_URL`）/ `coze`（Coze 平台 PG 变量组），不自动嗅探 |
| `resolveStorageConfig` | 对象存储凭证解析：`STORAGE_PROVIDER` 显式选择 `s3`（`S3_ENDPOINT_URL` / `S3_BUCKET_NAME`）/ `coze`（Coze 平台 `COZE_BUCKET_*` 变量组），凭证可选（缺省走 SDK 默认凭证链），不自动嗅探 |
| `resolveBaseUrl` | 服务对外 baseUrl 解析链：`PUBLIC_BASE_URL` → `BETTER_AUTH_URL`（历史遗留兼容键）→（DEV 回退）→ `PROJECT_DOMAIN_DEFAULT` → fallback |
| `resolveListenAddress` | 监听地址：`HOSTNAME`（默认 `0.0.0.0`）+ `PORT`（默认 `5000`；平台旧名 `DEPLOY_RUN_PORT` 经适配层回退） |
| `normalizeDeployEnv` / `deploymentAliases` | 部署适配层（TICKET-001）：按 `DEPLOY_PROVIDER` 分派（缺省 `self` 通用模式，中立键直读；Coze 部署需显式设置 `DEPLOY_PROVIDER=coze`），把平台注入旧名**读取时**回退映射到中立键（不写 `process.env`） |

#### 配置键命名规范（TICKET-001）

环境变量命名遵循**三层命名空间模型**，新增配置键需经维护组评审：

1. **通用契约命名空间**（service-kit 声明的键）：一律中立命名，**禁止以任何平台名（coze / vercel / render / aws 等）作为键名的一部分**；平台差异通过键值分派表达（`DEPLOY_PROVIDER` / `DATABASE_PROVIDER`）。
2. **平台注入命名空间**（`COZE_*`、`PG*` 等）：平台私有。项目**不写入**（`loadDotEnv` 默认平台注入优先，私有值会被静默覆盖）、**不提升进通用契约**（语义污染）。
3. **项目私有命名空间**（服务自有 schema 扩展）：**自由命名**，但不得占用平台注入命名空间。

**裸读禁令**：禁止直接 `process.env.COZE_*` 裸读平台注入变量，必须经中立键（通用契约 + `deploymentAliases` / `normalizeDeployEnv`）或自有 schema 显式声明（私有层）接入。

平台注入变量名本身不改名，由适配层在读取时映射：解析器内部调用 `normalizeDeployEnv`；`loadEnv` 路径传 `deploymentAliases` 常量。

### `/db` — SQL 数据库抽象

集群统一数据库操作心智模型：**SQL 字符串即真理**，调用方直接书写参数化 SQL（`$1` 占位），无字段映射层。

- `SqlDb`：SQL 执行器接口——`query(sql, params)` 查询返回行、`execute(sql, params)` 写语句返回影响行数、`withTransaction(fn)` 事务强承诺（回调内全部写入要么整体提交、要么整体回滚）；继承 `LifecycleAware`
- 渠道三值域（`DatabaseChannel`）：`postgres`（通用，凭证 `DATABASE_URL`）/ `coze`（按平台注入行为运行，`PGDATABASE_URL` / `PG*` 变量组）/ `none`（**显式无库声明**，`createSqlDb` 对其 fail-fast，消费方据此改用非库存储）——SQL 语义一致，仅连接凭证获取方式不同
- `PgSqlDb`：kit 官方渠道适配器（`postgres` / `coze` 两渠道共用；真事务 BEGIN/COMMIT/ROLLBACK、事务代理禁止嵌套、pg 23505 归一化为 `UniqueViolationError`、支持 `ssl` / `max` / `idleTimeoutMillis` 连接池选项）
- `PoolProvider` + `isPoolProvider(db)`：连接池提供能力与类型守卫（宿主注入场景，如把池传给 omni-auth 等外部库），替代 `(db as PgSqlDb)` 类型断言；事务代理不实现该接口，守卫对其返回 `false`
- `resolveDatabaseChannel`：渠道解析，唯一来源 `DATABASE_PROVIDER`，未设置默认 `postgres`（不自动嗅探）
- `createSqlDb({ channel })`：渠道工厂——按 channel 分派凭证获取并返回 `PgSqlDb` 实例；需要自定义连接池选项（如 SSL）时直接 `new PgSqlDb(url, options)`
- 错误族：`StorageError` 基类、`UniqueViolationError`（`code = "UNIQUE_VIOLATION"`，与 omni-auth SDK 同语义错误码对齐）、`StorageConfigError`（配置错误）

```ts
import { createSqlDb, resolveDatabaseChannel } from "yunzone-service-kit/db";

const channel = resolveDatabaseChannel(); // DATABASE_PROVIDER → "postgres" | "coze" | "none"
const db = createSqlDb({ channel });     // postgres → DATABASE_URL；coze → 平台注入变量组；none → fail-fast

const rows = await db.query("SELECT id FROM users WHERE name = $1", ["alice"]);
```

> **事务边界约束**：`withTransaction` 回调内禁止调用 omni-auth 等外部库的认证/写 API——跨抽象事务互相不可见（外部库在池上另开连接），其写入会静默逃逸本事务。

### `/storage` — 对象存储抽象

集群统一对象存储操作心智模型，与 `/db` 的 `SqlDb` 抽象**完全同构**：**key 即真理**，调用方直接组织 storage key（如 `avatars/user123.jpg`），无字段映射层。

- `ObjectStore`：存储执行器接口——`upload(params)` 上传返回 key、`getSignedUrl(key, expireSeconds?)` 生成读签名 URL（禁止自行拼接）、`getUploadUrl(options)` 生成写（PUT）预签名 URL（客户端直写场景，默认时效 300s）、`delete(key)` 删除、`exists(key)` 存在性检查；继承 `LifecycleAware`（init/disconnect 由组合根调度）
- 渠道三值域（`StorageChannel`）：`s3`（通用 S3，实现需额外获取连接凭证 `S3_ENDPOINT_URL` / `S3_BUCKET_NAME`）/ `coze`（按平台注入行为运行，`COZE_BUCKET_*` 变量组）/ `none`（显式无存储声明，任何存储操作对其 fail-fast）——操作语义一致，仅连接凭证获取方式不同
- `S3ObjectStore`：kit 官方渠道适配器（`@aws-sdk/client-s3` 实现，`s3` / `coze` 两渠道共用，渠道差异仅凭证解析；`forcePathStyle` 默认 true 以兼容 MinIO 等非 AWS 端点，阿里云 OSS 等需置 false；支持注入 `S3Client` 便于单测）
- `resolveStorageChannel`：渠道解析，唯一来源 `STORAGE_PROVIDER`，未设置默认 `s3`（不自动嗅探）
- `createObjectStore({ channel })`：渠道工厂——按 channel 分派凭证获取并返回 `S3ObjectStore` 实例；需要自定义 S3Client 时直接 `new S3ObjectStore(config, options)`
- 错误族：`ObjectStoreError` 基类、`ObjectStoreConfigError`（配置错误；命名避开 db 已占用的 `StorageError` 族）

```ts
import { createObjectStore, resolveStorageChannel } from "yunzone-service-kit/storage";

const channel = resolveStorageChannel(); // STORAGE_PROVIDER → "s3" | "coze" | "none"
const store = createObjectStore({ channel }); // s3 → S3_* 变量；coze → 平台注入变量组；none → fail-fast

const key = await store.upload({ fileContent: buffer, fileName: "avatars/user123.jpg", contentType: "image/jpeg" });
const url = await store.getSignedUrl(key);
```

### `/ops` — 运维数据接口与管理后台认证（纯逻辑层）

**运维报告聚合**：

- `createOpsReporter({ name, version, env? })`：聚合服务信息、部署信息、注册中心状态快照、宿主扩展段、env set/unset 指纹（**不含变量值**）
- `reporter.addSection(id, provider)`：挂载宿主自有运维数据（API 调用热度、队列积压、卡片目录快照等 kit 无契约的数据）。provider 每次 `report()` 时调用，同步/异步皆可；**抛错只把该段降级为 `{ ok: false, error }`**（只留消息不留堆栈），其余段与整份报告照常产出
- 本入口**不提供 HTTP 端点**：服务自建路由，3 行封装 `/ops`：

```ts
import { createOpsReporter } from "yunzone-service-kit/ops";
import { facetKeys } from "yunzone-service-kit/config";

const reporter = createOpsReporter({ name: "user-center", version: "1.2.3" });
reporter.addRegistry("captcha", captchaRegistry);
reporter.addSection("apiHeat", () => heatCounter.snapshot()); // 形状由宿主定义
reporter.setEnvKeys(facetKeys(envSchema)); // 或手写白名单 ["DEPLOY_ENV", "ADMIN_PASSWORD"]

export async function GET() {
  return Response.json(await reporter.report());
}
```

扩展段在报告中的形态（消费方按 `ok` 收窄后读 `data`）：

```jsonc
{
  "sections": {
    "apiHeat": { "ok": true, "data": { /* 宿主自定义 */ } },
    "queue": { "ok": false, "error": "counter unavailable" }
  }
}
```

**管理后台认证（Admin Session Protocol v1.0，详见 [docs/admin-session-protocol.md](docs/admin-session-protocol.md)）**——集群内唯一实现，服务**禁止自建** admin-auth：

| 导出 | 说明 |
|---|---|
| `resolveAdminConfig(env?)` | 读取管理面配置；`ADMIN_PASSWORD` 未设置 → `enabled: false`（禁用态 503），**无默认密码回退** |
| `hashAdminPassword` / `verifyAdminPasswordWithHash` | 登录密码 SHA-256 哈希与常量时间比对（模块加载时缓存哈希，此后不持有明文） |
| `createSignedAdminSession` / `validateSignedAdminSession` | HMAC-SHA256 签名会话（防伪造、无状态、多实例自动可用）；校验返回会话主体用户名或 `null` |
| `deriveAdminSessionSecret` | 由密码哈希派生会话密钥——密码轮换后全部旧会话立即失效 |
| `ADMIN_SESSION_COOKIE` / `ADMIN_SESSION_DEFAULT_MAX_AGE_SECONDS` | cookie 名（`admin_session`）与默认有效期（`86400` 秒） |

### `/ops/next` — 管理后台路由守卫（Next.js 适配层）

独立入口，依赖 `next/server`（`next` 为 optional peerDependency），不污染纯逻辑层：

```ts
import { requireAdminAuth } from "yunzone-service-kit/ops/next";

// 禁用态 → 503 { code: "ADMIN_DISABLED" }；未登录 / 会话无效 / 已过期 → 401 { code: "UNAUTHENTICATED" }
export const GET = requireAdminAuth(async (request, { params }) => {
  return Response.json({ /* ... */ });
});
```

守卫以宽松泛型原样透传服务侧 handler 签名，**不引入 `NextRequest` 作为参数类型**——规避 Next.js 内部私有标记在不同 `node_modules` 副本间的类型不兼容；cookie 按鸭子类型读取，兼容 getter 属性（Next.js 15.3+/16）与方法（旧版）两种形态。

### `/auth` — 鉴权中心契约与客户端

Token Authority Service（鉴权中心）对接：**契约副本 + 官方通信实现**，单一事实源为 [docs/token-contract.md](docs/token-contract.md)。

- 契约面：`TOKEN_ENDPOINTS`（issue / introspect / lookup / refresh / revoke / healthz）、`TOKEN_ERROR_CODES`、各端点请求/响应类型
- `createAuthCenterClient({ baseUrl, apiKey?, timeoutMs? })`：
  - `introspect(request)`：无效 token 由服务端统一返回 `200 + { active: false }`（防枚举），客户端原样透传**不抛错**，消费方按 `active` 判断
  - `healthz()`：探活，可用（2xx）返回 `true`，不可达 / 非 2xx 一律 `false`（不抛错）
- `AuthCenterError`：协议层失败（网络 / 超时 / 非 2xx / 响应体非法）统一归一化；响应体可解析出服务端错误码时保留至 `error.code`
- **职责边界**：kit 只封装通信协议；探活节奏、降级回退、claims → 业务身份映射等策略由消费方实现

**凭证文件（服务凭证唯一配置渠道，详见 [docs/credential-file.md](docs/credential-file.md)）**：

服务凭证（apiKey / productId / 服务地址）不进环境变量。签发或轮换凭证时从鉴权中心管理后台一次性下载凭证文件（明文 apiKey 仅存在于签发/轮换响应，服务端只存 hash，事后无补发路径），放置到服务目录并加入 `.gitignore`：

```ts
import { createAuthCenterClient, loadAuthCenterCredential } from "yunzone-service-kit/auth";

// 默认读 <cwd>/auth-center.credential.json；缺失即抛 CredentialFileError（fail-fast）
const credential = loadAuthCenterCredential();

const client = createAuthCenterClient({
  baseUrl: credential.authCenterUrl,
  apiKey: credential.apiKey,
});
```

- 文件含明文 apiKey：加载时做启发式检查，疑似被 git 跟踪时 `console.warn` 一次（提示非保证）
- 文件内 `expiresAt` 仅为签发时快照（auto-renew 场景会失真），仅供展示；运行时有效性以 introspect 为准
- 轮换后旧文件立即失效（introspect 返回 `active: false`），需重新下载凭证文件

### `/app` — 应用目录契约（AppManifest v1）

Headless 纯数据层（零框架 / 零 React）：子产品按契约自述"应用介绍"，宿主聚合后标准渲染、随意编排。详见 [docs/app-manifest.md](docs/app-manifest.md)。

- `parseAppManifest(input, source?)` + `appManifestSchema`：契约校验与归一化（`status` → `"live"`、`tags` → `[]`）；失败抛 `AppManifestError`
- `resolveAppCatalog(entries, { skipInvalid? })`：把「子产品自述 + 宿主编排覆盖」合并为可直接渲染的 `ResolvedApp[]`（`order` 升序在前、重复 id fail-fast）
- `APP_MANIFEST_WELL_KNOWN_PATH`：标准端点路径约定 `/.well-known/app-manifest.json`

### `/app/next` — 标准端点托管（Next.js 适配层）

```ts
// src/app/.well-known/app-manifest.json/route.ts
import { createAppManifestHandler } from "yunzone-service-kit/app/next";
import manifest from "@/manifest/app-manifest.json";

export const GET = createAppManifestHandler({ manifest });
```

每次请求经契约校验（非法 manifest → `500 { code: "APP_MANIFEST_INVALID" }`，不输出非法契约、不泄漏诊断细节），成功响应统一 `Cache-Control: public, max-age=300`；`manifest` 支持静态对象或函数形态（运行时动态状态）。完全静态时也可直接放置 `public/.well-known/app-manifest.json`（零代码，二选一）。

## 开发

```bash
pnpm install
pnpm test       # vitest 单元测试
pnpm ts-check   # 类型检查
pnpm build      # tsup 构建（ESM + CJS + DTS）
```

## 发布

- 版本策略：`0.x` 快速迭代，手动 bump `package.json` 版本后打 GitHub Release（tag = `v0.x.y`）
- 发布流程：GitHub Release published 触发 [publish.yml](.github/workflows/publish.yml)，通过 OIDC 自动发布到 npmjs（public）
- 消费者安装：`pnpm add yunzone-service-kit`
- 本地开发联调：`pnpm add link:../yunzone-service-kit`（实时指向源目录 dist，发布后切回 `^0.x.y`）

## License

MIT
