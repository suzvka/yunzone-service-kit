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
