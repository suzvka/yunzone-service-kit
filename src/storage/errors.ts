/**
 * 对象存储错误族
 *
 * 所有渠道实现（s3 / coze）统一抛出本族错误，
 * 调用方按类 catch，不依赖字符串匹配。
 *
 * 命名说明：db 模块已占用 StorageError / StorageConfigError（历史命名），
 * 存储错误族采用 ObjectStore* 前缀避免同名冲突。
 */

import { KitError } from "../core";

/** 对象存储基础设施错误基类 */
export class ObjectStoreError extends KitError {}

/** 对象存储配置错误（渠道非法 / none 渠道下创建执行器 / 渠道凭证缺失或不完整） */
export class ObjectStoreConfigError extends ObjectStoreError {}
