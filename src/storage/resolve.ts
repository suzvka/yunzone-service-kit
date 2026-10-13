/**
 * 存储渠道解析 — 值域统一
 *
 * 唯一来源 STORAGE_PROVIDER（与 /db 的 resolveDatabaseChannel 同构）：
 * - s3（默认，未设置时）：通用 S3 兼容存储，凭证取自 S3_ENDPOINT_URL / S3_BUCKET_NAME
 * - coze：Coze 平台对象存储集成，按平台注入行为运行（COZE_BUCKET_* 变量组）
 * - none：显式无存储声明（业务不需要对象存储）；任何存储操作（createObjectStore / resolveStorageConfig）
 *   对其 fail-fast 抛 ObjectStoreConfigError，消费方应据此选择非对象存储方案
 * - 业务注册渠道（2026-10-13 开放化）：经 registerStorageChannel 登记的渠道名同属合法
 *   值域（kit 辅助定位：不约束业务）；渠道不合法仍 fail-fast（禁止自动嗅探与隐式默认）
 */

import { ObjectStoreConfigError } from "./errors";
import type { StorageChannel } from "./types";
import {
  BUILTIN_STORAGE_CHANNELS,
  isKnownStorageChannel,
  listRegisteredStorageChannels,
} from "./registry";

/** 渠道环境变量名（唯一真理） */
const STORAGE_PROVIDER_KEY = "STORAGE_PROVIDER";

/**
 * 解析当前环境应使用的存储渠道
 *
 * @throws ObjectStoreConfigError 变量值非法时抛出（内置渠道 + 已注册渠道之外的值）
 */
export function resolveStorageChannel(
  env: Record<string, string | undefined> = process.env
): StorageChannel {
  const value = env[STORAGE_PROVIDER_KEY];
  // 未设置默认 s3（与 /db 未设置默认 postgres 一致；不自动嗅探其他变量）
  if (value === undefined || value === "") {
    return "s3";
  }
  if (isKnownStorageChannel(value)) {
    return value;
  }
  const registered = listRegisteredStorageChannels();
  const registeredNote =
    registered.length > 0 ? `；已注册: ${registered.join(", ")}` : "";
  throw new ObjectStoreConfigError(
    `[storage/resolve] ${STORAGE_PROVIDER_KEY} 非法: "${value}"。` +
      `支持: ${BUILTIN_STORAGE_CHANNELS.join(", ")}${registeredNote}`
  );
}
