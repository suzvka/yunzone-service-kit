/**
 * 数据库错误族
 *
 * 所有渠道实现（postgres / coze）统一抛出本族错误，
 * 调用方按类 catch，不依赖字符串匹配。
 */

import { KitError } from "../core";

/** 数据库基础设施错误基类 */
export class StorageError extends KitError {}

/**
 * 唯一约束冲突（INSERT/UPDATE 触发唯一键，如 pg 23505；由渠道实现归一化抛出）
 *
 * code 固定为 UNIQUE_VIOLATION，与 omni-auth SDK 的同一语义错误码对齐——
 * 跨抽象（认证域/业务域）判断唯一冲突统一用 err.code，避免同名不同类型陷阱。
 */
export class UniqueViolationError extends StorageError {
  constructor(message: string) {
    super(message, { code: "UNIQUE_VIOLATION" });
  }
}

/** 数据库配置错误（渠道非法 / none 渠道下创建执行器 / 渠道凭证缺失） */
export class StorageConfigError extends StorageError {}

/** pg 唯一约束冲突错误码 */
const PG_UNIQUE_VIOLATION = "23505";

/**
 * 错误归一化：底层驱动错误 → kit 错误族
 *
 * 唯一约束冲突（23505）归一化为 UniqueViolationError，
 * 其余原样返回（保留驱动原始错误码与堆栈，便于排障）。
 * 官方适配器（PgSqlDb）与离线引擎（/db/offline）共用本函数——
 * 两条实现路径的错误语义因此只有一处真理。
 */
export function normalizeDbError(err: unknown): unknown {
  if (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === PG_UNIQUE_VIOLATION
  ) {
    return new UniqueViolationError((err as Error).message);
  }
  return err;
}
