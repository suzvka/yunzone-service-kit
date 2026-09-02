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
