/**
 * 应用目录契约 — 错误类型
 *
 * 错误码约定：
 * - APP_MANIFEST_INVALID            — manifest 解析失败（zod 路径诊断）
 * - APP_MANIFEST_VERSION_UNSUPPORTED — schemaVersion 非当前支持版本
 * - APP_MANIFEST_API_DUPLICATE_ID   — manifest apis 条目重复 id（fail-fast）
 * - APP_CATALOG_DUPLICATE_ID        — 编排条目重复 id（fail-fast）
 */

import { KitError } from "../core";

/** 应用目录契约领域错误基类 */
export class AppManifestError extends KitError {}
