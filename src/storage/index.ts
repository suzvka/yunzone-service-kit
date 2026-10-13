/**
 * yunzone-service-kit/storage — 对象存储抽象
 *
 * 集群统一对象存储抽象形状（与 /db 的 SqlDb 抽象同构）：
 * - key 即真理：调用方直接组织 storage key，无字段映射层
 * - 渠道值域开放（2026-10-13）：内置 s3（通用 S3）/ coze（平台注入）/ none（显式无存储）
 *   之外，业务可经 registerStorageChannel 注册自有渠道（kit 辅助定位：不约束业务），
 *   显式声明禁止嗅探
 * - 契约与官方适配器（S3ObjectStore）均在本模块；需要自定义 S3Client
 *   （如注入 mock）时直接实例化 S3ObjectStore，否则用 createObjectStore 快捷入口
 * - 错误归一化：底层 SDK 错误统一包装为 ObjectStoreError
 * - 生命周期：init/disconnect 钩子由组合根统一调度
 */

export { resolveStorageChannel } from "./resolve";
export { createObjectStore } from "./factory";
export { S3ObjectStore } from "./s3";
export type { S3ObjectStoreOptions } from "./s3";
export {
  registerStorageChannel,
  unregisterStorageChannel,
  isKnownStorageChannel,
  getStorageChannelFactory,
  listRegisteredStorageChannels,
  BUILTIN_STORAGE_CHANNELS,
} from "./registry";
export type { StorageChannelFactory, StorageEnv } from "./registry";
export {
  ObjectStoreError,
  ObjectStoreConfigError,
} from "./errors";
export type {
  StorageChannel,
  ObjectStoreConfig,
  UploadParams,
  GetUploadUrlOptions,
  ObjectStore,
} from "./types";
export type { ResolvedStorageConfig } from "../config/storage";
