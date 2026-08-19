/**
 * 存储工厂
 *
 * 契约在 kit（yunzone-service-kit/db）、实现留在消费侧——kit 保持零新增运行时依赖：
 * - memory：kit 内置（测试/本地开发）
 * - postgres / file / txt：适配器由消费迁移阶段在各项目内实现
 *
 * 组合根职责（统一约定）：校验 backend → 实例化 → init → 注册 disconnect 到进程退出钩子。
 */

import { StorageConfigError } from "./errors";
import {
  MemoryKeyValueStore,
  TransactionalMemoryDbAdapter,
} from "./memory";
import type {
  DbAdapter,
  KeyValueStore,
  StorageBackend,
  StorageConfig,
  TransactionalDbAdapter,
} from "./types";

/** 无法在当前包内实例化的 backend 统一报错 */
function unavailableBackend(backend: StorageBackend): StorageConfigError {
  return new StorageConfigError(
    `[db/factory] backend="${backend}" 适配器由消费侧提供，本阶段仅 "memory" 可实例化。` +
      `契约见 yunzone-service-kit/db。`
  );
}

/**
 * 运行时守卫：事务收窄（调用方在请求事务前先验证）
 *
 * 非事务实现上的事务请求应抛 TransactionUnavailableError（fail-fast），
 * 取代静默顺序写入回退。
 */
export function isTransactional(adapter: DbAdapter): adapter is TransactionalDbAdapter {
  return typeof (adapter as TransactionalDbAdapter).transaction === "function";
}

/**
 * 创建通用数据平面适配器（按 backend 分派）
 *
 * @throws StorageConfigError backend 当前不可实例化时抛出
 */
export function createDbAdapter(config: StorageConfig): TransactionalDbAdapter | DbAdapter {
  switch (config.backend) {
    case "memory":
      return new TransactionalMemoryDbAdapter();
    case "postgres":
    case "file":
    case "txt":
      throw unavailableBackend(config.backend);
    default: {
      const exhaustive: never = config.backend;
      return String(exhaustive) as never;
    }
  }
}

/**
 * 创建键值原语（按 backend 分派）
 *
 * @throws StorageConfigError backend 当前不可实例化时抛出
 */
export function createKeyValueStore(config: { backend: StorageBackend }): KeyValueStore {
  switch (config.backend) {
    case "memory":
      return new MemoryKeyValueStore();
    case "postgres":
    case "file":
    case "txt":
      throw unavailableBackend(config.backend);
    default: {
      const exhaustive: never = config.backend;
      return String(exhaustive) as never;
    }
  }
}