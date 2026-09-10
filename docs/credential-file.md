# 产品凭证文件契约（auth-center.credential.json）

> 版本：v2.0（2026-09-10，分段交付）
> 单一事实源：本文件 + [src/auth/credential-file.ts](../src/auth/credential-file.ts)
> 适用范围：产品接入集群的唯一配置交付物；kit 装配层（不消费、不解释段语义）+ 各消费方按需取段。

---

## 1. 定位

- **产品接入唯一配置交付物**：注册 / 轮换时由签发方（产品中心）一次性下发完整文件；消费方放置后由 kit 装配——等效于"自动填好环境变量"。kit 只做形态校验与结构化装配，**不消费、不解释任何段的内容语义**；文件命名沿用合一时代的历史名（`auth-center.credential.json`）。
- **分段结构（段 = 各签发方的语义域）**：鉴权段（顶层 `authCenterUrl` + `apiKey`，yunzone_auth 服务凭证）/ 产品段（`product`，产品权威指代）/ 产品中心段（`productCenter`，调产品中心 v1 的地址与 Bearer）/ `client` 元数据段。
- **签发时刻工件**：明文 apiKey 仅存在于签发 / 轮换响应（仅此一次）；服务端只存 hash——无任何补发路径，丢件即重签。
- **全明文**：文件以明文 JSON 存放（与 `.env` 同一安全边界：拿到文件系统访问权即拿到凭证），不做字段级加密。未来加密采用**整文件信封包装**（见 §6），内层 schema 不变。
- **必须加入 `.gitignore`**：kit 加载时做启发式检查，疑似被 git 跟踪时 `console.warn` 一次（提示非保证）。

## 2. 文件形态

形态 = 各段拼装（鉴权段必填，其余段按签发方交付物决定）：

```json
{
  "version": "1.0",
  "type": "client-credential",
  "issuer": "token-authority",
  "authCenterUrl": "https://auth.example.com",
  "client": {
    "id": "（凭证 id，新模型 = credentials.id）",
    "name": "wanyanai",
    "productId": "（合一时代兼容字段，可选；权威指代见 product.id）",
    "expiresAt": null,
    "redirectUris": ["…"],
    "confidential": true,
    "callbackUrls": ["…"]
  },
  "apiKey": "sk-auth-<id>.<key>",
  "product": {
    "id": "（产品中心 product.id，轮换不变）",
    "name": "万言AI"
  },
  "productCenter": {
    "baseUrl": "https://pc.example.com",
    "apiKey": "sk-pc-…"
  },
  "endpoints": { "issue": "…", "introspect": "…" }
}
```

| 字段 | 必填 | 语义 |
|---|---|---|
| `authCenterUrl` | ✓ | 鉴权中心服务地址（加载时归一化尾部斜杠） |
| `apiKey` | ✓ | 鉴权段服务凭证明文（新模型 `sk-auth-<id>.<key>` 自编码，凭证 id 即签发者身份 §4.2） |
| `product.id` | 段存在时 ✓ | 产品权威指代（产品中心 `product.id`，轮换不变）；管理员凭证等非产品交付物无此段 |
| `product.name` | - | 产品名（展示） |
| `productCenter.baseUrl` | 段存在时 ✓ | 产品中心服务地址（加载时归一化尾部斜杠） |
| `productCenter.apiKey` | 段存在时 ✓ | 产品凭证（sk-pc）明文 |
| `client.productId` | - | 合一时代兼容字段：新签发文件以 `product.id` 为权威指代，旧消费链（读 `credential.productId`）继续可用 |
| `client.id` / `client.name` / `client.expiresAt` | - | 签发响应元数据；`expiresAt` 为签发时快照（新模型恒 null），仅供展示，运行时有效性以 introspect 为准 |
| 其余字段（version / type / issuer / endpoints / …） | - | 忽略（向前兼容）：新增字段只允许可选，不改变既有字段语义 |

## 3. 加载

```ts
import { loadAuthCenterCredential } from "yunzone-service-kit/auth";

const credential = loadAuthCenterCredential();                  // 默认 <cwd>/auth-center.credential.json
const credential = loadAuthCenterCredential({ path: "…" });     // 指定路径（相对路径按 cwd 解析）
const credential = loadAuthCenterCredential({ optional: true }); // 缺失 → null（默认缺失即抛，fail-fast）
```

- 失败抛 `CredentialFileError`：只报文件路径与字段名，**不回显凭证值**
- 返回：`authCenterUrl`（尾部斜杠已归一化）/ `apiKey` / `productId?` / `clientId?` / `name?` / `expiresAt?` / `product?` / `productCenter?`（`baseUrl` 已归一化）/ `sourcePath`

## 4. 消费

```ts
import { createAuthCenterClient, loadAuthCenterCredential } from "yunzone-service-kit/auth";

const credential = loadAuthCenterCredential();
const client = createAuthCenterClient({
  baseUrl: credential.authCenterUrl,
  apiKey: credential.apiKey,
});
// 产品自指：credential.product?.id（新签发文件为权威指代；历史文件回退 credential.productId）
// 调产品中心 v1：credential.productCenter?.baseUrl / .apiKey（文件含产品中心段时）
```

## 5. 生命周期

| 事件 | 文件状态 |
|---|---|
| 注册 / 轮换（产品中心编排 §3.1） | 一次性下发完整凭证文件（含明文，仅此一次） |
| 轮换完成 | 旧 apiKey 被物理删除 → 旧文件请求 401，必须换用新文件 |
| 过期语义 | 新模型凭证恒无过期（以轮换代卫生，DESIGN.md §3.1），文件内快照仅展示 |

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
