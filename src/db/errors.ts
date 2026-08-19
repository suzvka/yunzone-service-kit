/**
 * 数据库错误族
 *
 * 所有渠道实现（postgres / coze）统一抛出本族错误，
 * 调用方按类 catch，不依赖字符串匹配。
 */

import { KitError } from "../core";

/** 数据库基础设施错误基类 */
export class StorageError extends KitError {}

/** 唯一约束冲突（INSERT/UPDATE 触发唯一键，如 pg 23505；由渠道实现归一化抛出） */
export class UniqueViolationError extends StorageError {}

/** 数据库配置错误（渠道缺失/非法/当前无可用实现） */
export class StorageConfigError extends StorageError {}
