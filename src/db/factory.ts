/**
 * 数据库渠道工厂
 *
 * 契约与官方适配器均在 kit：
 * - postgres / coze 渠道统一由 PgSqlDb 适配（渠道差异 = 凭证获取方式）：
 *   - postgres：凭证取自 DATABASE_URL
 *   - coze：按平台注入行为运行（PGDATABASE_URL / PG* 变量组）
 * - 业务注册渠道（2026-10-13 开放化）：经 registerDatabaseChannel 登记的工厂分派
 *   （kit 辅助定位：不约束业务；渠道选择不再迫使业务在 kit 之外重抄分支）
 * - env 可注入（默认 process.env），便于测试
 * - 组合根职责（统一约定）：校验 channel → 实例化 → init → 注册 disconnect 到进程退出钩子
 */

import { resolveDatabaseUrl } from "../config";
import { StorageConfigError } from "./errors";
import { PgSqlDb } from "./pg";
import { getDatabaseChannelFactory } from "./registry";
import type { SqlDb, SqlDbConfig } from "./types";

/**
 * 创建 SQL 执行器（按 channel 分派：内置官方适配器 ∪ 业务注册渠道）
 *
 * @throws Error 渠道对应凭证缺失 / 未注册时抛出（含诊断快照，见 config/resolveDatabaseUrl）
 */
export function createSqlDb(
  config: SqlDbConfig,
  env: Record<string, string | undefined> = process.env
): SqlDb {
  if (config.channel === "none") {
    // none = 显式无库声明：任何创建数据库执行器的行为都是配置错误（fail-fast）
    throw new StorageConfigError(
      "[db/factory] channel 为 none（显式无库），不应创建数据库执行器。" +
        "业务应选择非库存储后端（如文件）。"
    );
  }
  switch (config.channel) {
    case "postgres":
      // 通用模式：额外获取连接凭证（DATABASE_URL）
      return new PgSqlDb(
        resolveDatabaseUrl({ provider: "postgres", env }),
        config.options
      );
    case "coze":
      // coze 模式：按平台注入行为运行（PGDATABASE_URL / PG* 变量组）
      return new PgSqlDb(resolveDatabaseUrl({ provider: "coze", env }), config.options);
    default: {
      // 业务注册渠道（开放注册表；未注册 → fail-fast，不静默降级）
      const factory = getDatabaseChannelFactory(config.channel);
      if (factory) return factory({ env });
      throw new StorageConfigError(
        `[db/factory] 未分派且未注册的渠道: ${String(config.channel)}。` +
          "自定义渠道须先经 registerDatabaseChannel 登记。"
      );
    }
  }
}
