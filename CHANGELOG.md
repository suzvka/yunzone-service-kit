# Changelog

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
