/**
 * yunzone-service-kit/db — 互斥后端抽象（db-core）
 *
 * 集群统一数据库抽象形状：
 * - 显式分派：StorageConfig.backend 必填，禁止自动嗅探与隐式默认
 * - 领域真理在接口：CRUD 字段 camelCase，物理列名是实现私有细节
 * - 事务诚实：强承诺（TransactionalDbAdapter）或无事务（DbAdapter），禁止假承诺
 * - 生命周期：init/disconnect 钩子由组合根统一调度
 *
 * 契约在本模块；pg / file / txt 适配器由消费侧实现（本模块内置 memory 供测试）。
 * 与 yunzone-service-kit/registry（并存 Provider 模式）共享 core 原语、语义并列。
 */

export { resolveStorageBackend } from "./resolve";
export {
  isTransactional,
  createDbAdapter,
  createKeyValueStore,
} from "./factory";
export {
  MemoryDbAdapter,
  TransactionalMemoryDbAdapter,
  MemoryKeyValueStore,
} from "./memory";
export {
  StorageError,
  RecordNotFoundError,
  UniqueViolationError,
  TransactionUnavailableError,
  StorageConfigError,
} from "./errors";
export type {
  StorageBackend,
  StorageConfig,
  PgConnection,
  FileConnection,
  TxtConnection,
  Json,
  Condition,
  OrderBy,
  DbAdapter,
  TransactionalDbAdapter,
  KeyValueStore,
} from "./types";