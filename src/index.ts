/**
 * yunzone-service-kit — 云洲服务集群通用基础设施
 *
 * 入口子路径：
 * - yunzone-service-kit/core     — 共享原语（错误基类 / 生命周期钩子）
 * - yunzone-service-kit/db       — SQL 数据库抽象（SqlDb 契约 + PgSqlDb 渠道适配器）
 * - yunzone-service-kit/storage  — 对象存储抽象（S3 契约 + 渠道分派）
 * - yunzone-service-kit/registry — 泛型 Provider 注册中心基座（并存 Provider 模式）
 * - yunzone-service-kit/config   — 运行时配置层（env facets / 数据库 URL / 存储凭证 / baseUrl）
 * - yunzone-service-kit/ops      — 运维数据接口（报告聚合 + 管理后台公共逻辑）
 * - yunzone-service-kit/auth     — Token Authority 服务契约（端点 / 请求 / 响应 / 错误码）+ 客户端执行层
 * - yunzone-service-kit/app      — 应用目录契约（AppManifest v1 + 目录聚合纯函数）
 */

export * from "./core";
export * from "./db";
export * from "./storage";
export * from "./registry";
export * from "./config";
export * from "./ops";
export * from "./auth";
export * from "./app";
