/**
 * 数据库渠道解析 — 值域统一
 *
 * 唯一来源 DATABASE_PROVIDER（与 config/resolveDatabaseUrl 的行为一致）：
 * - postgres（默认，未设置时）：通用 PostgreSQL，凭证取自 DATABASE_URL
 * - coze：Coze 平台数据库集成，按平台注入行为运行（PGDATABASE_URL / PG* 变量组）
 *
 * 渠道不合法 → 抛 StorageConfigError（fail-fast；禁止自动嗅探与隐式默认）。
 */

import { StorageConfigError } from "./errors";
import type { DatabaseChannel } from "./types";

/** 渠道环境变量名（唯一真理） */
const DATABASE_PROVIDER_KEY = "DATABASE_PROVIDER";

/** channel 合法值域 */
const CHANNELS: readonly DatabaseChannel[] = ["postgres", "coze"];

/**
 * 解析当前环境应使用的数据库渠道
 *
 * @throws StorageConfigError 变量值非法时抛出
 */
export function resolveDatabaseChannel(
  env: Record<string, string | undefined> = process.env
): DatabaseChannel {
  const value = env[DATABASE_PROVIDER_KEY];
  // 未设置默认 postgres（与 config/resolveDatabaseUrl 一致；不自动嗅探其他变量）
  if (value === undefined || value === "") {
    return "postgres";
  }
  if ((CHANNELS as readonly string[]).includes(value)) {
    return value as DatabaseChannel;
  }
  throw new StorageConfigError(
    `[db/resolve] ${DATABASE_PROVIDER_KEY} 非法: "${value}"。` +
      `支持: ${CHANNELS.join(", ")}`
  );
}
