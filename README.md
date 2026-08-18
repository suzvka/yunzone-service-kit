# @yunzone/service-kit

云洲服务集群通用基础设施：**插件式 Provider 注册中心基座**（`/registry`）与**运行时配置层**（`/config`）。

纯 TypeScript 实现，零框架耦合（不依赖 Next.js/React），任何 Node 服务可直接引用。

## 子模块

### `/registry` — 泛型 Provider 注册中心基座

定义集群内所有"插件式 Provider"模式的公共契约（验证码、风控、对象存储等）：

- `KitProvider`：最小接口（元信息 `meta` + 健康检查 `isAvailable()`）
- `ProviderRegistry<T, P>`：注册（重复 id 忽略）、优先级排序、健康检查优雅降级、`getStatus()` 状态快照
- 领域注册中心通过继承复用调度逻辑，可扩展 `describeProvider` 追加领域字段

```ts
import { ProviderRegistry } from "@yunzone/service-kit/registry";

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

| 导出 | 说明 |
|---|---|
| `defineEnv` / `loadEnv` / `EnvConfigError` | zod 环境变量契约声明与懒解析；失败抛出带诊断快照的错误（**只显示 set/unset，不回显变量值**） |
| `resolveDatabaseUrl` | 数据库连接 URL 解析：`DATABASE_PROVIDER` 显式选择 `postgres`（`DATABASE_URL`）/ `coze`（Coze 平台 PG 变量组），不自动嗅探 |
| `resolveBaseUrl` | 服务对外 baseUrl 解析链：`BETTER_AUTH_URL` →（DEV 回退）→ `COZE_PROJECT_DOMAIN_DEFAULT` → fallback |

```ts
import { defineEnv, loadEnv } from "@yunzone/service-kit/config";
import { z } from "zod";

const envSchema = defineEnv(
  z.object({
    STORAGE_PROVIDER: z.string(),
    COZE_BUCKET_NAME: z.string().optional(),
  })
);
const env = loadEnv(envSchema);
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
- 消费者安装：`pnpm add @yunzone/service-kit`

## License

MIT
