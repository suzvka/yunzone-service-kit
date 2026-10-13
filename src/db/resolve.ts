/**
 * 数据库渠道解析 — 值域统一
 *
 * 唯一来源 DATABASE_PROVIDER（与 config/resolveDatabaseUrl 的行为一致）：
 * - postgres（默认，未设置时）：通用 PostgreSQL，凭证取自 DATABASE_URL
 * - coze：Coze 平台数据库集成，按平台注入行为运行（PGDATABASE_URL / PG* 变量组）
 * - none：显式无库声明（业务不需要数据库）；任何数据库操作（createSqlDb / resolveDatabaseUrl）
 *   对其 fail-fast 抛 StorageConfigError，消费方应据此选择非库存储后端
 * - 业务注册渠道（2026-10-13 开放化）：经 registerDatabaseChannel 登记的渠道名同属合法
 *   值域（kit 辅助定位：不约束业务）；渠道不合法仍 fail-fast（禁止自动嗅探与隐式默认）
 */

import { StorageConfigError } from "./errors";
import type { DatabaseChannel } from "./types";
import {
  BUILTIN_DATABASE_CHANNELS,
  isKnownDatabaseChannel,
  listRegisteredDatabaseChannels,
} from "./registry";

/** 渠道环境变量名（唯一真理） */
const DATABASE_PROVIDER_KEY = "DATABASE_PROVIDER";

/**
 * 解析当前环境应使用的数据库渠道
 *
 * @throws StorageConfigError 变量值非法时抛出（内置渠道 + 已注册渠道之外的值）
 */
export function resolveDatabaseChannel(
  env: Record<string, string | undefined> = process.env
): DatabaseChannel {
  const value = env[DATABASE_PROVIDER_KEY];
  // 未设置默认 postgres（与 config/resolveDatabaseUrl 一致；不自动嗅探其他变量）
  if (value === undefined || value === "") {
    return "postgres";
  }
  if (isKnownDatabaseChannel(value)) {
    return value;
  }
  const registered = listRegisteredDatabaseChannels();
  const registeredNote =
    registered.length > 0 ? `；已注册: ${registered.join(", ")}` : "";
  throw new StorageConfigError(
    `[db/resolve] ${DATABASE_PROVIDER_KEY} 非法: "${value}"。` +
      `支持: ${BUILTIN_DATABASE_CHANNELS.join(", ")}${registeredNote}`
  );
}
