# 鉴权中心凭证文件契约（auth-center.credential.json）

> 版本：v1.0（2026-09）
> 单一事实源：本文件 + [src/auth/credential-file.ts](../src/auth/credential-file.ts)
> 适用范围：消费方（宿主应用）对鉴权中心（yunzone_auth）所签发服务凭证的配置渠道。

---

## 1. 定位

- **服务凭证唯一配置渠道**：`apiKey` / `productId` / 鉴权中心地址全部经凭证文件交付，**不走环境变量**（`AUTH_CENTER_*` 三要素与 kit `authCenterFacet` 已退役）。
- **签发时刻工件**：明文 apiKey 仅存在于鉴权中心管理后台的签发 / 轮换响应（仅此一次）；凭证文件由该响应在**客户端拼装**并下载。服务端只存 hash——无任何补发路径，丢件即重签。
- **全明文**：文件以明文 JSON 存放（与 `.env` 同一安全边界：拿到文件系统访问权即拿到凭证），不做字段级加密。未来加密采用**整文件信封包装**（见 §6），内层 schema 不变。
- **必须加入 `.gitignore`**：kit 加载时做启发式检查，疑似被 git 跟踪时 `console.warn` 一次（提示非保证）。

## 2. 文件形态

形态 = 签发/轮换响应体 + `authCenterUrl` 字段：

```json
{
  "version": "1.0",
  "type": "client-credential",
  "issuer": "token-authority",
  "authCenterUrl": "https://auth.example.com",
  "client": {
    "id": "（tokenHash，即 clientId）",
    "name": "wanyanai",
    "productId": "wanyanai",
    "expiresAt": "2027-09-09T00:00:00.000Z",
    "redirectUris": ["…"],
    "confidential": true,
    "callbackUrls": ["…"]
  },
  "apiKey": "sk-client-…",
  "endpoints": { "issue": "…", "introspect": "…" }
}
```

| 字段 | 必填 | 语义 |
|---|---|---|
| `authCenterUrl` | ✓ | 鉴权中心服务地址（加载时归一化尾部斜杠） |
| `apiKey` | ✓ | 服务凭证明文（`sk-client-` 前缀） |
| `client.productId` | ✓ | 凭证归属产品 ID（消费方签发 token 时的产品标识） |
| `client.id` | - | 凭证唯一标识（= tokenHash = clientId） |
| `client.name` / `client.expiresAt` | - | 展示元数据；`expiresAt` 为签发时快照（auto-renew 场景会失真），仅供展示，运行时有效性以 introspect 为准 |
| 其余字段（version / type / issuer / endpoints / …） | - | 忽略（向前兼容）：新增字段只允许可选，不改变既有字段语义 |

## 3. 加载

```ts
import { loadAuthCenterCredential } from "yunzone-service-kit/auth";

const credential = loadAuthCenterCredential();                  // 默认 <cwd>/auth-center.credential.json
const credential = loadAuthCenterCredential({ path: "…" });     // 指定路径（相对路径按 cwd 解析）
const credential = loadAuthCenterCredential({ optional: true }); // 缺失 → null（默认缺失即抛，fail-fast）
```

- 失败抛 `CredentialFileError`：只报文件路径与字段名，**不回显凭证值**
- 返回：`authCenterUrl`（尾部斜杠已归一化）/ `apiKey` / `productId` / `clientId?` / `name?` / `expiresAt?` / `sourcePath`

## 4. 消费

```ts
import { createAuthCenterClient, loadAuthCenterCredential } from "yunzone-service-kit/auth";

const credential = loadAuthCenterCredential();
const client = createAuthCenterClient({
  baseUrl: credential.authCenterUrl,
  apiKey: credential.apiKey,
});
// productId 由 credential.productId 提供（业务签发 token 时使用）
```

## 5. 生命周期

| 事件 | 文件状态 |
|---|---|
| 签发 / 轮换 | 管理后台弹窗一次性拼装下载凭证文件（含明文） |
| refresh / 自动续期 | 令牌值不变 → 文件持续有效 |
| 轮换完成 | 旧 apiKey 被物理删除 → 旧文件 introspect 返回 `active: false`，必须重新下载 |
| `expiresAt` 到期 | 运行时以 introspect 结果为准，文件内快照不作判定依据 |

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
