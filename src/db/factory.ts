/**
 * 数据库渠道工厂
 *
 * 契约与官方适配器均在 kit：
 * - postgres / coze 渠道统一由 PgSqlDb 适配（渠道差异 = 凭证获取方式）：
 *   - postgres：凭证取自 DATABASE_URL
 *   - coze：按平台注入行为运行（PGDATABASE_URL / PG* 变量组）
 * - env 可注入（默认 process.env），便于测试
 * - 组合根职责（统一约定）：校验 channel → 实例化 → init → 注册 disconnect 到进程退出钩子
 */

import { resolveDatabaseUrl } from "../config";
import { StorageConfigError } from "./errors";
import { PgSqlDb } from "./pg";
import type { SqlDb, SqlDbConfig } from "./types";

/**
 * 创建 SQL 执行器（按 channel 分派凭证获取方式）
 *
 * @throws Error 渠道对应凭证缺失时抛出（含诊断快照，见 config/resolveDatabaseUrl）
 */
export function createSqlDb(
  config: SqlDbConfig,
  env: Record<string, string | undefined> = process.env
): SqlDb {
  switch (config.channel) {
    case "postgres":
      // 通用模式：额外获取连接凭证（DATABASE_URL）
      return new PgSqlDb(resolveDatabaseUrl({ provider: "postgres", env }));
    case "coze":
      // coze 模式：按平台注入行为运行（PGDATABASE_URL / PG* 变量组）
      return new PgSqlDb(resolveDatabaseUrl({ provider: "coze", env }));
    case "none":
      // none = 显式无库声明：任何创建数据库执行器的行为都是配置错误（fail-fast）
      throw new StorageConfigError(
        "[db/factory] channel 为 none（显式无库），不应创建数据库执行器。" +
          "业务应选择非库存储后端（如文件）。"
      );
    default: {
      // 编译期穷尽性守卫：新增渠道未在此分派即编译失败（运行期不可达）
      const exhaustive: never = config.channel;
      throw new StorageConfigError(
        `[db/factory] 未分派的渠道: ${String(exhaustive)}`
      );
    }
  }
}
