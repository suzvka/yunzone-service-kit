# yunzone-service-kit

云洲服务集群通用基础设施：**插件式 Provider 注册中心基座**（`/registry`）、**运行时配置层**（`/config`）、**SQL 数据库抽象**（`/db`）、**对象存储抽象**（`/storage`）与**运维数据接口**（`/ops`）。

纯 TypeScript 实现，零框架耦合（不依赖 Next.js/React），任何 Node 服务可直接引用。

## 子模块

### `/registry` — 泛型 Provider 注册中心基座

定义集群内所有"插件式 Provider"模式的公共契约（验证码、风控、对象存储等）：

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
| `authCenterFacet` | `AUTH_CENTER_URL`、`AUTH_CENTER_API_KEY`、`AUTH_CENTER_PRODUCT_ID` | 鉴权中心三要素（规范名） |
| `userCenterFacet` | `USER_CENTER_URL`、`USER_CENTER_API_KEY`（预留） | 用户中心服务端地址与凭证 |
| `adminFacet` | `ADMIN_PASSWORD`、`ADMIN_PATH`（默认 `/admin`） | 管理后台；**未设置密码 = 禁用（503）** |

```ts
import {
  adminFacet,
  authCenterFacet,
  composeFacets,
  deploymentFacet,
  requiredFacet,
  userCenterFacet,
} from "yunzone-service-kit/config";

// 组合分面（重复 key 抛错；全部 optional，缺省降级）
const envSchema = composeFacets(deploymentFacet, authCenterFacet, userCenterFacet, adminFacet);

// 模块级必填（如鉴权中心客户端三要素）
const authCenterEnvSchema = requiredFacet(authCenterFacet, [
  "AUTH_CENTER_URL",
  "AUTH_CENTER_API_KEY",
  "AUTH_CENTER_PRODUCT_ID",
]);
const env = loadEnv(authCenterEnvSchema);
```

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
| `defineEnv` / `loadEnv` / `EnvConfigError` / `envSnapshot` | zod 环境变量契约声明与懒解析；失败抛出带诊断快照的错误（**只显示 set/unset，不回显变量值**） |
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

- `SqlDb`：SQL 执行器接口——`query(sql, params)` 查询返回行、`execute(sql, params)` 写语句返回影响行数、`withTransaction(fn)` 事务强承诺（回调内全部写入要么整体提交、要么整体回滚）
- 渠道两模式（`DatabaseChannel`）：`postgres`（通用，实现需额外获取连接凭证 `DATABASE_URL`）/ `coze`（按平台注入行为运行，`PGDATABASE_URL` / `PG*` 变量组）——SQL 语义一致，仅连接凭证获取方式不同
- `PgSqlDb`：kit 官方渠道适配器（真事务、唯一键冲突归一化为 `UniqueViolationError`、支持 `ssl` / `max` 等连接池选项）
- `resolveDatabaseChannel`：渠道解析，唯一来源 `DATABASE_PROVIDER`，未设置默认 `postgres`（不自动嗅探）
- `createSqlDb({ channel })`：渠道工厂——按 channel 分派凭证获取并返回 `PgSqlDb` 实例；需要自定义连接池选项（如 SSL）时直接 `new PgSqlDb(url, options)`
- 错误族：`StorageError` 基类、`UniqueViolationError`（唯一键冲突归一化）、`StorageConfigError`（配置错误）

```ts
import { createSqlDb, resolveDatabaseChannel } from "yunzone-service-kit/db";

const channel = resolveDatabaseChannel(); // DATABASE_PROVIDER → "postgres" | "coze"
const db = createSqlDb({ channel });     // postgres → DATABASE_URL；coze → 平台注入变量组

const rows = await db.query("SELECT id FROM users WHERE name = $1", ["alice"]);
```

### `/storage` — 对象存储抽象

集群统一对象存储操作心智模型，与 `/db` 的 `SqlDb` 抽象**完全同构**：**key 即真理**，调用方直接组织 storage key（如 `avatars/user123.jpg`），无字段映射层。

- `ObjectStore`：存储执行器接口——`upload(params)` 上传返回 key、`getSignedUrl(key, expireSeconds?)` 生成签名 URL（禁止自行拼接）、`delete(key)` 删除、`exists(key)` 存在性检查；继承 `LifecycleAware`（init/disconnect 由组合根调度）
- 渠道三值域（`StorageChannel`）：`s3`（通用 S3，实现需额外获取连接凭证 `S3_ENDPOINT_URL` / `S3_BUCKET_NAME`）/ `coze`（按平台注入行为运行，`COZE_BUCKET_*` 变量组）/ `none`（显式无存储声明，任何存储操作对其 fail-fast）——操作语义一致，仅连接凭证获取方式不同
- `S3ObjectStore`：kit 官方渠道适配器（`@aws-sdk/client-s3` 实现，path-style 寻址兼容非 AWS 端点；`s3` / `coze` 两渠道共用，渠道差异仅凭证解析；支持注入 `S3Client` 便于单测）
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

### `/ops` — 运维数据接口（纯逻辑层）

- `createOpsReporter({ name, version })`：聚合服务信息、部署信息、注册中心状态快照、env set/unset 指纹（**不含变量值**）
- `resolveAdminConfig` / `verifyAdminToken` / `createAdminSession` / `validateAdminSession`：管理后台公共逻辑（密码校验常量时间比较、会话含过期检查）
- **不提供 HTTP 端点**（零框架耦合）：服务自建路由，3 行封装 `/ops`：

```ts
import { createOpsReporter } from "yunzone-service-kit/ops";

const reporter = createOpsReporter({ name: "user-center", version: "1.2.3" });
reporter.addRegistry("captcha", captchaRegistry);
reporter.setEnvKeys(["AUTH_CENTER_URL", "DEPLOY_ENV"]);

export async function GET() {
  return Response.json(await reporter.report());
}
```

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
