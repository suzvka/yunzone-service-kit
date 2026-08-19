/**
 * 数据库渠道工厂
 *
 * 契约在 kit（yunzone-service-kit/db）、渠道实现延后提供：
 * - postgres / coze 适配器当前均不可实例化，统一抛 StorageConfigError（fail-fast）
 * - 组合根职责（统一约定）：校验 channel → 实例化 → init → 注册 disconnect 到进程退出钩子
 */

import { StorageConfigError } from "./errors";
import type { DatabaseChannel, SqlDb, SqlDbConfig } from "./types";

/** 当前无法在包内实例化的渠道统一报错 */
function unavailableChannel(channel: DatabaseChannel): StorageConfigError {
  return new StorageConfigError(
    `[db/factory] channel="${channel}" 渠道适配器延后提供，契约见 yunzone-service-kit/db。` +
      `postgres 模式实现需额外获取连接凭证（DATABASE_URL）；coze 模式按平台注入行为运行。`
  );
}

/**
 * 创建 SQL 执行器（按 channel 分派）
 *
 * @throws StorageConfigError 渠道当前不可实例化时抛出
 */
export function createSqlDb(config: SqlDbConfig): SqlDb {
  switch (config.channel) {
    case "postgres":
    case "coze":
      throw unavailableChannel(config.channel);
    default: {
      const exhaustive: never = config.channel;
      return String(exhaustive) as never;
    }
  }
}
