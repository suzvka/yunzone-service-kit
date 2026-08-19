/**
 * 存储后端解析 — 值域统一
 *
 * 读取优先级：
 * 1. STORAGE_BACKEND（新统一变量，唯一真理）
 * 2. 旧变量别名（兼容期，逐项目迁移后淘汰）：
 *    - DATABASE_PROVIDER（kit / yunzone_auth）：postgres | coze → postgres
 *    - STORAGE_MODE（yunzone_redirect_gateway）：db | file
 *    - CONFIG_STORE（WanyanAI）：db | file
 *
 * 均未设置 → 抛 StorageConfigError（fail-fast；禁止自动检测与隐式默认）。
 */

import { StorageConfigError } from "./errors";
import type { StorageBackend } from "./types";

/** 新统一环境变量名 */
const STORAGE_BACKEND_KEY = "STORAGE_BACKEND";

/** 旧变量别名（按优先级排列） */
const LEGACY_KEYS = ["DATABASE_PROVIDER", "STORAGE_MODE", "CONFIG_STORE"] as const;

/** backend 合法值域 */
const BACKENDS: readonly StorageBackend[] = ["postgres", "file", "txt", "memory"];

/** 旧变量值 → backend 归一化；未知值返回 null */
function normalizeLegacy(value: string): StorageBackend | null {
  switch (value) {
    case "postgres":
      return "postgres";
    case "coze":
      // coze 是 pg 连接的构建方式（解析见 config/database.ts），不是独立 backend
      return "postgres";
    case "db":
      return "postgres";
    case "file":
      return "file";
    case "txt":
      return "txt";
    case "memory":
      return "memory";
    default:
      return null;
  }
}

/**
 * 解析当前环境应使用的存储后端
 *
 * @throws StorageConfigError 变量缺失或值无法映射时抛出
 */
export function resolveStorageBackend(
  env: Record<string, string | undefined> = process.env
): StorageBackend {
  const direct = env[STORAGE_BACKEND_KEY];
  if (direct !== undefined && direct !== "") {
    if ((BACKENDS as readonly string[]).includes(direct)) {
      return direct as StorageBackend;
    }
    throw new StorageConfigError(
      `[db/resolve] ${STORAGE_BACKEND_KEY} 非法: "${direct}"。` +
        `支持: ${BACKENDS.join(", ")}`
    );
  }

  for (const key of LEGACY_KEYS) {
    const value = env[key];
    if (value !== undefined && value !== "") {
      const normalized = normalizeLegacy(value);
      if (normalized !== null) {
        return normalized;
      }
      throw new StorageConfigError(
        `[db/resolve] ${key}="${value}" 无法映射到 StorageBackend。` +
          `支持: ${BACKENDS.join(", ")}`
      );
    }
  }

  throw new StorageConfigError(
    `[db/resolve] ${STORAGE_BACKEND_KEY} 未设置（禁止自动检测与隐式默认）。` +
      `请显式声明存储后端: ${BACKENDS.join(", ")}。` +
      `兼容旧键: ${LEGACY_KEYS.join(" / ")}（迁移后淘汰）。`
  );
}