/**
 * yunzone-service-kit — 云洲服务集群通用基础设施
 *
 * 入口子路径：
 * - yunzone-service-kit/core     — 共享原语（错误基类 / 生命周期钩子）
 * - yunzone-service-kit/db       — 互斥后端抽象（db-core：存储后端契约 + memory 实现）
 * - yunzone-service-kit/storage  — 对象存储抽象（storage-core：S3 契约 + 渠道分派）
 * - yunzone-service-kit/registry — 泛型 Provider 注册中心基座（并存 Provider 模式）
 * - yunzone-service-kit/config   — 运行时配置层（env facets / 数据库 URL / 存储凭证 / baseUrl）
 * - yunzone-service-kit/ops      — 运维数据接口（报告聚合 + 管理后台公共逻辑）
 * - yunzone-service-kit/auth     — Token Authority 服务契约（端点 / 请求 / 响应 / 错误码）
 */

export * from "./core";
export * from "./db";
export * from "./storage";
export * from "./registry";
export * from "./config";
export * from "./ops";
export * from "./auth/token-contract";
