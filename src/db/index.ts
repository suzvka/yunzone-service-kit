/**
 * yunzone-service-kit/db — SQL 数据库抽象
 *
 * 集群统一数据库抽象形状：
 * - SQL 字符串即真理：参数化 SQL（$1 占位）直传，无字段映射层
 * - 渠道值域开放（2026-10-13）：内置 postgres（通用，凭证 DATABASE_URL）/ coze（平台注入行为）/
 *   none（显式无库）之外，业务可经 registerDatabaseChannel 注册自有渠道（kit 辅助定位：
 *   不约束业务），显式声明禁止嗅探
 * - 事务强承诺：所有实现必须提供 withTransaction，禁止假承诺
 * - 生命周期：init/disconnect 钩子由组合根统一调度
 *
 * 契约与官方适配器（PgSqlDb）均在本模块；需要自定义连接池选项
 * （如 SSL）时直接实例化 PgSqlDb，否则用 createSqlDb 快捷入口。
 */

export { resolveDatabaseChannel } from "./resolve";
export { createSqlDb } from "./factory";
export { PgSqlDb, isPoolProvider } from "./pg";
export type { PgSqlDbOptions, PoolProvider } from "./pg";
export {
  registerDatabaseChannel,
  unregisterDatabaseChannel,
  isKnownDatabaseChannel,
  getDatabaseChannelFactory,
  listRegisteredDatabaseChannels,
  BUILTIN_DATABASE_CHANNELS,
} from "./registry";
export type { DatabaseChannelFactory, DatabaseEnv } from "./registry";
export { StorageError, UniqueViolationError, StorageConfigError } from "./errors";
export type { DatabaseChannel, SqlDbConfig, SqlDb } from "./types";
