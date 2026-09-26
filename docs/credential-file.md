# 产品凭证文件契约（auth-center.credential.json）

> 版本：v3.0（2026-09-26，v2 形态强切：单一命名源 = OAuth 2.0 协议术语，RFC 6749）
> 单一事实源：本文件 + [src/auth/credential-file.ts](../src/auth/credential-file.ts)
> 适用范围：产品接入集群的唯一配置交付物；kit 装配层（不消费、不解释段语义）+ 各消费方按需取段。

---

## 1. 定位

- **产品接入唯一配置交付物**：注册 / 轮换时由签发方（产品中心 / yunzone_auth）一次性下发完整文件；消费方放置后由 kit 装配——等效于"自动填好环境变量"。kit 只做形态校验与结构化装配，**不消费、不解释任何段的内容语义**；文件命名沿用合一时代的历史名（`auth-center.credential.json`）。
- **来源显式二选一（0.30）**：本地文件（默认，`AUTH_CENTER_CREDENTIAL_FILE` 指示路径）或远端 URL（`AUTH_CENTER_CREDENTIAL_URL`，集中托管；两键同设抛错）。凭证是**静态内容**：两种来源统一走进程内缓存快照，更新生效点 = 进程重启或 `refreshAuthCenterCredential()`（无 TTL / 周期刷新）。
- **远端 URL 是凭证材料**：URL 含访问凭据（读取即得或签名参数），任何日志 / 错误消息不回显；远端取件失败与「缺失」同语义（不新增错误族）。
- **分段结构（段 = 各签发方的语义域，v2 命名）**：
  - 鉴权段（顶层 `authCenterUrl` + `authCenterApiKey`）：yunzone_auth 服务凭证（sk-auth）；
  - OAuth 客户端段（顶层 `clientId` + `clientSecret` + `clientName`）：客户端身份与密钥——**字段名与 OAuth 协议参数 `client_id` / `client_secret` 同词源**，文档与消费方无需"X 即 Y"翻译；管理员凭证无 `clientSecret`（`clientRole` 标记角色）；
  - 产品段（`product`）：产品的权威指代（`product.id`，轮换不变）；
  - 产品中心段（`productCenter.baseUrl`）：产品中心服务地址；调产品中心 v1 的 Bearer **复用 `clientSecret`**（同一枚产品凭证的两个角色，不单独命名字段）。
- **签发时刻工件**：明文凭证仅存在于签发 / 轮换响应（仅此一次）；服务端只存 hash——无任何补发路径，丢件即重签。
- **全明文**：文件以明文 JSON 存放（与 `.env` 同一安全边界：拿到文件系统访问权即拿到凭证），不做字段级加密。未来加密采用**整文件信封包装**（见 §6），内层 schema 不变。
- **必须加入 `.gitignore`**：kit 加载时做启发式检查，疑似被 git 跟踪时 `console.warn` 一次（提示非保证）。

## 2. 文件形态

### 2.1 产品凭证（产品中心签发）

形态 = 各段拼装（鉴权段必填，其余段按签发方交付物决定）：

```json
{
  "version": "2.0",
  "type": "product-credential",
  "issuer": "product-center",
  "authCenterUrl": "https://auth.example.com",
  "authCenterApiKey": "sk-auth-<id>.<key>",
  "clientId": "（client_credential.id，轮换保持稳定）",
  "clientSecret": "sk-pc-<id>.<key>",
  "clientName": "wanyanai",
  "product": {
    "id": "（产品中心 product.id，轮换不变）",
    "name": "万言AI"
  },
  "productCenter": {
    "baseUrl": "https://pc.example.com"
  }
}
```

### 2.2 管理员 / 普通凭证（yunzone_auth 签发）

无产品归属与 OAuth secret；`clientRole` 标记档位（admin / normal）：

```json
{
  "version": "2.0",
  "type": "client-credential",
  "issuer": "token-authority",
  "authCenterUrl": "https://auth.example.com",
  "authCenterApiKey": "sk-auth-<id>.<key>",
  "clientId": "（credentials.id）",
  "clientName": "admin",
  "clientRole": "admin",
  "endpoints": { "issue": "…", "introspect": "…" }
}
```

### 2.3 字段表（v2 命名，单一命名源 = OAuth 2.0 协议术语）

| 字段 | 必填 | 语义 |
|---|---|---|
| `authCenterUrl` | ✓ | 鉴权中心服务地址（加载时归一化尾部斜杠） |
| `authCenterApiKey` | ✓ | 鉴权段服务凭证明文（`sk-auth-<id>.<key>` 自编码，凭证 id 即签发者身份 §4.2） |
| `clientId` | ✓ | OAuth 客户端身份（协议参数 `client_id`；产品中心 `client_credential.id` / 鉴权中心 `credentials.id`） |
| `clientSecret` | 产品凭证 ✓ | OAuth 客户端密钥（协议参数 `client_secret`；`sk-pc-<id>.<key>` 明文；调产品中心 v1 的 Bearer 同此值） |
| `clientName` | - | OAuth 客户端名称（展示） |
| `clientRole` | - | 凭证角色（鉴权中心形态：admin / normal） |
| `product.id` | 段存在时 ✓ | 产品权威指代（产品中心 `product.id`，轮换不变）；管理员凭证等非产品交付物无此段 |
| `product.name` | - | 产品名（展示） |
| `productCenter.baseUrl` | 段存在时 ✓ | 产品中心服务地址（加载时归一化尾部斜杠） |
| 其余字段（version / type / issuer / endpoints / …） | - | 忽略（向前兼容）：新增字段只允许可选，不改变既有字段语义 |

### 2.4 v1 → v2 迁移（强切）

v1 字段（顶层 `apiKey` / `client.id` / `productCenter.apiKey`）**不再受支持**：加载 v1 形态即校验失败，错误消息附迁移指引。迁移方式（凭证值不变，服务端 hash 不变，零中断窗口外风险）：

| v1 | v2 |
|---|---|
| 顶层 `apiKey` | `authCenterApiKey` |
| `client.id` | `clientId` |
| `client.name` | `clientName` |
| `client.productId` / `client.expiresAt` | 删除（权威指代 = `product.id`；有效性以 introspect 为准） |
| `productCenter.apiKey` | `clientSecret`（移出段，值只存一处） |
| `productCenter.baseUrl` | 不变 |
| `version: "1.0"` | `"2.0"` |

存量文件用部署侧迁移脚本做字段重排（值原样搬迁），或从签发方重新轮换获取 v2 文件。

## 3. 加载

### 3.1 来源解析（显式，不嗅探）

| env 状态 | 行为 |
|---|---|
| `AUTH_CENTER_CREDENTIAL_URL` 设置 | 远端来源：`refreshAuthCenterCredential()` fetch 取件；`options.path` 忽略 |
| `AUTH_CENTER_CREDENTIAL_FILE` 设置 | 本地文件路径来源 |
| 两键同时设置 | 抛 `CredentialFileError`（显式二选一，fail-fast） |
| 均未设置 | 本地默认 `<cwd>/auth-center.credential.json` |

### 3.2 统一缓存快照

- 来源内容经**进程内缓存**快照：首次读取（文件来源可同步直读兜底，并装入缓存）或 `refreshAuthCenterCredential()` 装入；此后加载一律读缓存；
- **更新生效点 = 进程重启或显式刷新**（本地 / 远端来源一致）；
- 缓存挂载 `globalThis`：CJS / ESM 双构建实例共享同一缓存（预取与读取不分家）；
- 校验 / 装配仍在读取时进行（缓存原始文本）：缺失 / 非法 JSON / schema 失败三个错误分支与旧版逐一对应。

### 3.3 刷新（唯一更新入口）

```ts
import { refreshAuthCenterCredential } from "yunzone-service-kit/auth";

await refreshAuthCenterCredential();                     // 来源按 3.1 解析
await refreshAuthCenterCredential({ path: "…" });        // 显式文件路径（仅文件来源生效）
await refreshAuthCenterCredential({ timeoutMs: 5_000 }); // 远端抓取超时（毫秒，默认 10000）
```

- 幂等、**永不抛错**：失败仅 `console.warn`（不回显 URL），缓存不更新（保持原值；冷启动保持「无凭证」）；
- 部署约定：各服务启动流程调用一次（启动即部署，「部署时自动调一次」）；运行期热更新（如管理台刷新按钮）同样调用本函数。

### 3.4 失败语义（远端取件失败 = 缺失）

| 情形 | 读侧行为 |
|---|---|
| 远端未预取 / 取件失败（网络 / 非 2xx / 超时） | 与「文件缺失」同语义：`optional ? null : CredentialFileError`（消息不展示 URL） |
| 远端取到但非法（非 JSON / schema 失败） | 既有「校验失败」分支（同上不展示 URL；v1 形态附迁移指引） |

### 3.5 用法与返回

```ts
import { loadAuthCenterCredential } from "yunzone-service-kit/auth";

const credential = loadAuthCenterCredential();                  // 来源按 3.1 解析；缺失抛错（fail-fast）
const credential = loadAuthCenterCredential({ path: "…" });     // 指定路径（仅文件来源；相对路径按 cwd 解析）
const credential = loadAuthCenterCredential({ optional: true }); // 缺失 → null
```

- 失败抛 `CredentialFileError`：只报来源标识与字段名，**不回显凭证值（含远端 URL）**
- 返回：`authCenterUrl`（尾部斜杠已归一化）/ `authCenterApiKey` / `clientId` / `clientSecret?` / `clientName?` / `clientRole?` / `product?` / `productCenter?`（`baseUrl` 已归一化）/ `sourcePath`（来源标识：本地 = 绝对路径；远端 = `remote://auth-center.credential.json`）

## 4. 消费

```ts
import { createAuthCenterClient, loadAuthCenterCredential } from "yunzone-service-kit/auth";

const credential = loadAuthCenterCredential();
const client = createAuthCenterClient({
  baseUrl: credential.authCenterUrl,
  apiKey: credential.authCenterApiKey,
});
// OAuth：client_id = credential.clientId；client_secret = credential.clientSecret
// 产品自指：credential.product?.id
// 调产品中心 v1：credential.productCenter?.baseUrl（Bearer = credential.clientSecret）
```

## 5. 生命周期

| 事件 | 文件状态 |
|---|---|
| 注册 / 轮换（产品中心编排 §3.1） | 一次性下发完整凭证文件（v2 形态，含明文，仅此一次） |
| 轮换完成 | 旧凭证被物理删除 → 旧文件请求 401，必须换用新文件 |
| 过期语义 | 新模型凭证恒无过期（以轮换代卫生，DESIGN.md §3.1） |
| v1 存量文件 | 强切后不再可加载：运行迁移脚本字段重排（值不变）或重新轮换 |

> 缓存快照：加载即快照；轮换换件（或远端对象覆盖）后须**重启进程或调用 `refreshAuthCenterCredential()`** 才生效（本地 / 远端来源一致）。

## 6. 未来：整文件加密（预留）

内层明文即本契约 schema，外层信封（格式在落地时定稿，载体决定 alg / kdf 字段）：

```json
{
  "format": "sealed-credential",
  "version": 1,
  "alg": "aes-256-gcm",
  "kdf": "…",
  "ciphertext": "…"
}
```

密钥载体候选：OS 凭据库（Windows DPAPI / Linux secret-tool）、口令派生（加载时输入 passphrase 走 KDF）、平台 KMS。**不做字段级加密**——解密密钥仍需存放，徒增复杂度而无安全增益。
