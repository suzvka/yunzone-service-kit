/**
 * 存储错误族
 *
 * 所有存储实现（pg / file / txt / memory）统一抛出本族错误，
 * 调用方按类 catch，不依赖字符串匹配。
 */

import { KitError } from "../core";

/** 存储基础设施错误基类 */
export class StorageError extends KitError {}

/** 记录不存在（findOne/updateOne 等未命中） */
export class RecordNotFoundError extends StorageError {}

/** 唯一约束冲突（create/update 触发唯一键） */
export class UniqueViolationError extends StorageError {}

/** 在非事务实现上请求事务（isTransactional 守卫失败时抛出，fail-fast，取代静默回退） */
export class TransactionUnavailableError extends StorageError {}

/** 存储配置错误（backend 缺失/非法/当前不可实例化） */
export class StorageConfigError extends StorageError {}