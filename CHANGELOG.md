# Changelog

## Unreleased

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
