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
